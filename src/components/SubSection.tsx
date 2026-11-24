import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

const load = (key: string): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return {} } }

/**
 * Sotto-sezione a scomparsa dentro una scheda: da chiusa mostra titolo e un riepilogo in una riga, aperta mostra il contenuto.
 * Lo stato aperto/chiuso si ricorda su questo dispositivo (`storageKey` per scheda, `id` per sezione).
 */
export function SubSection({ storageKey, id, testId, icon, title, summary, badge, children }: {
  storageKey: string; id: string; testId: string; icon: ReactNode; title: string; summary?: string; badge?: ReactNode; children: ReactNode
}) {
  const [open, setOpen] = useState(() => !!load(storageKey)[id])
  const flip = () => setOpen((o) => {
    const n = !o
    try { localStorage.setItem(storageKey, JSON.stringify({ ...load(storageKey), [id]: n })) } catch { /* noop */ }
    return n
  })
  return (
    <div data-testid={testId} data-open={open || undefined} className="mt-3 rounded-xl bg-bg">
      <button type="button" onClick={flip} aria-expanded={open} className="flex w-full items-center gap-2 p-3 text-left active:bg-line/30">
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {!open && summary && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        {badge}
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  )
}
