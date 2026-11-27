import { useMemo } from 'react'
import { ArrowLeft, Pencil, Receipt } from 'lucide-react'
import type { Account } from '../types'
import { useApp } from '../store/AppProvider'
import { accountBalances, filterTransactions, periodRange, summarize } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { MonthNav } from './Nav'
import { TxGroups } from './TxGroups'
import { EmptyState, MembersBadge } from './ui'
import { GROUP_LABEL } from './AccountForm'
import { MascotPeek } from './Mascots'
import { t } from '../i18n'

/** Dettaglio di un conto: saldo e movimenti del periodo scelto (mese o anno). */
export function AccountDetail({ account, onBack, onEdit }: { account: Account; onBack: () => void; onEdit: () => void }) {
  const { db, view, me, openTx } = useApp()
  const balance = useMemo(() => accountBalances(db)[account.id] ?? 0, [db, account.id])
  const { from, to } = periodRange(view.month, view.period)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: 'all', accountId: account.id, q: '', me: me?.id ?? null }), [db, account.id, me, from.getTime(), to.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = summarize(txs)

  return (
    <div>
      <div className="space-y-3 px-4 pb-3 pt-safe">
        <div className="flex items-center gap-2 pt-3">
          <button className="icon-btn" onClick={onBack} aria-label={t('Torna ai conti')}><ArrowLeft size={22} /></button>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{account.name}</h1>
          <button className="icon-btn" onClick={onEdit} aria-label={t('Modifica conto')}><Pencil size={20} /></button>
        </div>
        <MonthNav />
      </div>
      <div className="space-y-3 px-4">
        <MascotPeek kind="zenitsu" side="left">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-muted">{t('Saldo')} · {t(GROUP_LABEL[account.group])}</p>
          <p className={`text-3xl font-extrabold tabular-nums ${balance < 0 ? 'text-exp' : ''}`}>{formatMoney(balance)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <MembersBadge ids={account.members} />
            {account.excludeFromTotal && <span>{t('fuori dal totale')}</span>}
            {account.hidden && <span>{t('nascosto')}</span>}
          </div>
        </div>
        </MascotPeek>
        <div className="card grid grid-cols-3 divide-x divide-line/70 py-3 text-center">
          <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Entrate')}</p><p className="font-bold text-inc tabular-nums">{formatMoney(sum.income)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Uscite')}</p><p className="font-bold text-exp tabular-nums">{formatMoney(sum.expense)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Bilancio')}</p><p className={`font-bold tabular-nums ${sum.balance < 0 ? 'text-exp' : ''}`}>{formatMoney(sum.balance)}</p></div>
        </div>
        {txs.length === 0
          ? <div className="card"><EmptyState icon={<Receipt size={28} />} title={t('Nessun movimento')} text={t('Non ci sono movimenti su questo conto nel periodo scelto.')} action={<button className="btn-primary" onClick={() => openTx({ initial: { accountId: account.id } })}>{t('Aggiungi transazione')}</button>} /></div>
          : <TxGroups txs={txs} countSplit />}
      </div>
    </div>
  )
}
