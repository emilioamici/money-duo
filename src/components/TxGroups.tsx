import { useMemo } from 'react'
import type { Transaction } from '../types'
import { summarize } from '../lib/calc'
import { dayKey, dayLabel, formatMoney } from '../lib/format'
import { TransactionRow } from './TransactionRow'

/** Transazioni raggruppate per giorno, con il totale di ogni giorno. */
export function TxGroups({ txs }: { txs: Transaction[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of txs) { const k = dayKey(t.date); m.set(k, [...(m.get(k) ?? []), t]) }
    return [...m.entries()]
  }, [txs])
  return (
    <>
      {groups.map(([k, list]) => {
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
    </>
  )
}
