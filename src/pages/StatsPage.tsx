import { useMemo, useState } from 'react'
import { ChevronDown, Handshake } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { categoryBreakdown, coupleBalance, filterTransactions, monthRange, sortedAccounts, summarize } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { MonthNav, ScopeChips } from '../components/Nav'
import { Donut } from '../components/Donut'
import { CatBubble, Segmented } from '../components/ui'
import type { CategoryType } from '../types'

export function StatsPage() {
  const { db, view, names, openTx } = useApp()
  const [type, setType] = useState<CategoryType>('expense')
  const [open, setOpen] = useState<string | null>(null)
  const { from, to } = monthRange(view.month)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: '' }), [db, view.scope, view.accountId, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => categoryBreakdown(db, txs, type), [db, txs, type])
  const total = items.reduce((s, i) => s + i.total, 0)
  const sum = summarize(txs)

  // bilancio di coppia: sempre su tutte le transazioni (ignora il filtro ambito), mese e totale
  const all = (f: Date | null, t: Date | null) => db.transactions.filter((x) => (!f || new Date(x.date) >= f) && (!t || new Date(x.date) < t))
  const monthNet = coupleBalance(db, all(from, to))
  const totalNet = coupleBalance(db, all(null, null))

  const line = (net: number) => net === 0 ? 'Siete in pari' : net > 0 ? `${names.b} deve a ${names.a}` : `${names.a} deve a ${names.b}`

  const settle = () => {
    if (totalNet === 0) return
    const debtor = totalNet > 0 ? 'b' : 'a'
    const creditor = totalNet > 0 ? 'a' : 'b'
    const accs = sortedAccounts(db).filter((a) => !a.hidden)
    openTx({ initial: {
      type: 'transfer', amount: Math.abs(totalNet), title: 'Rimborso spese di coppia',
      accountId: accs.find((a) => a.owner === debtor)?.id ?? accs[0]?.id, toAccountId: accs.find((a) => a.owner === creditor)?.id ?? null,
    } })
  }

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-3 bg-bg/90 px-4 pb-3 pt-safe backdrop-blur">
        <h1 className="pt-3 text-xl font-extrabold tracking-tight">Statistiche</h1>
        <MonthNav />
        <ScopeChips />
      </div>
      <div className="space-y-3 px-4">
        <div className="card p-4">
          <Segmented<CategoryType> value={type} onChange={(t) => { setType(t); setOpen(null) }} options={[{ value: 'expense', label: 'Uscite', color: 'text-exp' }, { value: 'income', label: 'Entrate', color: 'text-inc' }]} />
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nessun dato in questo periodo.</p>
          ) : (
            <>
              <div className="py-3"><Donut slices={items.map((i) => ({ color: i.color, value: i.total }))} center={formatMoney(total)} sub={type === 'expense' ? 'Uscite' : 'Entrate'} /></div>
              <ul className="divide-y divide-line/60">
                {items.map((i) => (
                  <li key={i.id}>
                    <button className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => setOpen(open === i.id ? null : i.id)} disabled={i.children.length === 0}>
                      <CatBubble icon={i.icon} color={i.color} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-2 text-sm font-semibold"><span className="truncate">{i.name}</span><span className="tabular-nums">{formatMoney(i.total)}</span></span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${(i.total / total) * 100}%`, background: i.color }} /></span>
                          <span className="w-10 text-right text-xs text-muted">{Math.round((i.total / total) * 100)}%</span>
                        </span>
                      </span>
                      {i.children.length > 0 && <ChevronDown size={16} className={`text-muted transition ${open === i.id ? 'rotate-180' : ''}`} />}
                    </button>
                    {open === i.id && (
                      <ul className="mb-2 ml-12 space-y-1.5 text-sm">
                        {i.children.map((c) => <li key={c.id} className="flex justify-between text-muted"><span>{c.icon} {c.name}</span><span className="tabular-nums">{formatMoney(c.total)}</span></li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-center text-xs text-muted">Periodo: entrate {formatMoney(sum.income)} · uscite {formatMoney(sum.expense)} (giroconti esclusi)</p>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 font-bold"><Handshake size={20} className="text-brand" />Bilancio di coppia</div>
          <div className="grid grid-cols-2 gap-3 text-center">
            {[['Questo mese', monthNet], ['Complessivo', totalNet]].map(([l, n]) => (
              <div key={l as string} className="rounded-xl bg-bg p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">{l as string}</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums">{formatMoney(Math.abs(n as number))}</p>
                <p className="text-xs text-muted">{line(n as number)}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Calcolato sulle spese pagate da una persona con divisione 50/50 o anticipata; i giroconti tra conti dei due profili contano come rimborsi.</p>
          {totalNet !== 0 && <button className="btn-soft mt-3 w-full" onClick={settle}>Registra rimborso ({formatMoney(Math.abs(totalNet))})</button>}
        </div>
      </div>
    </div>
  )
}
