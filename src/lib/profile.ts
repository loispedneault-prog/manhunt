// `?p=2` namespaces storage so several players can be tested in one browser.
const params = new URLSearchParams(location.search)
const NS = params.get('p') ?? ''
const PROFILE_KEY = 'mh_profile' + NS
const GAME_KEY = 'mh_game' + NS
const DRAFT_KEY = 'mh_draft'

export const SIM = params.has('sim')

export interface Profile {
  id: string
  name: string
  avatar: string // data URL
  avatarUrl?: string // uploaded copy
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: app still works for this session */
  }
}

export const loadProfile = () => read<Profile>(PROFILE_KEY)
export const saveProfile = (p: Profile) => write(PROFILE_KEY, p)
export const loadGameId = () => read<string>(GAME_KEY)
export const saveGameId = (id: string | null) => write(GAME_KEY, id)
export const loadDraft = <T,>() => read<T>(DRAFT_KEY)
export const saveDraft = (d: unknown) => write(DRAFT_KEY, d)

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  // Older Safari fallback
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const shortCode = (playerId: string) => playerId.replace(/-/g, '').slice(0, 4).toUpperCase()
