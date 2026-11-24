import { bridgeAccess, bridgeEnabled, dbMeta, dbRead, dbWrite, houseJoin, houseMine, houseRegister } from './bridge'
import { authCallback, authConfigured, authLogout, authRefresh, authStart } from './auth'
import { walletAck, walletIngest, walletPull, walletRevoke, walletToken } from './wallet'
import { sendWebPush, type PushSubscriptionData, type VapidKeys } from './webpush'

/** Minimo indispensabile dell'archivio KV di Cloudflare (così il codice si prova anche in Node). */
export interface KV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(opts: { prefix: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>
}

export interface Env {
  SUBS: KV
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  /** URL https o mailto: di contatto, inviato ai servizi di push (non un dato personale) */
  VAPID_SUBJECT?: string
  /** origini autorizzate a chiamare il server, separate da virgola (es. https://utente.github.io) */
  ALLOWED_ORIGINS: string
  /** solo per i test in locale: accetta qualsiasi endpoint di push */
  ALLOW_ANY_PUSH_HOST?: string
  /** solo per i test in locale: indirizzo delle API Google (predefinito: https://www.googleapis.com) */
  GOOGLE_API?: string
  // ----- accesso persistente (facoltativo): client OAuth di Google Cloud e chiave per cifrare i token di rinnovo
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** 32 byte casuali in base64url (node worker/scripts/generate-session-key.mjs) */
  SESSION_KEY?: string
  /** solo test: indirizzi di Google per OAuth */
  GOOGLE_AUTH_URL?: string
  GOOGLE_OAUTH_API?: string
  /** altri client OAuth (oltre a GOOGLE_CLIENT_ID) i cui token il ponte accetta, separati da virgola */
  ALLOWED_CLIENT_IDS?: string
}

/** Servizi di push dei browser: gli unici indirizzi a cui il server accetta di inviare. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com']
const MAX_RECIPIENTS = 20
const MAX_DEVICES_PER_USER = 5
const TTL_SECONDS = 90 * 24 * 3600
const RENEW_AFTER_MS = 30 * 24 * 3600 * 1000

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

interface StoredSub extends PushSubscriptionData { added: number }
const key = (fileId: string, email: string) => `s:${fileId}:${email.toLowerCase()}`
export const validFileId = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{10,100}$/.test(s)
export const validEmail = (s: unknown): s is string => typeof s === 'string' && s.length < 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

function validSubscription(env: Env, s: unknown): s is PushSubscriptionData {
  const o = s as PushSubscriptionData
  if (!o || typeof o.endpoint !== 'string' || !o.keys || typeof o.keys.p256dh !== 'string' || typeof o.keys.auth !== 'string') return false
  let u: URL
  try { u = new URL(o.endpoint) } catch { return false }
  if (env.ALLOW_ANY_PUSH_HOST === 'true') return true // solo sviluppo locale
  if (u.protocol !== 'https:') return false
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : {}
}

/**
 * Verifica il token Google dell'utente: ritorna la sua email (verificata da Google) e controlla che abbia
 * accesso al file del database indicato. Il server non salva mai il token.
 */
export async function authenticate(env: Env, req: Request, fileId: string, directOnly = false): Promise<string> {
  const google = env.GOOGLE_API || 'https://www.googleapis.com'
  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'Accesso mancante')
  const auth = { Authorization: `Bearer ${token}` }
  const about = await fetch(`${google}/drive/v3/about?fields=user(emailAddress)`, { headers: auth })
  if (about.status === 401) throw new HttpError(401, 'Sessione Google non valida o scaduta')
  if (!about.ok) throw new HttpError(502, 'Google non risponde')
  const email = ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress
  if (!email) throw new HttpError(401, 'Account Google non riconosciuto')
  const file = await fetch(`${google}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id&supportsAllDrives=true`, { headers: auth })
  if (file.status === 404 || file.status === 403) {
    // niente accesso diretto (permesso `drive.file`): passa chi ha il file condiviso e la famiglia collegata al ponte
    if (!directOnly && (await bridgeAccess(env, token, email, fileId))) return email.toLowerCase()
    throw new HttpError(403, 'Nessun accesso al database della famiglia')
  }
  if (!file.ok) throw new HttpError(502, 'Google non risponde')
  return email.toLowerCase()
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text()
    if (text.length > 8000) throw new HttpError(413, 'Richiesta troppo grande')
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object') throw new Error()
    return o as Record<string, unknown>
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, 'Richiesta non valida')
  }
}

export async function loadSubs(env: Env, fileId: string, email: string): Promise<StoredSub[]> {
  try { return (JSON.parse((await env.SUBS.get(key(fileId, email))) ?? '[]') as StoredSub[]) } catch { return [] }
}
const saveSubs = (env: Env, fileId: string, email: string, list: StoredSub[]) =>
  list.length ? env.SUBS.put(key(fileId, email), JSON.stringify(list), { expirationTtl: TTL_SECONDS }) : env.SUBS.delete(key(fileId, email))

/** Registra (o rinnova) un dispositivo dell'utente. Scrive solo se serve: il piano gratuito di KV ha un limite di scritture al giorno. */
async function subscribe(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  if (!validSubscription(env, body.subscription)) throw new HttpError(400, 'Sottoscrizione non valida')
  const email = await authenticate(env, req, body.fileId)
  const sub = body.subscription
  const list = await loadSubs(env, body.fileId, email)
  const known = list.find((s) => s.endpoint === sub.endpoint)
  if (known && known.keys.p256dh === sub.keys.p256dh && known.keys.auth === sub.keys.auth && Date.now() - known.added < RENEW_AFTER_MS) return { ok: true, devices: list.length }
  const next = [{ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, added: Date.now() }, ...list.filter((s) => s.endpoint !== sub.endpoint)].slice(0, MAX_DEVICES_PER_USER)
  await saveSubs(env, body.fileId, email, next)
  return { ok: true, devices: next.length }
}

async function unsubscribe(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  if (!validFileId(body.fileId) || typeof body.endpoint !== 'string') throw new HttpError(400, 'Richiesta non valida')
  const email = await authenticate(env, req, body.fileId)
  const list = await loadSubs(env, body.fileId, email)
  await saveSubs(env, body.fileId, email, list.filter((s) => s.endpoint !== body.endpoint))
  return { ok: true }
}

/** Invia una notifica ai dispositivi dei destinatari (che devono essersi iscritti allo stesso database). */
async function notify(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  const recipients = Array.isArray(body.recipients) ? [...new Set(body.recipients.filter(validEmail).map((e) => e.toLowerCase()))] : []
  if (!recipients.length || recipients.length > MAX_RECIPIENTS) throw new HttpError(400, 'Destinatari non validi')
  const title = typeof body.title === 'string' ? body.title.slice(0, 120) : ''
  const text = typeof body.body === 'string' ? body.body.slice(0, 300) : ''
  if (!title) throw new HttpError(400, 'Titolo mancante')
  const tag = typeof body.tag === 'string' ? body.tag.slice(0, 100) : undefined
  const sender = await authenticate(env, req, body.fileId)

  const vapid: VapidKeys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'https://example.invalid/' }
  // chi scrive non riceve la propria notifica, tranne nella prova ("test": true) che può indirizzarsi solo a se stesso
  const targets = body.test === true ? recipients.filter((r) => r === sender) : recipients.filter((r) => r !== sender)
  let sent = 0, failed = 0, removed = 0
  const codes: number[] = [] // codici di risposta dei servizi push per gli invii non riusciti (aiutano a capire perché)
  for (const email of targets) {
    const list = await loadSubs(env, body.fileId, email)
    const keep: StoredSub[] = []
    for (const s of list) {
      const r = await sendWebPush(s, { title, body: text, tag }, vapid)
      if (r.status >= 200 && r.status < 300) { sent++; keep.push(s) }
      else if (r.gone) removed++
      else { failed++; codes.push(r.status); keep.push(s) }
    }
    if (keep.length !== list.length) await saveSubs(env, body.fileId, email, keep)
  }
  return { ok: true, sent, failed, removed, ...(codes.length ? { codes } : {}) }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(env, req)
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
    const { pathname } = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: headers['Access-Control-Allow-Origin'] ? 204 : 403, headers })
    if (pathname === '/health') return json(200, { ok: true, auth: authConfigured(env), bridge: bridgeEnabled(env) })
    // l'accesso persistente passa da due pagine aperte nel browser (GET): Google rimanda qui dopo il consenso
    if (req.method === 'GET' && pathname === '/auth/start') return authStart(env, req)
    if (req.method === 'GET' && pathname === '/auth/callback') return authCallback(env, req)
    if (req.method !== 'POST') return json(404, { error: 'Non trovato' })
    // il Comando Rapido dell'iPhone scrive qui con il token personale nell'indirizzo: nessuna origine del browser
    const wallet = /^\/wallet\/in\/([\w-]{20,100})$/.exec(pathname)
    if (wallet) { const r = await walletIngest(env, req, wallet[1]); return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }) }
    // le chiamate dal browser devono arrivare da un'origine autorizzata
    if (!headers['Access-Control-Allow-Origin']) return json(403, { error: 'Origine non autorizzata' })
    try {
      if (pathname === '/subscribe') return json(200, await subscribe(env, req))
      if (pathname === '/unsubscribe') return json(200, await unsubscribe(env, req))
      if (pathname === '/notify') return json(200, await notify(env, req))
      if (pathname === '/house/register') return json(200, await houseRegister(env, req))
      if (pathname === '/house/join') return json(200, await houseJoin(env, req))
      if (pathname === '/house/mine') return json(200, await houseMine(env, req))
      if (pathname === '/db/meta') return json(200, await dbMeta(env, req))
      if (pathname === '/db/read') return await dbRead(env, req, headers)
      if (pathname === '/db/write') return json(200, await dbWrite(env, req))
      if (pathname === '/wallet/token') return json(200, await walletToken(env, req))
      if (pathname === '/wallet/revoke') return json(200, await walletRevoke(env, req))
      if (pathname === '/wallet/pull') return json(200, await walletPull(env, req))
      if (pathname === '/wallet/ack') return json(200, await walletAck(env, req))
      if (pathname === '/auth/refresh') { const r = await authRefresh(env, req); return json(r.status, r.body) }
      if (pathname === '/auth/logout') { const r = await authLogout(env, req); return json(r.status, r.body) }
      return json(404, { error: 'Non trovato' })
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message })
      return json(500, { error: 'Errore interno' })
    }
  },
}
