import { useMemo, useState } from 'react'
import { Receipt, Search, SlidersHorizontal, X } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { ALL_TIME, countFilters, emptyFilters, filterTransactions, periodRange, summarize } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { MonthNav, ScopeChips, SyncChip } from '../components/Nav'
import { TxGroups } from '../components/TxGroups'
import { FilterSheet } from '../components/FilterSheet'
import { MascotPeek } from '../components/Mascots'
import { EmptyState } from '../components/ui'
import { NotificationBell } from '../components/Notifications'
import { t } from '../i18n'

export function HomePage({ onOpenSync }: { onOpenSync: () => void }) {
  const { db, view, setView, openTx, me } = useApp()
  const [search, setSearch] = useState(!!view.q)
  const [filtering, setFiltering] = useState(false)
  const nFilters = countFilters(view.filters)
  const searching = view.q.trim() !== ''
  // con un testo di ricerca si cerca in tutte le transazioni, non solo nel periodo visualizzato
  const { from, to } = searching ? ALL_TIME : periodRange(view.month, view.period)
  const txs = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: view.q, me: me?.id ?? null, adv: view.filters }), [db, view, me, from.getTime(), to.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = summarize(txs)
  return (
    <div>
      <div className="space-y-3 px-4 pb-3 pt-safe">
        <div className="flex items-center justify-between pt-3">
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight"><img src="./icon-192.png" alt="" className="h-9 w-9 rounded-xl" /><span className="sr-only sm:not-sr-only">Money <span className="text-brand">Duo</span></span></h1>
          <div className="flex items-center gap-2">
            <SyncChip onClick={onOpenSync} />
            <NotificationBell />
            <button className="icon-btn" aria-label={t('Filtri')} onClick={() => setFiltering(true)}>
              <SlidersHorizontal size={20} />
              {nFilters > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-onbrand">{nFilters}</span>}
            </button>
            <button className="icon-btn" aria-label={t('Cerca')} onClick={() => { setSearch((s) => !s); if (search) setView({ q: '' }) }}>{search ? <X size={20} /> : <Search size={20} />}</button>
          </div>
        </div>
        {searching ? <p className="rounded-xl bg-brand/10 px-3 py-2 text-center text-sm font-semibold text-brand" data-testid="search-all">{t('Ricerca in tutte le transazioni, di ogni periodo')}</p> : <MonthNav />}
        {search && <input autoFocus className="input" placeholder={t('Cerca per titolo, nota, categoria, conto, importo…')} value={view.q} onChange={(e) => setView({ q: e.target.value })} />}
        <ScopeChips />
      </div>

      <div className="space-y-3 px-4">
        <MascotPeek kind="mochi">
          <div className="card grid grid-cols-3 divide-x divide-line/70 py-3 text-center">
            <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Entrate')}</p><p className="font-bold text-inc tabular-nums">{formatMoney(sum.income)}</p></div>
            <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Uscite')}</p><p className="font-bold text-exp tabular-nums">{formatMoney(sum.expense)}</p></div>
            <div><p className="text-[11px] font-semibold uppercase text-muted">{t('Bilancio')}</p><p className={`font-bold tabular-nums ${sum.balance < 0 ? 'text-exp' : ''}`}>{formatMoney(sum.balance)}</p></div>
          </div>
        </MascotPeek>

        {nFilters > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-brand/10 px-3 py-2 text-sm">
            <button className="font-semibold text-brand" onClick={() => setFiltering(true)}>{nFilters === 1 ? t('1 filtro attivo') : t('{n} filtri attivi', { n: nFilters })}</button>
            <button className="font-semibold text-muted" onClick={() => setView({ filters: emptyFilters() })}>{t('Azzera')}</button>
          </div>
        )}

        {txs.length === 0 ? (
          <div className="card"><EmptyState icon={<Receipt size={28} />} title={t('Nessuna transazione')} text={view.q || nFilters ? t('Nessun risultato per questa ricerca o questi filtri.') : t('Non ci sono movimenti in questo periodo.')}
            action={<button className="btn-primary" onClick={() => openTx()}>{t('Aggiungi transazione')}</button>} /></div>
        ) : <TxGroups txs={txs} />}
      </div>
      {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
    </div>
  )
}
