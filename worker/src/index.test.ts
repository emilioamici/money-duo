import { createECDH, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type KV } from './index'
import { b64u } from './webpush'

const require = createRequire(import.meta.url)
const ece = require('http_ece') as { decrypt: (body: Buffer, p: Record<string, unknown>) => Buffer }

const ORIGIN = 'https://utente.github.io'
const FILE = 'file_id_1234567890'
class MemKV implements KV {
  data = new Map<string, string>(); writes = 0
  async get(k: string) { return this.data.get(k) ?? null }
  async put(k: string, v: string) { this.writes++; this.data.set(k, v) }
  async delete(k: string) { this.writes++; this.data.delete(k) }
}

function device(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); const auth = randomBytes(16)
  return { ecdh, auth, sub: { endpoint: `https://${host}/send/${randomBytes(4).toString('hex')}`, keys: { p256dh: b64u.enc(ecdh.getPublicKey()), auth: b64u.enc(auth) } } }
}

let env: Env, kv: MemKV
let tokens: Record<string, { email: string; files: string[] }>
let pushed: Array<{ url: string; headers: Record<string, string>; body: Uint8Array }>
let pushStatus: Record<string, number>

beforeEach(async () => {
  kv = new MemKV()
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  env = {
    SUBS: kv, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, VAPID_SUBJECT: 'https://utente.github.io/money-duo/',
    VAPID_PUBLIC_KEY: b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), VAPID_PRIVATE_KEY: ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!,
  }
  tokens = { 'tok-emilio': { email: 'Emilio@Example.com', files: [FILE] }, 'tok-anna': { email: 'anna@example.com', files: [FILE] }, 'tok-estraneo': { email: 'mallory@example.com', files: [] } }
  pushed = []; pushStatus = {}
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
    if (url.startsWith('https://www.googleapis.com/')) {
      const t = tokens[auth.replace('Bearer ', '')]
      if (!t) return new Response('{}', { status: 401 })
      if (url.includes('/about')) return Response.json({ user: { emailAddress: t.email } })
      const id = /files\/([^?]+)/.exec(url)![1]
      return t.files.includes(id) ? Response.json({ id }) : new Response('{}', { status: 404 })
    }
    pushed.push({ url, headers: init!.headers as Record<string, string>, body: init!.body as Uint8Array })
    return new Response(null, { status: pushStatus[url] ?? 201 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const call = (path: string, body: unknown, token = 'tok-emilio', origin = ORIGIN) =>
  worker.fetch(new Request('https://push.example.workers.dev' + path, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env)
const sub = (token: string, d: ReturnType<typeof device>) => call('/subscribe', { fileId: FILE, subscription: d.sub }, token)
const decrypt = (d: ReturnType<typeof device>, body: Uint8Array) => JSON.parse(ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString())

describe('accesso', () => {
  it('health e CORS', async () => {
    expect((await worker.fetch(new Request('https://x/health'), env)).status).toBe(200)
    const pre = await worker.fetch(new Request('https://x/notify', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect((await worker.fetch(new Request('https://x/notify', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), env)).status).toBe(403)
  })
  it('origine non autorizzata, token mancante o scaduto, nessun accesso al file', async () => {
    const d = device()
    expect((await call('/subscribe', { fileId: FILE, subscription: d.sub }, 'tok-emilio', 'https://evil.test')).status).toBe(403)
    expect((await worker.fetch(new Request('https://x/subscribe', { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ fileId: FILE, subscription: d.sub }) }), env)).status).toBe(401)
    expect((await sub('scaduto', d)).status).toBe(401)
    expect((await sub('tok-estraneo', d)).status).toBe(403)
    expect(kv.data.size).toBe(0)
  })
})

describe('/subscribe', () => {
  it('salva il dispositivo sotto l\'email verificata da Google (minuscola)', async () => {
    const d = device()
    const r = await sub('tok-emilio', d)
    expect(r.status).toBe(200)
    expect([...kv.data.keys()]).toEqual([`s:${FILE}:emilio@example.com`])
  })
  it('rifiuta endpoint non dei servizi di push (niente invii verso indirizzi arbitrari) e dati malformati', async () => {
    expect((await sub('tok-emilio', device('evil.example.com'))).status).toBe(400)
    expect((await call('/subscribe', { fileId: FILE, subscription: { endpoint: 'http://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } } })).status).toBe(400)
    expect((await call('/subscribe', { fileId: '../x', subscription: device().sub })).status).toBe(400)
    expect((await sub('tok-emilio', device('web.push.apple.com'))).status).toBe(200)
    expect((await sub('tok-emilio', device('updates.push.services.mozilla.com'))).status).toBe(200)
  })
  it('rinnovo: non riscrive se nulla è cambiato; massimo 5 dispositivi', async () => {
    const d = device()
    await sub('tok-emilio', d); await sub('tok-emilio', d); await sub('tok-emilio', d)
    expect(kv.writes).toBe(1)
    for (let i = 0; i < 6; i++) await sub('tok-emilio', device())
    expect(JSON.parse(kv.data.get(`s:${FILE}:emilio@example.com`)!)).toHaveLength(5)
  })
  it('/unsubscribe toglie solo quel dispositivo', async () => {
    const a = device(), b = device()
    await sub('tok-emilio', a); await sub('tok-emilio', b)
    expect((await call('/unsubscribe', { fileId: FILE, endpoint: a.sub.endpoint })).status).toBe(200)
    expect(JSON.parse(kv.data.get(`s:${FILE}:emilio@example.com`)!).map((s: { endpoint: string }) => s.endpoint)).toEqual([b.sub.endpoint])
    await call('/unsubscribe', { fileId: FILE, endpoint: b.sub.endpoint })
    expect(kv.data.size).toBe(0)
  })
})

describe('/notify', () => {
  it('invia ai destinatari iscritti, cifrato e leggibile solo da loro; non al mittente', async () => {
    const anna = device(), emilio = device()
    await sub('tok-anna', anna); await sub('tok-emilio', emilio)
    const r = await call('/notify', { fileId: FILE, recipients: ['anna@example.com', 'emilio@example.com'], title: 'Emilio ha aggiunto una spesa', body: '45,00 € · Cena', tag: 'tx:1' })
    expect(await r.json()).toEqual({ ok: true, sent: 1, failed: 0, removed: 0 })
    expect(pushed).toHaveLength(1)
    expect(pushed[0].url).toBe(anna.sub.endpoint)
    expect(pushed[0].headers.Authorization).toMatch(/^vapid t=/)
    expect(decrypt(anna, pushed[0].body)).toEqual({ title: 'Emilio ha aggiunto una spesa', body: '45,00 € · Cena', tag: 'tx:1' })
    expect(() => decrypt(emilio, pushed[0].body)).toThrow()
  })
  it('tutti i dispositivi del destinatario', async () => {
    await sub('tok-anna', device()); await sub('tok-anna', device('web.push.apple.com'))
    const r = await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'B' })
    expect((await r.json() as { sent: number }).sent).toBe(2)
  })
  it('un utente iscritto a un ALTRO database non riceve nulla', async () => {
    tokens['tok-anna'].files = ['altro_file_1234567']
    await call('/subscribe', { fileId: 'altro_file_1234567', subscription: device().sub }, 'tok-anna')
    const r = await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'B' })
    expect((await r.json() as { sent: number }).sent).toBe(0)
    expect(pushed).toHaveLength(0)
  })
  it('chi non ha accesso al file non può far inviare notifiche', async () => {
    await sub('tok-anna', device())
    expect((await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'B' }, 'tok-estraneo')).status).toBe(403)
    expect((await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'B' }, 'scaduto')).status).toBe(401)
    expect(pushed).toHaveLength(0)
  })
  it('dispositivo scaduto (410) eliminato; errore temporaneo (500) conservato', async () => {
    const dead = device(), flaky = device('web.push.apple.com'), ok = device('updates.push.services.mozilla.com')
    for (const d of [dead, flaky, ok]) await sub('tok-anna', d)
    pushStatus[dead.sub.endpoint] = 410; pushStatus[flaky.sub.endpoint] = 500
    const r = await (await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'B' })).json() as { sent: number; failed: number; removed: number }
    expect(r).toMatchObject({ sent: 1, failed: 1, removed: 1 })
    const left = JSON.parse(kv.data.get(`s:${FILE}:anna@example.com`)!).map((s: { endpoint: string }) => s.endpoint).sort()
    expect(left).toEqual([flaky.sub.endpoint, ok.sub.endpoint].sort())
  })
  it('limiti: destinatari, titolo obbligatorio, testo troncato, richiesta enorme', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`)
    expect((await call('/notify', { fileId: FILE, recipients: many, title: 'T', body: 'B' })).status).toBe(400)
    expect((await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], body: 'B' })).status).toBe(400)
    expect((await call('/notify', { fileId: FILE, recipients: ['non-una-email'], title: 'T' })).status).toBe(400)
    const anna = device(); await sub('tok-anna', anna)
    await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T'.repeat(500), body: 'x'.repeat(5000) })
    const m = decrypt(anna, pushed[0].body)
    expect(m.title.length).toBe(120); expect(m.body.length).toBe(300)
    expect((await call('/notify', { fileId: FILE, recipients: ['anna@example.com'], title: 'T', body: 'x'.repeat(9000) })).status).toBe(413)
  })
  it('prova: solo verso se stessi', async () => {
    const emilio = device(), anna = device()
    await sub('tok-emilio', emilio); await sub('tok-anna', anna)
    const r = await (await call('/notify', { fileId: FILE, recipients: ['emilio@example.com', 'anna@example.com'], title: 'Prova', body: 'ok', test: true })).json() as { sent: number }
    expect(r.sent).toBe(1)
    expect(pushed[0].url).toBe(emilio.sub.endpoint)
  })
})
