import { useMemo, useState } from 'react'
import { ChevronDown, CircleCheck, Handshake, Wallet } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { NotificationBell } from '../components/Notifications'
import { categoryBreakdown, debtTone, headlineDebt, familyBalances, filterTransactions, periodRange, sortedAccounts, summarize, type Debt } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { paypalUrl } from '../lib/paypal'
import { MonthNav, ScopeChips } from '../components/Nav'
import { LiquidityPanel } from '../components/LiquidityChart'
import { Panel } from '../components/Panel'
import { MascotPeek } from '../components/Mascots'
import { Donut } from '../components/Donut'
import { CatBubble, Segmented } from '../components/ui'
import type { CategoryType } from '../types'

const TONE = { credit: 'text-inc', debit: 'text-exp', neutral: 'text-ink' } as const

export function StatsPage() {
  const { db, view, nameOf, openTx, me } = useApp()
  const [type, setType] = useState<CategoryType>('expense')
  const [open, setOpen] = useState<string | null>(null)
  const { from, to } = periodRange(view.month, view.period)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: '', me: me?.id ?? null }), [db, view.scope, view.accountId, me, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => categoryBreakdown(db, txs, type), [db, txs, type])
  const total = items.reduce((s, i) => s + i.total, 0)
  const sum = summarize(txs)

  // saldi tra membri: su tutte le transazioni (ignora il filtro d'ambito), del mese e complessivi
  const monthDebts = useMemo(() => familyBalances(db, db.transactions.filter((x) => { const d = new Date(x.date); return d >= from && d < to })), [db, from.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalDebts = useMemo(() => familyBalances(db, db.transactions), [db])
  const head = headlineDebt(totalDebts, me?.id)

  const settle = (d: Debt) => {
    const accs = sortedAccounts(db).filter((a) => !a.hidden)
    const personal = (id: string) => accs.find((a) => a.members.length === 1 && a.members[0] === id) ?? accs.find((a) => a.members.includes(id))
    openTx({ initial: { type: 'transfer', amount: d.amount, title: 'Rimborso spese', accountId: personal(d.debtor)?.id, toAccountId: personal(d.creditor)?.id ?? null } })
  }

  const payTo = (id: string) => db.members.find((m) => m.id === id)?.paypal ?? null
  /** apre PayPal.Me con l'importo e, qui nell'app, il rimborso già compilato da salvare */
  const payPaypal = (d: Debt) => {
    const handle = payTo(d.creditor)
    if (!handle) return
    window.open(paypalUrl(handle, d.amount), '_blank', 'noopener')
    settle(d)
  }

  const DebtList = ({ list, actions }: { list: Debt[]; actions?: boolean }) =>
    list.length === 0 ? <p className="flex items-center gap-1.5 py-2 text-sm text-muted"><CircleCheck size={16} aria-hidden />Siete in pari</p> : (
      <ul className="space-y-2">
        {[...list].sort((a, b) => Number(b.debtor === me?.id || b.creditor === me?.id) - Number(a.debtor === me?.id || a.creditor === me?.id)).map((d) => (
          <li key={d.debtor + d.creditor} className="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
            <span><b>{nameOf(d.debtor)}</b> deve a <b>{nameOf(d.creditor)}</b></span>
            <span className="flex items-center gap-2">
              <b className={`tabular-nums ${TONE[debtTone(d, me?.id)]}`}>{formatMoney(d.amount)}</b>
              {actions && <button className="btn-soft !px-2.5 !py-1 !text-xs" onClick={() => settle(d)}>Rimborsa</button>}
              {actions && d.debtor === me?.id && payTo(d.creditor) && <button className="btn-soft !px-2.5 !py-1 !text-xs !text-trf" onClick={() => payPaypal(d)} aria-label={`Paga ${nameOf(d.creditor)} con PayPal`}>PayPal</button>}
            </span>
          </li>
        ))}
      </ul>
    )

  return (
    <div>
      <div className="space-y-3 px-4 pt-safe">
        <div className="flex items-center justify-between pt-3"><h1 className="text-xl font-extrabold tracking-tight">Statistiche</h1><NotificationBell /></div>
        <MascotPeek kind="zenitsu" side="left">
          <Panel id="debts" label="Saldi tra i membri" icon={<Handshake size={22} />}
            headline={head
              ? <span className={TONE[head.tone]} data-tone={head.tone}><b>{nameOf(head.debt.debtor)}</b> deve a <b>{nameOf(head.debt.creditor)}</b> · {formatMoney(head.debt.amount)}</span>
              : <span className="inline-flex items-center gap-1.5 text-ink" data-tone="ok"><CircleCheck size={20} aria-hidden />Tutti i saldi tra i membri sono in ordine</span>}
            quick={head && head.tone === 'debit' && payTo(head.debt.creditor)
              ? <button className="btn-soft w-full" onClick={() => payPaypal(head.debt)} aria-label={`Paga ${nameOf(head.debt.creditor)} con PayPal`}><Wallet size={18} />Paga {nameOf(head.debt.creditor)} con PayPal · {formatMoney(head.debt.amount)}</button>
              : undefined}
            sub={totalDebts.length > 1 ? <span className="text-muted">+ {totalDebts.length - 1} {totalDebts.length === 2 ? 'altro saldo' : 'altri saldi'}</span> : undefined}>
            <p className="mb-1 text-[11px] font-semibold uppercase text-muted">{view.period === 'year' ? 'Quest\'anno' : 'Questo mese'}</p>
            <DebtList list={monthDebts} />
            <p className="mb-1 mt-4 text-[11px] font-semibold uppercase text-muted">Complessivo</p>
            <DebtList list={totalDebts} actions />
            <p className="mt-3 text-xs text-muted">Calcolato sulle spese pagate da un membro e divise con altri; i trasferimenti tra conti personali di membri diversi contano come rimborsi. Le spese pagate dal «conto condiviso» non generano debiti.</p>
          </Panel>
        </MascotPeek>
        <LiquidityPanel />
      </div>
      <div className="sticky top-0 z-10 mt-3 space-y-3 bg-bg/90 px-4 pb-3 pt-2 backdrop-blur">
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
          <p className="mt-2 text-center text-xs text-muted">Periodo: entrate {formatMoney(sum.income)} · uscite {formatMoney(sum.expense)} (trasferimenti esclusi)</p>
        </div>

      </div>
    </div>
  )
}
