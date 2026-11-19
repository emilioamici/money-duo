import { useMemo, useState } from 'react'
import { Receipt, Search, X } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { filterTransactions, monthRange, sortedAccounts, summarize, visibleTo } from '../lib/calc'
import { dayKey, dayLabel, formatMoney } from '../lib/format'
import { MonthNav, ScopeChips, SyncChip } from '../components/Nav'
import { TransactionRow } from '../components/TransactionRow'
import { EmptyState } from '../components/ui'
import type { Transaction } from '../types'

export function HomePage({ onOpenSync }: { onOpenSync: () => void }) {
  const { db, view, setView, openTx, me } = useApp()
  const [search, setSearch] = useState(!!view.q)
  const { from, to } = monthRange(view.month)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: view.q, me: me?.id ?? null }), [db, view, me, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = summarize(txs)
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of txs) { const k = dayKey(t.date); m.set(k, [...(m.get(k) ?? []), t]) }
    return [...m.entries()]
  }, [txs])

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-3 bg-bg/90 px-4 pb-3 pt-safe backdrop-blur">
        <div className="flex items-center justify-between pt-3">
          <h1 className="text-xl font-extrabold tracking-tight">Money<span className="text-brand">Duo</span></h1>
          <div className="flex items-center gap-2">
            <SyncChip onClick={onOpenSync} />
            <button className="rounded-full p-2 hover:bg-line/60" aria-label="Cerca" onClick={() => { setSearch((s) => !s); if (search) setView({ q: '' }) }}>{search ? <X size={20} /> : <Search size={20} />}</button>
          </div>
        </div>
        <MonthNav />
        {search && <input autoFocus className="input" placeholder="Cerca per titolo, nota, categoria, conto, importo…" value={view.q} onChange={(e) => setView({ q: e.target.value })} />}
        <ScopeChips />
      </div>

      <div className="space-y-3 px-4">
        <div className="card grid grid-cols-3 divide-x divide-line/70 py-3 text-center">
          <div><p className="text-[11px] font-semibold uppercase text-muted">Entrate</p><p className="font-bold text-inc tabular-nums">{formatMoney(sum.income)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase text-muted">Uscite</p><p className="font-bold text-exp tabular-nums">{formatMoney(sum.expense)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase text-muted">Bilancio</p><p className={`font-bold tabular-nums ${sum.balance < 0 ? 'text-exp' : ''}`}>{formatMoney(sum.balance)}</p></div>
        </div>

        <select className="input !py-2 text-sm" value={view.accountId} onChange={(e) => setView({ accountId: e.target.value })} aria-label="Filtra per conto">
          <option value="all">Tutti i conti</option>
          {sortedAccounts(db).filter((a) => visibleTo(db, a, me?.id ?? null) && (!a.hidden || a.id === view.accountId)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        {groups.length === 0 ? (
          <div className="card"><EmptyState icon={<Receipt size={28} />} title="Nessuna transazione" text={view.q ? 'Nessun risultato per questa ricerca.' : 'Non ci sono movimenti in questo periodo.'}
            action={<button className="btn-primary" onClick={() => openTx()}>Aggiungi transazione</button>} /></div>
        ) : groups.map(([k, list]) => {
          const day = summarize(list)
          return (
            <section key={k} className="card overflow-hidden">
              <header className="flex justify-between border-b border-line/60 bg-line/20 px-4 py-2 text-xs font-semibold text-muted">
                <span>{dayLabel(k)}</span>
                <span className="tabular-nums">{day.income > 0 && <span className="text-inc">+{formatMoney(day.income)} </span>}{day.expense > 0 && <span className="text-exp">−{formatMoney(day.expense)}</span>}</span>
              </header>
              <div className="divide-y divide-line/50">{list.map((t) => <TransactionRow key={t.id} tx={t} />)}</div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
