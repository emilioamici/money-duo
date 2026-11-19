import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import type { SplitMode, Transaction, TxType } from '../types'
import { useApp, type TxFormState } from '../store/AppProvider'
import { accountById, accountMemberIds, childCategories, expenseShares, sortedAccounts, topCategories, visibleTo } from '../lib/calc'
import { centsToInput, formatMoney, fromLocalInput, parseAmount, toLocalInput } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { deleteTransaction, saveTransaction } from '../lib/mutations'
import { CatBubble, MemberAvatar, MemberChips, Segmented, Sheet } from './ui'
import { ask } from './dialogs'

/** Riga del form in stile elenco: etichetta a sinistra, valore a destra, linea sottile sotto. */
function Row({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <span className="w-[5.5rem] shrink-0 pt-2 text-[15px] text-muted">{label}</span>
      <div className="min-w-0 flex-1 py-1">{children}</div>
    </>
  )
  const cls = 'flex w-full items-start gap-3 border-b border-line/70 px-1 py-1.5 text-left'
  return onClick ? <button type="button" className={cls} onClick={onClick}>{inner}</button> : <div className={cls}>{inner}</div>
}
const plain = 'w-full bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted/70'

function CategoryPicker({ type, value, onChange }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void }) {
  const { db } = useApp()
  const cur = db.categories.find((c) => c.id === value)
  const parentId = cur ? cur.parentId ?? cur.id : null
  const tops = topCategories(db, type)
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
        <div className="mt-3 flex flex-wrap gap-2">
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

/** Finestra di scelta della categoria: si chiude da sola quando si sceglie una categoria "foglia". */
function CategorySheet({ type, value, onChange, onClose }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void; onClose: () => void }) {
  const { db } = useApp()
  return (
    <Sheet open onClose={onClose} title="Categoria" footer={<button className="btn-primary w-full" onClick={onClose}>Fatto</button>}>
      <CategoryPicker type={type} value={value} onChange={(id) => {
        onChange(id)
        const hasChildren = !!id && childCategories(db, id).length > 0
        if (!id || (!hasChildren)) onClose()
      }} />
    </Sheet>
  )
}

const pctToInput = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace('.', ','))
/** "33,33" -> 3333 (centesimi di punto); null se non valido */
const parsePercent = (s: string): number | null => {
  const t = s.trim().replace('%', '').replace(',', '.')
  if (!t) return 0
  if (!/^\d*\.?\d+$/.test(t)) return null
  const bp = Math.round(parseFloat(t) * 100)
  return bp >= 0 && bp <= 10000 ? bp : null
}

export function TransactionForm({ state, onClose }: { state: TxFormState; onClose: () => void }) {
  const { db, commit, prefs, setPrefs, me, members, nameOf } = useApp()
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
  const [pickCategory, setPickCategory] = useState(false)
  const [title, setTitle] = useState(seed.title ?? '')
  const [note, setNote] = useState(seed.note ?? '')
  const [paidBy, setPaidBy] = useState<string | null>(seed.paidBy !== undefined ? seed.paidBy : payerFor(seed.accountId ?? defaultAcc))
  const [paidTouched, setPaidTouched] = useState(seed.paidBy !== undefined)
  const [participants, setParticipants] = useState<string[]>(seed.participants ?? [])
  const [dividing, setDividing] = useState((seed.participants ?? []).length > 0)
  const [splitMode, setSplitMode] = useState<SplitMode>(seed.splitMode ?? 'equal')
  // valori digitati per membro (importo in € oppure percentuale), usati dalle modalità "importi" e "percentuali"
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const sv = seed.splitValues
    if (!sv) return {}
    return Object.fromEntries(Object.entries(sv).map(([id, v]) => [id, seed.splitMode === 'percent' ? pctToInput(v) : centsToInput(v)]))
  })
  const [error, setError] = useState('')

  const cents = parseAmount(amount)
  const showSplit = type === 'expense' && paidBy !== null
  const splitMembers = useMemo(() => {
    const extra = db.members.filter((m) => !m.active && (participants.includes(m.id) || m.id in vals))
    return [...members, ...extra]
  }, [db.members, members, participants, vals])

  const pickAccount = (id: string) => {
    setAccountId(id)
    if (!paidTouched) setPaidBy(payerFor(id))
    if (id === toAccountId) setToAccountId(accounts.find((a) => a.id !== id)?.id ?? '')
  }
  const changeType = (t: TxType) => {
    setType(t)
    if (t === 'transfer' || (categoryId && db.categories.find((c) => c.id === categoryId)?.type !== t)) setCategoryId(null)
  }

  /** parti uguali precompilate per le modalità con valori (si parte da una divisione sensata, poi la si ritocca) */
  const prefill = (mode: SplitMode, ids: string[]) => {
    if (mode === 'equal' || !ids.length) return setVals({})
    const eq = expenseShares({ amount: mode === 'percent' ? 10000 : cents ?? 0, participants: ids })
    setVals(Object.fromEntries(eq.map((s) => [s.member, mode === 'percent' ? pctToInput(s.amount) : s.amount ? centsToInput(s.amount) : ''])))
  }
  const defaultParticipants = () => {
    const acc = accs.get(accountId)
    return (acc ? accountMemberIds(db, acc) : members.map((m) => m.id)).filter((id) => members.some((m) => m.id === id))
  }
  const startDividing = (on: boolean) => {
    setDividing(on)
    if (on && participants.length === 0) setParticipants(defaultParticipants())
  }
  const changeMode = (mode: SplitMode) => {
    setSplitMode(mode)
    prefill(mode, participants.length ? participants : defaultParticipants())
  }

  /** Divisione risultante dal form, oppure un messaggio d'errore. */
  const buildSplit = (): { participants: string[]; splitMode: SplitMode; splitValues: Record<string, number> | null } | string => {
    if (!showSplit || !dividing) return { participants: [], splitMode: 'equal', splitValues: null }
    if (splitMode === 'equal') {
      return participants.length ? { participants, splitMode, splitValues: null } : 'Scegli con chi dividere la spesa oppure «Solo chi ha pagato».'
    }
    const values: Record<string, number> = {}
    for (const m of splitMembers) {
      const raw = vals[m.id] ?? ''
      const v = splitMode === 'percent' ? parsePercent(raw) : raw.trim() ? parseAmount(raw) : 0
      if (v === null || v < 0) return `Valore non valido per ${m.name}.`
      if (v > 0) values[m.id] = v
    }
    const ids = Object.keys(values)
    if (!ids.length) return 'Inserisci almeno un valore nella divisione.'
    const sum = ids.reduce((a, id) => a + values[id], 0)
    if (splitMode === 'amount' && cents !== null && sum !== cents) return `Gli importi sommano ${formatMoney(sum)}, ma la spesa è di ${formatMoney(cents)}.`
    if (splitMode === 'percent' && sum !== 10000) return `Le percentuali sommano ${pctToInput(sum)}%: devono fare 100%.`
    return { participants: ids, splitMode, splitValues: values }
  }

  // riepilogo "assegnato / restante" e anteprima dei debiti
  const assigned = useMemo(() => {
    if (splitMode === 'equal') return null
    let sum = 0
    for (const m of splitMembers) { const raw = vals[m.id] ?? ''; const v = splitMode === 'percent' ? parsePercent(raw) : raw.trim() ? parseAmount(raw) : 0; sum += v && v > 0 ? v : 0 }
    return sum
  }, [splitMode, splitMembers, vals])
  const target = splitMode === 'percent' ? 10000 : cents ?? 0
  const remaining = assigned === null ? 0 : target - assigned
  const fmtLeft = (v: number) => (splitMode === 'percent' ? `${pctToInput(Math.abs(v))}%` : formatMoney(Math.abs(v)))

  const hint = (() => {
    if (!showSplit || !dividing || !cents) return ''
    const sp = buildSplit()
    if (typeof sp === 'string') return ''
    const shares = expenseShares({ amount: cents, ...sp }).filter((s) => s.member !== paidBy)
    if (!shares.length) return 'Nessun debito: la quota è tutta di chi ha pagato.'
    return shares.map((s) => `${nameOf(s.member)} deve a ${nameOf(paidBy)} ${formatMoney(s.amount)}`).join(' · ')
  })()

  const save = () => {
    if (!cents || cents <= 0) return setError('Inserisci un importo maggiore di zero.')
    if (!accountId) return setError('Seleziona un conto.')
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Scegli due conti diversi per il trasferimento.')
    const sp = type === 'expense' ? buildSplit() : { participants: [], splitMode: 'equal' as SplitMode, splitValues: null }
    if (typeof sp === 'string') return setError(sp)
    const t: Transaction = {
      id: tx?.id ?? uid(), type, amount: cents, date: fromLocalInput(date || toLocalInput(nowIso())), accountId,
      toAccountId: type === 'transfer' ? toAccountId : null, categoryId: type === 'transfer' ? null : categoryId,
      title: title.trim(), note: note.trim(), paidBy: type === 'transfer' ? payerFor(accountId) : paidBy,
      participants: sp.participants, splitMode: sp.splitMode, splitValues: sp.splitValues, by: me?.id ?? null, createdAt: tx?.createdAt ?? nowIso(), updatedAt: nowIso(),
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

  const accLabel = (a: (typeof accounts)[number]) => `${a.name}${a.members.length === 1 ? ` · ${nameOf(a.members[0])}` : a.members.length === 0 ? ' · Famiglia' : ' · condiviso'}${a.hidden ? ' (nascosto)' : ''}`
  const accountSelect = (value: string, onChange: (v: string) => void, skip?: string) => (
    <div className="relative">
      <select className={`${plain} appearance-none pr-6`} value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.filter((a) => a.id !== skip).map((a) => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )

  const cat = db.categories.find((c) => c.id === categoryId)
  const parentCat = cat?.parentId ? db.categories.find((c) => c.id === cat.parentId) : undefined

  return (
    <Sheet open onClose={onClose} title={tx ? 'Modifica transazione' : 'Nuova transazione'}
      footer={
        <div className="flex gap-2">
          {tx && <button className="btn-danger" onClick={remove} aria-label="Elimina"><Trash2 size={18} /></button>}
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

      {/* ---- elenco dei campi, in stile Money Manager ---- */}
      <div className="-mx-1">
        <Row label="Data"><input type="datetime-local" className={plain} value={date} onChange={(e) => setDate(e.target.value)} /></Row>

        {type !== 'transfer' && (
          <Row label="Categoria" onClick={() => setPickCategory(true)}>
            <span className="flex items-center gap-2 py-1.5 text-[15px]">
              {cat ? <><CatBubble icon={cat.icon} color={cat.color} size={24} /><span className="min-w-0 flex-1 truncate">{parentCat ? `${parentCat.name} › ${cat.name}` : cat.name}</span></> : <span className="flex-1 text-muted/70">Seleziona</span>}
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </span>
          </Row>
        )}

        {accounts.length === 0 ? (
          <p className="my-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">Nessun conto visibile: crea o mostra un conto dalla sezione Conti.</p>
        ) : type === 'transfer' ? (
          <>
            <Row label="Da">{accountSelect(accountId, pickAccount)}</Row>
            <Row label="A">{accountSelect(toAccountId, setToAccountId, accountId)}</Row>
          </>
        ) : (
          <Row label="Conto">{accountSelect(accountId, pickAccount)}</Row>
        )}

        <Row label="Titolo"><input className={plain} placeholder={type === 'transfer' ? 'Es. Quota mensile' : 'Es. Spesa settimanale'} value={title} onChange={(e) => setTitle(e.target.value)} /></Row>
        <Row label="Note"><textarea className={`${plain} resize-none`} rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Row>

        {type !== 'transfer' && (
          <Row label={type === 'expense' ? 'Pagato da' : 'Incassato da'}>
            <div className="py-1"><MemberChips value={paidBy} onChange={(v) => { setPaidBy(v); setPaidTouched(true) }} nullLabel="Conto condiviso" includeIds={paidBy ? [paidBy] : []} /></div>
          </Row>
        )}

        {showSplit && (
          <Row label="Divisione">
            <div className="flex flex-wrap gap-2 py-1">
              <button type="button" onClick={() => startDividing(false)} className={`chip ${!dividing ? 'chip-on' : ''}`}>Solo chi ha pagato</button>
              <button type="button" onClick={() => startDividing(true)} className={`chip ${dividing ? 'chip-on' : ''}`}>Dividi con altri</button>
            </div>
          </Row>
        )}
      </div>

      {showSplit && dividing && (
        <div className="mt-3 rounded-2xl bg-bg p-3">
          <Segmented<SplitMode> value={splitMode} onChange={changeMode} options={[
            { value: 'equal', label: 'Parti uguali' }, { value: 'amount', label: 'Importi' }, { value: 'percent', label: 'Percentuali' },
          ]} />

          {splitMode === 'equal' ? (
            <>
              <p className="mb-2 mt-3 text-xs text-muted">Chi si divide la spesa in parti uguali (se chi ha pagato non è selezionato, ha anticipato tutto per gli altri):</p>
              <MemberChips multi value={participants} onChange={setParticipants} includeIds={participants} />
            </>
          ) : (
            <>
              <p className="mb-1 mt-3 text-xs text-muted">{splitMode === 'amount' ? 'Quanto spetta a ciascuno (in euro). Lascia vuoto chi non partecipa.' : 'Che percentuale spetta a ciascuno. Lascia vuoto chi non partecipa.'}</p>
              <ul className="divide-y divide-line/60">
                {splitMembers.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2">
                    <MemberAvatar name={m.name} color={m.color} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}{m.id === paidBy ? ' (ha pagato)' : ''}</span>
                    <span className="flex w-28 items-center rounded-lg border border-line bg-surface px-2">
                      <input inputMode="decimal" aria-label={`${splitMode === 'amount' ? 'Importo' : 'Percentuale'} di ${m.name}`} placeholder="0" className="w-full bg-transparent py-1.5 text-right text-sm outline-none"
                        value={vals[m.id] ?? ''} onChange={(e) => { setVals({ ...vals, [m.id]: e.target.value }); setError('') }} />
                      <span className="pl-1 text-sm text-muted">{splitMode === 'amount' ? '€' : '%'}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className={remaining === 0 && (assigned ?? 0) > 0 ? 'font-semibold text-inc' : remaining < 0 ? 'font-semibold text-exp' : 'text-muted'}>
                  {remaining === 0 && (assigned ?? 0) > 0 ? 'Divisione completa' : remaining > 0 ? `Restano ${fmtLeft(remaining)} da assegnare` : remaining < 0 ? `Superato di ${fmtLeft(remaining)}` : 'Nessun valore inserito'}
                </span>
                <button type="button" className="font-semibold text-brand" onClick={() => prefill(splitMode, participants.length ? participants : defaultParticipants())}>Ripartisci in parti uguali</button>
              </div>
            </>
          )}
          {hint && <p className="mt-3 text-xs text-muted">{hint}</p>}
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-exp">{error}</p>}
      {pickCategory && type !== 'transfer' && <CategorySheet type={type} value={categoryId} onChange={setCategoryId} onClose={() => setPickCategory(false)} />}
    </Sheet>
  )
}
