import { describe, expect, it } from 'vitest'
import { createDefaultDb } from './defaults'
import { favoriteForMerchant, merchantsOf, removeMerchant, setMerchantFavorite, approveTransaction, isWalletTx, walletNotifications, cardAccount, cardsOf, importWallet, pendingCount, removeCard, setCardAccount, walletTxId, type WalletItem } from './wallet'
import { deleteTransaction, saveAccount } from './mutations'
import { parseDb } from './merge'
import type { Account, Db, Favorite, Member } from '../types'

const NOW = '2026-05-01T10:00:00.000Z'
const emilio: Member = { id: 'a', name: 'Emilio', email: 'e@x.it', color: '#000', active: true, joinedAt: NOW, updatedAt: NOW }
const acc = (id: string, name: string, members: string[], extra: Partial<Account> = {}): Account =>
  ({ id, name, group: 'card', members, initialBalance: 0, excludeFromTotal: false, hidden: false, order: 0, createdAt: NOW, updatedAt: NOW, ...extra })
const base = (): Db => {
  let db: Db = { ...createDefaultDb(), accounts: [], transactions: [], members: [emilio, { ...emilio, id: 'b', name: 'Sara', email: 's@x.it' }] }
  db = saveAccount(db, acc('visa', 'Visa Emilio', ['a'], { order: 0 }))
  db = saveAccount(db, acc('casa', 'Cassa Famiglia', [], { order: 1 }))
  db = saveAccount(db, acc('sara', 'Visa Sara', ['b'], { order: 2 }))
  return db
}
const item = (over: Partial<WalletItem> = {}): WalletItem => ({ id: 'x1', amount: 1250, merchant: 'Esselunga', card: 'Visa Emilio', at: NOW, ...over })

describe('Apple Wallet: associazione carta → conto', () => {
  it('senza associazione nessun conto, anche se il nome somiglia', () => {
    expect(cardAccount(base(), 'a', 'Visa Emilio')).toBeNull()
  })
  it('con l\'associazione: nome della carta senza badare a maiuscole e punteggiatura', () => {
    const db = setCardAccount(base(), 'a', 'Visa •••• 1234', 'visa', NOW)
    expect(cardAccount(db, 'a', 'VISA 1234')?.id).toBe('visa')
    expect(cardAccount(db, 'b', 'Visa 1234')).toBeNull() // l'associazione è di chi l'ha fatta
  })
  it('non usa conti degli altri né nascosti', () => {
    const db = setCardAccount(base(), 'a', 'Visa 1', 'sara', NOW)
    expect(cardAccount(db, 'a', 'Visa 1')).toBeNull()
    const db2 = setCardAccount(base(), 'a', 'Visa 1', 'visa', NOW)
    expect(cardAccount(saveAccount(db2, { ...db2.accounts[0], hidden: true }), 'a', 'Visa 1')).toBeNull()
  })
})

describe('Apple Wallet: notifiche', () => {
  it('una per spesa, con esercente e importo; «da completare» se la carta non è associata', () => {
    const db = importWallet(setCardAccount(base(), 'a', 'Visa Emilio', 'visa', NOW), emilio, [item(), item({ id: 'x2', card: 'Revolut', merchant: 'Bar' })], undefined, NOW)
    const n = walletNotifications(db.transactions, NOW)
    expect(n).toHaveLength(2)
    expect(n[0]).toMatchObject({ kind: 'wallet', id: 'wallet:w-x1', txId: 'w-x1', title: 'Spesa da Wallet da approvare' })
    expect(n[0].body).toContain('Esselunga'); expect(n[0].body).toContain('12,50')
    expect(n[1].title).toBe('Spesa da Wallet da completare')
  })
  it('oltre 3 spese un solo riepilogo; nessuna spesa nessuna notifica', () => {
    const db = importWallet(base(), emilio, [1, 2, 3, 4].map((i) => item({ id: 'y' + i })), undefined, NOW)
    expect(walletNotifications(db.transactions, NOW)).toHaveLength(1)
    expect(walletNotifications(db.transactions, NOW)[0].title).toBe('4 spese da Wallet da approvare')
    expect(walletNotifications([], NOW)).toEqual([])
  })
})

describe('Apple Wallet: importazione', () => {
  it('crea un\'uscita senza categoria, da approvare, sul conto associato alla carta', () => {
    const db = importWallet(setCardAccount(base(), 'a', 'Visa Emilio', 'visa', NOW), emilio, [item()], undefined, NOW)
    const x = db.transactions[0]
    expect(x).toMatchObject({ id: walletTxId(item()), type: 'expense', amount: 1250, accountId: 'visa', categoryId: null, title: 'Esselunga', pending: 'approve', paidBy: 'a', participants: [], by: 'a' })
    expect(pendingCount(db, 'a')).toBe(1)
  })
  it('prima volta: la carta entra nell\'elenco «da associare» e la spesa è «da completare» sul conto personale', () => {
    const db = importWallet(base(), emilio, [item(), item({ id: 'x2' })], undefined, NOW)
    expect(db.transactions[0]).toMatchObject({ accountId: 'visa', pending: 'complete', walletCard: 'Visa Emilio' })
    expect(db.transactions[0].note).toContain('Visa Emilio')
    expect(cardsOf(db, 'a')).toEqual([{ name: 'Visa Emilio', accountId: null }]) // una sola volta, anche con due spese
  })
  it('associando la carta, le spese «da completare» passano al conto scelto e diventano «da approvare»', () => {
    let db = importWallet(base(), emilio, [item()], undefined, NOW)
    db = setCardAccount(db, 'a', 'visa emilio', 'casa', NOW)
    expect(db.transactions[0]).toMatchObject({ accountId: 'casa', pending: 'approve', paidBy: null, note: '' })
    expect(cardsOf(db, 'a')).toEqual([{ name: 'Visa Emilio', accountId: 'casa' }])
    // le spese successive vanno direttamente lì
    expect(importWallet(db, emilio, [item({ id: 'x9' })], undefined, NOW).transactions[1]).toMatchObject({ accountId: 'casa', pending: 'approve' })
  })
  it('togliere la carta la rimette «da associare» alla spesa successiva', () => {
    let db = setCardAccount(base(), 'a', 'Visa Emilio', 'visa', NOW)
    db = removeCard(db, 'a', 'Visa Emilio', NOW)
    expect(cardsOf(db, 'a')).toEqual([])
    expect(importWallet(db, emilio, [item()], undefined, NOW).transactions[0].pending).toBe('complete')
  })
  it('non duplica: stessa spesa due volte, né dopo averla eliminata', () => {
    let db = importWallet(base(), emilio, [item()], undefined, NOW)
    expect(importWallet(db, emilio, [item()], undefined, NOW)).toBe(db)
    db = deleteTransaction(db, walletTxId(item()))
    expect(importWallet(db, emilio, [item()], undefined, NOW).transactions).toHaveLength(0)
  })
  it('una spesa di Wallet si riconosce sempre, anche dopo l\'approvazione; una normale no', () => {
    const db = importWallet(base(), emilio, [item()], undefined, NOW)
    expect(isWalletTx(db.transactions[0])).toBe(true)
    expect(isWalletTx(approveTransaction(db, walletTxId(item()), NOW).transactions[0])).toBe(true)
    expect(isWalletTx({ id: 'abc123' })).toBe(false)
  })
  it('approvare toglie il segno; il salvataggio dal modulo (record nuovo senza pending) fa lo stesso', () => {
    const db = importWallet(base(), emilio, [item()], undefined, NOW)
    const ok = approveTransaction(db, walletTxId(item()), NOW)
    expect(ok.transactions[0].pending).toBeNull(); expect(pendingCount(ok, 'a')).toBe(0)
  })
  it('il segno sopravvive a salvataggio e rilettura del file', () => {
    const db = importWallet(base(), emilio, [item({ card: 'Revolut' })], undefined, NOW)
    const back = parseDb(JSON.parse(JSON.stringify(db)))
    expect(back.transactions[0]).toMatchObject({ pending: 'complete', walletCard: 'Revolut' })
    expect(cardsOf(back, 'a')).toEqual([{ name: 'Revolut', accountId: null }])
    expect(parseDb(JSON.parse(JSON.stringify(approveTransaction(db, walletTxId(item({ card: 'Revolut' })), NOW)))).transactions[0].pending).toBeUndefined()
  })
})

const fav = (over: Partial<Favorite> = {}): Favorite => ({
  id: 'f1', by: 'a', type: 'expense', amount: 3000, accountId: 'casa', toAccountId: null, categoryId: 'cat-spesa', title: 'Spesa settimanale', note: 'dal preferito',
  paidBy: null, participants: ['a', 'b'], splitMode: 'equal', splitValues: null, payments: null, tags: ['casa'], createdAt: NOW, updatedAt: NOW, ...over,
})
const withFav = (f = fav()): Db => ({ ...base(), favorites: [f] })

describe('Apple Wallet: esercenti legati a un preferito', () => {
  it('ogni esercente nuovo entra nell\'elenco, una sola volta', () => {
    const db = importWallet(base(), emilio, [item(), item({ id: 'x2', merchant: 'ESSELUNGA' }), item({ id: 'x3', merchant: 'Bar' })], undefined, NOW)
    expect(merchantsOf(db, 'a')).toEqual([{ name: 'Esselunga', favoriteId: null }, { name: 'Bar', favoriteId: null }])
  })
  it('esercente legato: la spesa è come il preferito con l\'importo di Wallet, e già approvata', () => {
    const db = setMerchantFavorite(withFav(), 'a', 'Esselunga', 'f1', NOW)
    const out = importWallet(db, emilio, [item({ amount: 4250 })], undefined, NOW)
    expect(out.transactions[0]).toMatchObject({
      id: 'w-x1', type: 'expense', amount: 4250, date: NOW, accountId: 'casa', categoryId: 'cat-spesa', title: 'Spesa settimanale', note: 'dal preferito',
      participants: ['a', 'b'], tags: ['casa'], pending: null, walletCard: 'Visa Emilio', by: 'a',
    })
    expect(isWalletTx(out.transactions[0])).toBe(true) // il simbolo di Wallet resta
    expect(pendingCount(out, 'a')).toBe(0)
  })
  it('collegando un esercente, le sue spese ancora da approvare passano al preferito e si approvano', () => {
    let db = importWallet(withFav(), emilio, [item({ amount: 999, id: 'p1' }), item({ id: 'p2', merchant: 'Bar' })], undefined, NOW)
    expect(pendingCount(db, 'a')).toBe(2)
    db = setMerchantFavorite(db, 'a', 'esselunga', 'f1', NOW)
    const x = db.transactions.find((t) => t.id === 'w-p1')!
    expect(x).toMatchObject({ amount: 999, accountId: 'casa', title: 'Spesa settimanale', pending: null })
    expect(db.transactions.find((t) => t.id === 'w-p2')!.pending).toBeTruthy() // l'altro esercente non cambia
  })
  it('un preferito cancellato, con importi per persona o con conti non più usabili si ignora (spesa da approvare)', () => {
    const linked = (f: Favorite) => setMerchantFavorite(withFav(f), 'a', 'Esselunga', 'f1', NOW)
    expect(favoriteForMerchant(linked(fav({ splitMode: 'amount' })), 'a', 'Esselunga')).toBeNull()
    expect(favoriteForMerchant(linked(fav({ accountId: 'sara' })), 'a', 'Esselunga')).toBeNull() // conto di un altro
    const gone = { ...linked(fav()), favorites: [] }
    expect(importWallet(gone, emilio, [item()], undefined, NOW).transactions[0].pending).toBeTruthy()
  })
  it('togliere il legame o l\'esercente riporta tutto come prima', () => {
    let db = setMerchantFavorite(withFav(), 'a', 'Esselunga', 'f1', NOW)
    db = setMerchantFavorite(db, 'a', 'Esselunga', null, NOW)
    expect(importWallet(db, emilio, [item()], undefined, NOW).transactions[0].pending).toBeTruthy()
    expect(merchantsOf(removeMerchant(db, 'a', 'Esselunga', NOW), 'a')).toEqual([])
  })
  it('le notifiche dicono «aggiunta» se è già approvata', () => {
    const db = importWallet(setMerchantFavorite(withFav(), 'a', 'Esselunga', 'f1', NOW), emilio, [item()], undefined, NOW)
    expect(walletNotifications(db.transactions, NOW)[0].title).toBe('Spesa da Wallet aggiunta')
  })
  it('il legame sopravvive a salvataggio e rilettura del file', () => {
    const db = setMerchantFavorite(withFav(), 'a', 'Esselunga', 'f1', NOW)
    expect(merchantsOf(parseDb(JSON.parse(JSON.stringify(db))), 'a')).toEqual([{ name: 'Esselunga', favoriteId: 'f1' }])
  })
})
