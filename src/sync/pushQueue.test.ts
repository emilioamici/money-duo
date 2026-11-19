import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_AGE_MS, enqueue, flushQueue, loadQueue, type QueuedPush } from './pushQueue'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
})

const NOW = 1_800_000_000_000
const item = (over: Partial<QueuedPush> = {}): QueuedPush => ({
  key: 'tx:1:t|anna@example.com', fileId: 'F', email: 'anna@example.com', title: 'Emilio ha aggiunto una spesa', body: '10,00 €', tag: 'tx:1:t', at: NOW, txId: '1', ...over,
})
const all = (_q: QueuedPush) => true

describe('coda delle notifiche push', () => {
  it('si accoda senza doppioni e resta dopo un riavvio (è salvata)', () => {
    enqueue([item(), item(), item({ key: 'tx:1:t|luca@example.com', email: 'luca@example.com' })])
    enqueue([item()])
    expect(loadQueue().map((q) => q.email)).toEqual(['anna@example.com', 'luca@example.com'])
  })

  it('invia tutto e svuota la coda', async () => {
    enqueue([item(), item({ key: 'b', email: 'luca@example.com' })])
    const sent: string[] = []
    const r = await flushQueue({ fileId: 'F', exists: all, now: NOW, send: async (q) => { sent.push(q.email); return 'ok' } })
    expect(r).toEqual({ sent: 2, dropped: 0, left: 0 })
    expect(sent).toEqual(['anna@example.com', 'luca@example.com'])
    expect(loadQueue()).toEqual([])
  })

  it('rete o server in errore: tiene la voce e le successive, e si ferma (non insiste)', async () => {
    enqueue([item({ key: 'a' }), item({ key: 'b' }), item({ key: 'c' })])
    let calls = 0
    const r = await flushQueue({ fileId: 'F', exists: all, now: NOW, send: async (q) => { calls++; return q.key === 'b' ? 'retry' : 'ok' } })
    expect(calls).toBe(2)
    expect(r).toEqual({ sent: 1, dropped: 0, left: 2 })
    expect(loadQueue().map((q) => q.key)).toEqual(['b', 'c'])
    // al ciclo dopo va a buon fine
    const r2 = await flushQueue({ fileId: 'F', exists: all, now: NOW, send: async () => 'ok' })
    expect(r2).toEqual({ sent: 2, dropped: 0, left: 0 })
  })

  it('errore definitivo: la voce si scarta e si prosegue con le altre', async () => {
    enqueue([item({ key: 'a' }), item({ key: 'b' })])
    const r = await flushQueue({ fileId: 'F', exists: all, now: NOW, send: async (q) => (q.key === 'a' ? 'drop' : 'ok') })
    expect(r).toEqual({ sent: 1, dropped: 1, left: 0 })
  })

  it('scarta le voci vecchie di oltre 24 ore, di un altro database o riferite a elementi eliminati', async () => {
    enqueue([
      item({ key: 'vecchia', at: NOW - MAX_AGE_MS - 1 }),
      item({ key: 'altro-db', fileId: 'G' }),
      item({ key: 'eliminata', txId: 'cancellata' }),
      item({ key: 'valida', txId: '1' }),
    ])
    const sent: string[] = []
    const r = await flushQueue({ fileId: 'F', now: NOW, exists: (q) => q.txId !== 'cancellata', send: async (q) => { sent.push(q.key); return 'ok' } })
    expect(sent).toEqual(['valida'])
    expect(r).toEqual({ sent: 1, dropped: 3, left: 0 })
  })

  it('due svuotamenti insieme non inviano due volte', async () => {
    enqueue([item()])
    let calls = 0
    const send = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'ok' as const }
    const [a, b] = await Promise.all([flushQueue({ fileId: 'F', exists: all, now: NOW, send }), flushQueue({ fileId: 'F', exists: all, now: NOW, send })])
    expect(calls).toBe(1)
    expect(a.sent + b.sent).toBe(1)
  })

  it('al massimo 100 voci', () => {
    enqueue(Array.from({ length: 130 }, (_, i) => item({ key: 'k' + i })))
    expect(loadQueue()).toHaveLength(100)
    expect(loadQueue()[99].key).toBe('k129')
  })
})
