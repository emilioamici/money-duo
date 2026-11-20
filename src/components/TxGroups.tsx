import { useMemo } from 'react'
import { AnimatePresence, m } from 'framer-motion'
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
      {groups.map(([k, list], gi) => {
        const day = summarize(list)
        return (
          <m.section key={k} className="card overflow-hidden" initial={gi < 8 ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 34, delay: Math.min(gi, 6) * 0.04 }}>
            <header className="flex justify-between border-b border-line/60 bg-line/20 px-4 py-2 text-xs font-semibold text-muted">
              <span>{dayLabel(k)}</span>
              <span className="tabular-nums">{day.income > 0 && <span className="text-inc">+{formatMoney(day.income)} </span>}{day.expense > 0 && <span className="text-exp">−{formatMoney(day.expense)}</span>}</span>
            </header>
            <div className="divide-y divide-line/50">
              {/* una riga eliminata esce scorrendo di lato; una nuova entra dal basso */}
              <AnimatePresence initial={false}>
                {list.map((t) => (
                  <m.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                    <TransactionRow tx={t} />
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </m.section>
        )
      })}
    </>
  )
}
