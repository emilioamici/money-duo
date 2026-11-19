import { describe, expect, it } from 'vitest'
import { createDefaultDb } from './defaults'
import { accountBalances, coupleBalance, totalLiquidity, categoryBreakdown } from './calc'
import { mergeDb, parseDb, replaceData, sameData } from './merge'
import { deleteCategory, deleteTransaction, saveAccount, saveProfiles, saveTransaction, setCategoryHidden } from './mutations'
import { parseAmount } from './format'
import type { Transaction } from '../types'

const base = (over: Partial<Transaction>): Transaction => ({
  id: 't' + Math.random(), type: 'expense', amount: 1000, date: '2026-11-10T10:00:00.000Z', accountId: 'acc-cash', toAccountId: null,
  categoryId: 'cat-food', title: '', note: '', paidBy: 'a', split: 'personal', createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z', ...over,
})

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
  it('calcola entrate, uscite e giroconti; esclude conti dal totale', () => {
    let db = createDefaultDb()
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
    let db = createDefaultDb()
    db = saveTransaction(db, base({ id: '1', amount: 700 }))
    db = { ...db, accounts: db.accounts.map((a) => (a.id === 'acc-cash' ? { ...a, hidden: true } : a)) }
    expect(accountBalances(db)['acc-cash']).toBe(-700)
  })
})

describe('bilancio di coppia', () => {
  it('50/50, anticipata, personale, comune e rimborso', () => {
    let db = createDefaultDb()
    db = { ...db, accounts: [...db.accounts, { ...db.accounts[0], id: 'acc-b', owner: 'b', name: 'B' }] }
    const t = [
      base({ amount: 1000, paidBy: 'a', split: 'equal' }), // B deve 500
      base({ amount: 2000, paidBy: 'a', split: 'advance' }), // B deve 2000
      base({ amount: 900, paidBy: 'b', split: 'equal' }), // A deve 450
      base({ amount: 5000, paidBy: 'a', split: 'personal' }),
      base({ amount: 5000, paidBy: 'shared', split: 'equal' }),
    ]
    expect(coupleBalance(db, t)).toBe(500 + 2000 - 450)
    const rimborso = base({ type: 'transfer', amount: 2050, accountId: 'acc-b', toAccountId: 'acc-cash', categoryId: null })
    expect(coupleBalance(db, [...t, rimborso])).toBe(0)
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

describe('merge', () => {
  it('unisce modifiche concorrenti senza perdere dati', async () => {
    const start = createDefaultDb()
    let local = saveTransaction(start, base({ id: 'x', amount: 100 }))
    let remote = saveTransaction(start, base({ id: 'y', amount: 200 }))
    const merged = mergeDb(local, remote)
    expect(merged.transactions.map((t) => t.id).sort()).toEqual(['x', 'y'])
    expect(mergeDb(remote, local).transactions).toHaveLength(2)
    await new Promise((r) => setTimeout(r, 5))
    remote = saveTransaction(merged, { ...merged.transactions.find((t) => t.id === 'x')!, amount: 999 })
    expect(mergeDb(local, remote).transactions.find((t) => t.id === 'x')!.amount).toBe(999)
    await new Promise((r) => setTimeout(r, 5))
    local = deleteTransaction(merged, 'y')
    const again = mergeDb(local, remote)
    expect(again.transactions.map((t) => t.id)).toEqual(['x'])
    expect(sameData(again, mergeDb(remote, local))).toBe(true)
  })
  it('replaceData non resuscita elementi rimossi', () => {
    const cur = saveTransaction(createDefaultDb(), base({ id: 'old' }))
    const incoming = { ...createDefaultDb() }
    const out = replaceData(cur, incoming)
    expect(out.transactions).toHaveLength(0)
    expect(mergeDb(out, cur).transactions).toHaveLength(0)
  })
  it('i dati di esempio di un\'installazione nuova non battono le modifiche reali', async () => {
    const remote0 = createDefaultDb()
    await new Promise((r) => setTimeout(r, 5))
    let remote = saveAccount(remote0, { ...remote0.accounts[0], name: 'Portafoglio', initialBalance: 5000 })
    remote = deleteCategory(remote, 'cat-health')
    remote = saveProfiles(remote, { a: 'Luca', b: 'Anna', shared: 'Casa' })
    await new Promise((r) => setTimeout(r, 5))
    const local = createDefaultDb() // nuova installazione, creata DOPO
    for (const m of [mergeDb(local, remote), mergeDb(remote, local)]) {
      const acc = m.accounts.find((a) => a.id === 'acc-cash')!
      expect(acc.name).toBe('Portafoglio')
      expect(acc.initialBalance).toBe(5000)
      expect(m.categories.some((c) => c.id === 'cat-health')).toBe(false)
      expect(m.profiles.a).toBe('Luca')
    }
  })
  it('parseDb valida', () => {
    expect(() => parseDb({})).toThrow()
    expect(() => parseDb({ schemaVersion: 99, accounts: [], categories: [], transactions: [] })).toThrow()
    expect(parseDb(JSON.parse(JSON.stringify(createDefaultDb()))).accounts).toHaveLength(2)
  })
})
