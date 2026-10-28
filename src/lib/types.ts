export type LatLng = [number, number]
export type Role = 'hunter' | 'fugitive'
export type Status = 'free' | 'jailed' | 'hunter'
export type PowerKey = 'reveal_public' | 'reveal_secret' | 'scramble'

export interface Config {
  duration_min: number
  headstart_min: number
  ping_min: number
  jail_min: number
  hunters: number
  capture_qr: boolean
  capture_declare: boolean
  pw_reveal_public: number
  pw_reveal_secret: number
  pw_scramble: number
  challenge_count: number
}

export interface Challenge {
  id: string
  lat: number
  lng: number
  text: string
}

export interface Prison {
  lat: number
  lng: number
  radius: number
}

export interface Game {
  id: string
  code: string
  host_id: string
  status: 'lobby' | 'running' | 'ended'
  config: Config
  zone: LatLng[]
  prison: Prison
  challenges: Challenge[]
  started_at: string | null
  paused_at: string | null
  paused_ms: number
  ended_at: string | null
  ended_ms: number | null
  end_reason: 'time' | 'caught' | 'host' | null
  created_at: string
}

export interface Player {
  game_id: string
  id: string
  name: string
  avatar_url: string | null
  role: Role
  status: Status
  times_caught: number
  jailed_ms: number | null
  converted_ms: number | null
  captures: number
  powers: Partial<Record<PowerKey, number>>
  scramble_ping: number | null
  lat: number | null
  lng: number | null
  acc: number | null
  pos_at: string | null
  joined_at: string
}

export interface PingPos {
  lat: number
  lng: number
  at: string | null
  status: Status
}

export interface Ping {
  game_id: string
  k: number
  positions: Record<string, PingPos>
  created_at: string
}

export interface Claim {
  game_id: string
  challenge_id: string
  player_id: string
  reward: PowerKey | null
  created_at: string
}

export interface GameEvent {
  id: number
  game_id: string
  type: string
  actor: string | null
  target: string | null
  data: Record<string, any>
  game_ms: number | null
  created_at: string
}

export const POWER_LABEL: Record<PowerKey, string> = {
  reveal_public: 'Révélation',
  reveal_secret: 'Révélation secrète',
  scramble: 'Brouillage',
}

export const DEFAULT_CONFIG: Config = {
  duration_min: 90,
  headstart_min: 5,
  ping_min: 10,
  jail_min: 10,
  hunters: 2,
  capture_qr: true,
  capture_declare: true,
  pw_reveal_public: 2,
  pw_reveal_secret: 1,
  pw_scramble: 2,
  challenge_count: 6,
}
