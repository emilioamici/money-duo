/**
 * Web Push per ambienti con sola WebCrypto (Cloudflare Workers, Node 20+, browser).
 * - cifratura del messaggio: RFC 8291 (Content-Encoding: aes128gcm)
 * - identificazione del server: VAPID, RFC 8292 (JWT ES256)
 */

const enc = new TextEncoder()

export const b64u = {
  enc(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec(str: string): Uint8Array {
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4)
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export interface PushSubscriptionData {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface VapidKeys {
  /** chiave pubblica non compressa (65 byte) in base64url */
  publicKey: string
  /** chiave privata (32 byte, valore "d") in base64url */
  privateKey: string
  /** contatto del mittente: URL https o mailto: */
  subject: string
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8))
}

/** Cifra `payload` per un dispositivo (RFC 8291). `opts` serve solo ai test. */
export async function encryptPayload(
  sub: PushSubscriptionData,
  payload: Uint8Array,
  opts: { salt?: Uint8Array; keyPair?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64u.dec(sub.keys.p256dh)
  const authSecret = b64u.dec(sub.keys.auth)
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Chiavi della sottoscrizione non valide')
  if (payload.length > 3900) throw new Error('Messaggio troppo lungo')

  const as = opts.keyPair ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const ikm = await hkdf(authSecret, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // un solo record: messaggio + delimitatore 0x02
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, concat(payload, new Uint8Array([2])) as BufferSource))

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = asPublic.length
  return concat(header, asPublic, body)
}

/** Intestazione `Authorization` VAPID per l'endpoint di push indicato. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowMs = Date.now()): Promise<string> {
  const pub = b64u.dec(vapid.publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Chiave pubblica VAPID non valida')
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: vapid.privateKey, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const part = (o: unknown) => b64u.enc(enc.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: vapid.subject })}`
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned) as BufferSource))
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${vapid.publicKey}`
}

export interface PushResult {
  /** HTTP status del servizio di push; 0 = errore di rete */
  status: number
  /** la sottoscrizione non esiste più (404/410): va eliminata */
  gone: boolean
}

/** Invia una notifica a un dispositivo. */
export async function sendWebPush(sub: PushSubscriptionData, message: unknown, vapid: VapidKeys, opts: { ttl?: number; urgency?: 'low' | 'normal' | 'high' } = {}): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)))
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 86400),
        Urgency: opts.urgency ?? 'normal',
      },
      body: body as BodyInit,
    })
    return { status: res.status, gone: res.status === 404 || res.status === 410 }
  } catch {
    return { status: 0, gone: false }
  }
}
