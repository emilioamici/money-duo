import type { Account, Db, Member, Transaction, WalletCard } from '../types'
import { accountMemberIds, sortedAccounts } from './calc'
import { t } from '../i18n'

/** Spesa arrivata da Apple Wallet attraverso il server (vedi worker/src/wallet.ts). */
export interface WalletItem { id: string; amount: number; merchant: string; card: string; at: string }

/** Confronto tra nomi di carte: senza maiuscole, accenti e punteggiatura. */
export const cardKey = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

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
  const added: Transaction[] = []
  for (const i of fresh) {
    const linked = cardAccount(db, me.id, i.card)
    const acc = linked ?? fallback
    if (!acc) continue
    if (i.card && !cards.some((c) => cardKey(c.name) === cardKey(i.card))) cards.push({ name: i.card, accountId: null })
    added.push({
      id: walletTxId(i), type: 'expense', amount: i.amount, date: i.at, accountId: acc.id, toAccountId: null, categoryId: null,
      title: i.merchant, note: i.card && !linked ? noteFor(i.card) : '',
      paidBy: acc.members.length === 1 ? acc.members[0] : null, participants: [], splitMode: 'equal', splitValues: null, payments: null, tags: [],
      pending: linked ? 'approve' : 'complete', ...(i.card ? { walletCard: i.card } : {}), by: me.id, createdAt: nowIso, updatedAt: nowIso,
    })
  }
  if (!added.length) return db
  const next = { ...db, transactions: [...db.transactions, ...added] }
  return cards.length !== cardsOf(db, me.id).length ? withCards(next, me.id, cards, nowIso) : next
}

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

/** Approva: la transazione diventa una come le altre. */
export function approveTransaction(db: Db, id: string, nowIso: string): Db {
  return { ...db, transactions: db.transactions.map((x) => (x.id === id && x.pending ? { ...x, pending: null, updatedAt: nowIso } : x)) }
}

export const pendingCount = (db: Db, me: string | null): number => db.transactions.filter((x) => x.pending && (!me || x.by === me)).length
