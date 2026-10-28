import { sb } from './supabase'
import type { Game } from './types'

// Server clock minus local clock, so every phone counts down the same timers.
let offset = 0

export async function syncClock() {
  let bestRtt = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    const { data, error } = await sb.rpc('server_now')
    const t1 = Date.now()
    if (error || !data) continue
    const rtt = t1 - t0
    if (rtt < bestRtt) {
      bestRtt = rtt
      offset = Date.parse(data as string) - (t0 + t1) / 2
    }
  }
}

export const now = () => Date.now() + offset

/** Milliseconds of play elapsed (pauses excluded). */
export function gameMs(g: Game): number {
  if (g.status === 'ended' && g.ended_ms != null) return g.ended_ms
  if (!g.started_at) return 0
  const end = g.paused_at ? Date.parse(g.paused_at) : now()
  return Math.max(0, end - Date.parse(g.started_at) - (g.paused_ms || 0))
}

export const minMs = (min: number) => Math.round(min * 60000)

export function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

export function ago(iso: string | null): string {
  if (!iso) return '?'
  const s = Math.max(0, Math.round((now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)} min`
}
