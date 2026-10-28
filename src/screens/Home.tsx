import { useEffect, useState } from 'react'
import { Avatar, Logo } from '../components/ui'
import type { Profile } from '../lib/profile'
import { ensurePlayer, sb } from '../lib/supabase'

const initialCode = (new URLSearchParams(location.search).get('join') ?? '').toUpperCase().slice(0, 5)
// Opening a scanned lobby QR (?join=CODE) joins once; leaving the game later must not re-join.
let autoJoinPending = initialCode.length === 5

function dropJoinParam() {
  const url = new URL(location.href)
  if (!url.searchParams.has('join')) return
  url.searchParams.delete('join')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export function Home({
  profile, notice, onEditProfile, onCreate, onJoined,
}: { profile: Profile; notice?: string; onEditProfile: () => void; onCreate: () => void; onJoined: (gameId: string, p: Profile) => void }) {
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(notice ?? '')

  useEffect(() => {
    if (!autoJoinPending) return
    autoJoinPending = false
    dropJoinParam()
    void join()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const join = async () => {
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setErr('Entre le code de la partie.')
    setBusy(true)
    setErr('')
    try {
      const { data: g, error } = await sb.from('games').select('id,status').eq('code', c).maybeSingle()
      if (error) return setErr('Pas de réseau. Réessaie.')
      if (!g) return setErr('Code introuvable.')
      if (g.status === 'ended') return setErr('Cette partie est terminée.')
      if (g.status !== 'lobby') {
        const { data: me } = await sb.from('players').select('id').eq('game_id', g.id).eq('id', profile.id).maybeSingle()
        if (!me) return setErr('La partie a déjà commencé.')
      }
      const res = await ensurePlayer(g.id, profile)
      if (!res.ok) return setErr('Impossible de rejoindre. Réessaie.')
      onJoined(g.id, res.profile)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen home">
      <Logo />
      <p className="tag">Chasse à l’homme · Ne te fais pas prendre</p>

      <button className="me-card" onClick={onEditProfile}>
        <Avatar url={profile.avatar} name={profile.name} size={56} />
        <div>
          <b>{profile.name}</b>
          <small>Modifier le profil</small>
        </div>
      </button>

      <div className="panel">
        <span className="field-label">Rejoindre une partie</span>
        <input
          className="input code-input"
          value={code}
          maxLength={5}
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={e => e.key === 'Enter' && join()}
        />
        <button className="btn primary big" disabled={busy} onClick={join}>
          {busy ? 'Connexion…' : 'Rejoindre'}
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      <div className="grow" />
      <button className="btn big" onClick={onCreate}>
        Créer une partie
      </button>
    </div>
  )
}
