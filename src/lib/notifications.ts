import type { Db, MemberId, Transaction } from '../types'
import { accountById, accountMemberIds, categoryById, expenseShares, inScope, visibleTo } from './calc'
import { formatMoney } from './format'
import { nowIso } from './ids'

export type NotifKind = 'tx' | 'account-new' | 'account-shared'

export interface Notif {
  id: string
  kind: NotifKind
  title: string
  body: string
  at: string
  read: boolean
  /** per aprire l'elemento dalla notifica */
  txId?: string
  accountId?: string
}

const GROUP_AFTER = 3 // oltre questa soglia, per tipo, si manda un riepilogo invece di una notifica per elemento

/**
 * Notifiche per il membro `me`, ricavate confrontando il DB prima e dopo l'arrivo di dati da altri.
 * - transazione aggiunta da un altro che vedo (conto in comune, conto condiviso con me, o spesa divisa con me)
 * - conto in comune aggiunto da un altro
 * - conto condiviso con me (nuovo o reso visibile a me)
 * Mai notificato per le mie modifiche. Funzione pura: nessun accesso a storage o rete.
 */
export function diffNotifications(prev: Db, next: Db, me: MemberId): Notif[] {
  const at = nowIso()
  const who = (id?: string | null) => (id ? next.members.find((m) => m.id === id)?.name ?? 'Un membro' : 'Un membro')
  const accs = accountById(next)
  const cats = categoryById(next)
  const out: Notif[] = []

  // ----- transazioni
  const prevTx = new Set(prev.transactions.map((t) => t.id))
  const newTx = next.transactions.filter((t) => !prevTx.has(t.id) && t.by !== me && inScope(next, accs, t, 'all', me))
  const txNotif = (t: Transaction): Notif => {
    const acc = accs.get(t.accountId)
    const myShare = t.type === 'expense' && t.paidBy && t.paidBy !== me ? expenseShares(t).find((s) => s.member === me)?.amount : undefined
    const kind = t.type === 'expense' ? 'una spesa' : t.type === 'income' ? "un'entrata" : 'un trasferimento'
    const label = t.title || (t.categoryId ? cats.get(t.categoryId)?.name : '') || ''
    const accName = acc && visibleTo(next, acc, me) ? acc.name : ''
    return {
      id: `tx:${t.id}:${t.updatedAt}`, kind: 'tx', at, read: false, txId: t.id,
      title: myShare ? `${who(t.by)} ha aggiunto una spesa condivisa con te` : `${who(t.by)} ha aggiunto ${kind}`,
      body: [formatMoney(t.amount), label, accName].filter(Boolean).join(' · ') + (myShare ? ` — la tua quota: ${formatMoney(myShare)}` : ''),
    }
  }
  if (newTx.length > GROUP_AFTER) {
    out.push({ id: `tx:group:${newTx.map((t) => t.id).sort()[0]}:${newTx.length}`, kind: 'tx', at, read: false,
      title: `${newTx.length} nuove transazioni condivise`, body: [...new Set(newTx.map((t) => who(t.by)))].join(', ') })
  } else out.push(...newTx.map(txNotif))

  // ----- conti
  const prevAcc = new Map(prev.accounts.map((a) => [a.id, a]))
  const accNotifs: Notif[] = next.accounts
    .filter((a) => !a.hidden && a.by !== me && visibleTo(next, a, me) && (!prevAcc.has(a.id) || !visibleTo(prev, prevAcc.get(a.id)!, me)))
    .map((a) => {
      const isNew = !prevAcc.has(a.id)
      const ids = accountMemberIds(next, a)
      const common = ids.length > 1
      const names = ids.map((id) => who(id)).join(', ')
      return isNew && common
        ? { id: `acc:${a.id}:new`, kind: 'account-new' as const, at, read: false, accountId: a.id, title: `Nuovo conto in comune: ${a.name}`, body: `Aggiunto da ${who(a.by)} · con ${names}` }
        : { id: `acc:${a.id}:shared:${a.updatedAt}`, kind: 'account-shared' as const, at, read: false, accountId: a.id, title: `${who(a.by)} ha condiviso con te il conto «${a.name}»`, body: common ? `Condiviso con ${names}` : 'Conto personale condiviso con te' }
    })
  if (accNotifs.length > GROUP_AFTER) {
    out.push({ id: `acc:group:${accNotifs.map((n) => n.accountId).sort()[0]}:${accNotifs.length}`, kind: 'account-shared', at, read: false,
      title: `${accNotifs.length} conti condivisi con te`, body: accNotifs.map((n) => n.title).slice(0, 3).join(' · ') })
  } else out.push(...accNotifs)
  return out
}

const MAX_KEPT = 100

/** Aggiunge le nuove notifiche in testa, senza duplicati, mantenendo al massimo MAX_KEPT elementi. */
export function mergeNotifications(current: Notif[], incoming: Notif[]): Notif[] {
  const seen = new Set(current.map((n) => n.id))
  return [...incoming.filter((n) => !seen.has(n.id)), ...current].slice(0, MAX_KEPT)
}
