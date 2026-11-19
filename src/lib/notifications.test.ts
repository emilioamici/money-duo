import { describe, expect, it } from 'vitest'
import { createFamilyDb } from './defaults'
import { diffNotifications, mergeNotifications } from './notifications'
import { newMember, saveAccount, saveTransaction } from './mutations'
import { inScope, accountById } from './calc'
import type { Account, Db, Transaction } from '../types'

const T = '2026-01-01T00:00:00.000Z'
const acc = (id: string, name: string, members: string[], over: Partial<Account> = {}): Account => ({
  id, name, group: 'bank', members, initialBalance: 0, excludeFromTotal: false, hidden: false, order: 9, by: 'm1', createdAt: T, updatedAt: T, ...over,
})
const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't' + Math.random(), type: 'expense', amount: 4500, date: '2026-11-10T10:00:00.000Z', accountId: 'a-all', toAccountId: null, categoryId: null,
  title: 'Cena', note: '', paidBy: null, participants: [], by: 'm1', createdAt: T, updatedAt: T, ...over,
})
const sleep = () => new Promise((r) => setTimeout(r, 4))

/** famiglia: m1 Marco, m2 Anna, m3 Luca. Conti: personale di m1, personale di m3, condiviso m1+m2, di tutta la famiglia. */
function base(): Db {
  let db = createFamilyDb('Rossi', { name: 'Marco', email: 'marco@example.com' })
  db = { ...db, members: [{ ...db.members[0], id: 'm1' }, { ...newMember(db, 'Anna', 'anna@example.com'), id: 'm2' }, { ...newMember(db, 'Luca', 'luca@example.com'), id: 'm3' }] }
  return { ...db, accounts: [acc('a-m1', 'Conto Marco', ['m1']), acc('a-m3', 'Conto Luca', ['m3']), acc('a-duo', 'Conto Marco+Anna', ['m1', 'm2']), acc('a-all', 'Cassa Famiglia', [])] }
}

describe('notifiche: transazioni', () => {
  it('una transazione di un altro su un conto in comune notifica', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-all', by: 'm1' }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Marco ha aggiunto una spesa')
    expect(n[0].body).toContain('45,00')
    expect(n[0].body).toContain('Cena')
    expect(n[0].body).toContain('Cassa Famiglia')
    expect(n[0].txId).toBe(next.transactions[0].id)
  })
  it('una transazione su un conto condiviso con alcuni notifica solo chi è nel conto', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-duo', by: 'm1' }))
    expect(diffNotifications(prev, next, 'm2')).toHaveLength(1)
    expect(diffNotifications(prev, next, 'm3')).toHaveLength(0)
  })
  it('le proprie transazioni non notificano mai', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-all', by: 'm2' }))
    expect(diffNotifications(prev, next, 'm2')).toHaveLength(0)
  })
  it('un conto personale di un altro non notifica', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-m3', by: 'm3' }))
    expect(diffNotifications(prev, next, 'm2')).toHaveLength(0)
    expect(diffNotifications(prev, next, 'm1')).toHaveLength(0)
  })
  it('una spesa divisa con me su un conto che non vedo notifica, con la mia quota', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-m3', by: 'm3', paidBy: 'm3', amount: 3000, participants: ['m1', 'm2', 'm3'] }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Luca ha aggiunto una spesa condivisa con te')
    expect(n[0].body).toContain('la tua quota: 10,00')
    expect(n[0].body).not.toContain('Conto Luca') // il nome del conto privato non si rivela
    expect(diffNotifications(prev, next, 'm1')).toHaveLength(1)
    // ...e la transazione risulta anche visibile nell'elenco di chi è coinvolto
    expect(inScope(next, accountById(next), next.transactions[0], 'all', 'm2')).toBe(true)
    expect(inScope(next, accountById(next), next.transactions[0], 'all', 'm1')).toBe(true)
  })
  it('con una divisione non uguale la quota indicata è quella precisa', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-m3', by: 'm3', paidBy: 'm3', amount: 10000, participants: ['m2', 'm3'], splitMode: 'percent', splitValues: { m2: 2500, m3: 7500 } }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n[0].body).toContain('la tua quota: 25,00')
  })
  it('spesa pagata da più persone: notifica a chi partecipa, con la sua quota', () => {
    const prev = base()
    const next = saveTransaction(prev, tx({ accountId: 'a-m3', by: 'm3', paidBy: null, amount: 9000, participants: ['m1', 'm2', 'm3'],
      payments: [{ member: 'm3', accountId: 'a-m3', amount: 5000 }, { member: 'm1', accountId: 'a-duo', amount: 4000 }] }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Luca ha aggiunto una spesa condivisa con te')
    expect(n[0].body).toContain('la tua quota: 30,00')
    expect(n[0].body).toContain('Conto Marco+Anna') // il primo conto che vedo tra quelli dei pagamenti
    expect(diffNotifications(prev, next, 'm1')).toHaveLength(1)
  })
  it('una transazione già presente non notifica di nuovo; modificarla non è "aggiungere"', async () => {
    const prev = saveTransaction(base(), tx({ id: 'x', accountId: 'a-all', by: 'm1' }))
    await sleep()
    const next = saveTransaction(prev, { ...prev.transactions[0], amount: 9999 })
    expect(diffNotifications(prev, next, 'm2')).toHaveLength(0)
  })
  it('più di tre nuove transazioni diventano un solo riepilogo', () => {
    const prev = base()
    let next = prev
    for (let i = 0; i < 5; i++) next = saveTransaction(next, tx({ accountId: 'a-all', by: 'm1' }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('5 nuove transazioni condivise')
    expect(n[0].body).toBe('Marco')
  })
})

describe('notifiche: conti', () => {
  it('un nuovo conto in comune aggiunto da un altro notifica', () => {
    const prev = base()
    const next = saveAccount(prev, acc('a-new', 'Vacanze', [], { by: 'm1' }))
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].kind).toBe('account-new')
    expect(n[0].title).toBe('Nuovo conto in comune: Vacanze')
    expect(n[0].accountId).toBe('a-new')
  })
  it('un conto nuovo condiviso solo con alcuni notifica solo loro', () => {
    const prev = base()
    const next = saveAccount(prev, acc('a-new', 'Casa', ['m1', 'm2'], { by: 'm1' }))
    expect(diffNotifications(prev, next, 'm2')[0].title).toBe('Nuovo conto in comune: Casa')
    expect(diffNotifications(prev, next, 'm3')).toHaveLength(0)
  })
  it('un conto personale di un altro, non condiviso con me, non notifica', () => {
    const prev = base()
    const next = saveAccount(prev, acc('a-new', 'Segreto', ['m3'], { by: 'm3' }))
    expect(diffNotifications(prev, next, 'm2')).toHaveLength(0)
  })
  it('un conto esistente condiviso con me in seguito notifica', async () => {
    const prev = base()
    await sleep()
    const next = saveAccount(prev, { ...prev.accounts[0], members: ['m1', 'm2'], by: 'm1' }) // Conto Marco ora anche con Anna
    const n = diffNotifications(prev, next, 'm2')
    expect(n).toHaveLength(1)
    expect(n[0].kind).toBe('account-shared')
    expect(n[0].title).toBe('Marco ha condiviso con te il conto «Conto Marco»')
    expect(diffNotifications(prev, next, 'm3')).toHaveLength(0)
  })
  it('un conto personale condiviso con me da un altro è "condiviso con te", non "in comune"', () => {
    const prev = base()
    const next = saveAccount(prev, acc('a-p', 'Spese di Luca', ['m2'], { by: 'm3' }))
    expect(diffNotifications(prev, next, 'm2')[0].title).toBe('Luca ha condiviso con te il conto «Spese di Luca»')
  })
  it('i miei conti non mi notificano, nemmeno se condivisi con altri', () => {
    const prev = base()
    expect(diffNotifications(prev, saveAccount(prev, acc('a-new', 'Mio', [], { by: 'm2' })), 'm2')).toHaveLength(0)
  })
  it('un conto nascosto non notifica', () => {
    const prev = base()
    expect(diffNotifications(prev, saveAccount(prev, acc('a-new', 'Vecchio', [], { by: 'm1', hidden: true })), 'm2')).toHaveLength(0)
  })
})

describe('notifiche: elenco', () => {
  it('niente duplicati e al massimo 100 elementi', () => {
    const n = (id: string) => ({ id, kind: 'tx' as const, title: id, body: '', at: T, read: false })
    expect(mergeNotifications([n('a'), n('b')], [n('b'), n('c')]).map((x) => x.id)).toEqual(['c', 'a', 'b'])
    const many = Array.from({ length: 120 }, (_, i) => n('n' + i))
    expect(mergeNotifications([], many)).toHaveLength(100)
  })
})
