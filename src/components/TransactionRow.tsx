import type { Transaction } from '../types'
import { useApp } from '../store/AppProvider'
import { accountById, categoryById, visibleTo } from '../lib/calc'
import { formatMoney, timeLabel } from '../lib/format'
import { CatBubble } from './ui'
import { useMemo } from 'react'
import { ArrowLeftRight } from 'lucide-react'

export function TransactionRow({ tx }: { tx: Transaction }) {
  const { db, nameOf, openTx, me } = useApp()
  const accs = useMemo(() => accountById(db), [db])
  const cats = useMemo(() => categoryById(db), [db])
  const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined
  const parent = cat?.parentId ? cats.get(cat.parentId) : undefined
  const from = accs.get(tx.accountId)
  const to = tx.toAccountId ? accs.get(tx.toAccountId) : undefined

  const title = tx.title || (tx.type === 'transfer' ? 'Giroconto' : cat?.name ?? (tx.type === 'income' ? 'Entrata' : 'Uscita'))
  const accName = (a?: typeof from) => (!a ? '?' : visibleTo(db, a, me?.id ?? null) ? a.name : 'Conto privato')
  const sub = tx.type === 'transfer'
    ? `${accName(from)} → ${accName(to)}`
    : [parent ? `${parent.name} › ${cat?.name}` : cat?.name, accName(from)].filter(Boolean).join(' · ')
  const badge = tx.type === 'expense' && tx.paidBy && tx.participants.length > 0
    ? `Diviso tra ${tx.participants.length} · paga ${nameOf(tx.paidBy)}`
    : tx.type !== 'transfer' && tx.paidBy && !(from?.members.length === 1 && from.members[0] === tx.paidBy) ? `Pagato da ${nameOf(tx.paidBy)}` : ''
  const color = tx.type === 'income' ? 'text-inc' : tx.type === 'expense' ? 'text-exp' : 'text-trf'

  return (
    <button onClick={() => openTx({ tx })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-line/30 active:bg-line/50">
      {tx.type === 'transfer'
        ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-trf/15 text-trf"><ArrowLeftRight size={18} /></span>
        : <CatBubble icon={cat?.icon ?? '❔'} color={cat?.color ?? '#94a3b8'} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{timeLabel(tx.date)} · {sub}</span>
        {badge && <span className="mt-0.5 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">{badge}</span>}
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${color}`}>{tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}{formatMoney(tx.amount)}</span>
    </button>
  )
}
