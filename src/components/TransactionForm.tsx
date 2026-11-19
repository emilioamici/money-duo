import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ProfileId, SplitMode, Transaction, TxType } from '../types'
import { useApp, type TxFormState } from '../store/AppProvider'
import { accountById, childCategories, sortedAccounts, topCategories } from '../lib/calc'
import { centsToInput, formatMoney, fromLocalInput, parseAmount, toLocalInput } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { deleteTransaction, saveTransaction } from '../lib/mutations'
import { CatBubble, Field, ProfileChips, Segmented, Sheet } from './ui'
import { ask } from './dialogs'

function CategoryPicker({ type, value, onChange }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void }) {
  const { db } = useApp()
  const cur = db.categories.find((c) => c.id === value)
  const parentId = cur ? cur.parentId ?? cur.id : null
  const tops = topCategories(db, type).filter(Boolean)
  // se la categoria corrente è nascosta la mostriamo comunque, così la modifica non la perde
  const list = cur && !tops.some((t) => t.id === parentId) ? [...tops, db.categories.find((c) => c.id === parentId)!].filter(Boolean) : tops
  const subs = parentId ? childCategories(db, parentId).concat(cur && cur.parentId && cur.hidden ? [cur] : []) : []
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(parentId === c.id && !cur?.parentId ? null : c.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] font-medium transition ${parentId === c.id ? 'border-brand bg-brand/10' : 'border-line'}`}>
            <CatBubble icon={c.icon} color={c.color} size={34} />
            <span className="w-full truncate text-center">{c.name}</span>
          </button>
        ))}
      </div>
      {subs.length > 0 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
          {subs.map((s) => (
            <button key={s.id} type="button" onClick={() => onChange(value === s.id ? parentId : s.id)} className={`chip ${value === s.id ? 'chip-on' : ''}`}>
              <span>{s.icon}</span>{s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TransactionForm({ state, onClose }: { state: TxFormState; onClose: () => void }) {
  const { db, commit, prefs, setPrefs, names } = useApp()
  const { tx, initial } = state
  const accs = useMemo(() => accountById(db), [db])
  const accounts = useMemo(() => sortedAccounts(db).filter((a) => !a.hidden || a.id === tx?.accountId || a.id === tx?.toAccountId), [db, tx])
  const seed = { ...initial, ...tx }

  const defaultAcc = accounts.find((a) => a.id === prefs.lastAccountId)?.id ?? accounts[0]?.id ?? ''
  const [type, setType] = useState<TxType>(seed.type ?? 'expense')
  const [amount, setAmount] = useState(seed.amount ? centsToInput(seed.amount) : '')
  const [date, setDate] = useState(toLocalInput(seed.date ?? nowIso()))
  const [accountId, setAccountId] = useState(seed.accountId ?? defaultAcc)
  const [toAccountId, setToAccountId] = useState(seed.toAccountId ?? accounts.find((a) => a.id !== (seed.accountId ?? defaultAcc))?.id ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(seed.categoryId ?? null)
  const [title, setTitle] = useState(seed.title ?? '')
  const [note, setNote] = useState(seed.note ?? '')
  const [paidBy, setPaidBy] = useState<ProfileId>(seed.paidBy ?? accs.get(seed.accountId ?? defaultAcc)?.owner ?? 'shared')
  const [paidTouched, setPaidTouched] = useState(!!seed.paidBy)
  const [split, setSplit] = useState<SplitMode>(seed.split ?? 'personal')
  const [error, setError] = useState('')

  const cents = parseAmount(amount)
  const other: ProfileId = paidBy === 'a' ? 'b' : 'a'
  const showSplit = type === 'expense' && paidBy !== 'shared'
  const effSplit: SplitMode = showSplit ? split : 'personal'

  const pickAccount = (id: string) => {
    setAccountId(id)
    if (!paidTouched) setPaidBy(accs.get(id)?.owner ?? 'shared')
    if (id === toAccountId) setToAccountId(accounts.find((a) => a.id !== id)?.id ?? '')
  }
  const changeType = (t: TxType) => {
    setType(t)
    if (t !== 'transfer' && categoryId && db.categories.find((c) => c.id === categoryId)?.type !== t) setCategoryId(null)
    if (t === 'transfer') setCategoryId(null)
  }

  const debtHint = (() => {
    if (!showSplit || !cents || effSplit === 'personal') return ''
    const share = effSplit === 'equal' ? Math.round(cents / 2) : cents
    return `${names[other]} deve a ${names[paidBy]} ${formatMoney(share)}`
  })()

  const save = () => {
    if (!cents || cents <= 0) return setError('Inserisci un importo maggiore di zero.')
    if (!accountId) return setError('Seleziona un conto.')
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Scegli due conti diversi per il giroconto.')
    const t: Transaction = {
      id: tx?.id ?? uid(), type, amount: cents, date: fromLocalInput(date || toLocalInput(nowIso())), accountId,
      toAccountId: type === 'transfer' ? toAccountId : null, categoryId: type === 'transfer' ? null : categoryId,
      title: title.trim(), note: note.trim(), paidBy: type === 'transfer' ? accs.get(accountId)?.owner ?? 'shared' : paidBy,
      split: type === 'expense' ? effSplit : 'personal', createdAt: tx?.createdAt ?? nowIso(), updatedAt: nowIso(),
    }
    commit((d) => saveTransaction(d, t))
    setPrefs({ lastAccountId: accountId })
    onClose()
  }

  const remove = async () => {
    if (!tx) return
    if (await ask({ title: 'Eliminare la transazione?', message: 'I saldi verranno ricalcolati.', ok: 'Elimina', danger: true })) {
      commit((d) => deleteTransaction(d, tx.id))
      onClose()
    }
  }

  const accOptions = accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {names[a.owner]}{a.hidden ? ' (nascosto)' : ''}</option>)

  return (
    <Sheet open onClose={onClose} title={tx ? 'Modifica transazione' : 'Nuova transazione'}
      footer={
        <div className="flex gap-2">
          {tx && <button className="btn-danger" onClick={remove} aria-label="Elimina"><Trash2 size={18} /></button>}
          <button className="btn-primary flex-1" onClick={save}>Salva</button>
        </div>
      }>
      <Segmented<TxType> value={type} onChange={changeType} options={[
        { value: 'expense', label: 'Uscita', color: 'text-exp' }, { value: 'income', label: 'Entrata', color: 'text-inc' }, { value: 'transfer', label: 'Giroconto', color: 'text-trf' },
      ]} />

      <div className="my-4 rounded-2xl bg-bg p-4 text-center">
        <input inputMode="decimal" autoFocus={!tx} placeholder="0,00" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }}
          className={`w-full bg-transparent text-center text-4xl font-bold outline-none placeholder:text-line ${type === 'expense' ? 'text-exp' : type === 'income' ? 'text-inc' : 'text-trf'}`} />
        <span className="text-xs text-muted">Importo in euro</span>
      </div>

      {accounts.length === 0 ? (
        <p className="mb-4 rounded-xl bg-exp/10 p-3 text-sm text-exp">Nessun conto visibile: crea o mostra un conto dalla sezione Conti.</p>
      ) : type === 'transfer' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Da"><select className="input" value={accountId} onChange={(e) => pickAccount(e.target.value)}>{accOptions}</select></Field>
          <Field label="A"><select className="input" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>{accOptions.filter((o) => o.key !== accountId)}</select></Field>
        </div>
      ) : (
        <Field label="Conto"><select className="input" value={accountId} onChange={(e) => pickAccount(e.target.value)}>{accOptions}</select></Field>
      )}

      {type !== 'transfer' && <Field label="Categoria"><CategoryPicker type={type} value={categoryId} onChange={setCategoryId} /></Field>}

      <Field label="Data e ora"><input type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Titolo"><input className="input" placeholder={type === 'transfer' ? 'Es. Quota mensile' : 'Es. Spesa settimanale'} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>

      {type !== 'transfer' && (
        <Field label={type === 'expense' ? 'Chi ha pagato' : 'Chi ha incassato'}>
          <ProfileChips value={paidBy} onChange={(p) => { setPaidBy(p); setPaidTouched(true) }} />
        </Field>
      )}
      {showSplit && (
        <Field label="Divisione" hint={debtHint}>
          <div className="flex flex-wrap gap-2">
            {([['personal', 'Personale'], ['equal', '50/50'], ['advance', `Anticipata 100% per ${names[other]}`]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setSplit(v)} className={`chip ${effSplit === v ? 'chip-on' : ''}`}>{l}</button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Note"><textarea className="input min-h-[72px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <p className="text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
