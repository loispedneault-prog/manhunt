import type { LatLng } from './types'

export function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLng = (bLng - aLng) * toRad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Ray casting; zone = [[lat,lng],...]. Same algorithm as public.in_zone on the server. */
export function inZone(zone: LatLng[], lat: number, lng: number): boolean {
  if (!zone || zone.length < 3) return true
  let inside = false
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const [yi, xi] = zone[i]
    const [yj, xj] = zone[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

export function zoneAreaM2(zone: LatLng[]): number {
  if (zone.length < 3) return 0
  const lat0 = zone[0][0]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110540
  let a = 0
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    a += zone[j][1] * kx * (zone[i][0] * ky) - zone[i][1] * kx * (zone[j][0] * ky)
  }
  return Math.abs(a / 2)
}

/**
 * Moves every vertex toward the zone's center by `meters`, never closer than 25 m to it.
 * Same math as public.shrink_zone on the server (used here only to preview the next zone).
 */
export function shrinkZone(base: LatLng[], meters: number): LatLng[] {
  if (base.length < 3 || meters <= 0) return base
  const clat = base.reduce((s, p) => s + p[0], 0) / base.length
  const clng = base.reduce((s, p) => s + p[1], 0) / base.length
  const kx = 111320 * Math.cos((clat * Math.PI) / 180)
  const ky = 110540
  return base.map(([lat, lng]) => {
    const dx = (lng - clng) * kx
    const dy = (lat - clat) * ky
    const d = Math.hypot(dx, dy)
    if (d === 0) return [lat, lng] as LatLng
    const nd = Math.max(Math.min(d, 25), d - meters)
    return [clat + (dy * (nd / d)) / ky, clng + (dx * (nd / d)) / kx] as LatLng
  })
}

/** Distance in meters from a point to the zone's border. */
function distToEdge(zone: LatLng[], lat: number, lng: number): number {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const ax = (zone[j][1] - lng) * kx, ay = (zone[j][0] - lat) * ky
    const bx = (zone[i][1] - lng) * kx, by = (zone[i][0] - lat) * ky
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/**
 * Picks `n` points inside the zone that are as far from each other as possible,
 * while staying off the border: random candidates, then greedy farthest-point selection.
 */
export function spreadPoints(zone: LatLng[], n: number): LatLng[] {
  if (zone.length < 3 || n <= 0) return []
  const lats = zone.map(p => p[0])
  const lngs = zone.map(p => p[1])
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const candidates: { p: LatLng; edge: number }[] = []
  let guard = 0
  while (candidates.length < 700 && guard++ < 30000) {
    const lat = minLat + Math.random() * (maxLat - minLat)
    const lng = minLng + Math.random() * (maxLng - minLng)
    if (!inZone(zone, lat, lng)) continue
    const edge = distToEdge(zone, lat, lng)
    if (edge < 20) continue
    candidates.push({ p: [lat, lng], edge })
  }
  if (!candidates.length) return []
  // A point near the border counts as "close" to something, so picks drift inward.
  const score = (c: { p: LatLng; edge: number }, chosen: LatLng[]) => {
    let d = c.edge * 2.5
    for (const q of chosen) d = Math.min(d, distM(c.p[0], c.p[1], q[0], q[1]))
    return d
  }
  const chosen: LatLng[] = []
  while (chosen.length < n && chosen.length < candidates.length) {
    let best: LatLng | null = null
    let bestD = -1
    for (const c of candidates) {
      const d = score(c, chosen)
      if (d > bestD) {
        bestD = d
        best = c.p
      }
    }
    if (!best) break
    chosen.push(best)
  }
  return chosen
}
