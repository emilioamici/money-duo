import { createECDH, createPublicKey, createVerify, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { b64u, encryptPayload, sendWebPush, vapidAuthorization } from './webpush'

const require = createRequire(import.meta.url)
// libreria indipendente (usata da web-push) per DECIFRARE: serve da riferimento per la nostra cifratura
const ece = require('http_ece') as { decrypt: (body: Buffer, p: Record<string, unknown>) => Buffer }

/** Dispositivo finto: coppia di chiavi + segreto di autenticazione, come in una vera PushSubscription. */
function device() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return { ecdh, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: b64u.enc(ecdh.getPublicKey()), auth: b64u.enc(auth) } } }
}
const decrypt = (d: ReturnType<typeof device>, body: Uint8Array) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString('utf8')

async function vapidKeys() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { publicKey: b64u.enc(pub), privateKey: jwk.d!, subject: 'https://example.test/app/' }
}

describe('cifratura RFC 8291', () => {
  it('un dispositivo indipendente decifra il messaggio', async () => {
    const d = device()
    const msg = JSON.stringify({ title: 'Marco ha aggiunto una spesa', body: '45,00 € · Cena', tag: 'tx:1' })
    const body = await encryptPayload(d.sub, new TextEncoder().encode(msg))
    expect(decrypt(d, body)).toBe(msg)
  })
  it('testo con accenti ed emoji, e messaggi lunghi', async () => {
    const d = device()
    const msg = 'Perché è già così: 🍕 città — ' + 'x'.repeat(2500)
    expect(decrypt(d, await encryptPayload(d.sub, new TextEncoder().encode(msg)))).toBe(msg)
  })
  it('ogni invio usa sale e chiave effimera diversi', async () => {
    const d = device()
    const a = await encryptPayload(d.sub, new TextEncoder().encode('ciao'))
    const b = await encryptPayload(d.sub, new TextEncoder().encode('ciao'))
    expect(b64u.enc(a)).not.toBe(b64u.enc(b))
  })
  it('un altro dispositivo NON riesce a decifrare', async () => {
    const d = device(), other = device()
    const body = await encryptPayload(d.sub, new TextEncoder().encode('segreto'))
    expect(() => decrypt(other, body)).toThrow()
  })
  it('struttura dell\'intestazione: sale 16 B, record 4096, chiave 65 B', async () => {
    const body = await encryptPayload(device().sub, new TextEncoder().encode('x'))
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(4) // chiave non compressa
  })
  it('rifiuta chiavi non valide e messaggi troppo lunghi', async () => {
    await expect(encryptPayload({ endpoint: 'https://x', keys: { p256dh: 'abc', auth: 'def' } }, new Uint8Array(3))).rejects.toThrow()
    await expect(encryptPayload(device().sub, new Uint8Array(4000))).rejects.toThrow()
  })
})

describe('VAPID (RFC 8292)', () => {
  it('JWT ES256 con audience, scadenza e contatto; firma verificabile con la chiave pubblica', async () => {
    const k = await vapidKeys()
    const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', k, Date.UTC(2026, 0, 1))
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!
    expect(m).toBeTruthy()
    expect(m[4]).toBe(k.publicKey)
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString())
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.UTC(2026, 0, 1) / 1000) + 12 * 3600, sub: 'https://example.test/app/' })
    expect(JSON.parse(Buffer.from(m[1], 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    // verifica con Node, in modo indipendente da WebCrypto
    const raw = b64u.dec(k.publicKey)
    const pk = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.enc(raw.slice(1, 33)), y: b64u.enc(raw.slice(33)) }, format: 'jwk' })
    const ok = createVerify('SHA256').update(`${m[1]}.${m[2]}`).end().verify({ key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'))
    expect(ok).toBe(true)
  })
  it('chiave pubblica non valida', async () => {
    await expect(vapidAuthorization('https://x.test/p', { publicKey: 'AAAA', privateKey: 'x', subject: 'https://s' })).rejects.toThrow()
  })
})

describe('invio', () => {
  it('POST all\'endpoint con le intestazioni giuste e corpo decifrabile', async () => {
    const d = device(), k = await vapidKeys()
    const f = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', f)
    const r = await sendWebPush(d.sub, { title: 'T', body: 'B' }, k)
    expect(r).toEqual({ status: 201, gone: false })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(d.sub.endpoint)
    const h = init.headers as Record<string, string>
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.Authorization).toMatch(/^vapid t=.+, k=.+$/)
    expect(h.TTL).toBe('86400')
    expect(JSON.parse(decrypt(d, init.body as Uint8Array))).toEqual({ title: 'T', body: 'B' })
    vi.unstubAllGlobals()
  })
  it('410 e 404 = dispositivo non più valido; errore di rete non lo è', async () => {
    const d = device(), k = await vapidKeys()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 410 })))
    expect((await sendWebPush(d.sub, {}, k)).gone).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('rete') }))
    expect(await sendWebPush(d.sub, {}, k)).toEqual({ status: 0, gone: false })
    vi.unstubAllGlobals()
  })
})
