import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { LatLng } from '../lib/types'

export type Tone = 'me' | 'hunter' | 'fugitive' | 'jailed' | 'alert'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  name: string
  avatar?: string | null
  tone: Tone
  ghost?: boolean
  out?: boolean
  sub?: string
}

export interface MapChallenge {
  id: string
  lat: number
  lng: number
  label: string
  done: boolean
}

interface Props {
  zone?: LatLng[]
  /** Upcoming (shrunk) zone, drawn as a dashed outline. */
  nextZone?: LatLng[] | null
  drawing?: boolean
  challenges?: MapChallenge[]
  markers?: MapMarker[]
  accuracy?: { lat: number; lng: number; acc: number } | null
  onMapClick?: (lat: number, lng: number) => void
  onChallengeClick?: (id: string) => void
  /** Change the value to re-fit the view on the zone. */
  fitKey?: string | number
  /** Change `key` to fly to a point. */
  focus?: { lat: number; lng: number; key: number } | null
  initialCenter?: LatLng
}

const WORLD: LatLng[] = [[-85, -180], [-85, 180], [85, 180], [85, -180]]
const RED = '#e10600'
const AMBER = '#ffb000'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const safeUrl = (u?: string | null) => (u && /^(https:\/\/[a-z0-9.-]+\.supabase\.co\/|data:image\/)/.test(u) ? u : null)

function markerHtml(m: MapMarker) {
  const url = safeUrl(m.avatar)
  const img = url ? `<img src="${esc(url)}" alt="">` : `<b>${esc(m.name.slice(0, 1).toUpperCase())}</b>`
  return `<div class="mk tone-${m.tone}${m.ghost ? ' ghost' : ''}${m.out ? ' out' : ''}">
    <div class="mk-img">${img}</div>
    <div class="mk-name">${esc(m.tone === 'me' ? 'TOI' : m.name)}</div>
    ${m.sub ? `<div class="mk-sub">${esc(m.sub)}</div>` : ''}
  </div>`
}

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ zone: L.LayerGroup; ch: L.LayerGroup; mk: L.LayerGroup; acc: L.LayerGroup } | null>(null)
  const markerCache = useRef(new Map<string, { m: L.Marker; html: string }>())
  const cbs = useRef(props)
  cbs.current = props

  useEffect(() => {
    const m = L.map(el.current!, {
      zoomControl: false,
      attributionControl: true,
      center: props.initialCenter ?? [45.5017, -73.5673],
      zoom: 16,
      maxZoom: 20,
    })
    // Standard OSM tiles (no API key), darkened with a CSS filter on .leaflet-tile-pane.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '© OpenStreetMap',
    }).addTo(m)
    layers.current = {
      zone: L.layerGroup().addTo(m),
      ch: L.layerGroup().addTo(m),
      acc: L.layerGroup().addTo(m),
      mk: L.layerGroup().addTo(m),
    }
    m.on('click', e => cbs.current.onMapClick?.(e.latlng.lat, e.latlng.lng))
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current!)
    const cache = markerCache.current
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      cache.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Zone: everything outside is painted red.
  const zoneKey = JSON.stringify(props.zone ?? []) + JSON.stringify(props.nextZone ?? null) + (props.drawing ? 'd' : '')
  useEffect(() => {
    const g = layers.current?.zone
    if (!g) return
    g.clearLayers()
    const z = props.zone ?? []
    if (z.length >= 3) {
      L.polygon([WORLD, z], { stroke: false, fillColor: RED, fillOpacity: 0.3, interactive: false }).addTo(g)
      L.polygon(z, { color: RED, weight: 2, fill: false, dashArray: props.drawing ? '6 6' : undefined, interactive: false }).addTo(g)
    } else if (z.length === 2) {
      L.polyline(z, { color: RED, weight: 2, dashArray: '6 6', interactive: false }).addTo(g)
    }
    const nz = props.nextZone
    if (nz && nz.length >= 3) {
      L.polygon(nz, { color: AMBER, weight: 2, opacity: 0.9, dashArray: '3 7', fill: false, interactive: false }).addTo(g)
    }
    if (props.drawing) {
      z.forEach((p, i) =>
        L.circleMarker(p, { radius: i === z.length - 1 ? 7 : 5, color: '#fff', weight: 2, fillColor: RED, fillOpacity: 1, interactive: false }).addTo(g),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey])

  const chKey = JSON.stringify(props.challenges ?? [])
  useEffect(() => {
    const g = layers.current?.ch
    if (!g) return
    g.clearLayers()
    for (const c of props.challenges ?? []) {
      const mk = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: 'mk-wrap',
          html: `<div class="ch${c.done ? ' done' : ''}"><span>${esc(c.label)}</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(g)
      mk.on('click', () => cbs.current.onChallengeClick?.(c.id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chKey])

  // Player markers are diffed so they glide instead of flickering on each GPS update.
  useEffect(() => {
    const g = layers.current?.mk
    if (!g) return
    const cache = markerCache.current
    const seen = new Set<string>()
    for (const m of props.markers ?? []) {
      seen.add(m.id)
      const html = markerHtml(m)
      const hit = cache.get(m.id)
      if (hit) {
        hit.m.setLatLng([m.lat, m.lng])
        if (hit.html !== html) {
          hit.m.setIcon(L.divIcon({ className: 'mk-wrap', html, iconSize: [40, 40], iconAnchor: [20, 20] }))
          hit.html = html
        }
        hit.m.setZIndexOffset(m.tone === 'me' ? 1000 : m.ghost ? 0 : 500)
      } else {
        const mk = L.marker([m.lat, m.lng], {
          icon: L.divIcon({ className: 'mk-wrap', html, iconSize: [40, 40], iconAnchor: [20, 20] }),
          zIndexOffset: m.tone === 'me' ? 1000 : m.ghost ? 0 : 500,
          interactive: false,
        }).addTo(g)
        cache.set(m.id, { m: mk, html })
      }
    }
    for (const [id, hit] of cache) {
      if (!seen.has(id)) {
        g.removeLayer(hit.m)
        cache.delete(id)
      }
    }
  }, [props.markers])

  const a = props.accuracy
  useEffect(() => {
    const g = layers.current?.acc
    if (!g) return
    g.clearLayers()
    if (a && a.acc > 8) {
      L.circle([a.lat, a.lng], { radius: a.acc, color: '#fff', weight: 1, opacity: 0.3, fillOpacity: 0.05, interactive: false }).addTo(g)
    }
  }, [a?.lat, a?.lng, a?.acc])

  useEffect(() => {
    const z = cbs.current.zone
    if (map.current && z && z.length >= 3) map.current.fitBounds(L.latLngBounds(z), { padding: [24, 24] })
  }, [props.fitKey])

  useEffect(() => {
    const f = props.focus
    if (map.current && f) map.current.flyTo([f.lat, f.lng], Math.max(map.current.getZoom(), 17), { duration: 0.6 })
  }, [props.focus?.key])

  return <div ref={el} className="map" />
}
