/** Schema del database di famiglia (file JSON su Google Drive + cache locale). */

export const SCHEMA_VERSION = 2

export type MemberId = string
export type TxType = 'expense' | 'income' | 'transfer'
export type AccountGroup = 'cash' | 'bank' | 'card' | 'savings' | 'investment' | 'other'
export type CategoryType = 'expense' | 'income'
export type SplitMode = 'equal' | 'amount' | 'percent'

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
  /** nome utente PayPal.Me (es. «mario.rossi»): gli altri membri lo usano per rimborsarlo; assente = non collegato */
  paypal?: string | null
  /**
   * Carte di Apple Wallet usate da questa persona e conto a cui sono associate (null = ancora da associare).
   * Le carte si aggiungono da sole al primo pagamento; l'associazione la sceglie la persona in Impostazioni → Apple Wallet.
   */
  walletCards?: WalletCard[]
  /** Esercenti di Apple Wallet visti finora e preferito a cui sono legati (null = nessuno): le spese di quell'esercente arrivano già compilate e approvate. */
  walletMerchants?: WalletMerchant[]
  updatedAt: string
}

export interface WalletMerchant {
  /** nome dell'esercente come lo comunica Wallet */
  name: string
  favoriteId: string | null
}

export interface WalletCard {
  /** nome della carta come lo comunica Wallet */
  name: string
  accountId: string | null
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
  /**
   * «Conto Split»: conto personale (uno solo per membro) usato per dividere le spese. È preselezionato quando quel membro paga uno split
   * e il suo saldo è sempre zero, qualunque spesa ci finisca. Assente = conto normale.
   */
  splitAccount?: boolean
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

/** Un pagamento di una spesa: chi ha pagato, da quale conto e quanto. */
export interface Payment {
  member: MemberId | null
  accountId: string
  /** centesimi */
  amount: number
}

export interface Transaction {
  id: string
  type: TxType
  /** centesimi, sempre > 0 */
  amount: number
  /** ISO 8601 (UTC) */
  date: string
  accountId: string
  /** solo per i trasferimenti */
  toAccountId: string | null
  categoryId: string | null
  title: string
  note: string
  /** chi ha pagato/incassato; null = conto condiviso (nessun debito tra membri) */
  paidBy: MemberId | null
  /** membri che si dividono la spesa; [] = spesa personale */
  participants: MemberId[]
  /** come si divide: parti uguali (predefinito), importi precisi o percentuali */
  splitMode?: SplitMode
  /**
   * valori inseriti per membro: importo in centesimi (mode 'amount') oppure percentuale in centesimi di punto,
   * 3333 = 33,33% (mode 'percent'). Assente con le parti uguali.
   */
  splitValues?: Record<MemberId, number> | null
  /**
   * Spesa pagata da più persone, ciascuna dal proprio conto. Assente (o null) = un solo pagamento:
   * `accountId` + `paidBy` + `amount`. Con più pagamenti `amount` è il totale, `accountId` il primo conto
   * e `paidBy` null; la somma dei pagamenti è uguale all'importo.
   */
  payments?: Payment[] | null
  /** etichette libere (es. "vacanza", "lidl") */
  tags?: string[]
  /**
   * Importata da Apple Wallet e non ancora controllata: 'approve' = pronta da approvare, 'complete' = il conto non è stato riconosciuto.
   * Sparisce quando l'utente approva, oppure apre la transazione e la salva.
   */
  pending?: 'approve' | 'complete' | null
  /** nome della carta come l'ha comunicato Wallet (solo informativo, per le transazioni importate) */
  walletCard?: string
  /** membro che ha aggiunto / modificato per ultimo la transazione (serve alle notifiche) */
  by?: MemberId | null
  createdAt: string
  updatedAt: string
}

/** Modello di transazione salvato tra i preferiti: scegliendolo si apre il form di copia con la data di oggi. */
export interface Favorite {
  id: string
  /** a chi appartiene: ogni membro vede solo i propri preferiti (i conti privati restano tali) */
  by: MemberId | null
  type: TxType
  amount: number
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  title: string
  note: string
  paidBy: MemberId | null
  participants: MemberId[]
  splitMode?: SplitMode
  splitValues?: Record<MemberId, number> | null
  payments?: Payment[] | null
  tags?: string[]
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
  /** modelli di transazione preferiti (assente nei file creati prima di questa funzione) */
  favorites: Favorite[]
  /** tombstone: id eliminato -> data di eliminazione (serve al merge tra dispositivi) */
  deleted: Record<string, string>
}
