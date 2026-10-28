import { Avatar, Logo } from '../components/ui'
import type { Profile } from '../lib/profile'
import { fmt, minMs } from '../lib/time'
import type { Game, Player } from '../lib/types'

export function End({ game, players, profile, onLeave }: { game: Game; players: Player[]; profile: Profile; onLeave: () => void }) {
  const hs = minMs(game.config.headstart_min)
  const endMs = game.ended_ms ?? minMs(game.config.duration_min)
  const fugitives = players
    .filter(p => p.role === 'fugitive')
    .map(p => ({ p, survived: Math.max(0, (p.status === 'hunter' ? p.converted_ms ?? endMs : endMs) - hs) }))
    .sort((a, b) => b.survived - a.survived || a.p.times_caught - b.p.times_caught)
  const winners =
    game.end_reason === 'time'
      ? fugitives.filter(f => f.p.status === 'free')
      : game.end_reason === 'caught'
        ? []
        : fugitives.filter(f => f.p.status !== 'hunter')
  // Only crown someone when they outlasted everyone else (no tie).
  const lastStanding = fugitives.length && (fugitives.length === 1 || fugitives[0].survived > fugitives[1].survived) ? fugitives[0] : null
  const hunters = players.filter(p => p.status === 'hunter').sort((a, b) => b.captures - a.captures)

  const headline =
    game.end_reason === 'time'
      ? winners.length
        ? winners.length === 1
          ? `${winners[0].p.name} a survécu`
          : 'Les fugitifs ont survécu'
        : 'Temps écoulé'
      : game.end_reason === 'caught'
        ? 'Les chasseurs ont gagné'
        : 'Partie arrêtée'
  const iWon = winners.some(w => w.p.id === profile.id) || (game.end_reason === 'caught' && hunters.some(h => h.id === profile.id && h.role === 'hunter'))

  return (
    <div className="screen end">
      <Logo small />
      <h2 className="end-title glitch-soft">{headline}</h2>
      <p className="mono dim">Durée : {fmt(endMs)}</p>
      {iWon && <p className="win">VICTOIRE</p>}

      {lastStanding && (
        <div className="panel">
          <span className="field-label">Dernier fugitif debout</span>
          <div className="prow">
            <Avatar url={lastStanding.p.avatar_url} name={lastStanding.p.name} size={56} tone="fugitive" />
            <span className="pname big">{lastStanding.p.name}</span>
            <span className="mono">{fmt(lastStanding.survived)}</span>
          </div>
        </div>
      )}

      <div className="panel">
        <span className="field-label">Fugitifs · temps de survie</span>
        {fugitives.map(({ p, survived }, i) => (
          <div key={p.id} className="prow">
            <b className="mono rank">{i + 1}</b>
            <Avatar url={p.avatar_url} name={p.name} size={36} tone={p.status === 'hunter' ? 'hunter' : p.status === 'jailed' ? 'jailed' : 'fugitive'} />
            <span className="pname">{p.name}</span>
            <span className="mono dim">{p.status === 'hunter' ? 'pris' : p.status === 'jailed' ? 'prison' : 'libre'}</span>
            <span className="mono">{fmt(survived)}</span>
          </div>
        ))}
      </div>

      <div className="panel">
        <span className="field-label">Chasseurs · captures</span>
        {hunters.map(p => (
          <div key={p.id} className="prow">
            <Avatar url={p.avatar_url} name={p.name} size={36} tone="hunter" />
            <span className="pname">{p.name}{p.role === 'fugitive' && <em> · converti</em>}</span>
            <span className="mono">{p.captures}</span>
          </div>
        ))}
      </div>

      <div className="grow" />
      <button className="btn primary big" onClick={onLeave}>Retour au menu</button>
    </div>
  )
}
