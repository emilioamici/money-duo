import type { Account, Category, Db, Profiles, Transaction } from '../types'
import { SCHEMA_VERSION } from '../types'
import { nowIso, uid } from './ids'

type Rec = { id: string; updatedAt: string }

/** Unione per id: vince l'`updatedAt` più recente; le eliminazioni (tombstone) vincono se più recenti. */
function mergeList<T extends Rec>(a: T[], b: T[], deleted: Record<string, string>): T[] {
  const map = new Map<string, T>()
  for (const x of a) map.set(x.id, x)
  for (const y of b) {
    const x = map.get(y.id)
    if (!x || y.updatedAt > x.updatedAt) map.set(y.id, y)
  }
  return [...map.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= x.updatedAt))
}

function mergeDeleted(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const out = { ...a }
  for (const [id, t] of Object.entries(b)) if (!out[id] || t > out[id]) out[id] = t
  return out
}

/** Merge a livello di record tra copia locale e copia remota. `remote` è autorevole per i metadati. */
export function mergeDb(local: Db, remote: Db): Db {
  const deleted = mergeDeleted(local.deleted, remote.deleted)
  const profiles: Profiles = remote.profiles.updatedAt > local.profiles.updatedAt ? remote.profiles : local.profiles
  const newerMeta = remote.meta.updatedAt >= local.meta.updatedAt ? remote.meta : local.meta
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      dbId: remote.meta.dbId,
      createdAt: local.meta.createdAt < remote.meta.createdAt ? local.meta.createdAt : remote.meta.createdAt,
      updatedAt: newerMeta.updatedAt,
      updatedBy: newerMeta.updatedBy,
      revision: Math.max(local.meta.revision, remote.meta.revision),
    },
    profiles,
    accounts: mergeList(local.accounts, remote.accounts, deleted).sort((x, y) => x.order - y.order),
    categories: mergeList(local.categories, remote.categories, deleted).sort((x, y) => x.order - y.order),
    transactions: mergeList(local.transactions, remote.transactions, deleted),
    deleted,
  }
}

/** I due DB hanno lo stesso contenuto (ignorando i metadati)? */
export function sameData(a: Db, b: Db): boolean {
  const norm = (d: Db) =>
    JSON.stringify([
      d.profiles,
      [...d.accounts].sort((x, y) => x.id.localeCompare(y.id)),
      [...d.categories].sort((x, y) => x.id.localeCompare(y.id)),
      [...d.transactions].sort((x, y) => x.id.localeCompare(y.id)),
      Object.entries(d.deleted).sort(([x], [y]) => x.localeCompare(y)),
    ])
  return norm(a) === norm(b)
}

/** Sostituzione completa: gli elementi non presenti nel nuovo DB diventano tombstone, così il sync non li "resuscita". */
export function replaceData(current: Db, incoming: Db): Db {
  const t = nowIso()
  const deleted = mergeDeleted(current.deleted, incoming.deleted)
  const keep = new Set([...incoming.accounts, ...incoming.categories, ...incoming.transactions].map((x) => x.id))
  for (const x of [...current.accounts, ...current.categories, ...current.transactions]) if (!keep.has(x.id)) deleted[x.id] = t
  // gli elementi importati devono battere eventuali tombstone preesistenti
  const bump = <T extends Rec>(list: T[]): T[] => list.map((x) => (deleted[x.id] && deleted[x.id] >= x.updatedAt ? { ...x, updatedAt: t } : x))
  for (const id of keep) delete deleted[id]
  return {
    ...incoming,
    meta: { ...current.meta, updatedAt: t },
    accounts: bump(incoming.accounts),
    categories: bump(incoming.categories),
    transactions: bump(incoming.transactions),
    profiles: { ...incoming.profiles, updatedAt: t },
    deleted,
  }
}

// ---------- validazione / migrazione ----------

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const bool = (v: unknown): boolean => v === true
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)
const EPOCH = '1970-01-01T00:00:00.000Z'
const PROFILE = ['a', 'b', 'shared'] as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Valida e normalizza un JSON sconosciuto (file Drive o import locale). Lancia Error con messaggio leggibile. */
export function parseDb(raw: unknown): Db {
  if (!isObj(raw)) throw new Error('Il file non è un database MoneyDuo valido.')
  if (typeof raw.schemaVersion !== 'number') throw new Error('Il file non è un database MoneyDuo (schemaVersion mancante).')
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('Il file è stato creato da una versione più recente dell\'app: aggiorna MoneyDuo.')
  if (!Array.isArray(raw.accounts) || !Array.isArray(raw.categories) || !Array.isArray(raw.transactions))
    throw new Error('Database incompleto: mancano conti, categorie o transazioni.')

  const meta = isObj(raw.meta) ? raw.meta : {}
  const prof = isObj(raw.profiles) ? raw.profiles : {}
  const now = nowIso()

  const accounts: Account[] = raw.accounts.filter(isObj).filter((x) => typeof x.id === 'string').map((x, i) => ({
    id: x.id as string,
    name: str(x.name, 'Conto'),
    group: pick(x.group, ['cash', 'bank', 'card', 'savings', 'investment', 'other'] as const, 'other'),
    owner: pick(x.owner, PROFILE, 'shared'),
    initialBalance: Math.round(num(x.initialBalance)),
    excludeFromTotal: bool(x.excludeFromTotal),
    hidden: bool(x.hidden),
    order: num(x.order, i),
    createdAt: str(x.createdAt, EPOCH),
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const categories: Category[] = raw.categories.filter(isObj).filter((x) => typeof x.id === 'string').map((x, i) => ({
    id: x.id as string,
    name: str(x.name, 'Categoria'),
    type: pick(x.type, ['expense', 'income'] as const, 'expense'),
    parentId: typeof x.parentId === 'string' ? x.parentId : null,
    icon: str(x.icon, '📦'),
    color: str(x.color, '#64748b'),
    hidden: bool(x.hidden),
    order: num(x.order, i),
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const transactions: Transaction[] = raw.transactions.filter(isObj).filter((x) => typeof x.id === 'string').map((x) => ({
    id: x.id as string,
    type: pick(x.type, ['expense', 'income', 'transfer'] as const, 'expense'),
    amount: Math.abs(Math.round(num(x.amount))),
    date: str(x.date, EPOCH),
    accountId: str(x.accountId),
    toAccountId: typeof x.toAccountId === 'string' ? x.toAccountId : null,
    categoryId: typeof x.categoryId === 'string' ? x.categoryId : null,
    title: str(x.title),
    note: str(x.note),
    paidBy: pick(x.paidBy, PROFILE, 'shared'),
    split: pick(x.split, ['personal', 'equal', 'advance'] as const, 'personal'),
    createdAt: str(x.createdAt, EPOCH),
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const deleted: Record<string, string> = {}
  if (isObj(raw.deleted)) for (const [k, v] of Object.entries(raw.deleted)) if (typeof v === 'string') deleted[k] = v

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      dbId: str(meta.dbId) || uid(),
      createdAt: str(meta.createdAt, now),
      updatedAt: str(meta.updatedAt, now),
      updatedBy: str(meta.updatedBy),
      revision: num(meta.revision),
    },
    profiles: { a: str(prof.a, 'Emilio'), b: str(prof.b, 'Sara'), shared: str(prof.shared, 'In Comune'), updatedAt: str(prof.updatedAt, EPOCH) },
    accounts,
    categories,
    transactions,
    deleted,
  }
}
