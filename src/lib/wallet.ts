import type { Account, Db, Member, Transaction } from '../types'
import { accountMemberIds, sortedAccounts } from './calc'
import { t } from '../i18n'

/** Spesa arrivata da Apple Wallet attraverso il server (vedi worker/src/wallet.ts). */
export interface WalletItem { id: string; amount: number; merchant: string; card: string; at: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Il conto che corrisponde alla carta usata: nome uguale, oppure uno contenuto nell'altro («Visa» ↔ «Visa Emilio»).
 * Considera solo i conti che il membro vede e può usare; a parità vince il conto personale.
 */
export function matchAccount(db: Db, me: string, card: string): Account | null {
  const c = norm(card)
  if (c.length < 3) return null
  let best: { a: Account; score: number } | null = null
  for (const a of sortedAccounts(db)) {
    if (a.hidden || !accountMemberIds(db, a).includes(me)) continue
    const n = norm(a.name)
    if (n.length < 3) continue
    const score = n === c ? 3 : n.includes(c) || c.includes(n) ? 2 : 0
    if (!score) continue
    const personal = a.members.length === 1 ? 0.5 : 0
    if (!best || score + personal > best.score) best = { a, score: score + personal }
  }
  return best?.a ?? null
}

export const walletTxId = (item: WalletItem): string => `w-${item.id}`

/**
 * Aggiunge al database le spese di Wallet non ancora importate (un id per spesa: importarla due volte, o dopo averla eliminata, non la duplica).
 * Ogni spesa è un'uscita senza categoria con il segno «da approvare»; se il conto non si riconosce si usa `fallbackAccountId` e il segno è «da completare».
 */
export function importWallet(db: Db, me: Member, items: WalletItem[], fallbackAccountId: string | undefined, nowIso: string): Db {
  const fresh = items.filter((i) => !db.transactions.some((x) => x.id === walletTxId(i)) && !(walletTxId(i) in db.deleted))
  if (!fresh.length) return db
  const usable = sortedAccounts(db).filter((a) => !a.hidden && accountMemberIds(db, a).includes(me.id))
  const fallback = usable.find((a) => a.id === fallbackAccountId) ?? usable.find((a) => a.members.length === 1) ?? usable[0]
  const added: Transaction[] = []
  for (const i of fresh) {
    const acc = matchAccount(db, me.id, i.card) ?? fallback
    if (!acc) continue
    const known = !!i.card && matchAccount(db, me.id, i.card)?.id === acc.id
    added.push({
      id: walletTxId(i), type: 'expense', amount: i.amount, date: i.at, accountId: acc.id, toAccountId: null, categoryId: null,
      title: i.merchant, note: i.card && !known ? t('Carta Wallet: {card}', { card: i.card }) : '',
      paidBy: acc.members.length === 1 ? acc.members[0] : null, participants: [], splitMode: 'equal', splitValues: null, payments: null, tags: [],
      pending: known ? 'approve' : 'complete', ...(i.card ? { walletCard: i.card } : {}), by: me.id, createdAt: nowIso, updatedAt: nowIso,
    })
  }
  return added.length ? { ...db, transactions: [...db.transactions, ...added] } : db
}

/** Approva: la transazione diventa una come le altre. */
export function approveTransaction(db: Db, id: string, nowIso: string): Db {
  return { ...db, transactions: db.transactions.map((x) => (x.id === id && x.pending ? { ...x, pending: null, updatedAt: nowIso } : x)) }
}

export const pendingCount = (db: Db, me: string | null): number => db.transactions.filter((x) => x.pending && (!me || x.by === me)).length
