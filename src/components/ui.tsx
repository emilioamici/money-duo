import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { MascotImg } from './Mascots'
import { t } from '../i18n'

/** Finestre aperte, dalla più vecchia alla più recente: Esc chiude solo l'ultima. */
const sheetStack: symbol[] = []

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const id = Symbol('sheet')
    sheetStack.push(id)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && sheetStack[sheetStack.length - 1] === id && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      sheetStack.splice(sheetStack.indexOf(id), 1)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  // trascinamento verso il basso dalla maniglia (non dal contenuto, per non litigare con lo scorrimento): oltre 120 px o veloce → chiude
  const [dragY, setDragY] = useState(0)
  const drag = useRef<{ y: number; t: number } | null>(null)
  useEffect(() => { if (open) setDragY(0) }, [open])
  const onHandleDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, t: Date.now() }; e.currentTarget.setPointerCapture(e.pointerId) }
  const onHandleMove = (e: React.PointerEvent) => { if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.y)) }
  const onHandleUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d) return
    const dy = e.clientY - d.y, v = dy / Math.max(1, Date.now() - d.t)
    if (dy > 120 || (dy > 30 && v > 0.6)) onClose(); else setDragY(0)
  }
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 animate-fade bg-ink/30 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[92dvh] w-full animate-sheet flex-col glass-strong rounded-t-[2rem] shadow-2xl md:max-w-lg md:rounded-[2rem]"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: drag.current ? 'none' : 'transform .2s' } : undefined}>
        <div className="flex cursor-grab touch-none justify-center pb-1 pt-3" data-testid="sheet-handle" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
          <div className="h-1.5 w-10 rounded-full bg-muted/50" />
        </div>
        <div className="flex items-center justify-between px-5 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label={t('Chiudi')} className="icon-btn text-muted"><X size={20} /></button>
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
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className="relative flex rounded-full border border-line bg-line/40 p-1">
      {/* l'indicatore scivola da un segmento all'altro (solo transform) */}
      <span aria-hidden className="absolute bottom-1 left-1 top-1 rounded-full bg-surface shadow-[0_2px_8px_rgb(var(--ink)/0.15)] transition-transform duration-300 ease-[cubic-bezier(.3,1.3,.5,1)]"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`relative flex-1 whitespace-nowrap rounded-full px-2 py-1.5 text-sm font-semibold transition active:scale-95 ${value === o.value ? (o.color ?? 'text-brand') : 'text-muted'}`}>
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
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function MemberAvatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Scelta di uno o più membri attivi (+ eventuale opzione "nessuno" per il pagatore). */
export function MemberChips({ value, onChange, multi = false, nullLabel, includeIds = [] }: {
  value: string | string[] | null
  onChange: (v: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any
  multi?: boolean
  nullLabel?: string
  includeIds?: string[] // membri non attivi da mostrare comunque (storico)
}) {
  const { db } = useApp()
  const list = db.members.filter((m) => m.active || includeIds.includes(m.id))
  const sel = (id: string) => (multi ? (value as string[]).includes(id) : value === id)
  const toggle = (id: string) => (multi ? onChange(sel(id) ? (value as string[]).filter((x) => x !== id) : [...(value as string[]), id]) : onChange(id))
  return (
    <div className="flex flex-wrap gap-2">
      {nullLabel && (
        <button type="button" onClick={() => onChange(null)} className={`chip ${!multi && value === null ? 'chip-on' : ''}`}>{!multi && value === null && <Check size={14} />}{nullLabel}</button>
      )}
      {list.map((m) => (
        <button key={m.id} type="button" onClick={() => toggle(m.id)} className={`chip ${sel(m.id) ? 'chip-on' : ''}`}>
          {sel(m.id) ? <Check size={14} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />}{m.name}{!m.active && ' (ex)'}
        </button>
      ))}
    </div>
  )
}

/** Etichetta dei membri di un conto: "Famiglia", il nome se personale, oppure i nomi. */
export function MembersBadge({ ids }: { ids: string[] }) {
  const { db } = useApp()
  const text = ids.length === 0 ? t('Tutta la famiglia') : ids.map((id) => db.members.find((m) => m.id === id)?.name ?? '?').join(', ')
  const shared = ids.length !== 1
  return <span className={`max-w-[12rem] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${shared ? 'bg-inc/15 text-inc' : 'bg-trf/15 text-trf'}`}>{text}</span>
}

export function EmptyState({ title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <MascotImg kind="pair" className="mb-3 w-36" />
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

/** Scheda che si apre e si chiude: titolo, riga di riepilogo quando è chiusa, contenuto quando è aperta. */
export function Accordion({ title, summary, icon, open, onToggle, children }: {
  title: string; summary?: ReactNode; icon: ReactNode; open: boolean; onToggle: () => void; children: ReactNode
}) {
  return (
    <section className="card overflow-hidden" data-open={open || undefined}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left active:bg-line/30">
        <span className="text-brand">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {summary && !open && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line/60 p-4">{children}</div>}
    </section>
  )
}
