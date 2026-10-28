import { useEffect } from 'react'
import { Logo } from '../components/ui'
import type { Profile } from '../lib/profile'
import { syncClock } from '../lib/time'
import { useGame } from '../lib/useGame'
import { End } from './End'
import { GameScreen } from './GameScreen'
import { Lobby } from './Lobby'

export function GameRoot({ gameId, profile, onLeave }: { gameId: string; profile: Profile; onLeave: (notice?: string) => void }) {
  const data = useGame(gameId)

  useEffect(() => {
    void syncClock()
    const iv = setInterval(() => void syncClock(), 120000)
    return () => clearInterval(iv)
  }, [])

  const { game, players, loaded, missing } = data
  const me = players.find(p => p.id === profile.id)

  useEffect(() => {
    if (missing) onLeave('La partie a été annulée.')
  }, [missing, onLeave])

  useEffect(() => {
    // Removed from the lobby by the host.
    if (loaded && game && game.status === 'lobby' && players.length > 0 && !me) onLeave('Tu as été retiré de la partie.')
  }, [loaded, game, players.length, me, onLeave])

  if (!loaded || !game) {
    return (
      <div className="screen center">
        <Logo small />
        <p className="waiting">{data.online ? 'Connexion…' : 'Pas de réseau — nouvelle tentative…'}</p>
        <button className="btn ghost" onClick={() => onLeave()}>Retour au menu</button>
      </div>
    )
  }

  if (game.status === 'ended') return <End game={game} players={players} profile={profile} onLeave={() => onLeave()} />

  if (!me) {
    return (
      <div className="screen center">
        <Logo small />
        <p className="waiting">Tu ne fais pas partie de cette partie.</p>
        <button className="btn" onClick={() => onLeave()}>Retour au menu</button>
      </div>
    )
  }

  if (game.status === 'lobby') return <Lobby game={game} players={players} profile={profile} onLeave={() => onLeave()} />
  return <GameScreen data={data} game={game} me={me} profile={profile} onLeave={() => onLeave()} />
}
