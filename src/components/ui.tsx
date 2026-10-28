import type { ReactNode } from 'react'

export function Modal({ title, onClose, children, tone }: { title: string; onClose?: () => void; children: ReactNode; tone?: 'red' | 'amber' }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${tone ? 'modal-' + tone : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          {onClose && (
            <button className="x" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Stepper({
  label, value, min, max, step = 1, suffix = '', onChange,
}: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>−</button>
        <b>{value}{suffix}</b>
        <button onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>+</button>
      </div>
    </div>
  )
}

export function Seg<T extends string | number>({
  label, value, options, onChange,
}: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="seg">
        {options.map(o => (
          <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`check ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="box">{checked ? '■' : ''}</span>
      {label}
    </button>
  )
}

export function Avatar({ url, name, size = 44, tone }: { url?: string | null; name: string; size?: number; tone?: string }) {
  return (
    <div className={`avatar ${tone ? 'tone-' + tone : ''}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <b>{name.slice(0, 1).toUpperCase()}</b>}
    </div>
  )
}

export interface Toast {
  id: number
  text: string
  tone?: 'red' | 'amber' | 'blue' | 'green'
}

export function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="toasts">
      {items.map(t => (
        <div key={t.id} className={`toast ${t.tone ? 'toast-' + t.tone : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <h1 className={`logo ${small ? 'logo-sm' : ''}`}>
      <span className="glitch" data-text="MAN HUNT">MAN HUNT</span>
    </h1>
  )
}
