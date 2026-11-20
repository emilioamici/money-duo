import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
let health: Record<string, unknown> = { ok: true, auth: true, bridge: true }
const calls: Array<{ url: string; body?: string }> = []
let registerStatus = 200

beforeEach(() => {
  store.clear(); calls.length = 0; health = { ok: true, auth: true, bridge: true }; registerStatus = 200
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('import', {})
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined })
    if (url.endsWith('/health')) return new Response(JSON.stringify(health))
    if (url.endsWith('/house/register')) return new Response('{}', { status: registerStatus })
    return new Response('{}', { status: 404 })
  })
})

async function load() {
  vi.doMock('./push', () => ({ pushUrl: () => 'https://w.example' }))
  vi.doMock('./auth', () => ({ sessionId: () => store.get('moneyduo:session') ?? '' }))
  return import('./bridge')
}

describe('registrazione della famiglia sul ponte', () => {
  it('solo il proprietario, con accesso persistente e un Worker col ponte', async () => {
    const { ensureRegistered } = await load()
    expect(await ensureRegistered('FILEID12345', 'tok', { owner: true })).toBe(false) // niente sessione persistente
    store.set('moneyduo:session', 'S'.repeat(40))
    expect(await ensureRegistered('FILEID12345', 'tok', { owner: false })).toBe(false) // non è il proprietario
    expect(calls.filter((c) => c.url.endsWith('/house/register'))).toHaveLength(0)
  })

  it('registra, poi aspetta tre giorni; con force subito', async () => {
    const { ensureRegistered } = await load()
    store.set('moneyduo:session', 'S'.repeat(40))
    expect(await ensureRegistered('FILEID12345', 'tok', { owner: true })).toBe(true)
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/house/register'))!.body!)).toEqual({ fileId: 'FILEID12345', session: 'S'.repeat(40) })
    expect(await ensureRegistered('FILEID12345', 'tok', { owner: true })).toBe(false) // già fatto da poco
    expect(await ensureRegistered('FILEID12345', 'tok', { owner: true, force: true })).toBe(true) // dopo un invito
    expect(calls.filter((c) => c.url.endsWith('/house/register'))).toHaveLength(2)
  })

  it('un Worker senza ponte o un rifiuto non registrano nulla e non danno errori', async () => {
    store.set('moneyduo:session', 'S'.repeat(40))
    health = { ok: true, auth: true }
    const old = await load()
    expect(await old.bridgeAvailable()).toBe(false)
    expect(await old.ensureRegistered('FILEID12345', 'tok', { owner: true })).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/house/register'))).toBe(false)
    vi.resetModules(); health = { ok: true, auth: true, bridge: true }; registerStatus = 403
    const refused = await load()
    expect(await refused.ensureRegistered('FILEID12345', 'tok', { owner: true })).toBe(false)
    expect(store.has('moneyduo:bridgeReg:FILEID12345')).toBe(false) // non si segna come fatto: si riprova
  })
})
