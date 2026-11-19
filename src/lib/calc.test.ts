import { describe, expect, it } from 'vitest'
import { createDefaultDb, createFamilyDb, isPristine } from './defaults'
import { accountBalances, categoryBreakdown, expenseShares, familyBalances, isSharedAccount, totalLiquidity, visibleTo } from './calc'
import { mergeDb, parseDb, replaceData, sameData } from './merge'
import { deactivateMember, deleteCategory, deleteTransaction, newMember, saveAccount, saveFamilyName, saveMember, saveTransaction, setCategoryHidden } from './mutations'
import { parseAmount } from './format'
import type { Account, Db, Transaction } from '../types'

const base = (over: Partial<Transaction>): Transaction => ({
  id: 't' + Math.random(), type: 'expense', amount: 1000, date: '2026-11-10T10:00:00.000Z', accountId: 'acc-cash', toAccountId: null,
  categoryId: 'cat-food', title: '', note: '', paidBy: null, participants: [], createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z', ...over,
})
const acc = (id: string, members: string[]): Account => ({ id, name: id, group: 'bank', members, initialBalance: 0, excludeFromTotal: false, hidden: false, order: 9, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms))

/** famiglia di 3 membri: m1 (capofamiglia), m2, m3 */
function family3(): Db {
  let db = createFamilyDb('Rossi', { name: 'Marco', email: 'marco@example.com' })
  const m1 = db.members[0].id
  db = { ...db, members: [{ ...db.members[0], id: 'm1' }, { ...newMember(db, 'Anna', 'anna@example.com'), id: 'm2' }, { ...newMember(db, 'Luca', 'luca@example.com'), id: 'm3' }] }
  db = { ...db, accounts: db.accounts.map((a) => (a.members.includes(m1) ? { ...a, members: ['m1'] } : a)) }
  return { ...db, accounts: [...db.accounts, acc('acc-m2', ['m2']), acc('acc-m3', ['m3']), acc('acc-duo', ['m1', 'm2'])] }
}

describe('format', () => {
  it('parseAmount', () => {
    expect(parseAmount('12,50')).toBe(1250)
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('12.5')).toBe(1250)
    expect(parseAmount('-3')).toBe(-300)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('saldi', () => {
  it('calcola entrate, uscite e trasferimenti; esclude conti dal totale', () => {
    let db = family3()
    db = saveTransaction(db, base({ id: '1', type: 'income', amount: 5000 }))
    db = saveTransaction(db, base({ id: '2', amount: 1500 }))
    db = saveTransaction(db, base({ id: '3', type: 'transfer', amount: 1000, toAccountId: 'acc-shared', categoryId: null }))
    const bal = accountBalances(db)
    expect(bal['acc-cash']).toBe(5000 - 1500 - 1000)
    expect(bal['acc-shared']).toBe(1000)
    expect(totalLiquidity(db, bal)).toBe(2500 + 1000)
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-shared' ? { ...a, excludeFromTotal: true } : a)) }
    expect(totalLiquidity(db, accountBalances(db))).toBe(2500)
  })
  it('un conto nascosto mantiene lo storico', () => {
    let db = family3()
    db = saveTransaction(db, base({ id: '1', amount: 700 }))
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-cash' ? { ...a, hidden: true } : a)) }
    expect(accountBalances(db)['acc-cash']).toBe(-700)
  })
})

describe('visibilità conti', () => {
  it('personale, condiviso con alcuni, tutta la famiglia', () => {
    const db = family3()
    const get = (id: string) => db.accounts.find((a) => a.id === id)!
    expect(visibleTo(db, get('acc-m2'), 'm2')).toBe(true)
    expect(visibleTo(db, get('acc-m2'), 'm3')).toBe(false)
    expect(visibleTo(db, get('acc-duo'), 'm1')).toBe(true)
    expect(visibleTo(db, get('acc-duo'), 'm3')).toBe(false)
    expect(visibleTo(db, get('acc-shared'), 'm3')).toBe(true) // members [] = tutta la famiglia
    expect(isSharedAccount(db, get('acc-shared'))).toBe(true)
    expect(isSharedAccount(db, get('acc-m2'))).toBe(false)
    expect(visibleTo(db, get('acc-m2'), null)).toBe(true)
    // un nuovo membro vede subito i conti di tutta la famiglia
    const more = saveMember(db, newMember(db, 'Zia', null))
    expect(isSharedAccount(more, more.accounts.find((a) => a.id === 'acc-shared')!)).toBe(true)
  })
})

describe('divisione spese e saldi tra membri', () => {
  it('quote uguali con resto deterministico', () => {
    const s = expenseShares(base({ amount: 1000, participants: ['m3', 'm1', 'm2'] }))
    expect(s.map((x) => x.member)).toEqual(['m1', 'm2', 'm3'])
    expect(s.map((x) => x.amount)).toEqual([334, 333, 333])
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(1000)
  })
  it('due membri: 50/50, anticipata, personale, conto condiviso e rimborso', () => {
    const db = family3()
    const t = [
      base({ amount: 1000, paidBy: 'm1', participants: ['m1', 'm2'] }), // m2 deve 500
      base({ amount: 2000, paidBy: 'm1', participants: ['m2'] }), // anticipata: m2 deve 2000
      base({ amount: 900, paidBy: 'm2', participants: ['m1', 'm2'] }), // m1 deve 450
      base({ amount: 5000, paidBy: 'm1', participants: [] }), // personale
      base({ amount: 5000, paidBy: null, participants: ['m1', 'm2'] }), // conto condiviso: nessun debito
    ]
    expect(familyBalances(db, t)).toEqual([{ debtor: 'm2', creditor: 'm1', amount: 500 + 2000 - 450 }])
    const rimborso = base({ type: 'transfer', amount: 2050, accountId: 'acc-m2', toAccountId: 'acc-cash', categoryId: null })
    expect(familyBalances(db, [...t, rimborso])).toEqual([])
  })
  it('tre membri: debiti incrociati e un rimborso parziale', () => {
    const db = family3()
    const t = [
      base({ amount: 3000, paidBy: 'm1', participants: ['m1', 'm2', 'm3'] }), // m2→m1 1000, m3→m1 1000
      base({ amount: 600, paidBy: 'm2', participants: ['m2', 'm3'] }), // m3→m2 300
      base({ amount: 400, paidBy: 'm3', participants: ['m1'] }), // m1→m3 400
    ]
    const d = familyBalances(db, t)
    expect(d).toContainEqual({ debtor: 'm2', creditor: 'm1', amount: 1000 })
    expect(d).toContainEqual({ debtor: 'm3', creditor: 'm1', amount: 600 })
    expect(d).toContainEqual({ debtor: 'm3', creditor: 'm2', amount: 300 })
    expect(d).toHaveLength(3)
    const part = base({ type: 'transfer', amount: 400, accountId: 'acc-m3', toAccountId: 'acc-cash', categoryId: null })
    expect(familyBalances(db, [...t, part]).find((x) => x.debtor === 'm3' && x.creditor === 'm1')!.amount).toBe(200)
    // un trasferimento da un conto condiviso a più membri non è un rimborso
    const no = base({ type: 'transfer', amount: 400, accountId: 'acc-duo', toAccountId: 'acc-cash', categoryId: null })
    expect(familyBalances(db, [no])).toEqual([])
  })
})

describe('divisione non uguale', () => {
  const amountTx = (over: Partial<Transaction>) => base({ amount: 10000, paidBy: 'm1', ...over })
  it('importi precisi', () => {
    const t = amountTx({ participants: ['m1', 'm2', 'm3'], splitMode: 'amount', splitValues: { m1: 5000, m2: 3000, m3: 2000 } })
    expect(expenseShares(t)).toEqual([{ member: 'm1', amount: 5000 }, { member: 'm2', amount: 3000 }, { member: 'm3', amount: 2000 }])
    expect(familyBalances(family3(), [t])).toEqual([{ debtor: 'm2', creditor: 'm1', amount: 3000 }, { debtor: 'm3', creditor: 'm1', amount: 2000 }])
  })
  it('percentuali: somma sempre esatta, resto al valore frazionario più alto', () => {
    const t = amountTx({ amount: 1000, participants: ['m1', 'm2', 'm3'], splitMode: 'percent', splitValues: { m1: 3333, m2: 3333, m3: 3334 } })
    const s = expenseShares(t)
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(1000)
    expect(s.find((x) => x.member === 'm3')!.amount).toBe(334)
    const t2 = amountTx({ amount: 9999, participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 7000, m2: 3000 } })
    expect(expenseShares(t2).map((x) => x.amount)).toEqual([6999, 3000]) // 69,993 -> 69,99 ; 29,997 -> 30,00
    expect(expenseShares(t2).reduce((a, x) => a + x.amount, 0)).toBe(9999)
  })
  it('chi ha valore 0 non partecipa', () => {
    const t = amountTx({ participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 10000, m2: 0 } })
    expect(expenseShares(t)).toEqual([{ member: 'm1', amount: 10000 }])
    expect(familyBalances(family3(), [t])).toEqual([])
  })
  it('valori incoerenti: si ripiega sulle parti uguali, mai debiti sballati', () => {
    expect(expenseShares(amountTx({ participants: ['m1', 'm2'], splitMode: 'amount', splitValues: { m1: 5000, m2: 3000 } })).map((x) => x.amount)).toEqual([5000, 5000])
    expect(expenseShares(amountTx({ participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 5000, m2: 3000 } })).map((x) => x.amount)).toEqual([5000, 5000])
  })
  it('senza modalità (dati vecchi) = parti uguali, come prima', () => {
    expect(expenseShares(amountTx({ participants: ['m2', 'm1'] })).map((x) => x.amount)).toEqual([5000, 5000])
  })
  it('anticipo per altri con importi: chi paga non partecipa', () => {
    const t = amountTx({ participants: ['m2', 'm3'], splitMode: 'amount', splitValues: { m2: 6000, m3: 4000 } })
    expect(familyBalances(family3(), [t])).toEqual([{ debtor: 'm2', creditor: 'm1', amount: 6000 }, { debtor: 'm3', creditor: 'm1', amount: 4000 }])
  })
  it('i vecchi file e le nuove transazioni mantengono la modalità dopo parse/serializzazione', () => {
    const db = saveTransaction(family3(), amountTx({ id: 'x', participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 6000, m2: 4000 } }))
    const back = parseDb(JSON.parse(JSON.stringify(db)))
    expect(back.transactions[0].splitMode).toBe('percent')
    expect(back.transactions[0].splitValues).toEqual({ m1: 6000, m2: 4000 })
    expect(parseDb(JSON.parse(JSON.stringify(createDefaultDb()))).transactions).toHaveLength(0)
  })
})

describe('categorie', () => {
  it('nascondere un padre nasconde i figli e mostrarli li riattiva', () => {
    let db = createDefaultDb()
    db = setCategoryHidden(db, 'cat-food', true)
    expect(db.categories.filter((c) => c.id.startsWith('cat-food')).every((c) => c.hidden)).toBe(true)
    db = setCategoryHidden(db, 'cat-food-1', false)
    expect(db.categories.find((c) => c.id === 'cat-food')!.hidden).toBe(false)
    db = setCategoryHidden(db, 'cat-food', false)
    expect(db.categories.filter((c) => c.id.startsWith('cat-food')).every((c) => !c.hidden)).toBe(true)
  })
  it('breakdown raggruppa sottocategorie sul padre', () => {
    const db = createDefaultDb()
    const r = categoryBreakdown(db, [base({ categoryId: 'cat-food-0', amount: 300 }), base({ categoryId: 'cat-food-1', amount: 200 }), base({ categoryId: null, amount: 100 })], 'expense')
    expect(r[0].id).toBe('cat-food')
    expect(r[0].total).toBe(500)
    expect(r[0].children).toHaveLength(2)
    expect(r[1].name).toBe('Senza categoria')
  })
})

describe('isPristine', () => {
  it('vero solo per i dati di esempio mai toccati', () => {
    const db = createDefaultDb()
    expect(isPristine(db)).toBe(true)
    expect(isPristine(saveTransaction(db, base({ id: 'x' })))).toBe(false)
    expect(isPristine(saveAccount(db, { ...db.accounts[0], name: 'Altro' }))).toBe(false)
    expect(isPristine(saveFamilyName(db, 'Rossi'))).toBe(false)
    expect(isPristine(createFamilyDb('Rossi', { name: 'M', email: 'm@example.com' }))).toBe(false)
  })
})

describe('membri', () => {
  it('un membro rimosso resta nello storico ma non è attivo', () => {
    let db = family3()
    db = saveTransaction(db, base({ id: 'x', paidBy: 'm3', participants: ['m1', 'm3'] }))
    db = deactivateMember(db, 'm3')
    expect(db.members.find((m) => m.id === 'm3')!.active).toBe(false)
    expect(familyBalances(db, db.transactions)).toEqual([{ debtor: 'm1', creditor: 'm3', amount: 500 }])
  })
  it('il merge unisce modifiche ai membri fatte su dispositivi diversi', async () => {
    const start = family3()
    await sleep()
    const a = saveMember(start, { ...start.members[1], name: 'Anna R.' })
    const b = saveMember(start, newMember(start, 'Zia', 'zia@example.com'))
    const m = mergeDb(a, b)
    expect(m.members).toHaveLength(4)
    expect(m.members.find((x) => x.id === 'm2')!.name).toBe('Anna R.')
  })
})

describe('merge', () => {
  it('unisce modifiche concorrenti senza perdere dati', async () => {
    const start = family3()
    let local = saveTransaction(start, base({ id: 'x', amount: 100 }))
    let remote = saveTransaction(start, base({ id: 'y', amount: 200 }))
    const merged = mergeDb(local, remote)
    expect(merged.transactions.map((t) => t.id).sort()).toEqual(['x', 'y'])
    expect(mergeDb(remote, local).transactions).toHaveLength(2)
    await sleep()
    remote = saveTransaction(merged, { ...merged.transactions.find((t) => t.id === 'x')!, amount: 999 })
    expect(mergeDb(local, remote).transactions.find((t) => t.id === 'x')!.amount).toBe(999)
    await sleep()
    local = deleteTransaction(merged, 'y')
    const again = mergeDb(local, remote)
    expect(again.transactions.map((t) => t.id)).toEqual(['x'])
    expect(sameData(again, mergeDb(remote, local))).toBe(true)
  })
  it('replaceData non resuscita elementi rimossi', () => {
    const cur = saveTransaction(family3(), base({ id: 'old' }))
    const out = replaceData(cur, createDefaultDb())
    expect(out.transactions).toHaveLength(0)
    expect(out.members).toHaveLength(0)
    expect(mergeDb(out, cur).transactions).toHaveLength(0)
    expect(mergeDb(out, cur).members).toHaveLength(0)
  })
  it('i dati di esempio di un\'installazione nuova non battono le modifiche reali', async () => {
    const remote0 = createDefaultDb()
    await sleep()
    let remote = saveAccount(remote0, { ...remote0.accounts[0], name: 'Portafoglio', initialBalance: 5000 })
    remote = deleteCategory(remote, 'cat-health')
    remote = saveFamilyName(remote, 'Casa Rossi')
    await sleep()
    const local = createDefaultDb() // nuova installazione, creata DOPO
    for (const m of [mergeDb(local, remote), mergeDb(remote, local)]) {
      const a = m.accounts.find((x) => x.id === 'acc-cash')!
      expect(a.name).toBe('Portafoglio')
      expect(a.initialBalance).toBe(5000)
      expect(m.categories.some((c) => c.id === 'cat-health')).toBe(false)
      expect(m.family.name).toBe('Casa Rossi')
    }
  })
})

describe('replaceData e nome famiglia', () => {
  it('un import senza nome famiglia proprio mantiene quello attuale; con nome proprio lo sostituisce', () => {
    const cur = saveFamilyName(family3(), 'Casa Rossi')
    expect(replaceData(cur, createDefaultDb()).family.name).toBe('Casa Rossi')
    const named = saveFamilyName(createDefaultDb(), 'Altra Famiglia')
    expect(replaceData(cur, named).family.name).toBe('Altra Famiglia')
  })
})

describe('parseDb e migrazione v1 -> v2', () => {
  const v1 = () => ({
    schemaVersion: 1,
    meta: { dbId: 'd1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', updatedBy: '', revision: 4 },
    profiles: { a: 'Emilio', b: 'Sara', shared: 'In Comune', updatedAt: '2026-01-05T00:00:00.000Z' },
    accounts: [
      { id: 'x1', name: 'Mio', group: 'bank', owner: 'a', initialBalance: 100, excludeFromTotal: false, hidden: false, order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'x2', name: 'Suo', group: 'bank', owner: 'b', initialBalance: 0, excludeFromTotal: false, hidden: true, order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'x3', name: 'Comune', group: 'bank', owner: 'shared', initialBalance: 0, excludeFromTotal: true, hidden: false, order: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z' },
    ],
    categories: [],
    transactions: [
      { id: 't1', type: 'expense', amount: 1000, date: '2026-01-10T10:00:00.000Z', accountId: 'x1', toAccountId: null, categoryId: null, title: '', note: '', paidBy: 'a', split: 'equal', createdAt: '2026-01-10T10:00:00.000Z', updatedAt: '2026-01-10T10:00:00.000Z' },
      { id: 't2', type: 'expense', amount: 500, date: '2026-01-11T10:00:00.000Z', accountId: 'x2', toAccountId: null, categoryId: null, title: '', note: '', paidBy: 'b', split: 'advance', createdAt: '2026-01-11T10:00:00.000Z', updatedAt: '2026-01-11T10:00:00.000Z' },
      { id: 't3', type: 'expense', amount: 300, date: '2026-01-12T10:00:00.000Z', accountId: 'x3', toAccountId: null, categoryId: null, title: '', note: '', paidBy: 'shared', split: 'equal', createdAt: '2026-01-12T10:00:00.000Z', updatedAt: '2026-01-12T10:00:00.000Z' },
      { id: 't4', type: 'expense', amount: 200, date: '2026-01-13T10:00:00.000Z', accountId: 'x1', toAccountId: null, categoryId: null, title: '', note: '', paidBy: 'a', split: 'personal', createdAt: '2026-01-13T10:00:00.000Z', updatedAt: '2026-01-13T10:00:00.000Z' },
    ],
    deleted: { gone: '2026-01-20T00:00:00.000Z' },
  })
  it('rifiuta file non validi o futuri', () => {
    expect(() => parseDb({})).toThrow()
    expect(() => parseDb({ schemaVersion: 99, accounts: [], categories: [], transactions: [] })).toThrow()
    expect(parseDb(JSON.parse(JSON.stringify(createDefaultDb()))).accounts).toHaveLength(2)
  })
  it('migra profili, conti e divisioni conservando i timestamp', () => {
    const db = parseDb(v1())
    expect(db.schemaVersion).toBe(2)
    expect(db.members.map((m) => [m.id, m.name, m.email])).toEqual([['a', 'Emilio', null], ['b', 'Sara', null]])
    expect(db.accounts.map((a) => a.members)).toEqual([['a'], ['b'], ['a', 'b']])
    expect(db.accounts.find((a) => a.id === 'x2')!.hidden).toBe(true)
    expect(db.accounts.find((a) => a.id === 'x3')!.updatedAt).toBe('2026-01-04T00:00:00.000Z')
    const tx = (id: string) => db.transactions.find((t) => t.id === id)!
    expect([tx('t1').paidBy, tx('t1').participants]).toEqual(['a', ['a', 'b']])
    expect([tx('t2').paidBy, tx('t2').participants]).toEqual(['b', ['a']])
    expect([tx('t3').paidBy, tx('t3').participants]).toEqual([null, []])
    expect([tx('t4').paidBy, tx('t4').participants]).toEqual(['a', []])
    expect(db.deleted).toEqual({ gone: '2026-01-20T00:00:00.000Z' })
    // stesso saldo di coppia di prima: b deve ad a 500; a deve a b 500 (anticipata) => pari
    expect(familyBalances(db, db.transactions)).toEqual([])
  })
  it('la migrazione è deterministica: migrare due volte e unire non cambia nulla', () => {
    const a = parseDb(v1())
    const b = parseDb(v1())
    expect(sameData(a, b)).toBe(true)
    expect(sameData(mergeDb(a, b), a)).toBe(true)
    // anche dopo un round trip nel nuovo formato
    expect(sameData(parseDb(JSON.parse(JSON.stringify(a))), a)).toBe(true)
  })
})
