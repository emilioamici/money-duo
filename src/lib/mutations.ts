import type { Account, Category, Db, Favorite, Member, Transaction } from '../types'
import { nowIso, uid } from './ids'
import { MEMBER_COLORS } from './defaults'

/** Funzioni pure Db -> Db. Ogni modifica aggiorna `updatedAt` del record (serve al merge). */

const without = (deleted: Record<string, string>, id: string) => {
  const { [id]: _drop, ...rest } = deleted
  return rest
}

export function saveTransaction(db: Db, tx: Transaction): Db {
  const next = { ...tx, updatedAt: nowIso() }
  const exists = db.transactions.some((x) => x.id === tx.id)
  return {
    ...db,
    transactions: exists ? db.transactions.map((x) => (x.id === tx.id ? next : x)) : [...db.transactions, next],
    deleted: without(db.deleted, tx.id),
  }
}

export function deleteTransaction(db: Db, id: string): Db {
  return { ...db, transactions: db.transactions.filter((x) => x.id !== id), deleted: { ...db.deleted, [id]: nowIso() } }
}

export function saveAccount(db: Db, acc: Account): Db {
  const t = nowIso()
  // Conto Split: solo personale e uno solo per membro (impostarlo su un conto lo toglie dall'altro)
  const split = !!acc.splitAccount && acc.members.length === 1
  const next: Account = { ...acc, updatedAt: t }
  if (split) next.splitAccount = true; else delete next.splitAccount
  const exists = db.accounts.some((x) => x.id === acc.id)
  const others = split ? db.accounts.map((x) => (x.id !== acc.id && x.splitAccount && x.members.length === 1 && x.members[0] === acc.members[0] ? (({ splitAccount: _s, ...r }) => ({ ...r, updatedAt: t }))(x) : x)) : db.accounts
  return {
    ...db,
    accounts: exists ? others.map((x) => (x.id === acc.id ? next : x)) : [...others, next],
    deleted: without(db.deleted, acc.id),
  }
}

export const accountInUse = (db: Db, id: string): boolean => db.transactions.some((t) => t.accountId === id || t.toAccountId === id)

/** Eliminazione consentita solo se il conto non ha storico (altrimenti: nascondere). */
export function deleteAccount(db: Db, id: string): Db {
  if (accountInUse(db, id)) return db
  return { ...db, accounts: db.accounts.filter((x) => x.id !== id), deleted: { ...db.deleted, [id]: nowIso() } }
}

export function setAccountHidden(db: Db, id: string, hidden: boolean): Db {
  const t = nowIso()
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, hidden, updatedAt: t } : a)) }
}

export function setAccountExcluded(db: Db, id: string, excludeFromTotal: boolean): Db {
  const t = nowIso()
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, excludeFromTotal, updatedAt: t } : a)) }
}

export function saveCategory(db: Db, cat: Category): Db {
  const next = { ...cat, updatedAt: nowIso() }
  const exists = db.categories.some((x) => x.id === cat.id)
  return {
    ...db,
    categories: exists ? db.categories.map((x) => (x.id === cat.id ? next : x)) : [...db.categories, next],
    deleted: without(db.deleted, cat.id),
  }
}

export const categoryInUse = (db: Db, id: string): boolean =>
  db.transactions.some((t) => t.categoryId === id) || db.categories.some((c) => c.parentId === id)

export function deleteCategory(db: Db, id: string): Db {
  if (categoryInUse(db, id)) return db
  return { ...db, categories: db.categories.filter((x) => x.id !== id), deleted: { ...db.deleted, [id]: nowIso() } }
}

/**
 * Nascondere un padre nasconde a cascata le sottocategorie; mostrarlo le riattiva.
 * Mostrare una sottocategoria riattiva anche il padre (altrimenti resterebbe invisibile).
 */
export function setCategoryHidden(db: Db, id: string, hidden: boolean): Db {
  const t = nowIso()
  const target = db.categories.find((c) => c.id === id)
  if (!target) return db
  return {
    ...db,
    categories: db.categories.map((c) => {
      const hit = c.id === id || c.parentId === id || (!hidden && c.id === target.parentId)
      return hit && c.hidden !== hidden ? { ...c, hidden, updatedAt: t } : c
    }),
  }
}

export function saveFamilyName(db: Db, name: string): Db {
  return { ...db, family: { name: name.trim() || 'Famiglia', updatedAt: nowIso() } }
}

export function saveMember(db: Db, m: Member): Db {
  const next = { ...m, updatedAt: nowIso() }
  const exists = db.members.some((x) => x.id === m.id)
  return { ...db, members: exists ? db.members.map((x) => (x.id === m.id ? next : x)) : [...db.members, next], deleted: without(db.deleted, m.id) }
}

export function newMember(db: Db, name: string, email: string | null, joined = false): Member {
  const t = nowIso()
  return { id: uid(), name, email, color: MEMBER_COLORS[db.members.length % MEMBER_COLORS.length], active: true, joinedAt: joined ? t : null, updatedAt: t }
}

/** Il membro esce dalla famiglia: resta nello storico (pagamenti, divisioni) ma non è più selezionabile. */
export function deactivateMember(db: Db, id: string): Db {
  const t = nowIso()
  return { ...db, members: db.members.map((m) => (m.id === id ? { ...m, active: false, updatedAt: t } : m)) }
}

export const nextOrder = (items: Array<{ order: number }>): number => items.reduce((m, x) => Math.max(m, x.order), -1) + 1

// ---------- copia e preferiti ----------

/** Campi di una transazione che si portano in una copia o in un preferito (niente id, date, autore). */
export function templateOf(tx: Transaction | Favorite): Partial<Transaction> {
  return {
    type: tx.type, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId, categoryId: tx.categoryId,
    title: tx.title, note: tx.note, paidBy: tx.paidBy, participants: [...tx.participants],
    splitMode: tx.splitMode ?? 'equal', splitValues: tx.splitValues ? { ...tx.splitValues } : null,
    payments: tx.payments ? tx.payments.map((p) => ({ ...p })) : null, tags: [...(tx.tags ?? [])],
  }
}

/** Stato iniziale del form per una copia: stessi dati, data e ora di adesso. */
export const copyOf = (tx: Transaction | Favorite): Partial<Transaction> => ({ ...templateOf(tx), date: nowIso() })

/** Impronta per riconoscere lo stesso modello (tipo, importo, conti, categoria, titolo, partecipanti, pagamenti). */
const sig = (x: Transaction | Favorite) => JSON.stringify([x.type, x.amount, x.accountId, x.toAccountId, x.categoryId, x.title.trim().toLowerCase(), x.participants, x.payments ?? null])

/** Il preferito (di questo membro) che corrisponde a una transazione, se c'è. */
export function findFavorite(db: Db, tx: Transaction, me: string | null): Favorite | undefined {
  return db.favorites.find((f) => f.by === me && sig(f) === sig(tx))
}

export function addFavorite(db: Db, tx: Transaction, me: string | null): Db {
  if (findFavorite(db, tx, me)) return db
  const t = nowIso()
  const fav: Favorite = { id: uid(), by: me, ...(templateOf(tx) as Omit<Favorite, 'id' | 'by' | 'createdAt' | 'updatedAt'>), createdAt: t, updatedAt: t }
  return { ...db, favorites: [...db.favorites, fav] }
}

export function deleteFavorite(db: Db, id: string): Db {
  return { ...db, favorites: db.favorites.filter((f) => f.id !== id), deleted: { ...db.deleted, [id]: nowIso() } }
}
