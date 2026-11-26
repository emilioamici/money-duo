import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TxType } from '../types'
import { useApp } from '../store/AppProvider'
import { ALL_TIME, allTags, childCategories, countFilters, emptyFilters, filterTransactions, periodRange, sortedAccounts, topCategories, visibleTo, type TxFilters } from '../lib/calc'
import { centsToInput, parseAmount } from '../lib/format'
import { Sheet, Toggle } from './ui'
import { t } from '../i18n'

const TYPES: Array<[TxType, string]> = [['expense', 'Uscite'], ['income', 'Entrate'], ['transfer', 'Trasferimenti']]

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function Group({ title, count, children, open: init = false }: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(init)
  return (
    <section className="border-b border-line/60 py-2">
      <button type="button" className="flex w-full items-center justify-between py-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="font-semibold">{title}{!!count && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-onbrand">{count}</span>}</span>
        <ChevronDown size={18} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-2">{children}</div>}
    </section>
  )
}

/** Filtri della lista transazioni: tipo, conti, importo, categorie, tag. Si applicano subito. */
export function FilterSheet({ onClose }: { onClose: () => void }) {
  const { db, view, setView, me } = useApp()
  const f = view.filters
  const set = (patch: Partial<TxFilters>) => setView({ filters: { ...f, ...patch } })
  const accounts = useMemo(() => sortedAccounts(db).filter((a) => (!a.hidden && visibleTo(db, a, me?.id ?? null)) || f.accountIds.includes(a.id)), [db, me, f.accountIds])
  const tags = useMemo(() => allTags(db), [db])
  const { from, to } = view.q.trim() ? ALL_TIME : periodRange(view.month, view.period)
  const n = useMemo(() => filterTransactions(db, { from, to, scope: view.scope, accountId: view.accountId, q: view.q, me: me?.id ?? null, adv: f }).length, [db, from, to, view.scope, view.accountId, view.q, me, f])

  // importi: si digitano come testo e si convertono quando sono validi
  const [min, setMin] = useState(f.min !== null ? centsToInput(f.min) : '')
  const [max, setMax] = useState(f.max !== null ? centsToInput(f.max) : '')
  const amount = (raw: string, key: 'min' | 'max') => {
    key === 'min' ? setMin(raw) : setMax(raw)
    const c = raw.trim() ? parseAmount(raw) : null
    set({ [key]: c !== null && c >= 0 ? c : null } as Partial<TxFilters>)
  }

  return (
    <Sheet open onClose={onClose} title={t('Filtri')}
      footer={
        <div className="flex gap-2">
          <button className="btn-soft" disabled={!countFilters(f)} onClick={() => { setView({ filters: emptyFilters() }); setMin(''); setMax('') }}>{t('Azzera')}</button>
          <button className="btn-primary flex-1" onClick={onClose}>{n === 1 ? t('Mostra 1 transazione') : t('Mostra {n} transazioni', { n })}</button>
        </div>
      }>
      <Group title={t('Tipo')} count={f.types.length ? f.types.length : undefined} open>
        <div className="flex flex-wrap gap-2">
          {TYPES.map(([ty, label]) => <button key={ty} type="button" className={`chip ${f.types.includes(ty) ? 'chip-on' : ''}`} aria-pressed={f.types.includes(ty)} onClick={() => set({ types: toggle(f.types, ty) })}>{t(label)}</button>)}
        </div>
      </Group>

      <Group title={t('Conti')} count={f.accountIds.length || undefined}>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => <button key={a.id} type="button" className={`chip ${f.accountIds.includes(a.id) ? 'chip-on' : ''}`} aria-pressed={f.accountIds.includes(a.id)} onClick={() => set({ accountIds: toggle(f.accountIds, a.id) })}>{a.name}</button>)}
        </div>
      </Group>

      <Group title={t('Importo')} count={f.min !== null || f.max !== null ? 1 : undefined}>
        <div className="flex items-center gap-2">
          <input className="input" inputMode="decimal" placeholder={t('Min €')} aria-label={t('Importo minimo')} value={min} onChange={(e) => amount(e.target.value, 'min')} />
          <span className="text-muted">–</span>
          <input className="input" inputMode="decimal" placeholder={t('Max €')} aria-label={t('Importo massimo')} value={max} onChange={(e) => amount(e.target.value, 'max')} />
        </div>
      </Group>

      <Group title={t('Categorie')} count={f.categoryIds.length || undefined}>
        {(['expense', 'income'] as const).map((type) => (
          <div key={type} className="mb-3">
            <p className="label">{type === 'expense' ? t('Uscite') : t('Entrate')}</p>
            <div className="flex flex-wrap gap-2">
              {topCategories(db, type).map((c) => {
                const subs = childCategories(db, c.id)
                const parentOn = f.categoryIds.includes(c.id)
                return (
                  <div key={c.id} className="contents">
                    <button type="button" className={`chip ${parentOn ? 'chip-on' : ''}`} aria-pressed={parentOn} onClick={() => set({ categoryIds: toggle(f.categoryIds, c.id) })}>{c.icon} {c.name}</button>
                    {!parentOn && subs.map((s) => <button key={s.id} type="button" className={`chip !px-2.5 !py-1 !text-xs ${f.categoryIds.includes(s.id) ? 'chip-on' : ''}`} aria-pressed={f.categoryIds.includes(s.id)} onClick={() => set({ categoryIds: toggle(f.categoryIds, s.id) })}>{c.name} › {s.name}</button>)}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">{t('Scegliendo una categoria principale sono incluse le sue sottocategorie.')}</p>
      </Group>

      {tags.length > 0 && (
        <Group title={t('Tag')} count={f.tags.length || undefined}>
          <div className="flex flex-wrap gap-2">
            {tags.map((g) => <button key={g} type="button" className={`chip ${f.tags.includes(g) ? 'chip-on' : ''}`} aria-pressed={f.tags.includes(g)} onClick={() => set({ tags: toggle(f.tags, g) })}>#{g}</button>)}
          </div>
        </Group>
      )}

      <div className="pt-3"><Toggle checked={f.splitOnly} onChange={(v) => set({ splitOnly: v })} label={t('Solo spese condivise (split)')} /></div>
    </Sheet>
  )
}
