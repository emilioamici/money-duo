import { describe, expect, it } from 'vitest'
import { createFamilyDb } from './defaults'
import { titleSuggestions } from './calc'
import { mergeDb, parseDb, replaceData } from './merge'
import { addFavorite, copyOf, deleteFavorite, findFavorite, saveTransaction } from './mutations'
import type { Db, Transaction } from '../types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't' + Math.random(), type: 'expense', amount: 1250, date: '2026-01-05T10:00:00.000Z', accountId: 'acc-cash', toAccountId: null, categoryId: 'cat-food',
  title: 'Spesa Lidl', note: 'n', paidBy: null, participants: [], splitMode: 'equal', splitValues: null, payments: null, tags: ['casa'],
  by: 'm1', createdAt: '2026-01-05T10:00:00.000Z', updatedAt: '2026-01-05T10:00:00.000Z', ...over,
})
const withTx = (list: Transaction[]): Db => list.reduce((d, t) => saveTransaction(d, t), createFamilyDb('Rossi', { name: 'Marco', email: 'marco@example.com' }))

describe('copia transazione', () => {
  it('stessi dati, data di adesso, niente id né autore', () => {
    const before = Date.now()
    const c = copyOf(tx({ amount: 999, title: 'Cena', participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 6000, m2: 4000 }, tags: ['x'] }))
    expect(c.id).toBeUndefined()
    expect(c.by).toBeUndefined()
    expect(c).toMatchObject({ amount: 999, title: 'Cena', participants: ['m1', 'm2'], splitMode: 'percent', splitValues: { m1: 6000, m2: 4000 }, tags: ['x'] })
    expect(new Date(c.date!).getTime()).toBeGreaterThanOrEqual(before)
  })
  it('è una copia vera: modificarla non cambia l\'originale', () => {
    const o = tx({ tags: ['a'], participants: ['m1'] })
    const c = copyOf(o)
    c.tags!.push('b'); c.participants!.push('m2')
    expect(o.tags).toEqual(['a']); expect(o.participants).toEqual(['m1'])
  })
})

describe('preferiti', () => {
  it('si aggiungono una volta sola per modello e si tolgono con una tombstone', () => {
    const t = tx()
    let db = withTx([t])
    db = addFavorite(db, t, 'm1')
    db = addFavorite(db, t, 'm1')
    expect(db.favorites).toHaveLength(1)
    expect(db.favorites[0]).toMatchObject({ by: 'm1', title: 'Spesa Lidl', amount: 1250 })
    expect(findFavorite(db, t, 'm1')).toBeTruthy()
    expect(findFavorite(db, t, 'm2')).toBeUndefined()           // i preferiti sono personali
    db = deleteFavorite(db, db.favorites[0].id)
    expect(db.favorites).toHaveLength(0)
    expect(Object.keys(db.deleted)).toHaveLength(1)
  })
  it('un altro membro può avere lo stesso preferito', () => {
    const t = tx()
    let db = addFavorite(withTx([t]), t, 'm1')
    db = addFavorite(db, t, 'm2')
    expect(db.favorites.map((f) => f.by)).toEqual(['m1', 'm2'])
  })
  it('merge tra dispositivi: si uniscono, e l\'eliminazione più recente vince', () => {
    const t = tx()
    const base = withTx([t])
    const a = addFavorite(base, t, 'm1')
    const b = addFavorite(base, tx({ title: 'Altro' }), 'm2')
    expect(mergeDb(a, b).favorites).toHaveLength(2)
    const removed = deleteFavorite(a, a.favorites[0].id)
    expect(mergeDb(removed, a).favorites).toHaveLength(0)
    expect(mergeDb(a, removed).favorites).toHaveLength(0)
  })
  it('un file senza preferiti (versione precedente) si legge senza errori', () => {
    const { favorites: _f, ...old } = createFamilyDb('Rossi', { name: 'Marco', email: 'marco@example.com' })
    expect(parseDb(JSON.parse(JSON.stringify(old))).favorites).toEqual([])
  })
  it('sopravvivono a salvataggio e rilettura; una sostituzione completa senza preferiti li elimina con tombstone', () => {
    const t = tx()
    const db = addFavorite(withTx([t]), t, 'm1')
    expect(parseDb(JSON.parse(JSON.stringify(db))).favorites).toHaveLength(1)
    const next = replaceData(db, { ...db, favorites: [] })
    expect(next.favorites).toHaveLength(0)
    expect(next.deleted[db.favorites[0].id]).toBeTruthy()
  })
})

describe('proposte di titoli', () => {
  const db = withTx([
    tx({ title: 'Spesa Lidl', date: '2026-01-01T00:00:00.000Z' }), tx({ title: 'spesa lidl', date: '2026-02-01T00:00:00.000Z' }), tx({ title: 'Spesa Coop' }),
    tx({ title: 'Cena da Pino' }), tx({ title: 'Pizza' }), tx({ title: 'Lidl colazione' }), tx({ title: '' }),
  ])
  it('niente testo, niente proposte', () => { expect(titleSuggestions(db, '')).toEqual([]); expect(titleSuggestions(db, '  ')).toEqual([]) })
  it('prima chi inizia con il testo, poi chi lo contiene; senza doppioni tra maiuscole e minuscole', () => {
    expect(titleSuggestions(db, 'spe')).toEqual(['spesa lidl', 'Spesa Coop'])
    expect(titleSuggestions(db, 'lid')).toEqual(['Lidl colazione', 'spesa lidl'])
  })
  it('non propone il titolo già scritto per intero e rispetta il limite', () => {
    expect(titleSuggestions(db, 'pizza')).toEqual([])
    expect(titleSuggestions(db, 'a', 2)).toHaveLength(2)
  })
})

import { countFilters, emptyFilters, filterTransactions } from './calc'
describe('filtri avanzati', () => {
  const db0 = createFamilyDb('Rossi', { name: 'Marco', email: 'marco@example.com' })
  const me = db0.members[0].id
  const cat = db0.categories.find((c) => !c.parentId && c.type === 'expense')!
  const kid = { ...cat, id: 'kid', parentId: cat.id, name: 'Figlia' }
  const other = db0.categories.find((c) => !c.parentId && c.type === 'expense' && c.id !== cat.id)!
  const db = [
    tx({ id: 'a', amount: 500, categoryId: cat.id, tags: ['casa'], title: 'a' }),
    tx({ id: 'b', amount: 2000, categoryId: 'kid', tags: ['Vacanza'], title: 'b' }),
    tx({ id: 'c', amount: 8000, categoryId: other.id, tags: [], title: 'c', type: 'income' }),
    tx({ id: 'd', amount: 3000, categoryId: null, type: 'transfer', accountId: 'acc-cash', toAccountId: 'acc-shared', tags: [], title: 'd' }),
    tx({ id: 'e', amount: 4000, categoryId: other.id, participants: [me, 'm2'], paidBy: me, tags: [], title: 'e' }),
  ].reduce((d, t) => saveTransaction(d, t), { ...db0, categories: [...db0.categories, kid] })
  const base = { from: new Date('2025-01-01'), to: new Date('2027-01-01'), scope: 'all' as const, accountId: 'all', q: '', me }
  const ids = (adv: Partial<ReturnType<typeof emptyFilters>>) => filterTransactions(db, { ...base, adv: { ...emptyFilters(), ...adv } }).map((t) => t.id).sort().join('')

  it('senza criteri non filtra nulla e non conta nulla', () => { expect(ids({})).toBe('abcde'); expect(countFilters(emptyFilters())).toBe(0) })
  it('per tipo', () => { expect(ids({ types: ['income'] })).toBe('c'); expect(ids({ types: ['income', 'transfer'] })).toBe('cd') })
  it('per importo: minimo e massimo inclusi', () => { expect(ids({ min: 2000, max: 4000 })).toBe('bde'); expect(ids({ min: 5000 })).toBe('c'); expect(ids({ max: 500 })).toBe('a') })
  it('per categoria: la principale include le sottocategorie; i trasferimenti non hanno categoria', () => {
    expect(ids({ categoryIds: [cat.id] })).toBe('ab')
    expect(ids({ categoryIds: ['kid'] })).toBe('b')
    expect(ids({ categoryIds: [other.id] })).toBe('ce')
  })
  it('per tag, senza badare alle maiuscole', () => { expect(ids({ tags: ['vacanza'] })).toBe('b'); expect(ids({ tags: ['casa', 'vacanza'] })).toBe('ab') })
  it('per conto: anche il conto di destinazione di un trasferimento', () => { expect(ids({ accountIds: ['acc-shared'] })).toBe('d') })
  it('solo spese condivise', () => { expect(ids({ splitOnly: true })).toBe('e') })
  it('i criteri si combinano', () => { expect(ids({ types: ['expense'], min: 3000 })).toBe('e'); expect(countFilters({ ...emptyFilters(), types: ['expense'], min: 1, splitOnly: true })).toBe(3) })
})

import { debtTone, headlineDebt } from './calc'
describe('saldo in evidenza', () => {
  const d = (debtor: string, creditor: string, amount: number) => ({ debtor, creditor, amount })
  it('verde se mi devono, rosso se devo, neutro se non mi riguarda', () => {
    expect(debtTone(d('b', 'a', 100), 'a')).toBe('credit')
    expect(debtTone(d('a', 'b', 100), 'a')).toBe('debit')
    expect(debtTone(d('b', 'c', 100), 'a')).toBe('neutral')
    expect(debtTone(d('a', 'b', 100), null)).toBe('neutral')
  })
  it('nessun saldo = tutto in ordine', () => { expect(headlineDebt([], 'a')).toBeNull() })
  it('in evidenza il saldo più grande tra quelli che mi riguardano, altrimenti il più grande', () => {
    const list = [d('b', 'c', 900), d('a', 'b', 50), d('c', 'a', 30)]
    expect(headlineDebt(list, 'a')).toEqual({ debt: d('a', 'b', 50), tone: 'debit' })
    expect(headlineDebt(list, 'z')).toEqual({ debt: d('b', 'c', 900), tone: 'neutral' })
    expect(headlineDebt(list, null)?.debt.amount).toBe(900)
  })
})

import { applyLang } from '../i18n'
import { centsToInput, formatMoney, parseAmount } from './format'
describe('formati in inglese', () => {
  it('importi: punto decimale, virgola per le migliaia', () => {
    applyLang('en')
    try {
      expect(formatMoney(123456)).toBe('€1,234.56')
      expect(centsToInput(1250)).toBe('12.50')
      expect(centsToInput(1000)).toBe('10')
      expect(parseAmount('1,234.56')).toBe(123456)
      expect(parseAmount('12.5')).toBe(1250)
      expect(parseAmount('1,234')).toBe(123400)        // in inglese la virgola con tre cifre = migliaia
      expect(parseAmount('12,50')).toBe(1250)          // virgola con due cifre = decimali anche in inglese
    } finally { applyLang('it') }
  })
  it('in italiano resta come prima', () => {
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('12,5')).toBe(1250)
    expect(parseAmount('1,234')).toBe(123)               // italiano: la virgola è sempre decimale
    expect(centsToInput(1250)).toBe('12,50')
  })
})
