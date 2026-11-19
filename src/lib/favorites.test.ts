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
