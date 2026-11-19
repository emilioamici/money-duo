import type { Db, MemberId, Transaction } from '../types'
import { accountById, accountMemberIds, categoryById, expenseShares, inScope, involvedAccountIds, txPayerIds, visibleTo } from './calc'
import { formatMoney } from './format'
import { nowIso } from './ids'
import { t as tr } from '../i18n'

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
  const who = (id?: string | null) => (id ? next.members.find((m) => m.id === id)?.name ?? tr('Un membro') : tr('Un membro'))
  const accs = accountById(next)
  const cats = categoryById(next)
  const out: Notif[] = []

  // ----- transazioni
  const prevTx = new Set(prev.transactions.map((t) => t.id))
  const newTx = next.transactions.filter((t) => !prevTx.has(t.id) && t.by !== me && inScope(next, accs, t, 'all', me))
  const txNotif = (t: Transaction): Notif => {
    const acc = involvedAccountIds(t).map((id) => accs.get(id)).find((a) => a && visibleTo(next, a, me))
    const payers = txPayerIds(t)
    // se partecipo alla spesa e non l'ho pagata da solo, mi interessa la mia quota
    const myShare = t.type === 'expense' && payers.length > 0 && !(payers.length === 1 && payers[0] === me) ? expenseShares(t).find((s) => s.member === me)?.amount : undefined
    const kind = t.type === 'expense' ? tr('una spesa') : t.type === 'income' ? tr('un\'entrata') : tr('un trasferimento')
    const label = t.title || (t.categoryId ? cats.get(t.categoryId)?.name : '') || ''
    const accName = acc?.name ?? ''
    return {
      id: `tx:${t.id}:${t.updatedAt}`, kind: 'tx', at, read: false, txId: t.id,
      title: myShare ? tr('{who} ha aggiunto una spesa condivisa con te', { who: who(t.by) }) : tr('{who} ha aggiunto {kind}', { who: who(t.by), kind }),
      body: [formatMoney(t.amount), label, accName].filter(Boolean).join(' · ') + (myShare ? ' — ' + tr('la tua quota: {v}', { v: formatMoney(myShare) }) : ''),
    }
  }
  if (newTx.length > GROUP_AFTER) {
    out.push({ id: `tx:group:${newTx.map((t) => t.id).sort()[0]}:${newTx.length}`, kind: 'tx', at, read: false,
      title: tr('{n} nuove transazioni condivise', { n: newTx.length }), body: [...new Set(newTx.map((t) => who(t.by)))].join(', ') })
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
        ? { id: `acc:${a.id}:new`, kind: 'account-new' as const, at, read: false, accountId: a.id, title: tr('Nuovo conto in comune: {name}', { name: a.name }), body: tr('Aggiunto da {who} · con {names}', { who: who(a.by), names }) }
        : { id: `acc:${a.id}:shared:${a.updatedAt}`, kind: 'account-shared' as const, at, read: false, accountId: a.id, title: tr('{who} ha condiviso con te il conto «{name}»', { who: who(a.by), name: a.name }), body: common ? tr('Condiviso con {names}', { names }) : tr('Conto personale condiviso con te') }
    })
  if (accNotifs.length > GROUP_AFTER) {
    out.push({ id: `acc:group:${accNotifs.map((n) => n.accountId).sort()[0]}:${accNotifs.length}`, kind: 'account-shared', at, read: false,
      title: tr('{n} conti condivisi con te', { n: accNotifs.length }), body: accNotifs.map((n) => n.title).slice(0, 3).join(' · ') })
  } else out.push(...accNotifs)
  return out
}

const MAX_KEPT = 100

/** Aggiunge le nuove notifiche in testa, senza duplicati, mantenendo al massimo MAX_KEPT elementi. */
export function mergeNotifications(current: Notif[], incoming: Notif[]): Notif[] {
  const seen = new Set(current.map((n) => n.id))
  return [...incoming.filter((n) => !seen.has(n.id)), ...current].slice(0, MAX_KEPT)
}
