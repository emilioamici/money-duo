import { describe, expect, it } from 'vitest'
import { createDefaultDb } from './defaults'
import { approveTransaction, importWallet, matchAccount, pendingCount, walletTxId, type WalletItem } from './wallet'
import { deleteTransaction, saveAccount } from './mutations'
import { parseDb } from './merge'
import type { Account, Db, Member } from '../types'

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

describe('Apple Wallet: abbinamento del conto', () => {
  it('nome uguale o contenuto, ignorando maiuscole e accenti', () => {
    const db = base()
    expect(matchAccount(db, 'a', 'visa emilio')?.id).toBe('visa')
    expect(matchAccount(db, 'a', 'Visa')?.id).toBe('visa')
    expect(matchAccount(db, 'a', 'Cassa')?.id).toBe('casa')
  })
  it('non usa i conti degli altri né quelli nascosti, e non abbina nomi troppo corti', () => {
    const db = base()
    expect(matchAccount(db, 'a', 'Visa Sara')?.id).not.toBe('sara')
    expect(matchAccount(db, 'a', 'XY')).toBeNull()
    expect(matchAccount(saveAccount(db, { ...db.accounts[0], hidden: true }), 'a', 'Visa Emilio')).toBeNull()
  })
})

describe('Apple Wallet: importazione', () => {
  it('crea un\'uscita senza categoria, da approvare, sul conto riconosciuto', () => {
    const db = importWallet(base(), emilio, [item()], undefined, NOW)
    const x = db.transactions[0]
    expect(x).toMatchObject({ id: walletTxId(item()), type: 'expense', amount: 1250, accountId: 'visa', categoryId: null, title: 'Esselunga', pending: 'approve', paidBy: 'a', participants: [], by: 'a' })
    expect(pendingCount(db, 'a')).toBe(1)
  })
  it('conto non riconosciuto: usa quello personale e segna «da completare» con la carta nelle note', () => {
    const db = importWallet(base(), emilio, [item({ card: 'Revolut' })], undefined, NOW)
    expect(db.transactions[0]).toMatchObject({ accountId: 'visa', pending: 'complete', walletCard: 'Revolut' })
    expect(db.transactions[0].note).toContain('Revolut')
  })
  it('non duplica: stessa spesa due volte, né dopo averla eliminata', () => {
    let db = importWallet(base(), emilio, [item()], undefined, NOW)
    expect(importWallet(db, emilio, [item()], undefined, NOW)).toBe(db)
    db = deleteTransaction(db, walletTxId(item()))
    expect(importWallet(db, emilio, [item()], undefined, NOW).transactions).toHaveLength(0)
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
    expect(parseDb(JSON.parse(JSON.stringify(approveTransaction(db, walletTxId(item({ card: 'Revolut' })), NOW)))).transactions[0].pending).toBeUndefined()
  })
})
