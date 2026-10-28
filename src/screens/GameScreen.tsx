import NoSleep from 'nosleep.js'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { MapView, type MapMarker } from '../components/MapView'
import { QrCode } from '../components/QrCode'
import { QrScanner } from '../components/QrScanner'
import { Avatar, Modal, Toasts, type Toast } from '../components/ui'
import { playVoice, sfx, startRecording, unlockAudio, vibrate, type Recording } from '../lib/audio'
import { distM, fmtDist, inZone } from '../lib/geo'
import { SIM, shortCode, type Profile } from '../lib/profile'
import { rpc, sb, uploadMedia } from '../lib/supabase'
import { fmt, gameMs, minMs, now } from '../lib/time'
import { POWER_LABEL, type Game, type GameEvent, type Player, type PowerKey } from '../lib/types'
import type { GameData } from '../lib/useGame'
import { useGeo } from '../lib/useGeo'

const MSG: Record<string, string> = {
  not_running: 'La partie n’est pas en cours',
  paused: 'Partie en pause',
  headstart: 'Attends la fin de l’avance des fugitifs',
  not_hunter: 'Seuls les chasseurs peuvent capturer',
  unknown: 'Joueur introuvable',
  not_free: 'Ce joueur n’est pas libre',
  none_left: 'Plus de charges',
  wrong_role: 'Pas disponible pour ton rôle',
  already_active: 'Brouillage déjà prêt pour le prochain ping',
  too_far: 'Trop loin',
  no_position: 'Pas de position GPS récente — attends le signal',
  taken: 'Déjà accompli par quelqu’un',
  jailed: 'Impossible en prison',
  empty: 'Personne en prison',
  bad_reward: 'Récompense invalide',
  error: 'Erreur serveur — réessaie',
  network: 'Pas de réseau — réessaie',
}

const QR_PREFIX = 'MANHUNT:'
const minutesAgo = (iso: string | null) => (iso ? Math.max(0, Math.floor((now() - Date.parse(iso)) / 60000)) : 0)

interface Props {
  data: GameData
  game: Game
  me: Player
  profile: Profile
  onLeave: () => void
}

export function GameScreen({ data, game, me, onLeave }: Props) {
  const { players, ping, claims, events } = data
  const [, rerender] = useState(0)
  useEffect(() => {
    const t = setInterval(() => rerender(x => x + 1), 500)
    return () => clearInterval(t)
  }, [])

  // ---------- derived game state ----------
  const cfg = game.config
  const gms = gameMs(game)
  const hs = minMs(cfg.headstart_min)
  const dur = minMs(cfg.duration_min)
  const iv = minMs(cfg.ping_min)
  const jailMs = minMs(cfg.jail_min)
  const headstart = gms < hs
  const paused = !!game.paused_at
  const isHost = game.host_id === me.id
  const isHunter = me.status === 'hunter'
  const isJailed = me.status === 'jailed'
  const channel = isHunter ? 'hunter' : 'fugitive'
  const nextPing = headstart ? hs + iv - gms : iv - ((gms - hs) % iv)
  const remaining = dur - gms
  const pw = me.powers ?? {}
  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const nameOf = (id: string | null) => (id && byId.get(id)?.name) || '???'

  const activeReveals = events.filter(e => e.type === 'reveal' && Number(e.data.until_ms) > gms)
  const publicReveals = activeReveals.filter(e => !e.data.secret)
  const revealLeft = Math.max(0, ...activeReveals.map(e => Number(e.data.until_ms) - gms))
  const publicLeft = Math.max(0, ...publicReveals.map(e => Number(e.data.until_ms) - gms))

  const lastSos = events.findLast(e => e.type === 'sos')
  const lastResume = events.findLast(e => e.type === 'resume')
  const sosActive = paused && !!lastSos && (!lastResume || lastResume.id < lastSos.id)
  const sosPlayer = sosActive && lastSos ? byId.get(lastSos.actor ?? '') : undefined

  // ---------- toasts ----------
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((text: string, tone?: Toast['tone'], ms = 4500) => {
    const id = Math.random()
    setToasts(t => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms)
  }, [])

  // ---------- entering: unlock audio + keep the screen awake (needs a tap) ----------
  const [entered, setEntered] = useState(false)
  const noSleep = useRef<NoSleep | null>(null)
  const enter = () => {
    unlockAudio()
    try {
      noSleep.current ??= new NoSleep()
      const r = noSleep.current.enable() as unknown as Promise<void> | undefined
      r?.catch?.(() => {})
    } catch {
      /* wake lock unsupported */
    }
    setEntered(true)
  }
  useEffect(
    () => () => {
      try {
        noSleep.current?.disable()
      } catch {
        /* ignore */
      }
    },
    [],
  )

  // ---------- GPS ----------
  const geo = useGeo(game.id, me.id, true)
  const myPos = geo.pos ?? (me.lat != null && me.lng != null ? { lat: me.lat, lng: me.lng, acc: me.acc ?? 30, at: 0 } : null)
  const meOut = !!myPos && !inZone(game.zone, myPos.lat, myPos.lng)

  // ---------- server tick (jail timeouts, pings, end of game) ----------
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'visible') void rpc('tick', { p_game: game.id })
    }
    run()
    const t = setInterval(run, 3000)
    return () => clearInterval(t)
  }, [game.id])

  // ---------- ambience ----------
  useEffect(() => {
    if (!meOut || !entered) return
    sfx.siren()
    vibrate([300, 100, 300])
    const t = setInterval(() => sfx.siren(), 5000)
    return () => clearInterval(t)
  }, [meOut, entered])

  const secToPing = Math.ceil(nextPing / 1000)
  useEffect(() => {
    if (entered && !paused && secToPing <= 10 && secToPing > 0 && remaining > 0) sfx.heartbeat()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secToPing])

  // ---------- live events → sounds + toasts ----------
  const processed = useRef<number>(events.length ? events[events.length - 1].id : 0)
  useEffect(() => {
    const fresh = events.filter(e => e.id > processed.current)
    if (!fresh.length) return
    processed.current = fresh[fresh.length - 1].id
    for (const e of fresh) {
      if (now() - Date.parse(e.created_at) > 60000) continue // missed while asleep: don't replay
      handleEvent(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])

  function handleEvent(e: GameEvent) {
    switch (e.type) {
      case 'ping':
        sfx.ping()
        vibrate([200, 100, 200])
        toast('PING — toutes les positions sont révélées', 'red')
        break
      case 'capture': {
        sfx.capture()
        vibrate(400)
        const jailed = e.data.result === 'jailed'
        if (e.target === me.id) toast(jailed ? 'TU ES CAPTURÉ — VA EN PRISON' : 'PRIS UNE 2ᵉ FOIS — TU DEVIENS CHASSEUR', 'red', 9000)
        else toast(jailed ? `${nameOf(e.actor)} a capturé ${nameOf(e.target)} → prison` : `${nameOf(e.target)} est pris une 2ᵉ fois → chasseur`, 'red')
        break
      }
      case 'jail_timeout':
        if (e.target === me.id) toast('Personne n’est venu… TU DEVIENS CHASSEUR', 'red', 9000)
        else toast(`${nameOf(e.target)} rejoint les chasseurs`, 'red')
        break
      case 'freed':
        sfx.good()
        toast(`${nameOf(e.actor)} a délivré ${e.data.count} prisonnier${e.data.count > 1 ? 's' : ''} !`, 'green', 6000)
        break
      case 'reveal':
        if (e.data.secret) {
          if (isHunter) toast(`${nameOf(e.actor)} : révélation secrète (30 s)`, 'blue')
        } else if (isHunter) {
          toast(`${nameOf(e.actor)} révèle les fugitifs (30 s)`, 'blue')
        } else {
          sfx.alarm()
          vibrate([500, 200, 500])
          toast('LES CHASSEURS VOIENT TA POSITION — 30 s', 'red', 6000)
        }
        break
      case 'scramble':
        if (e.actor === me.id) toast('Ton prochain ping sera brouillé', 'blue')
        break
      case 'challenge':
        if (e.actor === me.id) {
          sfx.good()
          toast(`Défi accompli : +1 ${POWER_LABEL[e.data.reward as PowerKey] ?? 'pouvoir'}`, 'green')
        } else toast(`${nameOf(e.actor)} a accompli un défi`, 'amber')
        break
      case 'sos':
        sfx.alarm()
        setTimeout(() => sfx.alarm(), 1500)
        vibrate([800, 200, 800, 200, 800])
        break
      case 'pause':
        if (e.data.reason !== 'sos') toast('Partie en pause', 'amber')
        break
      case 'resume':
        toast('La partie reprend', 'amber')
        break
      case 'voice':
        if (e.actor !== me.id && e.data.channel === channel && e.data.url) {
          playVoice(String(e.data.url))
          toast(`🎙 ${nameOf(e.actor)}`, isHunter ? 'red' : 'blue', 3000)
        }
        break
      case 'capture_req':
        if (e.target === me.id) {
          sfx.alarm()
          vibrate([400, 100, 400])
        }
        break
      case 'capture_deny':
        if (e.target === me.id) toast(`${nameOf(e.actor)} conteste la capture`, 'amber')
        break
    }
  }

  // ---------- map markers: who sees whom ----------
  const markers: MapMarker[] = []
  for (const p of players) {
    if (p.id === me.id) {
      if (myPos) markers.push({ id: p.id, lat: myPos.lat, lng: myPos.lng, name: p.name, avatar: p.avatar_url, tone: 'me', out: meOut })
      continue
    }
    const hasPos = p.lat != null && p.lng != null
    const out = hasPos && !inZone(game.zone, p.lat!, p.lng!)
    const tone = p.status === 'hunter' ? 'hunter' : p.status === 'jailed' ? 'jailed' : 'fugitive'
    const staleS = p.pos_at ? Math.round((now() - Date.parse(p.pos_at)) / 1000) : 999
    const live =
      hasPos &&
      ((isHunter && p.status === 'hunter') || out || (isHunter && activeReveals.length > 0 && p.status !== 'hunter') || sosPlayer?.id === p.id)
    if (live) {
      markers.push({
        id: p.id,
        lat: p.lat!,
        lng: p.lng!,
        name: p.name,
        avatar: p.avatar_url,
        tone: sosPlayer?.id === p.id ? 'alert' : tone,
        out,
        sub: sosPlayer?.id === p.id ? 'SOS' : out ? 'HORS ZONE' : staleS > 45 ? `vu il y a ${staleS < 120 ? staleS + ' s' : Math.floor(staleS / 60) + ' min'}` : undefined,
      })
    } else {
      const pp = ping?.positions?.[p.id]
      if (pp) {
        markers.push({
          id: p.id,
          lat: pp.lat,
          lng: pp.lng,
          name: p.name,
          avatar: p.avatar_url,
          tone: pp.status === 'hunter' ? 'hunter' : pp.status === 'jailed' ? 'jailed' : 'fugitive',
          ghost: true,
          sub: `ping · ${minutesAgo(ping!.created_at)} min`,
        })
      }
    }
  }

  const claimMap = new Map(claims.map(c => [c.challenge_id, c.player_id]))
  const mapChallenges = game.challenges.map((c, i) => ({ id: c.id, lat: c.lat, lng: c.lng, label: String(i + 1).padStart(2, '0'), done: claimMap.has(c.id) }))
  const openChallenges = game.challenges.filter(c => !claimMap.has(c.id)).length

  // ---------- prison ----------
  const prisoners = players.filter(p => p.status === 'jailed')
  const distPrison = myPos ? distM(myPos.lat, myPos.lng, game.prison.lat, game.prison.lng) : null
  const prisonReach = game.prison.radius + Math.min(myPos?.acc ?? 0, 20)
  const canFree = me.status === 'free' && prisoners.length > 0 && distPrison != null && distPrison <= prisonReach
  const jailLeft = isJailed && me.jailed_ms != null ? me.jailed_ms + jailMs - gms : 0

  // ---------- UI state ----------
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [chOpen, setChOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sosConfirm, setSosConfirm] = useState(false)
  const [endConfirm, setEndConfirm] = useState(false)
  const [rewardFor, setRewardFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const answered = useRef(new Set<number>())
  const [, bumpAnswered] = useState(0)

  const act = async (key: string, fn: () => Promise<string>) => {
    if (busy) return 'busy'
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (!['ok', 'jailed', 'converted'].includes(r)) toast(MSG[r] ?? 'Erreur — réessaie', 'amber')
    return r
  }

  const firePower = (k: PowerKey) => act(k, () => rpc('use_power', { p_game: game.id, p_by: me.id, p_power: k }))
  const capture = (targetId: string) => {
    setCaptureOpen(false)
    void act('capture', () => rpc('capture_player', { p_game: game.id, p_target: targetId, p_by: me.id }))
  }
  const declare = async (targetId: string) => {
    setCaptureOpen(false)
    const { error } = await sb.from('events').insert({ game_id: game.id, type: 'capture_req', actor: me.id, target: targetId })
    toast(error ? MSG.network : `Demande envoyée à ${nameOf(targetId)} — il doit confirmer`, error ? 'amber' : 'blue')
  }
  const freePrisoners = () => act('free', () => rpc('free_prisoners', { p_game: game.id, p_by: me.id }))
  const claim = (chId: string, reward: PowerKey) => {
    setRewardFor(null)
    void act('claim', () => rpc('claim_challenge', { p_game: game.id, p_by: me.id, p_challenge: chId, p_reward: reward }))
  }
  const setPause = (p: boolean) => act('pause', () => rpc('set_pause', { p_game: game.id, p_by: me.id, p_pause: p, p_reason: 'host' }))
  const sendSos = async () => {
    setSosConfirm(false)
    unlockAudio()
    const r = await rpc('send_sos', { p_game: game.id, p_by: me.id })
    if (r !== 'ok') toast(MSG[r] ?? 'SOS non envoyé — réessaie !', 'red')
  }

  // Capture requests waiting for MY confirmation.
  const pendingReq =
    me.status === 'free'
      ? events.findLast(
          e =>
            e.type === 'capture_req' &&
            e.target === me.id &&
            !answered.current.has(e.id) &&
            now() - Date.parse(e.created_at) < 90000 &&
            !events.some(d => d.type === 'capture_deny' && d.data.req === e.id),
        )
      : undefined
  const answerReq = async (req: GameEvent, accept: boolean) => {
    answered.current.add(req.id)
    bumpAnswered(x => x + 1)
    if (accept) {
      const r = await rpc('capture_player', { p_game: game.id, p_target: me.id, p_by: req.actor })
      if (!['jailed', 'converted'].includes(r)) toast(MSG[r] ?? 'Erreur', 'amber')
    } else {
      await sb.from('events').insert({ game_id: game.id, type: 'capture_deny', actor: me.id, target: req.actor, data: { req: req.id } })
    }
  }

  const recenter = () => myPos && setFocus({ lat: myPos.lat, lng: myPos.lng, key: Date.now() })

  // ---------- render ----------
  const roleLabel = isHunter ? 'Chasseur' : isJailed ? 'Prisonnier' : 'Fugitif'
  const roleCls = isHunter ? 'hunter' : isJailed ? 'jailed' : 'fugitive'

  return (
    <div className={`game role-${roleCls} ${meOut ? 'is-out' : ''} ${sosActive ? 'is-sos' : ''}`}>
      <MapView
        zone={game.zone}
        prison={game.prison}
        challenges={mapChallenges}
        markers={markers}
        accuracy={myPos}
        fitKey={1}
        focus={focus}
        onMapClick={SIM ? geo.simSet : undefined}
        onChallengeClick={() => setChOpen(true)}
      />
      <div className="vignette" />

      <div className="hud">
        <div className={`role-badge ${roleCls}`}>
          <Avatar url={me.avatar_url} name={me.name} size={30} />
          <span>{roleLabel}</span>
        </div>
        <div className="hud-mid">
          <b className="mono timer">{fmt(remaining)}</b>
          <small className={`mono ${secToPing <= 10 ? 'blink' : ''}`}>PING {fmt(nextPing)}</small>
        </div>
        <button className="sos-btn" onClick={() => setSosConfirm(true)}>SOS</button>
        <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">☰</button>
      </div>

      <div className="banners">
        {!data.online && <div className="banner amber">Connexion perdue — reconnexion…</div>}
        {geo.error ? <div className="banner amber">{geo.error}</div> : !myPos && <div className="banner amber">Recherche du signal GPS…</div>}
        {sosActive && (
          <div className="banner red flash">
            SOS — {sosPlayer?.name ?? '???'} a besoin d’aide · partie en pause
            <div className="banner-actions">
              {sosPlayer?.lat != null && (
                <button onClick={() => setFocus({ lat: sosPlayer.lat!, lng: sosPlayer.lng!, key: Date.now() })}>Voir</button>
              )}
              {(isHost || lastSos?.actor === me.id) && <button onClick={() => void setPause(false)}>Reprendre</button>}
            </div>
          </div>
        )}
        {paused && !sosActive && (
          <div className="banner amber">
            Partie en pause
            {isHost && (
              <div className="banner-actions">
                <button onClick={() => void setPause(false)}>Reprendre</button>
              </div>
            )}
          </div>
        )}
        {headstart && !isHunter && <div className="banner red">FUIS ! Les chasseurs partent dans {fmt(hs - gms)}</div>}
        {meOut && <div className="banner red flash">HORS ZONE — ta position est visible en direct</div>}
        {!isHunter && publicLeft > 0 && <div className="banner red flash">Les chasseurs te voient — {Math.ceil(publicLeft / 1000)} s</div>}
        {isHunter && revealLeft > 0 && <div className="banner blue">Révélation active — {Math.ceil(revealLeft / 1000)} s</div>}
        {isJailed && (
          <div className="banner jailed">
            EN PRISON — chasseur dans {fmt(jailLeft)}
            <small>
              {distPrison != null && distPrison > game.prison.radius ? `Rends-toi à la prison (${fmtDist(distPrison)})` : 'Attends qu’un fugitif vienne te délivrer'}
            </small>
          </div>
        )}
        {!isHunter && !isJailed && me.scramble_ping != null && <div className="banner blue">Brouillage prêt pour le prochain ping</div>}
      </div>

      <Toasts items={toasts} />

      <button className="recenter" onClick={recenter} aria-label="Me recentrer">◎</button>

      <div className="bar">
        <div className="bar-row">
          {isHunter ? (
            <>
              <button className="btn primary act" disabled={headstart || paused} onClick={() => setCaptureOpen(true)}>
                Capturer
              </button>
              <button className="btn act" disabled={!pw.reveal_public || headstart || paused || !!busy} onClick={() => void firePower('reveal_public')}>
                Révéler<small>×{pw.reveal_public ?? 0} · avertit</small>
              </button>
              <button className="btn act" disabled={!pw.reveal_secret || headstart || paused || !!busy} onClick={() => void firePower('reveal_secret')}>
                En secret<small>×{pw.reveal_secret ?? 0} · invisible</small>
              </button>
            </>
          ) : isJailed ? (
            <div className="jail-info mono">
              {prisoners.length} prisonnier{prisoners.length > 1 ? 's' : ''} · un fugitif libre doit entrer dans la prison
            </div>
          ) : (
            <>
              <button className="btn act" onClick={() => setCodeOpen(true)}>Mon code</button>
              <button className="btn act" disabled={!pw.scramble || me.scramble_ping != null || paused || !!busy} onClick={() => void firePower('scramble')}>
                Brouiller<small>×{pw.scramble ?? 0} · prochain ping</small>
              </button>
              {prisoners.length > 0 && (
                <button className={`btn act ${canFree ? 'primary pulse' : ''}`} disabled={!canFree || paused || !!busy} onClick={() => void freePrisoners()}>
                  Délivrer
                  <small>
                    {canFree ? `${prisoners.length} prisonnier${prisoners.length > 1 ? 's' : ''}` : distPrison != null ? `prison à ${fmtDist(Math.max(0, distPrison - game.prison.radius))}` : '—'}
                  </small>
                </button>
              )}
            </>
          )}
        </div>
        <div className="bar-row">
          <button className="btn act" onClick={() => setChOpen(true)}>
            Défis<small>{openChallenges} restant{openChallenges > 1 ? 's' : ''}</small>
          </button>
          <Walkie gameId={game.id} meId={me.id} channel={channel} onError={m => toast(m, 'amber')} />
        </div>
      </div>

      {headstart && isHunter && (
        <div className="headstart">
          <p>Les fugitifs s’enfuient</p>
          <b className="mono">{fmt(hs - gms)}</b>
          <small>Ne bouge pas. Écoute. La chasse commence bientôt.</small>
        </div>
      )}

      {!entered && (
        <div className="enter" onClick={enter}>
          <div className={`enter-role ${roleCls}`}>
            <small>Tu es</small>
            <b className="glitch" data-text={roleLabel.toUpperCase()}>{roleLabel.toUpperCase()}</b>
          </div>
          <p>{isHunter ? 'Traque-les. Personne ne s’échappe.' : isJailed ? 'Prie pour qu’on vienne te chercher.' : 'Cours. Cache-toi. Survis.'}</p>
          <button className="btn primary big">Entrer dans la chasse</button>
          <small className="dim">Garde l’écran allumé · son activé · mode silencieux désactivé</small>
        </div>
      )}

      {/* ---------- modals ---------- */}
      {pendingReq && (
        <Modal title="Capture" tone="red">
          <p className="big-msg">{nameOf(pendingReq.actor)} dit t’avoir attrapé.</p>
          <div className="row">
            <button className="btn primary big" onClick={() => void answerReq(pendingReq, true)}>Oui, je suis pris</button>
            <button className="btn big" onClick={() => void answerReq(pendingReq, false)}>Non</button>
          </div>
        </Modal>
      )}

      {captureOpen && (
        <CaptureModal
          game={game}
          players={players}
          onClose={() => setCaptureOpen(false)}
          onCapture={capture}
          onDeclare={id => void declare(id)}
          onBadQr={() => toast('QR inconnu', 'amber')}
        />
      )}

      {codeOpen && (
        <Modal title="Mon code" onClose={() => setCodeOpen(false)}>
          <p className="hint">Montre ce code au chasseur qui t’a attrapé.</p>
          <div className="qr-wrap">
            <QrCode text={QR_PREFIX + me.id} />
          </div>
          <b className="code">{shortCode(me.id)}</b>
        </Modal>
      )}

      {chOpen && (
        <Modal title="Défis" onClose={() => setChOpen(false)} tone="amber">
          <p className="hint">Rends-toi au point, fais le défi, puis appuie sur « Accompli ». Le premier arrivé gagne +1 pouvoir.</p>
          <div className="ch-list">
            {game.challenges.map((c, i) => {
              const by = claimMap.get(c.id)
              const d = myPos ? distM(myPos.lat, myPos.lng, c.lat, c.lng) : null
              const near = d != null && d <= 40 + Math.min(myPos?.acc ?? 0, 20)
              return (
                <div key={c.id} className={`ch-row ${by ? 'done' : ''}`}>
                  <b className="mono">{String(i + 1).padStart(2, '0')}</b>
                  <div className="ch-text">
                    <p>{c.text}</p>
                    <small className="mono">{by ? `Accompli par ${nameOf(by)}` : d != null ? fmtDist(d) : 'position inconnue'}</small>
                  </div>
                  <div className="ch-actions">
                    {!by && (
                      <button
                        className={`btn sm ${near ? 'primary' : ''}`}
                        disabled={!near || isJailed || headstart || paused || !!busy}
                        onClick={() => (isHunter ? setRewardFor(c.id) : claim(c.id, 'scramble'))}
                      >
                        {near ? 'Accompli' : 'Trop loin'}
                      </button>
                    )}
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        setChOpen(false)
                        setFocus({ lat: c.lat, lng: c.lng, key: Date.now() })
                      }}
                    >
                      Voir
                    </button>
                  </div>
                </div>
              )
            })}
            {!game.challenges.length && <p className="hint">Aucun défi dans cette partie.</p>}
          </div>
        </Modal>
      )}

      {rewardFor && (
        <Modal title="Récompense" onClose={() => setRewardFor(null)}>
          <p className="hint">Choisis ton pouvoir bonus.</p>
          <button className="btn big" onClick={() => claim(rewardFor, 'reveal_public')}>+1 Révélation (avertit)</button>
          <button className="btn big" onClick={() => claim(rewardFor, 'reveal_secret')}>+1 Révélation secrète</button>
        </Modal>
      )}

      {sosConfirm && (
        <Modal title="SOS" tone="red" onClose={() => setSosConfirm(false)}>
          <p className="big-msg">Envoyer une alerte à tous les joueurs ?</p>
          <p className="hint">Ta position sera montrée à tout le monde et la partie sera mise en pause.</p>
          <button className="btn primary big" onClick={() => void sendSos()}>Envoyer l’alerte</button>
          <button className="btn ghost" onClick={() => setSosConfirm(false)}>Annuler</button>
        </Modal>
      )}

      {menuOpen && (
        <Modal title="Menu" onClose={() => setMenuOpen(false)}>
          <span className="field-label">Joueurs</span>
          <div className="plist">
            {[...players]
              .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
              .map(p => (
                <div key={p.id} className="prow">
                  <Avatar url={p.avatar_url} name={p.name} size={34} tone={p.status === 'hunter' ? 'hunter' : p.status === 'jailed' ? 'jailed' : 'fugitive'} />
                  <span className="pname">{p.name}{p.id === me.id && <em> · toi</em>}</span>
                  <span className="mono dim">
                    {p.status === 'hunter' ? `chasseur · ${p.captures} cap.` : p.status === 'jailed' ? 'prison' : 'libre'}
                  </span>
                </div>
              ))}
          </div>
          <p className="mono dim">Code de la partie : {game.code}</p>
          {isHost && (
            <button className="btn" onClick={() => void setPause(!paused)}>
              {paused ? 'Reprendre la partie' : 'Mettre en pause'}
            </button>
          )}
          {isHost && (
            <button className="btn" onClick={() => setEndConfirm(true)}>Terminer la partie</button>
          )}
          <button className="btn ghost" onClick={onLeave}>Revenir au menu (rejoindre avec le code)</button>
        </Modal>
      )}

      {endConfirm && (
        <Modal title="Terminer" tone="red" onClose={() => setEndConfirm(false)}>
          <p className="big-msg">Arrêter la partie pour tout le monde ?</p>
          <button
            className="btn primary big"
            onClick={() => {
              setEndConfirm(false)
              setMenuOpen(false)
              void rpc('end_game', { p_game: game.id, p_by: me.id })
            }}
          >
            Terminer
          </button>
        </Modal>
      )}
    </div>
  )
}

const order = (p: Player) => (p.status === 'free' ? 0 : p.status === 'jailed' ? 1 : 2)

function CaptureModal({
  game, players, onClose, onCapture, onDeclare, onBadQr,
}: {
  game: Game
  players: Player[]
  onClose: () => void
  onCapture: (id: string) => void
  onDeclare: (id: string) => void
  onBadQr: () => void
}) {
  const tabs = [
    ...(game.config.capture_qr ? [{ k: 'scan', l: 'Scanner' }, { k: 'code', l: 'Code' }] : []),
    ...(game.config.capture_declare ? [{ k: 'declare', l: 'Déclarer' }] : []),
  ]
  const [tab, setTab] = useState(tabs[0]?.k ?? 'declare')
  const [code, setCode] = useState('')
  const free = players.filter(p => p.status === 'free')

  const onScan = (txt: string) => {
    const id = txt.startsWith(QR_PREFIX) ? txt.slice(QR_PREFIX.length) : ''
    if (id && players.some(p => p.id === id)) onCapture(id)
    else onBadQr()
  }
  const byCode = free.find(p => shortCode(p.id) === code.toUpperCase())

  return (
    <Modal title="Capturer" tone="red" onClose={onClose}>
      <div className="seg">
        {tabs.map(t => (
          <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>
      {tab === 'scan' && <QrScanner onResult={onScan} />}
      {tab === 'code' && (
        <>
          <input
            className="input code-input"
            maxLength={4}
            value={code}
            placeholder="XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button className="btn primary big" disabled={!byCode} onClick={() => byCode && onCapture(byCode.id)}>
            {byCode ? `Capturer ${byCode.name}` : code.length === 4 ? 'Code inconnu' : 'Entre le code du fugitif'}
          </button>
        </>
      )}
      {tab === 'declare' && (
        <>
          <p className="hint">Le fugitif devra confirmer sur son téléphone.</p>
          <div className="plist">
            {free.map(p => (
              <button key={p.id} className="prow btnrow" onClick={() => onDeclare(p.id)}>
                <Avatar url={p.avatar_url} name={p.name} size={40} tone="fugitive" />
                <span className="pname">{p.name}</span>
                <span className="mono">ATTRAPÉ ›</span>
              </button>
            ))}
            {!free.length && <p className="hint">Aucun fugitif libre.</p>}
          </div>
        </>
      )}
    </Modal>
  )
}

function Walkie({ gameId, meId, channel, onError }: { gameId: string; meId: string; channel: string; onError: (m: string) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'send'>('idle')
  const stateRef = useRef(state)
  stateRef.current = state
  const rec = useRef<Recording | null>(null)
  const held = useRef(false)
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stop = async () => {
    held.current = false
    clearTimeout(limit.current)
    const r = rec.current
    rec.current = null
    if (!r) return
    setState('send')
    try {
      const res = await r.stop()
      if (res) {
        const url = await uploadMedia(`voice/${gameId}/${Date.now()}-${meId.slice(0, 8)}.wav`, res.blob, 'audio/wav')
        if (!url) throw new Error('upload')
        const { error } = await sb.from('events').insert({ game_id: gameId, type: 'voice', actor: meId, data: { url, channel, dur: Math.round(res.durationMs) } })
        if (error) throw error
        sfx.radio()
      }
    } catch {
      onError('Message vocal non envoyé')
    }
    setState('idle')
  }

  const start = async (e: RPointerEvent) => {
    e.preventDefault()
    if (stateRef.current !== 'idle') return
    held.current = true
    unlockAudio()
    try {
      const r = await startRecording()
      if (!held.current) {
        r.cancel()
        return
      }
      rec.current = r
      setState('rec')
      vibrate(30)
      limit.current = setTimeout(() => void stop(), 20000)
    } catch {
      held.current = false
      onError('Micro refusé — autorise le micro pour ce site')
    }
  }

  return (
    <button
      className={`btn act walkie ${state}`}
      onPointerDown={e => void start(e)}
      onPointerUp={() => void stop()}
      onPointerCancel={() => void stop()}
      onPointerLeave={() => held.current && void stop()}
      onContextMenu={e => e.preventDefault()}
    >
      {state === 'rec' ? '● Enregistre…' : state === 'send' ? 'Envoi…' : 'Parler'}
      <small>{state === 'idle' ? `maintenir · ${channel === 'hunter' ? 'chasseurs' : 'fugitifs'}` : 'relâche pour envoyer'}</small>
    </button>
  )
}
