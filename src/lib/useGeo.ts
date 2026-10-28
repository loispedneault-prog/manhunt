import { useCallback, useEffect, useRef, useState } from 'react'
import { distM } from './geo'
import { SIM } from './profile'
import { sb } from './supabase'
import { now } from './time'

export interface MyPos {
  lat: number
  lng: number
  acc: number
  at: number
}

/**
 * Watches the GPS and pushes the position to the server: on movement (≥3 m, at most every 2 s)
 * and as a heartbeat every 8 s so others can tell a stale phone from a still one.
 * With `?sim` in the URL, the position comes from map taps instead (testing).
 */
export function useGeo(gameId: string, playerId: string, enabled: boolean) {
  const [pos, setPos] = useState<MyPos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastSent = useRef<{ lat: number; lng: number; t: number } | null>(null)
  const latest = useRef<MyPos | null>(null)
  const sending = useRef(false)

  const push = useCallback(
    async (p: MyPos, force = false) => {
      latest.current = p
      const l = lastSent.current
      const t = Date.now()
      if (l && t - l.t < 2000 && !force) return
      if (l && !force && distM(l.lat, l.lng, p.lat, p.lng) < 3 && t - l.t < 5000) return
      if (sending.current) return
      sending.current = true
      lastSent.current = { lat: p.lat, lng: p.lng, t }
      try {
        const { error: err } = await sb
          .from('players')
          .update({ lat: p.lat, lng: p.lng, acc: Math.round(p.acc), pos_at: new Date(now()).toISOString() })
          .eq('game_id', gameId)
          .eq('id', playerId)
        if (err) lastSent.current = null
      } catch {
        lastSent.current = null
      } finally {
        sending.current = false
      }
    },
    [gameId, playerId],
  )

  useEffect(() => {
    if (!enabled || SIM) return
    if (!('geolocation' in navigator)) {
      setError('GPS indisponible sur cet appareil')
      return
    }
    const id = navigator.geolocation.watchPosition(
      p => {
        const mp = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }
        setPos(mp)
        setError(null)
        void push(mp)
      },
      e => setError(e.code === 1 ? 'Accès au GPS refusé — autorise la localisation' : 'Signal GPS faible…'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled, push])

  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      if (latest.current && document.visibilityState === 'visible') void push(latest.current, true)
    }, 8000)
    return () => clearInterval(iv)
  }, [enabled, push])

  const simSet = useCallback(
    (lat: number, lng: number) => {
      const mp = { lat, lng, acc: 5, at: Date.now() }
      setPos(mp)
      void push(mp, true)
    },
    [push],
  )

  return { pos, error, simSet }
}
