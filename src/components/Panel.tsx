import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

const KEY = 'moneyduo:panels'
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }

/**
 * Scheda a scomparsa con un riepilogo sempre visibile (`headline`): da chiusa mostra solo quello,
 * aperta mostra anche il dettaglio. `quick` è un'azione rapida sempre visibile sotto il riepilogo. Lo stato aperto/chiuso si ricorda su questo dispositivo.
 */
export function Panel({ id, label, icon, headline, sub, quick, children }: { id: string; label: string; icon: ReactNode; headline: ReactNode; sub?: ReactNode; quick?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => !!load()[id])
  const flip = () => setOpen((o) => {
    const n = !o
    try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: n })) } catch { /* noop */ }
    return n
  })
  return (
    <section className="card overflow-hidden" data-panel={id} data-open={open || undefined}>
      <button type="button" onClick={flip} aria-expanded={open} aria-label={`${label}: ${open ? 'chiudi' : 'apri'} il dettaglio`} className="flex w-full items-center gap-3 p-4 text-left active:bg-line/30">
        <span className="text-brand">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
          <span className="block text-lg font-extrabold leading-snug tabular-nums">{headline}</span>
          {sub && <span className="block text-xs">{sub}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {quick && <div className="px-4 pb-4">{quick}</div>}
      {open && <div className="border-t border-line/60 p-4">{children}</div>}
    </section>
  )
}
