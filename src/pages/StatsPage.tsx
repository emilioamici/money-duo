import { useMemo, useState } from 'react'
import { ChevronDown, Handshake } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { categoryBreakdown, familyBalances, filterTransactions, monthRange, sortedAccounts, summarize, type Debt } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { MonthNav, ScopeChips } from '../components/Nav'
import { Donut } from '../components/Donut'
import { CatBubble, Segmented } from '../components/ui'
import type { CategoryType } from '../types'

export function StatsPage() {
  const { db, view, nameOf, openTx, me } = useApp()
  const [type, setType] = useState<CategoryType>('expense')
  const [open, setOpen] = useState<string | null>(null)
  const { from, to } = monthRange(view.month)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: '', me: me?.id ?? null }), [db, view.scope, view.accountId, me, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => categoryBreakdown(db, txs, type), [db, txs, type])
  const total = items.reduce((s, i) => s + i.total, 0)
  const sum = summarize(txs)

  // saldi tra membri: su tutte le transazioni (ignora il filtro d'ambito), del mese e complessivi
  const monthDebts = useMemo(() => familyBalances(db, db.transactions.filter((x) => { const d = new Date(x.date); return d >= from && d < to })), [db, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalDebts = useMemo(() => familyBalances(db, db.transactions), [db])

  const settle = (d: Debt) => {
    const accs = sortedAccounts(db).filter((a) => !a.hidden)
    const personal = (id: string) => accs.find((a) => a.members.length === 1 && a.members[0] === id) ?? accs.find((a) => a.members.includes(id))
    openTx({ initial: { type: 'transfer', amount: d.amount, title: 'Rimborso spese', accountId: personal(d.debtor)?.id, toAccountId: personal(d.creditor)?.id ?? null } })
  }

  const DebtList = ({ list, actions }: { list: Debt[]; actions?: boolean }) =>
    list.length === 0 ? <p className="py-2 text-sm text-muted">Siete in pari</p> : (
      <ul className="space-y-2">
        {[...list].sort((a, b) => Number(b.debtor === me?.id || b.creditor === me?.id) - Number(a.debtor === me?.id || a.creditor === me?.id)).map((d) => (
          <li key={d.debtor + d.creditor} className="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
            <span><b>{nameOf(d.debtor)}</b> deve a <b>{nameOf(d.creditor)}</b></span>
            <span className="flex items-center gap-2">
              <b className="tabular-nums">{formatMoney(d.amount)}</b>
              {actions && <button className="btn-soft !px-2.5 !py-1 !text-xs" onClick={() => settle(d)}>Rimborsa</button>}
            </span>
          </li>
        ))}
      </ul>
    )

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
          <div className="mb-3 flex items-center gap-2 font-bold"><Handshake size={20} className="text-brand" />Saldi tra i membri</div>
          <p className="mb-1 text-[11px] font-semibold uppercase text-muted">Questo mese</p>
          <DebtList list={monthDebts} />
          <p className="mb-1 mt-4 text-[11px] font-semibold uppercase text-muted">Complessivo</p>
          <DebtList list={totalDebts} actions />
          <p className="mt-3 text-xs text-muted">Calcolato sulle spese pagate da un membro e divise con altri; i giroconti tra conti personali di membri diversi contano come rimborsi. Le spese pagate dal «conto condiviso» non generano debiti.</p>
        </div>
      </div>
    </div>
  )
}
