import type { Account, Category, CategoryType, Db, Member, MemberId, Payment, Transaction, TxType } from '../types'

/** all = tutti i conti che vedo · shared = conti con più membri · altrimenti id di un membro */
export type Scope = 'all' | 'shared' | MemberId

export const accountById = (db: Db): Map<string, Account> => new Map(db.accounts.map((a) => [a.id, a]))
export const categoryById = (db: Db): Map<string, Category> => new Map(db.categories.map((c) => [c.id, c]))
export const memberById = (db: Db): Map<string, Member> => new Map(db.members.map((m) => [m.id, m]))
export const activeMembers = (db: Db): Member[] => db.members.filter((m) => m.active)

// ---------- pagamenti di una spesa

/** I pagamenti di una transazione: quelli espliciti (spesa pagata da più persone) oppure l'unico implicito (conto + pagatore). */
export function txPayments(tx: Transaction): Payment[] {
  return tx.payments && tx.payments.length ? tx.payments : [{ member: tx.paidBy, accountId: tx.accountId, amount: tx.amount }]
}
/** Chi ha pagato (membri). */
export const txPayerIds = (tx: Transaction): MemberId[] => [...new Set(txPayments(tx).map((p) => p.member).filter((m): m is MemberId => !!m))]
/** Tutti i conti toccati dalla transazione. */
export const involvedAccountIds = (tx: Transaction): string[] =>
  [...new Set([...(tx.type === 'expense' ? txPayments(tx).map((p) => p.accountId) : [tx.accountId]), tx.toAccountId].filter((x): x is string => !!x))]
/** Una spesa condivisa ("split"): ha dei partecipanti o più pagamenti. */
export const isSplit = (tx: Pick<Transaction, 'type' | 'participants' | 'payments'>): boolean => tx.type === 'expense' && (tx.participants.length > 0 || (tx.payments?.length ?? 0) > 1)

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
    if (t.type === 'expense') for (const p of txPayments(t)) bal[p.accountId] = (bal[p.accountId] ?? 0) - p.amount
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
  const involved = involvedAccountIds(tx).map((id) => accs.get(id)).filter((a): a is Account => !!a)
  // visibile se vedo uno dei conti coinvolti oppure se la transazione mi riguarda (pago io o sono tra chi si divide la spesa)
  const concerns = !!me && (txPayerIds(tx).includes(me) || tx.participants.includes(me))
  if (!concerns && !involved.some((a) => visibleTo(db, a, me))) return false
  if (scope === 'all') return true
  if (scope === 'shared') return involved.some((a) => isSharedAccount(db, a))
  return involved.some((a) => accountMemberIds(db, a).includes(scope))
}

/** Filtri avanzati della lista transazioni. Vuoto = nessun filtro; i criteri si combinano (e), dentro un criterio basta uno (o). */
export interface TxFilters {
  types: TxType[]
  /** conti coinvolti nella transazione (anche come conto di destinazione o tra i pagamenti di uno split) */
  accountIds: string[]
  /** categorie; scegliere una categoria principale include le sue sottocategorie */
  categoryIds: string[]
  tags: string[]
  /** importo minimo e massimo in centesimi, inclusi */
  min: number | null
  max: number | null
  /** solo le spese condivise (split) */
  splitOnly: boolean
}

export const emptyFilters = (): TxFilters => ({ types: [], accountIds: [], categoryIds: [], tags: [], min: null, max: null, splitOnly: false })

/** Quanti criteri sono attivi (per il badge sul pulsante). */
export function countFilters(f: TxFilters): number {
  return (f.types.length ? 1 : 0) + (f.accountIds.length ? 1 : 0) + (f.categoryIds.length ? 1 : 0) + (f.tags.length ? 1 : 0) + (f.min !== null || f.max !== null ? 1 : 0) + (f.splitOnly ? 1 : 0)
}

export interface Filters {
  from: Date
  to: Date // esclusa
  scope: Scope
  accountId: string // 'all' oppure id
  q: string
  me: MemberId | null
  /** filtri avanzati (solo schermata Transazioni) */
  adv?: TxFilters
}

export function monthRange(d: Date): { from: Date; to: Date } {
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1) }
}

export type Period = 'month' | 'year'

/** Intervallo [from, to) del mese o dell'intero anno che contiene `d`. */
export function periodRange(d: Date, period: Period): { from: Date; to: Date } {
  if (period === 'year') return { from: new Date(d.getFullYear(), 0, 1), to: new Date(d.getFullYear() + 1, 0, 1) }
  return monthRange(d)
}

function matchesFilters(t: Transaction, f: TxFilters, catIds: Set<string> | null, tagSet: Set<string> | null): boolean {
  if (f.types.length && !f.types.includes(t.type)) return false
  if (f.accountIds.length && !involvedAccountIds(t).some((id) => f.accountIds.includes(id))) return false
  if (f.categoryIds.length && !(t.categoryId && catIds?.has(t.categoryId))) return false
  if (f.tags.length && !(t.tags ?? []).some((g) => tagSet?.has(g.toLowerCase()))) return false
  if (f.min !== null && t.amount < f.min) return false
  if (f.max !== null && t.amount > f.max) return false
  if (f.splitOnly && !isSplit(t)) return false
  return true
}

export function filterTransactions(db: Db, f: Filters): Transaction[] {
  const accs = accountById(db)
  const cats = categoryById(db)
  const q = f.q.trim().toLowerCase()
  const from = f.from.getTime()
  const to = f.to.getTime()
  const adv = f.adv && countFilters(f.adv) ? f.adv : null
  // categorie scelte + sottocategorie delle principali scelte
  const catIds = adv ? new Set(db.categories.filter((c) => adv.categoryIds.includes(c.id) || (c.parentId && adv.categoryIds.includes(c.parentId))).map((c) => c.id)) : null
  const tagSet = adv ? new Set(adv.tags.map((g) => g.toLowerCase())) : null
  return db.transactions
    .filter((t) => {
      const ts = new Date(t.date).getTime()
      if (ts < from || ts >= to) return false
      if (!inScope(db, accs, t, f.scope, f.me)) return false
      if (f.accountId !== 'all' && !involvedAccountIds(t).includes(f.accountId)) return false
      if (adv && !matchesFilters(t, adv, catIds, tagSet)) return false
      if (q) {
        const hay = [t.title, t.note, cats.get(t.categoryId ?? '')?.name, ...involvedAccountIds(t).map((id) => accs.get(id)?.name), ...(t.tags ?? []).map((g) => '#' + g), (t.amount / 100).toFixed(2).replace('.', ',')]
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
 * - spesa condivisa: per ogni membro, netto = quanto ha pagato − la sua quota. Chi ha netto negativo deve la differenza a chi ha
 *   netto positivo (assegnazione deterministica dal più grande); con un solo pagatore è semplicemente "ognuno deve la sua quota a chi ha pagato"
 * - spesa senza pagatore (conto condiviso) o senza partecipanti: nessun debito
 * - trasferimento tra due conti PERSONALI di membri diversi = rimborso (da X a Y riduce il debito di X verso Y)
 */
export function familyBalances(db: Db, txs: Transaction[]): Debt[] {
  const accs = accountById(db)
  const owe = new Map<string, number>() // "debitore>creditore" -> importo
  const add = (d: MemberId, c: MemberId, v: number) => owe.set(`${d}>${c}`, (owe.get(`${d}>${c}`) ?? 0) + v)
  for (const t of txs) {
    if (t.type === 'expense' && t.participants.length > 0) {
      const net = new Map<MemberId, number>()
      let paidByMembers = 0
      for (const p of txPayments(t)) if (p.member) { net.set(p.member, (net.get(p.member) ?? 0) + p.amount); paidByMembers += p.amount }
      if (!paidByMembers) continue
      for (const s of expenseShares(t)) net.set(s.member, (net.get(s.member) ?? 0) - s.amount)
      const creditors = [...net].filter(([, v]) => v > 0).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([id, v]) => ({ id, left: v }))
      const debtors = [...net].filter(([, v]) => v < 0).sort(([a, x], [b, y]) => x - y || a.localeCompare(b)).map(([id, v]) => ({ id, need: -v }))
      for (const d of debtors) {
        for (const c of creditors) {
          if (d.need === 0) break
          const take = Math.min(d.need, c.left)
          if (take > 0) { add(d.id, c.id, take); d.need -= take; c.left -= take }
        }
      }
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

// ---------- tag

/** Normalizza un tag: niente "#" iniziale, spazi compattati, massimo 30 caratteri. */
export const normalizeTag = (s: string): string => s.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 30).trim()

/** Tag già usati, dal più frequente. */
export function allTags(db: Db): string[] {
  const n = new Map<string, number>()
  for (const t of db.transactions) for (const g of t.tags ?? []) n.set(g, (n.get(g) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g)
}

/**
 * Titoli già usati che corrispondono al testo digitato: prima quelli che iniziano con il testo, poi quelli che lo contengono;
 * a parità, i più usati e i più recenti. Il titolo identico a quello digitato non si propone.
 */
export function titleSuggestions(db: Db, text: string, limit = 5): string[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const seen = new Map<string, { title: string; n: number; last: string }>()
  for (const t of db.transactions) {
    const title = t.title.trim()
    if (!title) continue
    const k = title.toLowerCase()
    const e = seen.get(k)
    if (!e) seen.set(k, { title, n: 1, last: t.date })
    else { e.n++; if (t.date > e.last) { e.last = t.date; e.title = title } }
  }
  const rank = (k: string) => (k.startsWith(q) ? 0 : k.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2)
  return [...seen.entries()]
    .filter(([k]) => k.includes(q) && k !== q)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : -1) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([, e]) => e.title)
}

// ---------- andamento della liquidità

export interface LiquidityPoint {
  /** 0-11 */
  month: number
  /** liquidità a fine mese (per il mese in corso: oggi); null per i mesi futuri */
  value: number | null
}

/**
 * Liquidità a fine di ogni mese dell'anno, sui conti che contano nel totale (visibili a `me`, non nascosti, non esclusi).
 * `start` è la liquidità a inizio anno.
 */
export function liquiditySeries(db: Db, year: number, me: MemberId | null, now: Date = new Date()): { start: number; points: LiquidityPoint[] } {
  const counted = new Map(db.accounts.filter((a) => !a.hidden && !a.excludeFromTotal && visibleTo(db, a, me)).map((a) => [a.id, a]))
  const flows: Array<{ t: number; delta: number }> = []
  for (const t of db.transactions) {
    const ts = new Date(t.date).getTime()
    const push = (accountId: string | null | undefined, delta: number) => { if (accountId && counted.has(accountId)) flows.push({ t: ts, delta }) }
    if (t.type === 'expense') for (const p of txPayments(t)) push(p.accountId, -p.amount)
    else if (t.type === 'income') push(t.accountId, t.amount)
    else { push(t.accountId, -t.amount); push(t.toAccountId, t.amount) }
  }
  flows.sort((a, b) => a.t - b.t)
  let running = [...counted.values()].reduce((s, a) => s + a.initialBalance, 0)
  let i = 0
  const upTo = (limit: number) => { while (i < flows.length && flows[i].t < limit) running += flows[i++].delta }
  upTo(new Date(year, 0, 1).getTime())
  const start = running
  const points: LiquidityPoint[] = []
  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(year, m, 1).getTime()
    if (monthStart > now.getTime()) { points.push({ month: m, value: null }); continue }
    upTo(Math.min(new Date(year, m + 1, 1).getTime(), now.getTime() + 1))
    points.push({ month: m, value: running })
  }
  return { start, points }
}
