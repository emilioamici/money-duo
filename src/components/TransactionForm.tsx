import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Transaction, TxType } from '../types'
import { useApp, type TxFormState } from '../store/AppProvider'
import { accountById, sortedAccounts, visibleTo } from '../lib/calc'
import { centsToInput, fromLocalInput, parseAmount, toLocalInput } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { deleteTransaction, saveTransaction } from '../lib/mutations'
import { Segmented, Sheet } from './ui'
import { ask } from './dialogs'
import { TxFooterActions } from './txActions'
import { CategoryRow, Row, SelectField, TagsRow, TitleRow, accountLabel, plain } from './formParts'

/** Nuova transazione "normale": uscita, entrata o trasferimento. Le spese condivise hanno un form dedicato (Nuovo split). */
export function TransactionForm({ state, onClose }: { state: TxFormState; onClose: () => void }) {
  const { db, commit, prefs, setPrefs, me, nameOf } = useApp()
  const { tx, initial } = state
  const accs = useMemo(() => accountById(db), [db])
  const accounts = useMemo(
    () => sortedAccounts(db).filter((a) => a.id === tx?.accountId || a.id === tx?.toAccountId || (!a.hidden && visibleTo(db, a, me?.id ?? null))),
    [db, tx, me],
  )
  const seed = { ...initial, ...tx }

  const defaultAcc = accounts.find((a) => a.id === prefs.lastAccountId)?.id ?? accounts[0]?.id ?? ''
  /** conto personale -> quel membro; conto condiviso -> nessun pagatore in particolare */
  const payerFor = (accountId: string) => {
    const a = accs.get(accountId)
    return a && a.members.length === 1 ? a.members[0] : null
  }
  const [type, setType] = useState<TxType>(seed.type ?? 'expense')
  const [amount, setAmount] = useState(seed.amount ? centsToInput(seed.amount) : '')
  const [date, setDate] = useState(toLocalInput(seed.date ?? nowIso()))
  const [accountId, setAccountId] = useState(seed.accountId ?? defaultAcc)
  const [toAccountId, setToAccountId] = useState(seed.toAccountId ?? accounts.find((a) => a.id !== (seed.accountId ?? defaultAcc))?.id ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(seed.categoryId ?? null)
  const [title, setTitle] = useState(seed.title ?? '')
  const [note, setNote] = useState(seed.note ?? '')
  const [tags, setTags] = useState<string[]>(seed.tags ?? [])
  // chi ha pagato non si sceglie qui: segue il conto (personale = il suo proprietario); si conserva se la transazione ne aveva uno
  const [paidBy, setPaidBy] = useState<string | null>(seed.paidBy !== undefined ? seed.paidBy : payerFor(seed.accountId ?? defaultAcc))
  const [paidTouched] = useState(seed.paidBy !== undefined)
  const [error, setError] = useState('')

  const cents = parseAmount(amount)

  const pickAccount = (id: string) => {
    setAccountId(id)
    if (!paidTouched) setPaidBy(payerFor(id))
    if (id === toAccountId) setToAccountId(accounts.find((a) => a.id !== id)?.id ?? '')
  }
  const changeType = (t: TxType) => {
    setType(t)
    if (t === 'transfer' || (categoryId && db.categories.find((c) => c.id === categoryId)?.type !== t)) setCategoryId(null)
  }

  const save = () => {
    if (!cents || cents <= 0) return setError('Inserisci un importo maggiore di zero.')
    if (!accountId) return setError('Seleziona un conto.')
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Scegli due conti diversi per il trasferimento.')
    const t: Transaction = {
      id: tx?.id ?? uid(), type, amount: cents, date: fromLocalInput(date || toLocalInput(nowIso())), accountId,
      toAccountId: type === 'transfer' ? toAccountId : null, categoryId: type === 'transfer' ? null : categoryId,
      title: title.trim(), note: note.trim(), paidBy: type === 'transfer' ? payerFor(accountId) : paidBy,
      participants: [], splitMode: 'equal', splitValues: null, payments: null, tags,
      by: me?.id ?? null, createdAt: tx?.createdAt ?? nowIso(), updatedAt: nowIso(),
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

  const options = (skip?: string) => accounts.filter((a) => a.id !== skip).map((a) => ({ value: a.id, label: accountLabel(a, nameOf) }))

  return (
    <Sheet open onClose={onClose} title={tx ? 'Modifica transazione' : 'Nuova transazione'}
      footer={
        <div className="flex gap-2">
          {tx && <button className="btn-danger" onClick={remove} aria-label="Elimina"><Trash2 size={18} /></button>}
          {tx && <TxFooterActions tx={tx} />}
          <button className="btn-primary flex-1" onClick={save}>Salva</button>
        </div>
      }>
      <Segmented<TxType> value={type} onChange={changeType} options={[
        { value: 'expense', label: 'Uscita', color: 'text-exp' }, { value: 'income', label: 'Entrata', color: 'text-inc' }, { value: 'transfer', label: 'Trasferimento', color: 'text-trf' },
      ]} />

      <div className="my-4 rounded-2xl bg-bg p-4 text-center">
        <input inputMode="decimal" autoFocus={!tx} placeholder="0,00" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }}
          className={`w-full bg-transparent text-center text-4xl font-bold outline-none placeholder:text-line ${type === 'expense' ? 'text-exp' : type === 'income' ? 'text-inc' : 'text-trf'}`} />
        <span className="text-xs text-muted">Importo in euro</span>
      </div>

      <div className="-mx-1">
        <Row label="Data"><input type="datetime-local" className={plain} value={date} onChange={(e) => setDate(e.target.value)} /></Row>
        {type !== 'transfer' && <CategoryRow type={type} value={categoryId} onChange={setCategoryId} />}
        {accounts.length === 0 ? (
          <p className="my-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">Nessun conto visibile: crea o mostra un conto dalla sezione Conti.</p>
        ) : type === 'transfer' ? (
          <>
            <Row label="Da"><SelectField value={accountId} onChange={pickAccount} options={options()} /></Row>
            <Row label="A"><SelectField value={toAccountId} onChange={setToAccountId} options={options(accountId)} /></Row>
          </>
        ) : (
          <Row label="Conto"><SelectField value={accountId} onChange={pickAccount} options={options()} /></Row>
        )}
        <TitleRow value={title} onChange={setTitle} placeholder={type === 'transfer' ? 'Es. Quota mensile' : 'Es. Spesa settimanale'} />
        <Row label="Note"><textarea className={`${plain} resize-none`} rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Row>
        <TagsRow value={tags} onChange={setTags} />
      </div>

      {error && <p className="mt-3 text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
