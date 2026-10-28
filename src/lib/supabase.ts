import { createClient } from '@supabase/supabase-js'
import { dataUrlToBlob } from './image'
import { saveProfile, type Profile } from './profile'

const SUPABASE_URL = 'https://irddmposowtiwumbyfkj.supabase.co'
// Publishable key: safe to ship in the client.
const SUPABASE_KEY = 'sb_publishable_g_SbjrKrfW4vsS9RRxPrag_Kyq6c1dY'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 30 } },
})

/** Calls a Postgres function and returns its text result ('ok', 'too_far', ...). Network errors become 'network'. */
export async function rpc(fn: string, args: Record<string, unknown>): Promise<string> {
  try {
    const { data, error } = await sb.rpc(fn, args)
    if (error) {
      console.error(fn, error)
      return 'error'
    }
    return (data as string) ?? 'ok'
  } catch (e) {
    console.error(fn, e)
    return 'network'
  }
}

export async function uploadMedia(path: string, blob: Blob, contentType: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await sb.storage.from('media').upload(path, blob, { contentType, upsert: false })
    if (!error) return sb.storage.from('media').getPublicUrl(path).data.publicUrl
    console.error('upload', error)
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)))
  }
  return null
}

/** Adds (or refreshes) this profile as a player of the game. Uploads the selfie once. */
export async function ensurePlayer(gameId: string, profile: Profile): Promise<{ ok: boolean; profile: Profile }> {
  let p = profile
  if (!p.avatarUrl && p.avatar) {
    const url = await uploadMedia(`avatars/${p.id}-${Date.now()}.jpg`, dataUrlToBlob(p.avatar), 'image/jpeg')
    if (url) {
      p = { ...p, avatarUrl: url }
      saveProfile(p)
    }
  }
  const { error } = await sb
    .from('players')
    .upsert({ game_id: gameId, id: p.id, name: p.name, avatar_url: p.avatarUrl ?? null }, { onConflict: 'game_id,id' })
  if (error) console.error('ensurePlayer', error)
  return { ok: !error, profile: p }
}
