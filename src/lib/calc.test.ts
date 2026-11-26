import { describe, expect, it } from 'vitest'
import { createDefaultDb, createFamilyDb, isPristine } from './defaults'
import { accountBalances, splitAccountOf, allTags, categoryBreakdown, expenseShares, familyBalances, filterTransactions, involvedAccountIds, isSharedAccount, isSplit, liquiditySeries, normalizeTag, totalLiquidity, txPayerIds, visibleTo } from './calc'
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

describe('spese pagate da più persone', () => {
  // 100 € pagati: Marco 60 dal suo conto, Anna 40 dal suo; divisi in parti uguali tra i tre
  const multi = () => base({ amount: 10000, accountId: 'acc-cash', paidBy: null, participants: ['m1', 'm2', 'm3'],
    payments: [{ member: 'm1', accountId: 'acc-cash', amount: 6000 }, { member: 'm2', accountId: 'acc-m2', amount: 4000 }] })
  it('ogni conto viene addebitato del proprio pagamento', () => {
    const db = saveTransaction(family3(), multi())
    const bal = accountBalances(db)
    expect(bal['acc-cash']).toBe(-6000)
    expect(bal['acc-m2']).toBe(-4000)
    expect(bal['acc-m3']).toBe(0)
  })
  it('è una spesa condivisa e coinvolge tutti i conti dei pagamenti', () => {
    const t = multi()
    expect(isSplit(t)).toBe(true)
    expect(involvedAccountIds(t).sort()).toEqual(['acc-cash', 'acc-m2'])
    expect(txPayerIds(t).sort()).toEqual(['m1', 'm2'])
    expect(isSplit(base({ participants: [] }))).toBe(false)
  })
  it('debiti: ognuno paga la sua quota, chi ha pagato di più è creditore', () => {
    // quote 33,34 / 33,33 / 33,33 ; netti: m1 +26,66 ; m2 +6,67 ; m3 −33,33
    const d = familyBalances(family3(), [multi()])
    expect(d).toContainEqual({ debtor: 'm3', creditor: 'm1', amount: 2666 })
    expect(d).toContainEqual({ debtor: 'm3', creditor: 'm2', amount: 667 })
    expect(d).toHaveLength(2)
    expect(d.reduce((a, x) => a + x.amount, 0)).toBe(3333) // la quota di m3, esatta
  })
  it('con un solo pagatore il risultato è identico al modello precedente', () => {
    const single = base({ amount: 3000, paidBy: 'm1', participants: ['m1', 'm2', 'm3'] })
    const asPayments = { ...single, paidBy: null, payments: [{ member: 'm1', accountId: 'acc-cash', amount: 3000 }] }
    expect(familyBalances(family3(), [asPayments])).toEqual(familyBalances(family3(), [single]))
  })
  it('chi ha pagato ma non partecipa ha anticipato per gli altri', () => {
    const t = base({ amount: 9000, paidBy: null, participants: ['m2', 'm3'],
      payments: [{ member: 'm1', accountId: 'acc-cash', amount: 5000 }, { member: 'm2', accountId: 'acc-m2', amount: 4000 }] })
    // quote 45/45 ; netti: m1 +50 ; m2 −5 ; m3 −45
    const d = familyBalances(family3(), [t])
    expect(d).toContainEqual({ debtor: 'm3', creditor: 'm1', amount: 4500 })
    expect(d).toContainEqual({ debtor: 'm2', creditor: 'm1', amount: 500 })
  })
  it('un pagamento dal conto condiviso (senza membro) non crea debiti', () => {
    const t = base({ amount: 5000, paidBy: null, participants: ['m1', 'm2'], payments: [{ member: null, accountId: 'acc-shared', amount: 5000 }] })
    expect(familyBalances(family3(), [t])).toEqual([])
  })
  it('chi ha pagato vede la spesa anche se il conto è di un altro; una spesa vecchia senza pagamenti funziona come prima', () => {
    const db = saveTransaction(family3(), multi())
    const found = filterTransactions(db, { from: new Date('2026-11-01'), to: new Date('2026-12-01'), scope: 'all', accountId: 'acc-m2', q: '', me: 'm1' })
    expect(found).toHaveLength(1) // m1 non vede acc-m2 ma ha pagato
    expect(involvedAccountIds(base({ accountId: 'acc-cash' }))).toEqual(['acc-cash'])
  })
  it('parse: i pagamenti sopravvivono al salvataggio', () => {
    const back = parseDb(JSON.parse(JSON.stringify(saveTransaction(family3(), multi()))))
    expect(back.transactions[0].payments).toEqual(multi().payments)
  })
})

describe('tag', () => {
  it('normalizzazione, elenco per frequenza, ricerca', () => {
    expect(normalizeTag('  #Vacanza  Estate ')).toBe('Vacanza Estate')
    expect(normalizeTag('#'.repeat(3) + 'x'.repeat(50)).length).toBe(30)
    let db = family3()
    db = saveTransaction(db, base({ id: 'a', tags: ['lidl', 'spesa'] }))
    db = saveTransaction(db, base({ id: 'b', tags: ['lidl'] }))
    db = saveTransaction(db, base({ id: 'c', tags: ['viaggio'] }))
    expect(allTags(db)).toEqual(['lidl', 'spesa', 'viaggio'])
    const f = (q: string) => filterTransactions(db, { from: new Date('2026-11-01'), to: new Date('2026-12-01'), scope: 'all', accountId: 'all', q, me: null }).length
    expect(f('lidl')).toBe(2)
    expect(f('#viaggio')).toBe(1)
    expect(f('inesistente')).toBe(0)
    expect(parseDb(JSON.parse(JSON.stringify(db))).transactions.find((t) => t.id === 'a')!.tags).toEqual(['lidl', 'spesa'])
  })
})

describe('andamento della liquidità', () => {
  it('liquidità a fine mese, trasferimenti compresi, mesi futuri vuoti', () => {
    let db = family3()
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-cash' ? { ...a, initialBalance: 10000 } : a)) }
    const at = (iso: string, over: Partial<Transaction>) => base({ date: iso, ...over })
    db = saveTransaction(db, at('2025-12-20T10:00:00.000Z', { id: 'prev', type: 'income', amount: 5000 }))      // prima dell'anno: finisce nel saldo iniziale
    db = saveTransaction(db, at('2026-01-15T10:00:00.000Z', { id: 'j', type: 'expense', amount: 2000 }))        // gennaio -20
    db = saveTransaction(db, at('2026-03-05T10:00:00.000Z', { id: 'm', type: 'income', amount: 7000 }))         // marzo +70
    db = saveTransaction(db, at('2026-03-20T10:00:00.000Z', { id: 't1', type: 'transfer', amount: 1000, toAccountId: 'acc-shared', categoryId: null })) // tra conti contati: netto 0
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-shared' ? { ...a, excludeFromTotal: true } : a)) }                                // ...ma se è escluso, esce dalla liquidità
    const s = liquiditySeries(db, 2026, null, new Date('2026-05-10T12:00:00.000Z'))
    expect(s.start).toBe(15000)
    // 15.000 a inizio anno; gen −20 → 13.000; mar +70 e −10 verso il conto escluso → 19.000; aprile e maggio invariati; poi mesi futuri
    expect(s.points.map((p) => p.value)).toEqual([13000, 13000, 19000, 19000, 19000, null, null, null, null, null, null, null])
    expect(s.points[11].value).toBeNull()
  })
  it('un anno passato ha tutti i dodici mesi; non conta ciò che non vedo', () => {
    let db = family3()
    db = saveTransaction(db, base({ id: 'x', accountId: 'acc-m3', type: 'income', amount: 9000, date: '2024-06-10T10:00:00.000Z' }))
    const all = liquiditySeries(db, 2024, null, new Date('2026-05-10'))
    expect(all.points.every((p) => p.value !== null)).toBe(true)
    expect(all.points[11].value).toBe(9000)
    expect(liquiditySeries(db, 2024, 'm2', new Date('2026-05-10')).points[11].value).toBe(0) // il conto di m3 non è di m2
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

describe('Conto Split', () => {
  const withSplit = (db: Db, id: string): Db => saveAccount(db, { ...db.accounts.find((a) => a.id === id)!, splitAccount: true })
  it('il saldo è sempre zero, anche con saldo iniziale e spese', () => {
    let db = family3()
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-m2' ? { ...a, initialBalance: 5000 } : a)) }
    db = withSplit(db, 'acc-m2')
    db = saveTransaction(db, base({ accountId: 'acc-m2', amount: 3000, paidBy: 'm2', participants: ['m1', 'm2'] }))
    db = saveTransaction(db, base({ type: 'income', accountId: 'acc-m2', amount: 700 }))
    expect(accountBalances(db)['acc-m2']).toBe(0)
    expect(totalLiquidity(db, accountBalances(db))).toBe(totalLiquidity({ ...db, accounts: db.accounts.filter((a) => a.id !== 'acc-m2') }, accountBalances(db)))
  })
  it('uno solo per membro: impostarlo su un altro conto lo toglie dal primo', () => {
    let db = family3()
    db = saveAccount(db, { ...acc('acc-m2b', ['m2']), splitAccount: true })
    db = withSplit(db, 'acc-m2')
    expect(db.accounts.filter((a) => a.splitAccount).map((a) => a.id)).toEqual(['acc-m2'])
    expect(splitAccountOf(db, 'm2')?.id).toBe('acc-m2')
  })
  it('solo i conti personali: su un conto condiviso il flag cade', () => {
    const db = withSplit(family3(), 'acc-duo')
    expect(db.accounts.find((a) => a.id === 'acc-duo')?.splitAccount).toBeUndefined()
  })
  it('il flag sopravvive a lettura e salvataggio del file', () => {
    const db = withSplit(family3(), 'acc-m3')
    expect(parseDb(JSON.parse(JSON.stringify(db))).accounts.find((a) => a.id === 'acc-m3')?.splitAccount).toBe(true)
  })
})
