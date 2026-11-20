import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Cloud, CloudAlert, CloudOff, Loader2, X } from 'lucide-react'
import { useApp, type View } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { monthShort, periodLabel } from '../lib/format'
import type { Scope } from '../lib/calc'
import { t } from '../i18n'


export function MonthNav() {
  const { view, setView } = useApp()
  const [open, setOpen] = useState(false)
  const year = view.period === 'year'
  const shift = (n: number) => setView({ month: year ? new Date(view.month.getFullYear() + n, view.month.getMonth(), 1) : new Date(view.month.getFullYear(), view.month.getMonth() + n, 1) })
  return (
    <div className="relative flex items-center justify-between">
      <button className="icon-btn" onClick={() => shift(-1)} aria-label={year ? t('Anno precedente') : t('Mese precedente')}><ChevronLeft /></button>
      <button className="flex items-center gap-1 text-lg font-bold" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('Scegli mese o anno')}>{periodLabel(view.month, view.period)}<ChevronDown size={16} className="text-muted" /></button>
      <button className="icon-btn" onClick={() => shift(1)} aria-label={year ? t('Anno successivo') : t('Mese successivo')}><ChevronRight /></button>
      {open && <PeriodPicker onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Selettore come in Money Manager: griglia dei mesi dell'anno; toccando l'anno si seleziona l'anno intero. */
function PeriodPicker({ onClose }: { onClose: () => void }) {
  const { view, setView } = useApp()
  const [y, setY] = useState(view.month.getFullYear())
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])
  const pick = (patch: Partial<View>) => { setView(patch); onClose() }
  const now = new Date()
  return (
    <div ref={ref} role="group" aria-label={t('Scegli il periodo')} className="absolute left-0 right-0 top-full z-30 mt-2 glass-strong overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between bg-brand/15 px-4 py-2.5 text-sm font-semibold">
        <span>{t('Periodo')}</span>
        <span className="flex items-center gap-1">
          <button className="rounded-lg px-2 py-1 hover:bg-line/60" onClick={() => pick({ month: new Date(now.getFullYear(), now.getMonth(), 1), period: 'month' })}>{t('Questo mese')}</button>
          <button className="rounded-full p-1 hover:bg-line/60" onClick={onClose} aria-label={t('Chiudi')}><X size={18} /></button>
        </span>
      </div>
      <div className="flex items-center justify-between px-2 py-1">
        <button className="rounded-full p-2 hover:bg-line/60" onClick={() => setY(y - 1)} aria-label={t('Anno precedente nel selettore')}><ChevronLeft size={18} /></button>
        <button
          className={`rounded-lg px-3 py-1 text-base font-bold ${view.period === 'year' && view.month.getFullYear() === y ? 'bg-brand text-onbrand' : 'hover:bg-line/60'}`}
          onClick={() => pick({ month: new Date(y, view.month.getMonth(), 1), period: 'year' })} aria-label={t('Tutto il {y}', { y })} title={t('Seleziona l\'intero anno')}>{y}</button>
        <button className="rounded-full p-2 hover:bg-line/60" onClick={() => setY(y + 1)} aria-label={t('Anno successivo nel selettore')}><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-4 gap-1 p-2 pt-0">
        {Array.from({ length: 12 }, (_, i) => monthShort(i)).map((m, i) => {
          const on = view.period === 'month' && view.month.getFullYear() === y && view.month.getMonth() === i
          const cur = now.getFullYear() === y && now.getMonth() === i
          return <button key={m} onClick={() => pick({ month: new Date(y, i, 1), period: 'month' })} aria-pressed={on}
            className={`rounded-xl py-3 text-sm font-medium ${on ? 'bg-brand text-onbrand' : cur ? 'text-brand hover:bg-line/60' : 'hover:bg-line/60'}`}>{m}</button>
        })}
      </div>
    </div>
  )
}

export function ScopeChips() {
  const { view, setView, members } = useApp()
  const items: Array<[Scope, string]> = [['all', t('Tutti')], ['shared', t('Condivisi')], ...members.map((m): [Scope, string] => [m.id, m.name])]
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {items.map(([k, l]) => <button key={k} onClick={() => setView({ scope: k })} className={`chip ${view.scope === k ? 'chip-on' : ''}`}>{l}</button>)}
    </div>
  )
}

export function SyncChip({ onClick }: { onClick: () => void }) {
  const { sync } = useApp()
  if (sync.status === 'off') return null
  const cfg = {
    synced: { icon: <Cloud size={16} />, cls: 'text-inc', label: t('Sincronizzato') },
    syncing: { icon: <Loader2 size={16} className="animate-spin" />, cls: 'text-brand', label: t('Sync…') },
    pending: { icon: <Cloud size={16} />, cls: 'text-brand', label: t('Da inviare') },
    offline: { icon: <CloudOff size={16} />, cls: sync.dirty ? 'text-brand' : 'text-muted', label: sync.dirty ? t('Offline · da inviare') : t('Offline') },
    auth: { icon: <CloudAlert size={16} />, cls: 'text-exp', label: t('Riconnetti') },
    error: { icon: <CloudAlert size={16} />, cls: 'text-exp', label: t('Errore') },
    off: { icon: null, cls: '', label: '' },
  }[sync.status]
  return (
    <button onClick={sync.status === 'auth' ? () => void engine.signIn().catch(() => undefined) : onClick} className={`flex items-center gap-1.5 glass rounded-full px-3 py-1.5 text-xs font-semibold ${cfg.cls}`} aria-label={t('Stato sincronizzazione')}>
      {cfg.icon}{cfg.label}
    </button>
  )
}
