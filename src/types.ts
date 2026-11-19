/** Schema del database condiviso (file JSON su Google Drive + cache locale). */

export const SCHEMA_VERSION = 1

/** a = primo profilo, b = secondo profilo, shared = area in comune */
export type ProfileId = 'a' | 'b' | 'shared'
export type TxType = 'expense' | 'income' | 'transfer'
/** personal = spesa solo mia · equal = 50/50 con l'altro · advance = anticipata al 100% per l'altro */
export type SplitMode = 'personal' | 'equal' | 'advance'
export type AccountGroup = 'cash' | 'bank' | 'card' | 'savings' | 'investment' | 'other'
export type CategoryType = 'expense' | 'income'

export interface Profiles {
  a: string
  b: string
  shared: string
  updatedAt: string
}

export interface Account {
  id: string
  name: string
  group: AccountGroup
  owner: ProfileId
  /** centesimi (può essere negativo) */
  initialBalance: number
  /** escluso dal totale liquidità (investimenti, fondi vincolati…) */
  excludeFromTotal: boolean
  hidden: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  type: CategoryType
  /** null = categoria principale, altrimenti id della categoria padre */
  parentId: string | null
  icon: string
  color: string
  hidden: boolean
  order: number
  updatedAt: string
}

export interface Transaction {
  id: string
  type: TxType
  /** centesimi, sempre > 0 */
  amount: number
  /** ISO 8601 (UTC) */
  date: string
  accountId: string
  /** solo per i giroconti */
  toAccountId: string | null
  categoryId: string | null
  title: string
  note: string
  paidBy: ProfileId
  split: SplitMode
  createdAt: string
  updatedAt: string
}

export interface DbMeta {
  dbId: string
  createdAt: string
  updatedAt: string
  /** email dell'ultimo account che ha scritto (solo informativo) */
  updatedBy: string
  revision: number
}

export interface Db {
  schemaVersion: number
  meta: DbMeta
  profiles: Profiles
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  /** tombstone: id eliminato -> data di eliminazione (serve al merge tra dispositivi) */
  deleted: Record<string, string>
}
