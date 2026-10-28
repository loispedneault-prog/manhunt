import { useEffect, useMemo, useState } from 'react'
import { MapView } from '../components/MapView'
import { Check, Seg, Stepper } from '../components/ui'
import { pickTexts } from '../lib/challenges'
import { fmtDist, shrinkZone, spreadPoints, zoneAreaM2 } from '../lib/geo'
import { loadDraft, saveDraft, uuid, type Profile } from '../lib/profile'
import { ensurePlayer, sb } from '../lib/supabase'
import { DEFAULT_CONFIG, REVEAL_S, type Challenge, type Config, type LatLng } from '../lib/types'

interface Draft {
  config: Config
  zone: LatLng[]
  challenges: Challenge[]
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

export function Create({ profile, onCancel, onCreated }: { profile: Profile; onCancel: () => void; onCreated: (id: string, p: Profile) => void }) {
  const initial = useMemo<Draft>(() => {
    const d = loadDraft<Draft>()
    return {
      config: { ...DEFAULT_CONFIG, ...(d?.config ?? {}) },
      zone: d?.zone ?? [],
      challenges: d?.challenges ?? [],
    }
  }, [])
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<Config>(initial.config)
  const [zone, setZone] = useState<LatLng[]>(initial.zone)
  const [challenges, setChallenges] = useState<Challenge[]>(initial.challenges)
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fitKey, setFitKey] = useState(0)

  useEffect(() => saveDraft({ config, zone, challenges }), [config, zone, challenges])

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setConfig(c => ({ ...c, [k]: v }))

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      p => setFocus({ lat: p.coords.latitude, lng: p.coords.longitude, key: Date.now() }),
      () => setErr('Impossible de te localiser. Déplace la carte à la main.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Center on the host the first time the map step opens without a zone.
  useEffect(() => {
    if (step === 1 && zone.length === 0) locate()
    if (step >= 1 && zone.length >= 3) setFitKey(k => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const changeZone = (z: LatLng[]) => {
    setZone(z)
    setChallenges([])
  }

  const onMapClick = (lat: number, lng: number) => {
    setErr('')
    if (step === 1) changeZone([...zone, [lat, lng]])
  }

  const generate = (keepTexts = false) => {
    const pts = spreadPoints(zone, config.challenge_count)
    const texts = keepTexts && challenges.length === pts.length ? challenges.map(c => c.text) : pickTexts(pts.length)
    setChallenges(pts.map((p, i) => ({ id: uuid().slice(0, 8), lat: p[0], lng: p[1], text: texts[i] })))
  }

  useEffect(() => {
    if (step === 2 && challenges.length !== config.challenge_count) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const zoneOk = zone.length >= 3
  const area = zoneAreaM2(zone)
  // How many shrinks before the zone stops at its minimum size (vertices 25 m from the center).
  const shrinkCount = useMemo(() => {
    if (!config.shrink_enabled || !zoneOk || config.shrink_m <= 0) return 0
    let n = 0
    let prev = JSON.stringify(zone)
    while (n < 100) {
      const next = JSON.stringify(shrinkZone(zone, (n + 1) * config.shrink_m))
      if (next === prev) break
      prev = next
      n++
    }
    return n
  }, [config.shrink_enabled, config.shrink_m, zone, zoneOk])

  const next = () => {
    setErr('')
    if (step === 0) {
      if (!config.capture_qr && !config.capture_declare) return setErr('Choisis au moins une façon d’éliminer.')
      return setStep(1)
    }
    if (step === 1) {
      if (!zoneOk) return setErr('Trace la zone : au moins 3 points.')
      return setStep(2)
    }
  }

  const create = async () => {
    setBusy(true)
    setErr('')
    try {
      let gameId: string | null = null
      for (let attempt = 0; attempt < 6 && !gameId; attempt++) {
        const { data, error } = await sb
          .from('games')
          .insert({ code: genCode(), host_id: profile.id, config, zone, challenges })
          .select('id')
          .single()
        if (!error) gameId = data.id
        else if (error.code !== '23505') {
          console.error(error)
          break
        }
      }
      if (!gameId) return setErr('Création impossible. Vérifie ta connexion.')
      const res = await ensurePlayer(gameId, profile)
      if (!res.ok) return setErr('Création impossible. Vérifie ta connexion.')
      onCreated(gameId, res.profile)
    } finally {
      setBusy(false)
    }
  }

  const back = () => (step === 0 ? onCancel() : setStep(step - 1))

  return (
    <div className={`screen create ${step > 0 ? 'with-map' : ''}`}>
      <div className="topbar">
        <button className="btn ghost sm" onClick={back}>‹ Retour</button>
        <span className="steps">
          {['Réglages', 'Zone', 'Défis'].map((s, i) => (
            <b key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</b>
          ))}
        </span>
      </div>

      {step === 0 && (
        <div className="form">
          <h3 className="h3">Partie</h3>
          <Stepper label="Durée" value={config.duration_min} min={15} max={240} step={15} suffix=" min" onChange={v => set('duration_min', v)} />
          <Seg label="Avance des fugitifs" value={config.headstart_min} options={[{ value: 5, label: '5 min' }, { value: 10, label: '10 min' }]} onChange={v => set('headstart_min', v)} />
          <Stepper label="Ping toutes les" value={config.ping_min} min={5} max={15} suffix=" min" onChange={v => set('ping_min', v)} />
          <Stepper label="Chasseurs (tirage au sort)" value={config.hunters} min={1} max={6} onChange={v => set('hunters', v)} />

          <h3 className="h3">Zone</h3>
          <Check label="Rétrécissement de la zone" checked={config.shrink_enabled} onChange={v => set('shrink_enabled', v)} />
          {config.shrink_enabled && (
            <>
              <Stepper label="Rétrécit toutes les" value={config.shrink_every_min} min={1} max={60} suffix=" min" onChange={v => set('shrink_every_min', v)} />
              <Stepper label="De" value={config.shrink_m} min={10} max={500} step={10} suffix=" m" onChange={v => set('shrink_m', v)} />
              <p className="hint">La zone se resserre vers son centre après l’avance des fugitifs. Le prochain contour est affiché en pointillé jaune sur la carte.</p>
            </>
          )}

          <h3 className="h3">Élimination</h3>
          <Check label="Scan du QR code du fugitif" checked={config.capture_qr} onChange={v => set('capture_qr', v)} />
          <Check label="« Attrapé ! » + confirmation du fugitif" checked={config.capture_declare} onChange={v => set('capture_declare', v)} />
          <p className="hint">Un fugitif attrapé devient immédiatement chasseur.</p>

          <h3 className="h3">Pouvoirs (par joueur)</h3>
          <Stepper label={`Chasseurs · Révélation ${REVEAL_S} s (fugitifs avertis)`} value={config.pw_reveal_public} min={0} max={10} onChange={v => set('pw_reveal_public', v)} />
          <Stepper label={`Chasseurs · Révélation secrète ${REVEAL_S} s`} value={config.pw_reveal_secret} min={0} max={10} onChange={v => set('pw_reveal_secret', v)} />
          <Stepper label="Fugitifs · Brouiller le prochain ping" value={config.pw_scramble} min={0} max={10} onChange={v => set('pw_scramble', v)} />

          <h3 className="h3">Défis</h3>
          <Stepper label="Nombre de défis sur la carte" value={config.challenge_count} min={0} max={12} onChange={v => { set('challenge_count', v); setChallenges([]) }} />
          <p className="hint">Accomplir un défi = +1 pouvoir. Les défis sont placés le plus loin possible les uns des autres.</p>
        </div>
      )}

      {step === 1 && (
        <>
          <div className="map-box">
            <MapView zone={zone} drawing onMapClick={onMapClick} focus={focus} fitKey={fitKey} />
          </div>
          <div className="map-tools">
            <p className="hint">Touche la carte pour tracer le contour de la zone. Tout ce qui est dehors devient rouge.</p>
            <div className="row">
              <button className="btn sm" disabled={!zone.length} onClick={() => changeZone(zone.slice(0, -1))}>Annuler point</button>
              <button className="btn sm" disabled={!zone.length} onClick={() => changeZone([])}>Effacer</button>
              <button className="btn sm" onClick={locate}>Me localiser</button>
            </div>
            <p className="mono dim">{zone.length} points{zoneOk ? ` · ${(area / 1e6).toFixed(2).replace('.', ',')} km²` : ''}</p>
            {config.shrink_enabled && zoneOk && (
              <p className="mono dim">
                Rétrécissement : {shrinkCount} fois (≈ {shrinkCount * config.shrink_every_min} min) avant la taille minimale.
              </p>
            )}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="map-box short">
            <MapView
              zone={zone}
              fitKey={fitKey}
              challenges={challenges.map((c, i) => ({ id: c.id, lat: c.lat, lng: c.lng, label: String(i + 1).padStart(2, '0'), done: false }))}
            />
          </div>
          <div className="map-tools">
            <div className="row">
              <button className="btn sm" onClick={() => generate(true)}>Replacer les défis</button>
              <button className="btn sm" onClick={() => generate(false)}>Tout regénérer</button>
            </div>
            {challenges.length > 0 && challenges.length < config.challenge_count && (
              <p className="err">Zone trop petite pour {config.challenge_count} défis.</p>
            )}
            <div className="ch-list">
              {challenges.map((c, i) => (
                <div key={c.id} className="ch-item">
                  <b className="mono">{String(i + 1).padStart(2, '0')}</b>
                  <textarea
                    className="input"
                    rows={3}
                    value={c.text}
                    onChange={e => setChallenges(cs => cs.map(x => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                  />
                  <button
                    className="btn sm"
                    aria-label="Autre défi"
                    onClick={() => setChallenges(cs => cs.map(x => (x.id === c.id ? { ...x, text: pickTexts(1, cs.map(y => y.text))[0] } : x)))}
                  >
                    ↻
                  </button>
                </div>
              ))}
              {challenges.length > 1 && (
                <p className="mono dim">
                  Écart minimum entre défis :{' '}
                  {fmtDist(
                    Math.min(
                      ...challenges.flatMap((a, i) =>
                        challenges.slice(i + 1).map(b => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180))),
                      ),
                    ),
                  )}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {err && <p className="err">{err}</p>}
      <div className="bottom-cta">
        {step < 2 ? (
          <button className="btn primary big" onClick={next}>Suivant</button>
        ) : (
          <button className="btn primary big" disabled={busy} onClick={create}>
            {busy ? 'Création…' : 'Générer le code'}
          </button>
        )}
      </div>
    </div>
  )
}
