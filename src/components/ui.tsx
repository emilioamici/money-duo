import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { ProfileId } from '../types'
import { useApp } from '../store/AppProvider'

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 animate-fade bg-black/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[92dvh] w-full animate-sheet flex-col rounded-t-3xl bg-surface shadow-2xl md:max-w-lg md:rounded-3xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Chiudi" className="rounded-full p-2 text-muted hover:bg-line/60"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe border-t border-line/70 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; color?: string }> }) {
  return (
    <div className="flex rounded-xl bg-line/50 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition ${value === o.value ? 'bg-surface shadow ' + (o.color ?? 'text-brand') : 'text-muted'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="mb-3 flex w-full items-center justify-between gap-3 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function ProfileChips({ value, onChange, includeShared = true }: { value: ProfileId; onChange: (v: ProfileId) => void; includeShared?: boolean }) {
  const { names } = useApp()
  const list: ProfileId[] = includeShared ? ['a', 'b', 'shared'] : ['a', 'b']
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)} className={`chip ${value === p ? 'chip-on' : ''}`}>
          {value === p && <Check size={14} />}{names[p]}
        </button>
      ))}
    </div>
  )
}

const OWNER_STYLE: Record<ProfileId, string> = { a: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', b: 'bg-pink-500/15 text-pink-600 dark:text-pink-300', shared: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' }

export function OwnerBadge({ owner }: { owner: ProfileId }) {
  const { names } = useApp()
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OWNER_STYLE[owner]}`}>{names[owner]}</span>
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-brand/10 p-4 text-brand">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function CatBubble({ icon, color, size = 40 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: color + '26', fontSize: size * 0.5 }}>
      {icon}
    </span>
  )
}
