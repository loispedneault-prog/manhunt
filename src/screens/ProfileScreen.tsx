import { useRef, useState, type ChangeEvent } from 'react'
import { Logo } from '../components/ui'
import { fileToSquareDataUrl } from '../lib/image'
import { saveProfile, uuid, type Profile } from '../lib/profile'

export function ProfileScreen({ initial, onDone, onCancel }: { initial: Profile | null; onDone: (p: Profile) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [avatar, setAvatar] = useState(initial?.avatar ?? '')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      setAvatar(await fileToSquareDataUrl(f))
      setErr('')
    } catch {
      setErr('Photo illisible, réessaie.')
    }
  }

  const submit = () => {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 16)
    if (!n) return setErr('Choisis un nom.')
    if (!avatar) return setErr('Prends-toi en photo : elle apparaît sur la carte.')
    const p: Profile = {
      id: initial?.id ?? uuid(),
      name: n,
      avatar,
      avatarUrl: avatar === initial?.avatar ? initial?.avatarUrl : undefined,
    }
    saveProfile(p)
    onDone(p)
  }

  return (
    <div className="screen">
      <Logo small />
      <h2 className="h2">Identification</h2>
      <button className="photo-slot" onClick={() => fileRef.current?.click()}>
        {avatar ? <img src={avatar} alt="" /> : <span>📷<br />PRENDS-TOI<br />EN PHOTO</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
      {avatar && (
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          Reprendre la photo
        </button>
      )}
      <label className="field">
        <span className="field-label">Nom de joueur</span>
        <input
          className="input"
          value={name}
          maxLength={16}
          autoCapitalize="words"
          autoComplete="off"
          placeholder="Ton nom"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </label>
      {err && <p className="err">{err}</p>}
      <div className="grow" />
      <button className="btn primary big" onClick={submit}>
        Continuer
      </button>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
      )}
    </div>
  )
}
