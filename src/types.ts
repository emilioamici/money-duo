/** Schema del database di famiglia (file JSON su Google Drive + cache locale). */

export const SCHEMA_VERSION = 2

export type MemberId = string
export type TxType = 'expense' | 'income' | 'transfer'
export type AccountGroup = 'cash' | 'bank' | 'card' | 'savings' | 'investment' | 'other'
export type CategoryType = 'expense' | 'income'

export interface Family {
  name: string
  updatedAt: string
}

export interface Member {
  id: MemberId
  name: string
  /** account Google con cui la persona accede; null finché non è stato associato */
  email: string | null
  color: string
  /** false = rimosso dalla famiglia (resta nello storico) */
  active: boolean
  /** quando la persona ha aperto l'app per la prima volta (null = solo invitata) */
  joinedAt: string | null
  updatedAt: string
}

export interface Account {
  id: string
  name: string
  group: AccountGroup
  /** membri che vedono e usano il conto; [] = tutta la famiglia. Un solo membro = conto personale */
  members: MemberId[]
  /** centesimi (può essere negativo) */
  initialBalance: number
  /** escluso dal totale liquidità (investimenti, fondi vincolati…) */
  excludeFromTotal: boolean
  hidden: boolean
  order: number
  /** membro che ha creato / modificato per ultimo il conto (serve alle notifiche) */
  by?: MemberId | null
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
  /** chi ha pagato/incassato; null = conto condiviso (nessun debito tra membri) */
  paidBy: MemberId | null
  /** membri che si dividono la spesa in parti uguali; [] = spesa personale */
  participants: MemberId[]
  /** membro che ha aggiunto / modificato per ultimo la transazione (serve alle notifiche) */
  by?: MemberId | null
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
  family: Family
  members: Member[]
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  /** tombstone: id eliminato -> data di eliminazione (serve al merge tra dispositivi) */
  deleted: Record<string, string>
}
