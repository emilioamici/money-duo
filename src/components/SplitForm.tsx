import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { Payment, Transaction } from '../types'
import { useApp, type TxFormState } from '../store/AppProvider'
import { accountMemberIds, expenseShares, familyBalances, sortedAccounts, txPayments, visibleTo } from '../lib/calc'
import { centsToInput, formatMoney, fromLocalInput, parseAmount, toLocalInput } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { deleteTransaction, saveTransaction } from '../lib/mutations'
import { Sheet } from './ui'
import { ask } from './dialogs'
import { TxFooterActions } from './txActions'
import { CategoryRow, Row, SelectField, TagsRow, TitleRow, accountLabel, plain } from './formParts'
import { SplitEditor, resolveSplit, type SplitState } from './SplitEditor'
import { t } from '../i18n'
import { tb } from '../i18n/rich'

interface PayerRow { key: string; member: string; accountId: string; amount: string }
let rowKey = 0
const newKey = () => `p${++rowKey}`

/**
 * Nuovo split: una spesa condivisa, pagata da una o più persone (ognuna dal proprio conto)
 * e divisa tra i partecipanti in parti uguali, per importi o per percentuali.
 */
export function SplitForm({ state, onClose }: { state: TxFormState; onClose: () => void }) {
  const { db, commit, prefs, setPrefs, me, members, nameOf } = useApp()
  const { tx, initial } = state
  const seed = { ...initial, ...tx }
  const accounts = useMemo(
    () => sortedAccounts(db).filter((a) => (tx ? txPayments(tx).some((p) => p.accountId === a.id) : false) || (!a.hidden && visibleTo(db, a, me?.id ?? null))),
    [db, tx, me],
  )
  /** conti da cui un membro può pagare: quelli che lo includono e che io vedo */
  const eligible = (member: string, current?: string) => accounts.filter((a) => a.id === current || accountMemberIds(db, a).includes(member))
  const firstAccount = (member: string) => {
    const list = eligible(member)
    return list.find((a) => a.id === prefs.lastAccountId)?.id ?? list[0]?.id ?? ''
  }

  const [amount, setAmount] = useState(seed.amount ? centsToInput(seed.amount) : '')
  const [date, setDate] = useState(toLocalInput(seed.date ?? nowIso()))
  const [categoryId, setCategoryId] = useState<string | null>(seed.categoryId ?? null)
  const [title, setTitle] = useState(seed.title ?? '')
  const [note, setNote] = useState(seed.note ?? '')
  const [tags, setTags] = useState<string[]>(seed.tags ?? [])
  const [rows, setRows] = useState<PayerRow[]>(() => {
    // modifica, copia o preferito: i pagamenti si portano dietro; un conto che non si può più scegliere (nascosto, non mio) cede il posto al primo disponibile
    const src = tx ?? (seed.accountId || seed.payments?.length ? ({ ...seed, amount: seed.amount ?? 0 } as Transaction) : null)
    if (src) {
      const fallback = me?.id ?? members[0]?.id ?? ''
      return txPayments(src).map((p) => {
        const member = p.member ?? fallback
        return { key: newKey(), member, accountId: tx || accounts.some((a) => a.id === p.accountId) ? p.accountId : firstAccount(member), amount: centsToInput(p.amount) }
      })
    }
    const first = me?.id ?? members[0]?.id ?? ''
    return [{ key: newKey(), member: first, accountId: firstAccount(first), amount: '' }]
  })
  const [split, setSplit] = useState<SplitState>(() => {
    const sv = seed.splitValues
    return {
      mode: seed.splitMode ?? 'equal',
      participants: (seed.participants ?? []).length ? seed.participants! : members.map((m) => m.id),
      vals: sv ? Object.fromEntries(Object.entries(sv).map(([id, v]) => [id, seed.splitMode === 'percent' ? String(v / 100).replace('.', ',') : centsToInput(v)])) : {},
    }
  })
  const [error, setError] = useState('')

  const cents = parseAmount(amount)
  const multi = rows.length > 1
  const splitMembers = useMemo(() => {
    const extra = db.members.filter((m) => !m.active && (split.participants.includes(m.id) || m.id in split.vals))
    return [...members, ...extra]
  }, [db.members, members, split.participants, split.vals])
  const payerOptions = useMemo(() => {
    const extra = db.members.filter((m) => !m.active && rows.some((r) => r.member === m.id))
    return [...members, ...extra].map((m) => ({ value: m.id, label: m.name + (m.active ? '' : ' (ex)') }))
  }, [db.members, members, rows])

  const setRow = (key: string, patch: Partial<PayerRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const changePayer = (key: string, member: string) => setRow(key, { member, accountId: firstAccount(member) })
  const addPayer = () => {
    const used = new Set(rows.map((r) => r.member))
    const next = members.find((m) => !used.has(m.id))?.id ?? members[0]?.id ?? ''
    // con un solo pagatore l'importo era implicito: ora lo si rende esplicito (tutto al primo) e il nuovo parte vuoto
    setRows((rs) => [...(rs.length === 1 && cents ? [{ ...rs[0], amount: centsToInput(cents) }] : rs), { key: newKey(), member: next, accountId: firstAccount(next), amount: '' }])
  }

  /** Pagamenti validi oppure messaggio d'errore. */
  const buildPayments = (): Payment[] | string => {
    if (!cents || cents <= 0) return t('Inserisci un importo maggiore di zero.')
    const out: Payment[] = []
    for (const r of rows) {
      if (!r.member) return t('Scegli chi ha pagato.')
      if (!r.accountId) return t('{name} non ha un conto da cui pagare: scegline un altro oppure aggiungi un conto condiviso con te.', { name: nameOf(r.member) })
      const v = rows.length === 1 ? cents : parseAmount(r.amount)
      if (v === null || v <= 0) return t('Inserisci quanto ha pagato {name}.', { name: nameOf(r.member) })
      out.push({ member: r.member, accountId: r.accountId, amount: v })
    }
    const sum = out.reduce((a, p) => a + p.amount, 0)
    if (sum !== cents) return t('I pagamenti sommano {sum}, ma la spesa è di {total}.', { sum: formatMoney(sum), total: formatMoney(cents) })
    return out
  }

  const build = (): Transaction | string => {
    const pays = buildPayments()
    if (typeof pays === 'string') return pays
    const sp = resolveSplit(split, cents, splitMembers.map((m) => m.id))
    if (typeof sp === 'string') return sp
    return {
      id: tx?.id ?? uid(), type: 'expense', amount: cents!, date: fromLocalInput(date || toLocalInput(nowIso())),
      accountId: pays[0].accountId, toAccountId: null, categoryId, title: title.trim(), note: note.trim(),
      paidBy: pays.length === 1 ? pays[0].member : null, payments: pays.length > 1 ? pays : null,
      participants: sp.participants, splitMode: sp.splitMode, splitValues: sp.splitValues, tags,
      by: me?.id ?? null, createdAt: tx?.createdAt ?? nowIso(), updatedAt: nowIso(),
    }
  }

  const preview = useMemo(() => {
    const t = build()
    if (typeof t === 'string') return null
    const debts = familyBalances(db, [t])
    return { debts, shares: expenseShares(t) }
  }, [rows, split, amount]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const t = build()
    if (typeof t === 'string') return setError(t)
    commit((d) => saveTransaction(d, t))
    setPrefs({ lastAccountId: t.accountId })
    onClose()
  }

  const remove = async () => {
    if (!tx) return
    if (await ask({ title: t('Eliminare la spesa condivisa?'), message: t('I saldi e i debiti verranno ricalcolati.'), ok: t('Elimina'), danger: true })) {
      commit((d) => deleteTransaction(d, tx.id))
      onClose()
    }
  }

  const paidSum = rows.reduce((a, r) => a + (parseAmount(r.amount) ?? 0), 0)
  const left = (cents ?? 0) - paidSum
  const allFilled = rows.every((r) => (parseAmount(r.amount) ?? 0) > 0)

  return (
    <Sheet open onClose={onClose} title={tx ? t('Modifica split') : t('Nuovo split')}
      footer={
        <div className="flex gap-2">
          {tx && <button className="btn-danger" onClick={remove} aria-label={t('Elimina')}><Trash2 size={18} /></button>}
          {tx && <TxFooterActions tx={tx} />}
          <button className="btn-primary flex-1" onClick={save}>{t('Salva')}</button>
        </div>
      }>
      <div className="mb-4 rounded-2xl bg-bg p-4 text-center">
        <input inputMode="decimal" autoFocus={!tx} placeholder={t('0,00')} value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }}
          className="w-full bg-transparent text-center text-4xl font-bold text-exp outline-none placeholder:text-line" />
        <span className="text-xs text-muted">{t('Importo totale della spesa, in euro')}</span>
      </div>

      <div className="-mx-1">
        <Row label={t('Data')}><input type="datetime-local" className={plain} value={date} onChange={(e) => setDate(e.target.value)} /></Row>
        <CategoryRow type="expense" value={categoryId} onChange={setCategoryId} />
        <TitleRow value={title} onChange={setTitle} placeholder={t('Es. Cena di sabato')} />
        <Row label={t('Note')}><textarea className={`${plain} resize-none`} rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Row>
        <TagsRow value={tags} onChange={setTags} />
      </div>

      <h3 className="label mt-5">{t('Pagato da')}</h3>
      <div className="space-y-2">
        {rows.map((r) => {
          const list = eligible(r.member, r.accountId)
          return (
            <div key={r.key} className="rounded-2xl bg-bg p-3" data-testid="payer">
              <div className="flex items-center gap-2">
                <div className="flex-1"><SelectField ariaLabel={t('Chi ha pagato')} className={`${plain} font-semibold`} value={r.member} onChange={(v) => changePayer(r.key, v)} options={payerOptions} /></div>
                {multi && <button type="button" aria-label={t('Rimuovi questo pagamento')} className="rounded-full p-1.5 text-muted hover:bg-line/60" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><X size={16} /></button>}
              </div>
              <div className="flex items-center gap-2 border-t border-line/60 pt-1">
                <span className="shrink-0 text-xs text-muted">{t('dal conto')}</span>
                <div className="min-w-0 flex-1">
                  <SelectField ariaLabel={t('Conto di {name}', { name: nameOf(r.member) })} className={`${plain} !text-sm`} value={r.accountId} onChange={(v) => setRow(r.key, { accountId: v })}
                    options={list.length ? list.map((a) => ({ value: a.id, label: accountLabel(a, nameOf) })) : [{ value: '', label: t('Nessun conto di {name} visibile a te', { name: nameOf(r.member) }), disabled: true }]} />
                </div>
              </div>
              {multi && (
                <div className="flex items-center gap-2 border-t border-line/60 pt-1">
                  <span className="shrink-0 text-xs text-muted">{t('ha pagato')}</span>
                  <span className="flex flex-1 items-center justify-end">
                    <input inputMode="decimal" aria-label={t('Importo pagato da {name}', { name: nameOf(r.member) })} placeholder={t('0,00')} className="w-28 bg-transparent py-1.5 text-right text-[15px] outline-none"
                      value={r.amount} onChange={(e) => { setRow(r.key, { amount: e.target.value }); setError('') }} />
                    <span className="pl-1 text-sm text-muted">€</span>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {multi && (
        <p className={`mt-1.5 text-xs ${left === 0 && allFilled ? 'font-semibold text-inc' : left < 0 ? 'font-semibold text-exp' : 'text-muted'}`}>
          {left === 0 && allFilled ? t('Pagamenti completi') : left < 0 ? t('Superato di {v}', { v: formatMoney(-left) }) : !allFilled ? t('Inserisci quanto ha pagato ciascuno') : t('Restano {v} da attribuire ai pagamenti', { v: formatMoney(left) })}
        </p>
      )}
      <button type="button" className="btn-soft mt-2 w-full" onClick={addPayer}><Plus size={16} />{t('Aggiungi chi ha pagato')}</button>

      <h3 className="label mt-5">{t('Divisione')}</h3>
      <SplitEditor state={split} onChange={(s) => { setSplit(s); setError('') }} members={splitMembers} cents={cents} payerIds={rows.map((r) => r.member)} />

      {preview && (
        <div className="mt-3 rounded-xl bg-brand/10 p-3 text-sm">
          {preview.debts.length === 0
            ? <p className="text-muted">{t('Nessun debito: ognuno ha pagato esattamente la sua quota.')}</p>
            : <ul className="space-y-1">{preview.debts.map((d) => <li key={d.debtor + d.creditor}>{tb('<b>{a}</b> deve a <b>{b}</b>', { a: nameOf(d.debtor), b: nameOf(d.creditor) })} <b className="tabular-nums">{formatMoney(d.amount)}</b></li>)}</ul>}
        </div>
      )}
      {error && <p className="mt-3 text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
