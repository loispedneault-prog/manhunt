import { useCallback, useEffect, useRef, useState } from 'react'
import { sb } from './supabase'
import type { Claim, Game, GameEvent, Ping, Player } from './types'

export interface GameData {
  game: Game | null
  players: Player[]
  ping: Ping | null
  claims: Claim[]
  events: GameEvent[]
  loaded: boolean
  missing: boolean
  online: boolean
  reload: () => Promise<void>
}

function mergeEvents(prev: GameEvent[], incoming: GameEvent[]): GameEvent[] {
  if (!incoming.length) return prev
  const byId = new Map(prev.map(e => [e.id, e]))
  for (const e of incoming) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-300)
}

function upsertPlayer(list: Player[], p: Player): Player[] {
  const i = list.findIndex(x => x.id === p.id)
  if (i < 0) return [...list, p]
  const copy = [...list]
  copy[i] = p
  return copy
}

/**
 * Live game state: initial fetch + realtime subscription, with a full refetch whenever the
 * channel (re)connects, the phone wakes up, or every 20 s, so a dropped message never sticks.
 */
export function useGame(gameId: string): GameData {
  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [ping, setPing] = useState<Ping | null>(null)
  const [claims, setClaims] = useState<Claim[]>([])
  const [events, setEvents] = useState<GameEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [online, setOnline] = useState(true)
  const [retry, setRetry] = useState(0)
  const loading = useRef(false)

  const reload = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const [g, p, pi, c, e] = await Promise.all([
        sb.from('games').select('*').eq('id', gameId).maybeSingle(),
        sb.from('players').select('*').eq('game_id', gameId),
        sb.from('pings').select('*').eq('game_id', gameId).order('k', { ascending: false }).limit(1),
        sb.from('claims').select('*').eq('game_id', gameId),
        sb.from('events').select('*').eq('game_id', gameId).order('id', { ascending: false }).limit(200),
      ])
      if (g.error) {
        setOnline(false)
        return
      }
      if (!g.data) {
        setMissing(true)
        setLoaded(true)
        return
      }
      setGame(g.data as Game)
      if (!p.error) setPlayers(p.data as Player[])
      if (!pi.error) setPing((pi.data?.[0] as Ping) ?? null)
      if (!c.error) setClaims(c.data as Claim[])
      if (!e.error) setEvents(prev => mergeEvents(prev, (e.data as GameEvent[]).reverse()))
      setLoaded(true)
      setOnline(true)
    } catch {
      setOnline(false)
    } finally {
      loading.current = false
    }
  }, [gameId])

  useEffect(() => {
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const ch = sb
      .channel(`game-${gameId}-${retry}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, payload => {
        if (payload.eventType === 'DELETE') setMissing(true)
        else setGame(payload.new as Game)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, payload => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Partial<Player>
          if (old.game_id && old.game_id !== gameId) return
          setPlayers(ps => ps.filter(x => x.id !== old.id))
        } else {
          setPlayers(ps => upsertPlayer(ps, payload.new as Player))
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings', filter: `game_id=eq.${gameId}` }, payload => {
        const np = payload.new as Ping
        setPing(prev => (!prev || np.k > prev.k ? np : prev))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'claims', filter: `game_id=eq.${gameId}` }, payload => {
        const nc = payload.new as Claim
        setClaims(cs => (cs.some(c => c.challenge_id === nc.challenge_id) ? cs : [...cs, nc]))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` }, payload => {
        setEvents(prev => mergeEvents(prev, [payload.new as GameEvent]))
      })
      .subscribe(status => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          setOnline(true)
          void reload()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setOnline(false)
          retryTimer = setTimeout(() => setRetry(r => r + 1), 3000)
        }
      })

    const wake = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    const safety = setInterval(() => void reload(), 20000)
    void reload()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      clearInterval(safety)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      void sb.removeChannel(ch)
    }
  }, [gameId, reload, retry])

  return { game, players, ping, claims, events, loaded, missing, online, reload }
}
