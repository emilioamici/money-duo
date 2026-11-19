import type { Account, Category, CategoryType, Db, ProfileId, Transaction } from '../types'

export type Scope = 'all' | ProfileId

export const accountById = (db: Db): Map<string, Account> => new Map(db.accounts.map((a) => [a.id, a]))
export const categoryById = (db: Db): Map<string, Category> => new Map(db.categories.map((c) => [c.id, c]))

export const sortedAccounts = (db: Db): Account[] => [...db.accounts].sort((a, b) => a.order - b.order)

export function topCategories(db: Db, type: CategoryType, includeHidden = false): Category[] {
  return db.categories.filter((c) => c.type === type && c.parentId === null && (includeHidden || !c.hidden)).sort((a, b) => a.order - b.order)
}
export function childCategories(db: Db, parentId: string, includeHidden = false): Category[] {
  return db.categories.filter((c) => c.parentId === parentId && (includeHidden || !c.hidden)).sort((a, b) => a.order - b.order)
}

/** Saldo per conto (centesimi): saldo iniziale + entrate − uscite ± giroconti. Include sempre lo storico, anche dei conti nascosti. */
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

/** Totale liquidità: conti visibili e non esclusi (investimenti / fondi vincolati). `scope` limita al proprietario. */
export function totalLiquidity(db: Db, bal: Record<string, number>, scope: Scope = 'all'): number {
  return db.accounts
    .filter((a) => !a.hidden && !a.excludeFromTotal && (scope === 'all' || a.owner === scope))
    .reduce((s, a) => s + (bal[a.id] ?? 0), 0)
}

/** Ambito di una transazione = proprietario del conto (per i giroconti: di uno qualsiasi dei due conti). */
export function inScope(accs: Map<string, Account>, tx: Transaction, scope: Scope): boolean {
  if (scope === 'all') return true
  return accs.get(tx.accountId)?.owner === scope || (!!tx.toAccountId && accs.get(tx.toAccountId)?.owner === scope)
}

export interface Filters {
  from: Date
  to: Date // esclusa
  scope: Scope
  accountId: string // 'all' oppure id
  q: string
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
      if (!inScope(accs, t, f.scope)) return false
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

/**
 * Bilancio di coppia: valore > 0 ⇒ B deve ad A; < 0 ⇒ A deve a B.
 * - spesa pagata da A: 50/50 ⇒ B deve metà · anticipata ⇒ B deve tutto · personale ⇒ nulla (idem per B)
 * - spese pagate da "In Comune" non generano debiti
 * - giroconto tra un conto di B e uno di A = rimborso (riduce il debito di B); da A a B lo aumenta
 */
export function coupleBalance(db: Db, txs: Transaction[]): number {
  const accs = accountById(db)
  let net = 0
  for (const t of txs) {
    if (t.type === 'expense') {
      if (t.paidBy === 'shared' || t.split === 'personal') continue
      const share = t.split === 'equal' ? Math.round(t.amount / 2) : t.amount
      net += t.paidBy === 'a' ? share : -share
    } else if (t.type === 'transfer' && t.toAccountId) {
      const from = accs.get(t.accountId)?.owner
      const to = accs.get(t.toAccountId)?.owner
      if (from === 'b' && to === 'a') net -= t.amount
      else if (from === 'a' && to === 'b') net += t.amount
    }
  }
  return net
}
