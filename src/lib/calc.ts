import type { Account, Category, CategoryType, Db, Member, MemberId, Transaction } from '../types'

/** all = tutti i conti che vedo · shared = conti con più membri · altrimenti id di un membro */
export type Scope = 'all' | 'shared' | MemberId

export const accountById = (db: Db): Map<string, Account> => new Map(db.accounts.map((a) => [a.id, a]))
export const categoryById = (db: Db): Map<string, Category> => new Map(db.categories.map((c) => [c.id, c]))
export const memberById = (db: Db): Map<string, Member> => new Map(db.members.map((m) => [m.id, m]))
export const activeMembers = (db: Db): Member[] => db.members.filter((m) => m.active)

export const sortedAccounts = (db: Db): Account[] => [...db.accounts].sort((a, b) => a.order - b.order)

export function topCategories(db: Db, type: CategoryType, includeHidden = false): Category[] {
  return db.categories.filter((c) => c.type === type && c.parentId === null && (includeHidden || !c.hidden)).sort((a, b) => a.order - b.order)
}
export function childCategories(db: Db, parentId: string, includeHidden = false): Category[] {
  return db.categories.filter((c) => c.parentId === parentId && (includeHidden || !c.hidden)).sort((a, b) => a.order - b.order)
}

// ---------- visibilità dei conti ----------

/** Membri che usano il conto: la lista scelta, oppure tutti i membri attivi se la lista è vuota. */
export function accountMemberIds(db: Db, acc: Account): MemberId[] {
  return acc.members.length ? acc.members : activeMembers(db).map((m) => m.id)
}
/** Conto condiviso = usato da più di un membro. */
export const isSharedAccount = (db: Db, acc: Account): boolean => accountMemberIds(db, acc).length > 1
/** Il membro `me` vede il conto? (`me` null = identità non ancora nota: si vede tutto). La visibilità è un filtro dell'app, non un controllo d'accesso. */
export const visibleTo = (db: Db, acc: Account, me: MemberId | null): boolean => !me || accountMemberIds(db, acc).includes(me)

// ---------- saldi ----------

/** Saldo per conto (centesimi): saldo iniziale + entrate − uscite ± trasferimenti. Include sempre lo storico, anche dei conti nascosti. */
export function accountBalances(db: Db): Record<string, number> {
  const bal: Record<string, number> = {}
  for (const a of db.accounts) bal[a.id] = a.initialBalance
  for (const t of db.transactions) {
    if (t.type === 'expense') bal[t.accountId] = (bal[t.accountId] ?? 0) - t.amount
    else if (t.type === 'income') bal[t.accountId] = (bal[t.accountId] ?? 0) + t.amount
    else {
      bal[t.accountId] = (bal[t.accountId] ?? 0) - t.amount
      if (t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] ?? 0) + t.amount
    }
  }
  return bal
}

/** Totale liquidità: conti visibili, non nascosti e non esclusi; `include` restringe ulteriormente (es. per membro). */
export function totalLiquidity(db: Db, bal: Record<string, number>, include: (a: Account) => boolean = () => true): number {
  return db.accounts.filter((a) => !a.hidden && !a.excludeFromTotal && include(a)).reduce((s, a) => s + (bal[a.id] ?? 0), 0)
}

// ---------- filtri ----------

export function inScope(db: Db, accs: Map<string, Account>, tx: Transaction, scope: Scope, me: MemberId | null): boolean {
  const involved = [tx.accountId, tx.toAccountId].map((id) => (id ? accs.get(id) : undefined)).filter((a): a is Account => !!a)
  // visibile se vedo uno dei conti coinvolti oppure se la transazione mi riguarda (pago io o sono tra chi si divide la spesa)
  const concerns = !!me && (tx.paidBy === me || tx.participants.includes(me))
  if (!concerns && !involved.some((a) => visibleTo(db, a, me))) return false
  if (scope === 'all') return true
  if (scope === 'shared') return involved.some((a) => isSharedAccount(db, a))
  return involved.some((a) => accountMemberIds(db, a).includes(scope))
}

export interface Filters {
  from: Date
  to: Date // esclusa
  scope: Scope
  accountId: string // 'all' oppure id
  q: string
  me: MemberId | null
}

export function monthRange(d: Date): { from: Date; to: Date } {
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1) }
}

export function filterTransactions(db: Db, f: Filters): Transaction[] {
  const accs = accountById(db)
  const cats = categoryById(db)
  const q = f.q.trim().toLowerCase()
  const from = f.from.getTime()
  const to = f.to.getTime()
  return db.transactions
    .filter((t) => {
      const ts = new Date(t.date).getTime()
      if (ts < from || ts >= to) return false
      if (!inScope(db, accs, t, f.scope, f.me)) return false
      if (f.accountId !== 'all' && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false
      if (q) {
        const hay = [t.title, t.note, cats.get(t.categoryId ?? '')?.name, accs.get(t.accountId)?.name, accs.get(t.toAccountId ?? '')?.name, (t.amount / 100).toFixed(2).replace('.', ',')]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))
}

export function summarize(txs: Transaction[]): { income: number; expense: number; balance: number } {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amount
    else if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, balance: income - expense }
}

export interface BreakdownItem {
  id: string
  name: string
  icon: string
  color: string
  total: number
  children: Array<{ id: string; name: string; icon: string; total: number }>
}

/** Ripartizione per categoria principale con dettaglio sottocategorie, ordinata per importo. */
export function categoryBreakdown(db: Db, txs: Transaction[], type: CategoryType): BreakdownItem[] {
  const cats = categoryById(db)
  const top = new Map<string, BreakdownItem>()
  for (const t of txs) {
    if (t.type !== type) continue
    const c = t.categoryId ? cats.get(t.categoryId) : undefined
    const parent = c ? (c.parentId ? cats.get(c.parentId) ?? c : c) : undefined
    const key = parent?.id ?? 'none'
    let item = top.get(key)
    if (!item) {
      item = { id: key, name: parent?.name ?? 'Senza categoria', icon: parent?.icon ?? '❔', color: parent?.color ?? '#94a3b8', total: 0, children: [] }
      top.set(key, item)
    }
    item.total += t.amount
    if (c && c.parentId) {
      let ch = item.children.find((x) => x.id === c.id)
      if (!ch) item.children.push((ch = { id: c.id, name: c.name, icon: c.icon, total: 0 }))
      ch.total += t.amount
    }
  }
  const out = [...top.values()].sort((a, b) => b.total - a.total)
  out.forEach((i) => i.children.sort((a, b) => b.total - a.total))
  return out
}

// ---------- divisione spese e saldi tra membri ----------

/** Parti uguali tra gli id dati (il resto in centesimi va ai primi, in ordine di id: deterministico). */
function equalShares(amount: number, members: MemberId[]): Array<{ member: MemberId; amount: number }> {
  const ids = [...new Set(members)].sort()
  if (!ids.length) return []
  const base = Math.floor(amount / ids.length)
  const rest = amount - base * ids.length
  return ids.map((member, i) => ({ member, amount: base + (i < rest ? 1 : 0) }))
}

/** Ripartisce `total` in proporzione ai pesi interi, con il metodo del resto più alto (la somma è sempre esatta). */
function proportionalShares(total: number, weights: Array<[MemberId, number]>): Array<{ member: MemberId; amount: number }> {
  const sum = weights.reduce((a, [, w]) => a + w, 0)
  const parts = weights.map(([member, w]) => ({ member, exact: (total * w) / sum }))
  const out = parts.map((p) => ({ member: p.member, amount: Math.floor(p.exact), frac: p.exact - Math.floor(p.exact) }))
  let left = total - out.reduce((a, p) => a + p.amount, 0)
  for (const p of [...out].sort((a, b) => b.frac - a.frac || a.member.localeCompare(b.member))) {
    if (left <= 0) break
    p.amount++; left--
  }
  return out.map(({ member, amount }) => ({ member, amount }))
}

/**
 * Quota a carico di ogni partecipante.
 * - parti uguali (predefinito): tra i `participants`
 * - 'amount': gli importi indicati in `splitValues` (devono sommare all'importo della spesa)
 * - 'percent': le percentuali indicate (in centesimi di punto, somma 10000), arrotondate al centesimo con somma esatta
 * Se i valori non sono coerenti si ripiega sulle parti uguali, così nessuna spesa produce debiti sbagliati.
 */
export function expenseShares(tx: Pick<Transaction, 'amount' | 'participants' | 'splitMode' | 'splitValues'>): Array<{ member: MemberId; amount: number }> {
  const mode = tx.splitMode ?? 'equal'
  const vals = tx.splitValues
  if (mode !== 'equal' && vals) {
    const entries = Object.entries(vals).filter(([, v]) => v > 0).sort(([a], [b]) => a.localeCompare(b))
    const sum = entries.reduce((a, [, v]) => a + v, 0)
    if (mode === 'amount' && sum === tx.amount) return entries.map(([member, amount]) => ({ member, amount }))
    if (mode === 'percent' && sum === 10000) return proportionalShares(tx.amount, entries)
    if (entries.length) return equalShares(tx.amount, entries.map(([m]) => m))
  }
  return equalShares(tx.amount, tx.participants)
}

export interface Debt {
  debtor: MemberId
  creditor: MemberId
  amount: number
}

/**
 * Saldo netto tra ogni coppia di membri.
 * - spesa pagata da X e divisa tra i partecipanti: ognuno ≠ X deve la sua quota a X (X non partecipa = anticipo per gli altri)
 * - spesa senza pagatore (conto condiviso) o senza partecipanti: nessun debito
 * - trasferimento tra due conti PERSONALI di membri diversi = rimborso (da X a Y riduce il debito di X verso Y)
 */
export function familyBalances(db: Db, txs: Transaction[]): Debt[] {
  const accs = accountById(db)
  const owe = new Map<string, number>() // "debitore>creditore" -> importo
  const add = (d: MemberId, c: MemberId, v: number) => owe.set(`${d}>${c}`, (owe.get(`${d}>${c}`) ?? 0) + v)
  for (const t of txs) {
    if (t.type === 'expense' && t.paidBy) {
      for (const s of expenseShares(t)) if (s.member !== t.paidBy) add(s.member, t.paidBy, s.amount)
    } else if (t.type === 'transfer' && t.toAccountId) {
      const from = accs.get(t.accountId)
      const to = accs.get(t.toAccountId)
      if (from?.members.length === 1 && to?.members.length === 1 && from.members[0] !== to.members[0]) add(from.members[0], to.members[0], -t.amount)
    }
  }
  const ids = [...new Set([...owe.keys()].flatMap((k) => k.split('>')))].sort()
  const out: Debt[] = []
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const net = (owe.get(`${ids[i]}>${ids[j]}`) ?? 0) - (owe.get(`${ids[j]}>${ids[i]}`) ?? 0)
      if (net > 0) out.push({ debtor: ids[i], creditor: ids[j], amount: net })
      else if (net < 0) out.push({ debtor: ids[j], creditor: ids[i], amount: -net })
    }
  return out.sort((a, b) => b.amount - a.amount)
}
