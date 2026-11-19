import type { Transaction } from '../types'
import { useApp } from '../store/AppProvider'
import { accountById, categoryById, involvedAccountIds, isSplit, txPayerIds, visibleTo } from '../lib/calc'
import { formatMoney, timeLabel } from '../lib/format'
import { CatBubble } from './ui'
import { useMemo } from 'react'
import { ArrowLeftRight, Copy, Pencil, Trash2 } from 'lucide-react'
import { deleteTransaction } from '../lib/mutations'
import { ask } from './dialogs'
import { useTxActions } from './txActions'
import { SwipeRow } from './SwipeRow'

/** Riga della lista: scorrendola verso sinistra compaiono «Modifica», «Copia» ed «Elimina». */
export function TransactionRow({ tx }: { tx: Transaction }) {
  const { db, nameOf, openTx, me, commit } = useApp()
  const { copy } = useTxActions()
  const remove = async () => {
    if (await ask({ title: 'Eliminare la transazione?', message: 'I saldi verranno ricalcolati.', ok: 'Elimina', danger: true })) commit((d) => deleteTransaction(d, tx.id))
  }
  const accs = useMemo(() => accountById(db), [db])
  const cats = useMemo(() => categoryById(db), [db])
  const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined
  const parent = cat?.parentId ? cats.get(cat.parentId) : undefined
  const from = accs.get(tx.accountId)
  const payerIds = txPayerIds(tx)
  const extraAccounts = tx.type === 'expense' ? involvedAccountIds(tx).length - 1 : 0
  const to = tx.toAccountId ? accs.get(tx.toAccountId) : undefined

  const title = tx.title || (tx.type === 'transfer' ? 'Trasferimento' : cat?.name ?? (tx.type === 'income' ? 'Entrata' : 'Uscita'))
  const accName = (a?: typeof from) => (!a ? '?' : visibleTo(db, a, me?.id ?? null) ? a.name : 'Conto privato')
  const sub = tx.type === 'transfer'
    ? `${accName(from)} → ${accName(to)}`
    : [parent ? `${parent.name} › ${cat?.name}` : cat?.name, accName(from) + (extraAccounts > 0 ? ` +${extraAccounts}` : '')].filter(Boolean).join(' · ')
  const badge = isSplit(tx)
    ? `Split · ${tx.participants.length}${payerIds.length ? ` · ${payerIds.map(nameOf).join(' + ')}` : ''}`
    : tx.type !== 'transfer' && tx.paidBy && !(from?.members.length === 1 && from.members[0] === tx.paidBy) ? `Pagato da ${nameOf(tx.paidBy)}` : ''
  const color = tx.type === 'income' ? 'text-inc' : tx.type === 'expense' ? 'text-exp' : 'text-trf'

  return (
    <SwipeRow testId="tx-row" onTap={() => openTx({ tx })} buttonClass="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-line/30 active:bg-line/50"
      actions={[
        { label: 'Modifica', icon: <Pencil size={18} />, className: 'bg-brand', onClick: () => openTx({ tx }) },
        { label: 'Copia', icon: <Copy size={18} />, className: 'bg-trf', onClick: () => copy(tx) },
        { label: 'Elimina', icon: <Trash2 size={18} />, className: 'bg-exp', onClick: () => void remove() },
      ]}>
      {tx.type === 'transfer'
        ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-trf/15 text-trf"><ArrowLeftRight size={18} /></span>
        : <CatBubble icon={cat?.icon ?? '❔'} color={cat?.color ?? '#94a3b8'} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{timeLabel(tx.date)} · {sub}</span>
        <span className="mt-0.5 flex flex-wrap gap-1">
          {badge && <span className="inline-block rounded-lg bg-brand/10 px-2 py-0.5 text-[10px] font-semibold leading-tight text-brand">{badge}</span>}
          {(tx.tags ?? []).map((g) => <span key={g} className="inline-block rounded-full bg-line/70 px-2 py-0.5 text-[10px] font-medium text-muted">#{g}</span>)}
        </span>
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${color}`}>{tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}{formatMoney(tx.amount)}</span>
    </SwipeRow>
  )
}
