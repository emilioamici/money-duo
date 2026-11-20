import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/** Carica public/sw.js in un ambiente simulato e restituisce i gestori degli eventi registrati. */
function loadSw(windows: Array<{ visibilityState: string; postMessage: (m: unknown) => void; focus?: () => Promise<void> }>) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const shown: Array<{ title: string; opts: Record<string, unknown> }> = []
  const opened: string[] = []
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
    location: { origin: 'https://utente.github.io' },
    skipWaiting: () => undefined,
    clients: { matchAll: async () => windows, claim: async () => undefined, openWindow: async (u: string) => { opened.push(u) } },
    registration: { showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }) } },
  }
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches: {}, fetch: () => undefined, URL, Promise })
  const push = async (data: unknown, raw = false) => {
    const pending: Promise<unknown>[] = []
    handlers.push({ data: { json: () => { if (raw) throw new Error('non json'); return data }, text: () => String(data) }, waitUntil: (p: Promise<unknown>) => pending.push(p) })
    await Promise.all(pending)
  }
  return { push, shown, opened, handlers }
}

describe('service worker: push', () => {
  it('app in background: mostra la notifica con titolo, testo e tag', async () => {
    const sw = loadSw([{ visibilityState: 'hidden', postMessage: () => undefined }])
    await sw.push({ title: 'Anna ha aggiunto una spesa', body: '45,00 € · Cena', tag: 'tx:1' })
    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0].title).toBe('Anna ha aggiunto una spesa')
    expect(sw.shown[0].opts).toMatchObject({ body: '45,00 € · Cena', tag: 'tx:1', icon: './icon-192.png' })
  })
  it('app chiusa (nessuna finestra): mostra la notifica', async () => {
    const sw = loadSw([])
    await sw.push({ title: 'T', body: 'B' })
    expect(sw.shown).toHaveLength(1)
  })
  it('app in primo piano: nessuna notifica di sistema, avvisa l\'app di sincronizzare', async () => {
    const msgs: unknown[] = []
    const sw = loadSw([{ visibilityState: 'visible', postMessage: (m) => msgs.push(m) }])
    await sw.push({ title: 'T', body: 'B' })
    expect(sw.shown).toHaveLength(0)
    expect(msgs).toEqual([{ type: 'moneyduo-push' }])
  })
  it('messaggio non JSON o vuoto: notifica generica, nessun errore', async () => {
    const sw = loadSw([])
    await sw.push('solo testo', true)
    expect(sw.shown[0].title).toBe('Money Duo')
    expect(sw.shown[0].opts.body).toBe('solo testo')
  })
  it('tocco sulla notifica: porta in primo piano l\'app, o la apre', async () => {
    let focused = 0
    const open = loadSw([{ visibilityState: 'hidden', postMessage: () => undefined, focus: async () => { focused++ } }])
    const closed: boolean[] = []
    const pending: Promise<unknown>[] = []
    open.handlers.notificationclick({ notification: { close: () => closed.push(true) }, waitUntil: (p: Promise<unknown>) => pending.push(p) })
    await Promise.all(pending)
    expect(focused).toBe(1); expect(closed).toEqual([true])
    const none = loadSw([]); const p2: Promise<unknown>[] = []
    none.handlers.notificationclick({ notification: { close: () => undefined }, waitUntil: (p: Promise<unknown>) => p2.push(p) })
    await Promise.all(p2)
    expect(none.opened).toEqual(['./'])
  })
})
