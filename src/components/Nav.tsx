import { ChevronLeft, ChevronRight, Cloud, CloudAlert, CloudOff, Loader2 } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { monthLabel } from '../lib/format'
import type { Scope } from '../lib/calc'

export function MonthNav() {
  const { view, setView } = useApp()
  const shift = (n: number) => setView({ month: new Date(view.month.getFullYear(), view.month.getMonth() + n, 1) })
  return (
    <div className="flex items-center justify-between">
      <button className="rounded-full p-2 hover:bg-line/60" onClick={() => shift(-1)} aria-label="Mese precedente"><ChevronLeft /></button>
      <button className="text-lg font-bold" onClick={() => setView({ month: new Date() })} title="Torna al mese corrente">{monthLabel(view.month)}</button>
      <button className="rounded-full p-2 hover:bg-line/60" onClick={() => shift(1)} aria-label="Mese successivo"><ChevronRight /></button>
    </div>
  )
}

export function ScopeChips() {
  const { view, setView, names } = useApp()
  const items: Array<[Scope, string]> = [['all', 'Tutti'], ['shared', names.shared], ['a', names.a], ['b', names.b]]
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
    synced: { icon: <Cloud size={16} />, cls: 'text-inc', label: 'Sincronizzato' },
    syncing: { icon: <Loader2 size={16} className="animate-spin" />, cls: 'text-brand', label: 'Sync…' },
    pending: { icon: <Cloud size={16} />, cls: 'text-brand', label: 'Da inviare' },
    offline: { icon: <CloudOff size={16} />, cls: 'text-muted', label: 'Offline' },
    auth: { icon: <CloudAlert size={16} />, cls: 'text-exp', label: 'Riconnetti' },
    error: { icon: <CloudAlert size={16} />, cls: 'text-exp', label: 'Errore' },
    off: { icon: null, cls: '', label: '' },
  }[sync.status]
  return (
    <button onClick={sync.status === 'auth' ? () => void engine.signIn().catch(() => undefined) : onClick} className={`flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold shadow-sm ${cfg.cls}`} aria-label="Stato sincronizzazione">
      {cfg.icon}{cfg.label}
    </button>
  )
}
