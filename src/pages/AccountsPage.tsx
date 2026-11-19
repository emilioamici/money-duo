import { useMemo, useState } from 'react'
import { Eye, EyeOff, Plus, Wallet } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { accountBalances, sortedAccounts, totalLiquidity } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { setAccountHidden } from '../lib/mutations'
import { AccountForm, GROUP_LABEL } from '../components/AccountForm'
import { EmptyState, OwnerBadge, Toggle } from '../components/ui'
import type { Account, AccountGroup, ProfileId } from '../types'

const GROUP_ORDER: AccountGroup[] = ['cash', 'bank', 'card', 'savings', 'investment', 'other']

export function AccountsPage() {
  const { db, commit, names } = useApp()
  const [showHidden, setShowHidden] = useState(false)
  const [form, setForm] = useState<{ account?: Account } | null>(null)
  const bal = useMemo(() => accountBalances(db), [db])
  const total = totalLiquidity(db, bal)
  const list = sortedAccounts(db).filter((a) => showHidden || !a.hidden)
  const hiddenCount = db.accounts.filter((a) => a.hidden).length

  return (
    <div>
      <div className="px-4 pb-3 pt-safe"><h1 className="pt-3 text-xl font-extrabold tracking-tight">Conti</h1></div>
      <div className="space-y-3 px-4">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-muted">Liquidità totale</p>
          <p className={`text-3xl font-extrabold tabular-nums ${total < 0 ? 'text-exp' : ''}`}>{formatMoney(total)}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(['a', 'b', 'shared'] as ProfileId[]).map((p) => (
              <div key={p} className="rounded-xl bg-bg py-2">
                <p className="truncate px-1 text-[11px] font-semibold text-muted">{names[p]}</p>
                <p className="text-sm font-bold tabular-nums">{formatMoney(totalLiquidity(db, bal, p))}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Esclusi dal totale: conti nascosti e conti marcati come investimenti/fondi vincolati.</p>
        </div>

        {list.length === 0 && <div className="card"><EmptyState icon={<Wallet size={28} />} title="Nessun conto" text="Aggiungi il tuo primo conto." /></div>}

        {GROUP_ORDER.map((g) => {
          const items = list.filter((a) => a.group === g)
          if (!items.length) return null
          return (
            <section key={g}>
              <h2 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">{GROUP_LABEL[g]}</h2>
              <div className="card divide-y divide-line/50 overflow-hidden">
                {items.map((a) => (
                  <div key={a.id} className={`flex items-center gap-2 pr-2 ${a.hidden ? 'opacity-55' : ''}`}>
                    <button className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left" onClick={() => setForm({ account: a })}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{a.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5"><OwnerBadge owner={a.owner} />{a.excludeFromTotal && <span className="text-[11px] text-muted">fuori dal totale</span>}</span>
                      </span>
                      <span className={`font-bold tabular-nums ${(bal[a.id] ?? 0) < 0 ? 'text-exp' : ''}`}>{formatMoney(bal[a.id] ?? 0)}</span>
                    </button>
                    <button className="rounded-full p-2 text-muted hover:bg-line/60" aria-label={a.hidden ? 'Mostra conto' : 'Nascondi conto'} onClick={() => commit((d) => setAccountHidden(d, a.id, !a.hidden))}>
                      {a.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )
        })}

        <button className="btn-soft w-full" onClick={() => setForm({})}><Plus size={18} />Aggiungi conto</button>
        {hiddenCount > 0 && <div className="card px-4 pt-3"><Toggle checked={showHidden} onChange={setShowHidden} label={`Mostra conti nascosti (${hiddenCount})`} /></div>}
      </div>
      {form && <AccountForm account={form.account} onClose={() => setForm(null)} />}
    </div>
  )
}
