import { useMemo, useState } from 'react'
import { CircleSlash, CircleCheck, Eye, EyeOff, Pencil, Plus, Wallet } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { NotificationBell } from '../components/Notifications'
import { accountBalances, isSharedAccount, sortedAccounts, totalLiquidity, visibleTo } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { setAccountExcluded, setAccountHidden } from '../lib/mutations'
import { AccountForm, GROUP_LABEL } from '../components/AccountForm'
import { EmptyState, MembersBadge, Toggle } from '../components/ui'
import { SwipeRow } from '../components/SwipeRow'
import { AccountDetail } from '../components/AccountDetail'
import { MascotPeek } from '../components/Mascots'
import type { Account, AccountGroup } from '../types'

const GROUP_ORDER: AccountGroup[] = ['cash', 'bank', 'card', 'savings', 'investment', 'other']

export function AccountsPage() {
  const { db, commit, me, members } = useApp()
  const [showHidden, setShowHidden] = useState(false)
  const [form, setForm] = useState<{ account?: Account } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const bal = useMemo(() => accountBalances(db), [db])
  const mine = (a: Account) => visibleTo(db, a, me?.id ?? null)
  const total = totalLiquidity(db, bal, mine)
  const list = sortedAccounts(db).filter((a) => mine(a) && (showHidden || !a.hidden))
  const hiddenCount = db.accounts.filter((a) => a.hidden && mine(a)).length

  const detail = selected ? db.accounts.find((a) => a.id === selected) : undefined
  if (detail && mine(detail)) {
    return (
      <>
        <AccountDetail account={detail} onBack={() => setSelected(null)} onEdit={() => setForm({ account: detail })} />
        {form && <AccountForm account={form.account} onClose={() => setForm(null)} />}
      </>
    )
  }

  return (
    <div>
      <div className="px-4 pb-3 pt-safe"><div className="flex items-center justify-between pt-3"><h1 className="text-xl font-extrabold tracking-tight">Conti</h1><NotificationBell /></div></div>
      <div className="space-y-3 px-4">
        <MascotPeek kind="mochi">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-muted">Liquidità totale</p>
          <p className={`text-3xl font-extrabold tabular-nums ${total < 0 ? 'text-exp' : ''}`}>{formatMoney(total)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-bg py-2">
              <p className="truncate px-1 text-[11px] font-semibold text-muted">Condivisi</p>
              <p className="text-sm font-bold tabular-nums">{formatMoney(totalLiquidity(db, bal, (a) => mine(a) && isSharedAccount(db, a)))}</p>
            </div>
            {members.map((m) => (
              <div key={m.id} className="rounded-xl bg-bg py-2">
                <p className="truncate px-1 text-[11px] font-semibold text-muted">{m.name}</p>
                <p className="text-sm font-bold tabular-nums">{formatMoney(totalLiquidity(db, bal, (a) => mine(a) && a.members.length === 1 && a.members[0] === m.id))}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Conti personali per membro; esclusi dal totale: conti nascosti e conti marcati come investimenti/fondi vincolati. Vedi solo i conti tuoi o condivisi con te.</p>
        </div>
        </MascotPeek>

        {list.length === 0 && <div className="card"><EmptyState icon={<Wallet size={28} />} title="Nessun conto" text="Aggiungi il tuo primo conto." /></div>}

        {GROUP_ORDER.map((g) => {
          const items = list.filter((a) => a.group === g)
          if (!items.length) return null
          return (
            <section key={g}>
              <h2 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">{GROUP_LABEL[g]}</h2>
              <div className="card divide-y divide-line/50 overflow-hidden">
                {items.map((a) => (
                  <SwipeRow key={a.id} testId="account-row" className={a.hidden ? 'opacity-55' : ''} actionWidth={76}
                    onTap={() => setSelected(a.id)} buttonClass="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left"
                    actions={[
                      { label: 'Modifica', ariaLabel: 'Modifica conto', icon: <Pencil size={18} />, className: 'bg-brand', onClick: () => setForm({ account: a }) },
                      { label: a.excludeFromTotal ? 'Includi' : 'Escludi', ariaLabel: a.excludeFromTotal ? 'Includi nel totale' : 'Escludi dal totale', icon: a.excludeFromTotal ? <CircleCheck size={18} /> : <CircleSlash size={18} />, className: 'bg-trf', onClick: () => commit((d) => setAccountExcluded(d, a.id, !a.excludeFromTotal)) },
                      { label: a.hidden ? 'Mostra' : 'Nascondi', ariaLabel: a.hidden ? 'Mostra conto' : 'Nascondi conto', icon: a.hidden ? <Eye size={18} /> : <EyeOff size={18} />, className: 'bg-exp', onClick: () => commit((d) => setAccountHidden(d, a.id, !a.hidden)) },
                    ]}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5"><MembersBadge ids={a.members} />{a.excludeFromTotal && <span className="text-[11px] text-muted">fuori dal totale</span>}</span>
                    </span>
                    <span className={`font-bold tabular-nums ${(bal[a.id] ?? 0) < 0 ? 'text-exp' : ''}`}>{formatMoney(bal[a.id] ?? 0)}</span>
                  </SwipeRow>
                ))}
              </div>
            </section>
          )
        })}

        {list.length > 0 && <p className="px-1 text-xs text-muted">Tocca un conto per vedere i suoi movimenti. Scorrilo verso sinistra per modificarlo, escluderlo dal totale o nasconderlo.</p>}
        <button className="btn-soft w-full" onClick={() => setForm({})}><Plus size={18} />Aggiungi conto</button>
        {hiddenCount > 0 && <div className="card px-4 pt-3"><Toggle checked={showHidden} onChange={setShowHidden} label={`Mostra conti nascosti (${hiddenCount})`} /></div>}
      </div>
      {form && <AccountForm account={form.account} onClose={() => setForm(null)} />}
    </div>
  )
}
