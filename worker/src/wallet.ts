import { seal, unseal } from './auth'
import { HttpError, authenticate, loadSubs, readJson, validFileId, type Env } from './index'
import { b64u, sendWebPush } from './webpush'

/**
 * Apple Wallet → MoneyDuo. L'iPhone non permette alle app di leggere Wallet, ma un Comando Rapido con l'automazione «Transazione»
 * parte a ogni pagamento con Apple Pay e può chiamare un indirizzo: questo.
 *  - POST /wallet/token   (con Google) crea il token personale dell'utente per quel database; sul server resta solo il suo hash
 *  - POST /wallet/in/<token>  (dal Comando Rapido) mette la spesa in una casella dell'utente
 *  - POST /wallet/pull    (con Google) l'app prende le spese in attesa
 *  - POST /wallet/ack     l'app conferma e le spese vengono cancellate dal server
 * Le spese in casella sono cifrate (se SESSION_KEY è impostata) e spariscono dopo 30 giorni.
 */

const ITEM_TTL = 30 * 24 * 3600
const MAX_ITEMS = 100
const sha = async (s: string) => b64u.enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
const tokKey = (hash: string) => `wt:${hash}`
const userKey = (fileId: string, email: string) => `wu:${fileId}:${email}`
const itemPrefix = (fileId: string, email: string) => `wi:${fileId}:${email}:`

interface TokenRec { fileId: string; email: string }
export interface WalletItem { id: string; amount: number; merchant: string; card: string; at: string }

/** «12,50», «€12.50», «1.234,56», «1,234.56», «12.5 EUR» → centesimi (null se non è un importo > 0). */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 && raw < 1e7 ? Math.round(raw * 100) : null
  if (typeof raw !== 'string') return null
  let s = raw.replace(/[^\d.,-]/g, '')
  if (!s || s.startsWith('-')) return null
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.')
  const dec = Math.max(lastC, lastD)
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1)
  else s = s.replace(/[.,]/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) : null
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '')

async function userOf(env: Env, req: Request): Promise<{ fileId: string; email: string; body: Record<string, unknown> }> {
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  return { fileId: body.fileId, email: await authenticate(env, req, body.fileId), body }
}

/** Crea il token (o, se esiste già e non si chiede di rigenerarlo, dice solo che c'è: il server non lo conosce in chiaro). */
export async function walletToken(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  const old = await env.SUBS.get(userKey(fileId, email))
  if (old && body.rotate !== true) return { ok: true, exists: true }
  if (old) await env.SUBS.delete(tokKey(old))
  const token = b64u.enc(crypto.getRandomValues(new Uint8Array(24)))
  const hash = await sha(token)
  await env.SUBS.put(tokKey(hash), JSON.stringify({ fileId, email } satisfies TokenRec))
  await env.SUBS.put(userKey(fileId, email), hash)
  return { ok: true, exists: false, token }
}

export async function walletRevoke(env: Env, req: Request): Promise<unknown> {
  const { fileId, email } = await userOf(env, req)
  const old = await env.SUBS.get(userKey(fileId, email))
  if (old) await env.SUBS.delete(tokKey(old))
  await env.SUBS.delete(userKey(fileId, email))
  for (const k of (await env.SUBS.list({ prefix: itemPrefix(fileId, email), limit: 1000 })).keys) await env.SUBS.delete(k.name)
  return { ok: true }
}

const open = async (env: Env, v: string): Promise<WalletItem | null> => {
  if (!env.SESSION_KEY) { try { return JSON.parse(v) as WalletItem } catch { return null } }
  return unseal<WalletItem>(env, v)
}

export async function walletPull(env: Env, req: Request): Promise<unknown> {
  const { fileId, email } = await userOf(env, req)
  const enabled = !!(await env.SUBS.get(userKey(fileId, email)))
  const items: WalletItem[] = []
  if (enabled) {
    for (const k of (await env.SUBS.list({ prefix: itemPrefix(fileId, email), limit: MAX_ITEMS })).keys) {
      const v = await env.SUBS.get(k.name)
      const it = v ? await open(env, v) : null
      if (it) items.push(it)
    }
  }
  return { ok: true, enabled, items: items.sort((a, b) => a.at.localeCompare(b.at)) }
}

export async function walletAck(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string' && /^[\w-]{6,40}$/.test(i)).slice(0, MAX_ITEMS) : []
  for (const id of ids) await env.SUBS.delete(itemPrefix(fileId, email) + id)
  return { ok: true, removed: ids.length }
}

/** Dal Comando Rapido: JSON `{amount, merchant, card}` (o campi di un modulo). Il token nell'indirizzo è l'unica credenziale. */
export async function walletIngest(env: Env, req: Request, token: string): Promise<{ status: number; body: unknown }> {
  const rec = await env.SUBS.get(tokKey(await sha(token)))
  if (!rec) return { status: 404, body: { error: 'Token non valido o revocato' } }
  const { fileId, email } = JSON.parse(rec) as TokenRec
  let f: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text.length > 4000) return { status: 413, body: { error: 'Richiesta troppo grande' } }
    try { const j = JSON.parse(text); if (j && typeof j === 'object') f = j as Record<string, unknown> } catch { f = Object.fromEntries(new URLSearchParams(text)) }
  } catch { return { status: 400, body: { error: 'Richiesta non valida' } } }
  const amount = parseAmount(f.amount ?? f.Amount)
  if (!amount) return { status: 400, body: { error: 'Importo non valido' } }
  const existing = (await env.SUBS.list({ prefix: itemPrefix(fileId, email), limit: MAX_ITEMS + 1 })).keys.length
  if (existing >= MAX_ITEMS) return { status: 429, body: { error: 'Troppe spese in attesa: apri l\'app per importarle' } }
  const item: WalletItem = {
    id: `${Date.now().toString(36)}${b64u.enc(crypto.getRandomValues(new Uint8Array(4)))}`.replace(/[^\w-]/g, ''),
    amount, merchant: clean(f.merchant ?? f.Merchant ?? f.name, 120), card: clean(f.card ?? f.Card, 80), at: new Date().toISOString(),
  }
  const value = env.SESSION_KEY ? await seal(env, item) : JSON.stringify(item)
  await env.SUBS.put(itemPrefix(fileId, email) + item.id, value, { expirationTtl: ITEM_TTL })
  // avvisa i dispositivi dell'utente: l'app, appena sveglia, importa la spesa (best effort)
  try {
    const subs = await loadSubs(env, fileId, email)
    const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'https://example.invalid/' }
    const euro = (amount / 100).toFixed(2)
    for (const s of subs) await sendWebPush(s, { title: 'Spesa da approvare', body: `${item.merchant || 'Apple Pay'} · ${euro} €`, tag: 'wallet-' + item.id }, vapid)
  } catch { /* la spesa è comunque in casella */ }
  return { status: 200, body: { ok: true } }
}
