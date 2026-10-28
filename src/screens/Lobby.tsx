import { useState } from 'react'
import { QrCode } from '../components/QrCode'
import { Avatar, Logo } from '../components/ui'
import { startRecording, unlockAudio } from '../lib/audio'
import type { Profile } from '../lib/profile'
import { rpc, sb } from '../lib/supabase'
import { REVEAL_S, type Game, type Player } from '../lib/types'

export function Lobby({ game, players, profile, onLeave }: { game: Game; players: Player[]; profile: Profile; onLeave: () => void }) {
  const isHost = game.host_id === profile.id
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [gpsInfo, setGpsInfo] = useState('')
  const [micInfo, setMicInfo] = useState('')
  const c = game.config
  const sorted = [...players].sort((a, b) => a.joined_at.localeCompare(b.joined_at))
  const nh = players.filter(p => p.role === 'hunter').length
  const nf = players.length - nh
  const drawCount = Math.min(c.hunters, Math.max(1, players.length - 1))

  const toggle = async (p: Player) => {
    if (!isHost) return
    await sb.from('players').update({ role: p.role === 'hunter' ? 'fugitive' : 'hunter' }).eq('game_id', game.id).eq('id', p.id)
  }

  const draw = async () => {
    if (players.length < 2) return setErr('Il faut au moins 2 joueurs.')
    setErr('')
    const n = Math.min(c.hunters, players.length - 1)
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    const hunters = new Set(shuffled.slice(0, n).map(p => p.id))
    await Promise.all(
      players.map(p =>
        sb.from('players').update({ role: hunters.has(p.id) ? 'hunter' : 'fugitive' }).eq('game_id', game.id).eq('id', p.id),
      ),
    )
  }

  const kick = async (p: Player) => {
    if (!confirm(`Retirer ${p.name} de la partie ?`)) return
    await sb.from('players').delete().eq('game_id', game.id).eq('id', p.id)
  }

  const start = async () => {
    unlockAudio()
    setBusy(true)
    setErr('')
    const r = await rpc('start_game', { p_game: game.id, p_by: profile.id })
    setBusy(false)
    if (r === 'need_roles') setErr('Il faut au moins 1 chasseur et 1 fugitif.')
    else if (r !== 'ok' && r !== 'already_started') setErr('Impossible de lancer. Réessaie.')
  }

  const leave = async () => {
    if (isHost) {
      if (!confirm('Annuler la partie pour tout le monde ?')) return
      await sb.from('games').delete().eq('id', game.id)
    } else {
      await sb.from('players').delete().eq('game_id', game.id).eq('id', profile.id)
    }
    onLeave()
  }

  const joinUrl = `${location.origin}${location.pathname}?join=${game.code}`

  const share = async () => {
    const url = joinUrl
    try {
      if (navigator.share) await navigator.share({ title: 'MAN HUNT', text: `Rejoins la chasse : code ${game.code}`, url })
      else {
        await navigator.clipboard.writeText(url)
        setErr('Lien copié.')
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  // Ask for permissions now, so no prompt pops up mid-chase.
  const testGps = () => {
    unlockAudio()
    setGpsInfo('Recherche…')
    navigator.geolocation?.getCurrentPosition(
      p => setGpsInfo(`OK · précision ${Math.round(p.coords.accuracy)} m`),
      e => setGpsInfo(e.code === 1 ? 'REFUSÉ — active la localisation pour ce site' : 'Pas de signal, réessaie dehors'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }
  const testMic = async () => {
    unlockAudio()
    try {
      const r = await startRecording()
      r.cancel()
      setMicInfo('OK')
    } catch {
      setMicInfo('REFUSÉ — le walkie-talkie ne marchera pas')
    }
  }

  return (
    <div className="screen lobby">
      <Logo small />
      <div className="code-box">
        <span className="field-label">Scanne pour rejoindre</span>
        <div className="lobby-qr">
          <QrCode text={joinUrl} size={220} />
        </div>
        <small>Ouvre l’appareil photo et vise le code : l’app s’ouvre et rejoint la partie.</small>
        <b className="code">{game.code}</b>
        <button className="btn sm" onClick={share}>Partager le lien</button>
      </div>

      <div className="panel">
        <div className="row between">
          <span className="field-label">Joueurs · {players.length}</span>
          <span className="mono dim">{nh} chasseur{nh > 1 ? 's' : ''} · {nf} fugitif{nf > 1 ? 's' : ''}</span>
        </div>
        <div className="plist">
          {sorted.map(p => (
            <div key={p.id} className="prow">
              <Avatar url={p.avatar_url} name={p.name} size={40} tone={p.role} />
              <span className="pname">
                {p.name}
                {p.id === game.host_id && <em> · hôte</em>}
                {p.id === profile.id && <em> · toi</em>}
              </span>
              <button className={`role-tag ${p.role}`} onClick={() => toggle(p)} disabled={!isHost}>
                {p.role === 'hunter' ? 'Chasseur' : 'Fugitif'}
              </button>
              {isHost && p.id !== profile.id && (
                <button className="x" onClick={() => kick(p)} aria-label="Retirer">✕</button>
              )}
            </div>
          ))}
        </div>
        {isHost && (
          <button className="btn" onClick={draw}>
            Tirage au sort ({drawCount} chasseur{drawCount > 1 ? 's' : ''})
          </button>
        )}
        {isHost && <p className="hint">Touche un rôle pour le changer.</p>}
      </div>

      <div className="panel">
        <span className="field-label">Avant de partir</span>
        <div className="row">
          <button className="btn sm" onClick={testGps}>Tester le GPS</button>
          <span className="mono dim">{gpsInfo}</span>
        </div>
        <div className="row">
          <button className="btn sm" onClick={testMic}>Tester le micro</button>
          <span className="mono dim">{micInfo}</span>
        </div>
        <p className="hint">Garde l’app ouverte pendant toute la partie (écran allumé). Apporte une batterie externe. Désactive le mode silencieux.</p>
      </div>

      <div className="panel rules">
        <span className="field-label">Règles</span>
        <ul>
          <li>{c.duration_min} min de partie · {c.headstart_min} min d’avance pour les fugitifs</li>
          <li>Ping de tout le monde toutes les {c.ping_min} min</li>
          <li>Hors zone = position visible en direct</li>
          <li>Fugitif attrapé (scan de son QR) = il devient chasseur</li>
          {c.shrink_enabled && <li>La zone rétrécit de {c.shrink_m} m toutes les {c.shrink_every_min} min</li>}
          <li>Pouvoirs des chasseurs : {REVEAL_S} s</li>
          <li>Le dernier fugitif libre gagne</li>
        </ul>
      </div>

      {err && <p className="err">{err}</p>}
      <div className="grow" />
      {isHost ? (
        <button className="btn primary big pulse" disabled={busy} onClick={start}>
          {busy ? '…' : 'Que la chasse commence'}
        </button>
      ) : (
        <p className="waiting">En attente de l’hôte…</p>
      )}
      <button className="btn ghost" onClick={leave}>{isHost ? 'Annuler la partie' : 'Quitter'}</button>
    </div>
  )
}
