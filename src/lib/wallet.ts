import type { Account, Db, Favorite, Member, Transaction, WalletCard, WalletMerchant } from '../types'
import { templateOf } from './mutations'
import { accountMemberIds, sortedAccounts } from './calc'
import { t } from '../i18n'
import { formatMoney } from './format'
import type { Notif } from './notifications'

/** Spesa arrivata da Apple Wallet attraverso il server (vedi worker/src/wallet.ts). */
export interface WalletItem { id: string; amount: number; merchant: string; card: string; at: string }

/** Confronto tra nomi di carte: senza maiuscole, accenti e punteggiatura. */
export const cardKey = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const MAX_MERCHANTS = 100
/** Le carte e gli esercenti si confrontano allo stesso modo. */
export const nameKey = cardKey

export const walletTxId = (item: WalletItem): string => `w-${item.id}`
/** La spesa è arrivata da Apple Wallet (riconoscibile dall'id, che resta uguale anche dopo l'approvazione o la modifica). */
export const isWalletTx = (tx: { id: string }): boolean => tx.id.startsWith('w-')

const usable = (db: Db, me: string): Account[] => sortedAccounts(db).filter((a) => !a.hidden && accountMemberIds(db, a).includes(me))
const noteFor = (card: string): string => t('Carta Wallet: {card}', { card })

/** Le carte note di un membro. */
export const cardsOf = (db: Db, memberId: string): WalletCard[] => db.members.find((m) => m.id === memberId)?.walletCards ?? []

/** Il conto associato alla carta, se la persona l'ha scelto e può ancora usarlo. */
export function cardAccount(db: Db, memberId: string, card: string): Account | null {
  const key = cardKey(card)
  if (!key) return null
  const link = cardsOf(db, memberId).find((c) => cardKey(c.name) === key)
  return (link?.accountId && usable(db, memberId).find((a) => a.id === link.accountId)) || null
}

const withCards = (db: Db, memberId: string, cards: WalletCard[], nowIso: string): Db =>
  ({ ...db, members: db.members.map((m) => (m.id === memberId ? { ...m, walletCards: cards, updatedAt: nowIso } : m)) })

// ---------- esercenti legati a un preferito ----------

export const merchantsOf = (db: Db, memberId: string): WalletMerchant[] => db.members.find((m) => m.id === memberId)?.walletMerchants ?? []

const withMerchants = (db: Db, memberId: string, list: WalletMerchant[], nowIso: string): Db =>
  ({ ...db, members: db.members.map((m) => (m.id === memberId ? { ...m, walletMerchants: list, updatedAt: nowIso } : m)) })

/** Un preferito si può applicare a una spesa di Wallet se non ha importi per persona né pagamenti di più persone (l'importo lo decide Wallet). */
export const favoriteUsable = (f: Favorite): boolean => (f.splitMode ?? 'equal') !== 'amount' && (f.payments?.length ?? 0) <= 1

/** I preferiti che il membro può legare a un esercente (suoi o di tutti, compatibili). */
export const favoritesForMerchants = (db: Db, memberId: string): Favorite[] =>
  db.favorites.filter((f) => (f.by === memberId || f.by === null) && favoriteUsable(f)).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'it'))

/** Il preferito legato all'esercente, se esiste ancora, è applicabile e i suoi conti sono ancora utilizzabili dal membro. */
export function favoriteForMerchant(db: Db, memberId: string, merchant: string): Favorite | null {
  const key = nameKey(merchant)
  if (!key) return null
  const link = merchantsOf(db, memberId).find((m) => nameKey(m.name) === key)
  const fav = link?.favoriteId ? db.favorites.find((f) => f.id === link.favoriteId) : undefined
  if (!fav || !(fav.by === memberId || fav.by === null) || !favoriteUsable(fav)) return null
  const ok = new Set(usable(db, memberId).map((a) => a.id))
  const used = [fav.accountId, fav.toAccountId, ...(fav.payments ?? []).map((p) => p.accountId)].filter((x): x is string => !!x)
  return used.every((id) => ok.has(id)) ? fav : null
}

/** Dal preferito alla spesa di Wallet: stessi dati del preferito con importo e data della spesa. */
const fromFavorite = (fav: Favorite, base: Pick<Transaction, 'id' | 'amount' | 'date' | 'createdAt' | 'updatedAt'>, merchant: string, card: string | undefined, me: string): Transaction => ({
  ...(templateOf(fav) as Omit<Transaction, 'id' | 'amount' | 'date' | 'by' | 'createdAt' | 'updatedAt'>),
  ...base, title: fav.title || merchant, pending: null, ...(card ? { walletCard: card } : {}), by: me,
} as Transaction)

/**
 * Aggiunge al database le spese di Wallet non ancora importate (un id per spesa: importarla due volte, o dopo averla eliminata, non la duplica).
 * Ogni spesa è un'uscita senza categoria con il segno «da approvare». Se la carta non è ancora associata a un conto la carta si aggiunge
 * all'elenco «da associare» e la spesa va sul conto predefinito con il segno «da completare»: sceglie la persona.
 */
export function importWallet(db: Db, me: Member, items: WalletItem[], fallbackAccountId: string | undefined, nowIso: string): Db {
  const fresh = items.filter((i) => !db.transactions.some((x) => x.id === walletTxId(i)) && !(walletTxId(i) in db.deleted))
  if (!fresh.length) return db
  const mine = usable(db, me.id)
  const fallback = mine.find((a) => a.id === fallbackAccountId) ?? mine.find((a) => a.members.length === 1) ?? mine[0]
  const cards = [...cardsOf(db, me.id)]
  const merchants = [...merchantsOf(db, me.id)]
  const added: Transaction[] = []
  for (const i of fresh) {
    const base = { id: walletTxId(i), amount: i.amount, date: i.at, createdAt: nowIso, updatedAt: nowIso }
    // esercente legato a un preferito: la spesa è già compilata e approvata, come se si fosse usato il preferito con questo importo
    const fav = favoriteForMerchant(db, me.id, i.merchant)
    const linked = cardAccount(db, me.id, i.card)
    const acc = linked ?? fallback
    if (!fav && !acc) continue
    if (i.card && !cards.some((c) => cardKey(c.name) === cardKey(i.card))) cards.push({ name: i.card, accountId: null })
    if (i.merchant && !merchants.some((m) => nameKey(m.name) === nameKey(i.merchant))) merchants.push({ name: i.merchant, favoriteId: null })
    if (fav) { added.push(fromFavorite(fav, base, i.merchant, i.card || undefined, me.id)); continue }
    added.push({
      ...base, type: 'expense', accountId: acc!.id, toAccountId: null, categoryId: null,
      title: i.merchant, note: i.card && !linked ? noteFor(i.card) : '',
      paidBy: acc!.members.length === 1 ? acc!.members[0] : null, participants: [], splitMode: 'equal', splitValues: null, payments: null, tags: [],
      pending: linked ? 'approve' : 'complete', ...(i.card ? { walletCard: i.card } : {}), by: me.id,
    })
  }
  if (!added.length) return db
  let next: Db = { ...db, transactions: [...db.transactions, ...added] }
  if (cards.length !== cardsOf(db, me.id).length) next = withCards(next, me.id, cards, nowIso)
  if (merchants.length !== merchantsOf(db, me.id).length) {
    // l'elenco non cresce senza fine: oltre il tetto si scartano i più vecchi tra quelli senza preferito
    while (merchants.length > MAX_MERCHANTS) { const k = merchants.findIndex((m) => !m.favoriteId); merchants.splice(k < 0 ? 0 : k, 1) }
    next = withMerchants(next, me.id, merchants, nowIso)
  }
  return next
}

/**
 * Lega un esercente a un preferito (null = nessuno). Le sue spese ancora «da approvare» o «da completare»
 * diventano come il preferito (con il loro importo e la loro data) e già approvate.
 */
export function setMerchantFavorite(db: Db, memberId: string, merchant: string, favoriteId: string | null, nowIso: string): Db {
  const key = nameKey(merchant)
  const list = merchantsOf(db, memberId)
  const next = withMerchants(db, memberId, list.some((m) => nameKey(m.name) === key) ? list.map((m) => (nameKey(m.name) === key ? { ...m, favoriteId } : m)) : [...list, { name: merchant, favoriteId }], nowIso)
  const fav = favoriteForMerchant(next, memberId, merchant)
  if (!fav) return next
  return {
    ...next,
    transactions: next.transactions.map((x) => (x.pending && x.by === memberId && isWalletTx(x) && nameKey(x.title) === key
      ? { ...fromFavorite(fav, { id: x.id, amount: x.amount, date: x.date, createdAt: x.createdAt, updatedAt: nowIso }, x.title, x.walletCard, memberId) }
      : x)),
  }
}

export const removeMerchant = (db: Db, memberId: string, merchant: string, nowIso: string): Db =>
  withMerchants(db, memberId, merchantsOf(db, memberId).filter((m) => nameKey(m.name) !== nameKey(merchant)), nowIso)

/**
 * Associa una carta a un conto (null = torna «da associare»). Le spese di quella carta ancora «da completare»
 * passano al conto scelto e diventano «da approvare».
 */
export function setCardAccount(db: Db, memberId: string, card: string, accountId: string | null, nowIso: string): Db {
  const key = cardKey(card)
  const cards = cardsOf(db, memberId)
  const next = withCards(db, memberId, cards.some((c) => cardKey(c.name) === key) ? cards.map((c) => (cardKey(c.name) === key ? { ...c, accountId } : c)) : [...cards, { name: card, accountId }], nowIso)
  const acc = accountId ? usable(db, memberId).find((a) => a.id === accountId) : undefined
  if (!acc) return next
  return {
    ...next,
    transactions: next.transactions.map((x) => x.pending === 'complete' && x.by === memberId && x.walletCard && cardKey(x.walletCard) === key
      ? { ...x, accountId: acc.id, paidBy: acc.members.length === 1 ? acc.members[0] : null, note: x.note === noteFor(x.walletCard) ? '' : x.note, pending: 'approve' as const, updatedAt: nowIso }
      : x),
  }
}

/** Toglie la carta dall'elenco (ricomparirà da associare al prossimo pagamento). */
export const removeCard = (db: Db, memberId: string, card: string, nowIso: string): Db =>
  withCards(db, memberId, cardsOf(db, memberId).filter((c) => cardKey(c.name) !== cardKey(card)), nowIso)

/**
 * Notifiche per le spese appena importate da Wallet (una per spesa; oltre 3, un riepilogo). Funzione pura.
 * Compaiono nella campanella, e come avviso se l'app è aperta; con l'app chiusa le manda il server come notifica push.
 */
export function walletNotifications(added: Transaction[], nowIso: string): Notif[] {
  if (!added.length) return []
  if (added.length > 3) {
    return [{ id: `wallet:group:${added.map((x) => x.id).sort()[0]}:${added.length}`, kind: 'wallet', at: nowIso, read: false, txId: added[0].id,
      title: t('{n} spese da Wallet da approvare', { n: added.length }), body: added.slice(0, 3).map((x) => x.title || 'Apple Pay').join(', ') + '…' }]
  }
  return added.map((x) => ({ id: `wallet:${x.id}`, kind: 'wallet' as const, at: nowIso, read: false, txId: x.id,
    title: t(x.pending === 'complete' ? 'Spesa da Wallet da completare' : x.pending ? 'Spesa da Wallet da approvare' : 'Spesa da Wallet aggiunta'), body: `${x.title || 'Apple Pay'} · ${formatMoney(x.amount)}` }))
}

/** Approva: la transazione diventa una come le altre. */
export function approveTransaction(db: Db, id: string, nowIso: string): Db {
  return { ...db, transactions: db.transactions.map((x) => (x.id === id && x.pending ? { ...x, pending: null, updatedAt: nowIso } : x)) }
}

export const pendingCount = (db: Db, me: string | null): number => db.transactions.filter((x) => x.pending && (!me || x.by === me)).length
