import type { Account, Category, Db, Favorite, Member, Payment, Transaction } from '../types'
import { SCHEMA_VERSION } from '../types'
import { nowIso, uid } from './ids'
import { MEMBER_COLORS } from './defaults'

type Rec = { id: string; updatedAt: string }
const EPOCH = '1970-01-01T00:00:00.000Z'

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
    family: remote.family.updatedAt > local.family.updatedAt ? remote.family : local.family,
    members: mergeList(local.members, remote.members, deleted),
    accounts: mergeList(local.accounts, remote.accounts, deleted).sort((x, y) => x.order - y.order),
    categories: mergeList(local.categories, remote.categories, deleted).sort((x, y) => x.order - y.order),
    transactions: mergeList(local.transactions, remote.transactions, deleted),
    favorites: mergeList(local.favorites, remote.favorites, deleted),
    deleted,
  }
}

/** I due DB hanno lo stesso contenuto (ignorando i metadati)? */
export function sameData(a: Db, b: Db): boolean {
  const byId = <T extends { id: string }>(l: T[]) => [...l].sort((x, y) => x.id.localeCompare(y.id))
  const norm = (d: Db) =>
    JSON.stringify([d.family, byId(d.members), byId(d.accounts), byId(d.categories), byId(d.transactions), byId(d.favorites), Object.entries(d.deleted).sort(([x], [y]) => x.localeCompare(y))])
  return norm(a) === norm(b)
}

/** Sostituzione completa: gli elementi non presenti nel nuovo DB diventano tombstone, così il sync non li "resuscita". */
export function replaceData(current: Db, incoming: Db): Db {
  const t = nowIso()
  const deleted = mergeDeleted(current.deleted, incoming.deleted)
  const all = (d: Db) => [...d.members, ...d.accounts, ...d.categories, ...d.transactions, ...d.favorites]
  const keep = new Set(all(incoming).map((x) => x.id))
  for (const x of all(current)) if (!keep.has(x.id)) deleted[x.id] = t
  const bump = <T extends Rec>(list: T[]): T[] => list.map((x) => (deleted[x.id] && deleted[x.id] >= x.updatedAt ? { ...x, updatedAt: t } : x))
  for (const id of keep) delete deleted[id]
  return {
    ...incoming,
    meta: { ...current.meta, updatedAt: t },
    // un file senza nome famiglia impostato (timestamp epoch: dati di esempio o migrati) non cancella quello attuale
    family: incoming.family.updatedAt <= EPOCH ? current.family : { ...incoming.family, updatedAt: t },
    members: bump(incoming.members),
    accounts: bump(incoming.accounts),
    categories: bump(incoming.categories),
    transactions: bump(incoming.transactions),
    favorites: bump(incoming.favorites),
    deleted,
  }
}

// ---------- validazione / migrazione ----------

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numMap = (v: unknown): Record<string, number> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = Math.round(n)
  return Object.keys(out).length ? out : null
}
const parsePayments = (v: unknown): Payment[] | null => {
  if (!Array.isArray(v)) return null
  const out = v
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).accountId === 'string')
    .map((p) => ({ member: typeof p.member === 'string' ? p.member : null, accountId: p.accountId as string, amount: Math.abs(Math.round(num(p.amount))) }))
  return out.length ? out : null
}
const bool = (v: unknown): boolean => v === true
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * v1 (coppia: profili a/b/shared) -> v2 (famiglia). Deterministica: niente `now`, id fissi 'a' e 'b',
 * timestamp originali conservati; così migrare due volte lo stesso file dà lo stesso risultato e il merge non cambia nulla.
 */
function migrateV1(o: Obj): Obj {
  const prof = isObj(o.profiles) ? o.profiles : {}
  const pt = str(prof.updatedAt, EPOCH)
  const member = (id: string, name: string, i: number) => ({ id, name, email: null, color: MEMBER_COLORS[i], active: true, joinedAt: null, updatedAt: pt })
  const other: Record<string, string> = { a: 'b', b: 'a' }
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : [])
  return {
    ...o,
    schemaVersion: 2,
    family: { name: 'Famiglia', updatedAt: pt },
    members: [member('a', str(prof.a, 'Emilio'), 0), member('b', str(prof.b, 'Sara'), 1)],
    accounts: arr(o.accounts).map((a) => ({ ...a, members: a.owner === 'a' ? ['a'] : a.owner === 'b' ? ['b'] : ['a', 'b'] })),
    transactions: arr(o.transactions).map((t) => {
      const payer = t.paidBy === 'a' || t.paidBy === 'b' ? (t.paidBy as string) : null
      const participants = !payer ? [] : t.split === 'equal' ? ['a', 'b'] : t.split === 'advance' ? [other[payer]] : []
      return { ...t, paidBy: payer, participants }
    }),
  }
}

/** Valida e normalizza un JSON sconosciuto (file Drive o import locale), migrando i file v1. Lancia Error con messaggio leggibile. */
export function parseDb(input: unknown): Db {
  if (!isObj(input)) throw new Error('Il file non è un database MoneyDuo valido.')
  if (typeof input.schemaVersion !== 'number') throw new Error('Il file non è un database MoneyDuo (schemaVersion mancante).')
  if (input.schemaVersion > SCHEMA_VERSION) throw new Error('Il file è stato creato da una versione più recente dell\'app: aggiorna MoneyDuo.')
  if (!Array.isArray(input.accounts) || !Array.isArray(input.categories) || !Array.isArray(input.transactions))
    throw new Error('Database incompleto: mancano conti, categorie o transazioni.')
  const raw = input.schemaVersion < 2 ? migrateV1(input) : input

  const meta = isObj(raw.meta) ? raw.meta : {}
  const fam = isObj(raw.family) ? raw.family : {}
  const now = nowIso()
  const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj).filter((x) => typeof x.id === 'string') : [])

  const members: Member[] = list(raw.members).map((x, i) => ({
    id: x.id as string,
    name: str(x.name, 'Membro'),
    email: typeof x.email === 'string' && x.email ? x.email : null,
    color: str(x.color, MEMBER_COLORS[i % MEMBER_COLORS.length]),
    active: x.active !== false,
    joinedAt: typeof x.joinedAt === 'string' ? x.joinedAt : null,
    paypal: typeof x.paypal === 'string' && x.paypal ? x.paypal : null,
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const accounts: Account[] = list(raw.accounts).map((x, i) => ({
    id: x.id as string,
    name: str(x.name, 'Conto'),
    group: pick(x.group, ['cash', 'bank', 'card', 'savings', 'investment', 'other'] as const, 'other'),
    members: strArr(x.members),
    initialBalance: Math.round(num(x.initialBalance)),
    excludeFromTotal: bool(x.excludeFromTotal),
    hidden: bool(x.hidden),
    order: num(x.order, i),
    by: typeof x.by === 'string' ? x.by : null,
    createdAt: str(x.createdAt, EPOCH),
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const categories: Category[] = list(raw.categories).map((x, i) => ({
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

  const transactions: Transaction[] = list(raw.transactions).map((x) => ({
    id: x.id as string,
    type: pick(x.type, ['expense', 'income', 'transfer'] as const, 'expense'),
    amount: Math.abs(Math.round(num(x.amount))),
    date: str(x.date, EPOCH),
    accountId: str(x.accountId),
    toAccountId: typeof x.toAccountId === 'string' ? x.toAccountId : null,
    categoryId: typeof x.categoryId === 'string' ? x.categoryId : null,
    title: str(x.title),
    note: str(x.note),
    paidBy: typeof x.paidBy === 'string' ? x.paidBy : null,
    participants: strArr(x.participants),
    splitMode: pick(x.splitMode, ['equal', 'amount', 'percent'] as const, 'equal'),
    splitValues: numMap(x.splitValues),
    payments: parsePayments(x.payments),
    tags: strArr(x.tags),
    by: typeof x.by === 'string' ? x.by : null,
    createdAt: str(x.createdAt, EPOCH),
    updatedAt: str(x.updatedAt, EPOCH),
  }))

  const favorites: Favorite[] = list(raw.favorites).map((x) => ({
    id: x.id as string,
    by: typeof x.by === 'string' ? x.by : null,
    type: pick(x.type, ['expense', 'income', 'transfer'] as const, 'expense'),
    amount: Math.abs(Math.round(num(x.amount))),
    accountId: str(x.accountId),
    toAccountId: typeof x.toAccountId === 'string' ? x.toAccountId : null,
    categoryId: typeof x.categoryId === 'string' ? x.categoryId : null,
    title: str(x.title),
    note: str(x.note),
    paidBy: typeof x.paidBy === 'string' ? x.paidBy : null,
    participants: strArr(x.participants),
    splitMode: pick(x.splitMode, ['equal', 'amount', 'percent'] as const, 'equal'),
    splitValues: numMap(x.splitValues),
    payments: parsePayments(x.payments),
    tags: strArr(x.tags),
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
    family: { name: str(fam.name, 'Famiglia'), updatedAt: str(fam.updatedAt, EPOCH) },
    members,
    accounts,
    categories,
    transactions,
    favorites,
    deleted,
  }
}
