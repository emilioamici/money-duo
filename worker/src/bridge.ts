import { HttpError, readJson, validFileId, authenticate, type Env } from './index'
import { authConfigured, seal, unseal } from './auth'

/**
 * Ponte verso il database su Drive per chi non ha (ancora) accesso diretto al file.
 *
 * Con il permesso ristretto `drive.file` un file condiviso da altri si può aprire solo dopo il Selettore di Google,
 * che su iPhone spesso non funziona (cookie). Qui il file viene letto e scritto dal Worker con l'accesso del capofamiglia
 * che l'ha registrato: ma solo per gli account che compaiono tra le condivisioni del file su Drive, che restano l'unica
 * fonte dell'autorizzazione (invitare e togliere un membro = condividere e togliere la condivisione su Drive).
 * Il database passa dal Worker "al volo" (senza essere letto, salvato né registrato).
 */

const MAX_HOUSES_PER_USER = 10
const MAX_DB_BYTES = 8_000_000   // oggi il database pesa ~4 MB; il tetto evita corpi enormi
const MAX_ACCOUNTS = 20          // account che possono entrare con il codice
const TOKEN_CACHE_MS = 60_000
const WRITER_ROLES = ['owner', 'organizer', 'fileOrganizer', 'writer']
const hkey = (fileId: string) => `house:${fileId}`
const ikey = (email: string) => `inv:${email.toLowerCase()}`
const google = (env: Env) => env.GOOGLE_API || 'https://www.googleapis.com'
const oauth = (env: Env) => env.GOOGLE_OAUTH_API || 'https://oauth2.googleapis.com'
const FIELDS = 'id,name,version,modifiedTime,owners(emailAddress,displayName),properties'

interface House { rt: string; email: string }
export interface Perm { emailAddress?: string; role: string }

export const bridgeEnabled = (env: Env): boolean => authConfigured(env)

async function loadHouse(env: Env, fileId: string): Promise<House | null> {
  const v = await env.SUBS.get(hkey(fileId))
  return v ? unseal<House>(env, v) : null
}

/** Token d'accesso di chi ha registrato la casa. Se Google ha revocato il suo accesso il collegamento si cancella. */
async function houseToken(env: Env, fileId: string, house: House): Promise<string> {
  const r = await fetch(`${oauth(env)}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: house.rt, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    if (err.error === 'invalid_grant') { await env.SUBS.delete(hkey(fileId)); throw new HttpError(410, 'La famiglia non è più collegata: il capofamiglia deve riaprire l\'app.') }
    throw new HttpError(502, 'Google non risponde')
  }
  const t = (await r.json()) as { access_token?: string }
  if (!t.access_token) throw new HttpError(502, 'Risposta di Google non valida')
  return t.access_token
}

export async function permissionsOf(env: Env, token: string, fileId: string): Promise<Perm[]> {
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(emailAddress,role)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new HttpError(502, 'Google non risponde')
  return ((await r.json()) as { permissions?: Perm[] }).permissions ?? []
}

const clientIds = (env: Env): string[] => [env.GOOGLE_CLIENT_ID, ...(env.ALLOWED_CLIENT_IDS ?? '').split(',')].map((s) => (s ?? '').trim()).filter(Boolean)
const SCOPE_OK = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']

/** Esito della verifica di un token, tenuto in memoria per al massimo 60 secondi (mai salvato altrove; il token non viene mai conservato, solo il suo esito per pochi secondi). */
const verified = new Map<string, { ok: boolean; email?: string; exp: number }>()

/**
 * Il token è stato emesso per questa app (`aud`/`azp` = nostro client ID) con lo scope `drive.file` (o `drive`, che lo include)?
 * Senza questo controllo basterebbe un token qualsiasi dello stesso utente, emesso per un'altra app.
 */
async function issuedForApp(env: Env, token: string): Promise<boolean> {
  const hit = verified.get(token)
  if (hit && hit.exp > Date.now()) return hit.ok
  const r = await fetch(`${oauth(env)}/tokeninfo?access_token=${encodeURIComponent(token)}`)
  let ok = false
  if (r.ok) {
    const j = (await r.json()) as { aud?: string; azp?: string; scope?: string }
    const ids = clientIds(env)
    const scopes = (j.scope ?? '').split(/\s+/)
    ok = (ids.includes(j.aud ?? '') || ids.includes(j.azp ?? '')) && scopes.some((x) => SCOPE_OK.includes(x))
  }
  if (verified.size > 200) verified.clear()
  verified.set(token, { ok, exp: Date.now() + TOKEN_CACHE_MS })
  return ok
}

/** Per `authenticate`: chi non ha accesso diretto al file può comunque passare se la famiglia è registrata e il file è condiviso con lui. */
export async function bridgeAccess(env: Env, token: string, email: string, fileId: string): Promise<boolean> {
  return (await roleOf(env, token, email, fileId)) !== null
}

/** Ruolo dell'account sul file (da Drive, con l'accesso del capofamiglia); null = nessuna condivisione o famiglia non registrata. */
async function roleOf(env: Env, token: string, email: string, fileId: string): Promise<string | null> {
  if (!bridgeEnabled(env)) return null
  const house = await loadHouse(env, fileId)
  if (!house) return null
  if (!(await issuedForApp(env, token))) return null
  const perms = await permissionsOf(env, await houseToken(env, fileId, house), fileId)
  return perms.find((p) => p.emailAddress?.toLowerCase() === email.toLowerCase())?.role ?? null
}

async function whoami(env: Env, req: Request): Promise<{ token: string; email: string }> {
  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'Accesso mancante')
  const r = await fetch(`${google(env)}/drive/v3/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 401) throw new HttpError(401, 'Sessione Google non valida o scaduta')
  if (!r.ok) throw new HttpError(502, 'Google non risponde')
  const email = ((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress
  if (!email) throw new HttpError(401, 'Account Google non riconosciuto')
  if (!(await issuedForApp(env, token))) throw new HttpError(401, 'Token non emesso per questa app')
  return { token, email: email.toLowerCase() }
}

/**
 * POST /house/register {fileId, session}: il capofamiglia (proprietario del file) affida al Worker il collegamento al database,
 * con la sua sessione di accesso persistente. Aggiorna anche l'elenco delle famiglie di ogni invitato.
 * Solo il proprietario: così due membri non si sovrascrivono il collegamento a vicenda.
 */
export async function houseRegister(env: Env, req: Request): Promise<unknown> {
  if (!bridgeEnabled(env)) throw new HttpError(503, 'Il ponte non è configurato sul server')
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  if (typeof body.session !== 'string' || !/^[\w-]{30,80}$/.test(body.session)) throw new HttpError(400, 'Sessione non valida')
  const email = await authenticate(env, req, body.fileId, true) // accesso diretto al file, non via ponte
  const mine = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(body.fileId)}?fields=ownedByMe&supportsAllDrives=true`, { headers: { Authorization: req.headers.get('Authorization')! } })
  if (!mine.ok || !((await mine.json()) as { ownedByMe?: boolean }).ownedByMe) throw new HttpError(403, 'Solo il capofamiglia può collegare la famiglia')
  const stored = await env.SUBS.get(`sess:${body.session}`)
  const sess = stored ? await unseal<{ rt: string; email: string }>(env, stored) : null
  if (!sess || sess.email.toLowerCase() !== email) throw new HttpError(403, 'La sessione non corrisponde all\'account')
  const house: House = { rt: sess.rt, email }
  const existing = await loadHouse(env, body.fileId)
  if (!existing || existing.rt !== house.rt) await env.SUBS.put(hkey(body.fileId), await seal(env, house))
  const perms = await permissionsOf(env, await houseToken(env, body.fileId, house), body.fileId)
  for (const p of perms) {
    if (!p.emailAddress) continue
    const k = ikey(p.emailAddress)
    let list: string[] = []
    try { list = JSON.parse((await env.SUBS.get(k)) ?? '[]') as string[] } catch { list = [] }
    if (!list.includes(body.fileId)) await env.SUBS.put(k, JSON.stringify([body.fileId, ...list].slice(0, MAX_HOUSES_PER_USER)))
  }
  return { ok: true, members: perms.length }
}

/** POST /house/mine: le famiglie a cui l'account è stato invitato (file condivisi con lui e collegati al ponte). */
export async function houseMine(env: Env, req: Request): Promise<unknown> {
  if (!bridgeEnabled(env)) return { houses: [] }
  const { email } = await whoami(env, req)
  let ids: string[] = []
  try { ids = JSON.parse((await env.SUBS.get(ikey(email))) ?? '[]') as string[] } catch { ids = [] }
  const houses: Array<{ id: string; name: string; modifiedTime: string }> = []
  const keep: string[] = []
  for (const id of ids.slice(0, MAX_HOUSES_PER_USER)) {
    const house = await loadHouse(env, id)
    if (!house) continue
    try {
      const t = await houseToken(env, id, house)
      if (!(await permissionsOf(env, t, id)).some((p) => p.emailAddress?.toLowerCase() === email)) continue
      const m = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=name,modifiedTime&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` } })
      if (!m.ok) continue
      const meta = (await m.json()) as { name: string; modifiedTime: string }
      houses.push({ id, name: meta.name, modifiedTime: meta.modifiedTime }); keep.push(id)
    } catch { keep.push(id) /* errore passeggero: si riprova alla prossima */ }
  }
  if (keep.length !== ids.length) await (keep.length ? env.SUBS.put(ikey(email), JSON.stringify(keep)) : env.SUBS.delete(ikey(email)))
  return { houses }
}

/**
 * POST /house/join {fileId}: il CODICE è l'ID del file. Chi lo presenta (con un token valido per questa app) viene aggiunto dal Worker,
 * con l'accesso del capofamiglia, tra gli scrittori del file (senza email di notifica). Idempotente. Tetto di 20 account.
 * Chi ha il codice può quindi entrare: è un segreto condiviso. Si revoca togliendo l'account dalle condivisioni su Drive.
 */
export async function houseJoin(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  const { email } = await whoami(env, req)
  const house = await loadHouse(env, body.fileId)
  if (!house) throw new HttpError(404, 'Famiglia non collegata: il capofamiglia deve riaprire l\'app con l\'accesso persistente.')
  const owner = await houseToken(env, body.fileId, house)
  const perms = await permissionsOf(env, owner, body.fileId)
  if (!perms.some((p) => p.emailAddress?.toLowerCase() === email)) {
    if (perms.filter((p) => p.emailAddress).length >= MAX_ACCOUNTS) throw new HttpError(403, 'La famiglia ha già il numero massimo di account')
    const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(body.fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    })
    if (!r.ok) throw new HttpError(502, 'Non riesco a condividere il file: il capofamiglia deve riaprire l\'app')
  }
  const k = ikey(email)
  let list: string[] = []
  try { list = JSON.parse((await env.SUBS.get(k)) ?? '[]') as string[] } catch { list = [] }
  if (!list.includes(body.fileId)) await env.SUBS.put(k, JSON.stringify([body.fileId, ...list].slice(0, MAX_HOUSES_PER_USER)))
  return { ok: true }
}

/** Autorizza la richiesta e ritorna il token del capofamiglia per parlare con Drive. `write` richiede un ruolo con diritto di modifica. */
async function asHouse(env: Env, req: Request, write: boolean): Promise<{ token: string; id: string }> {
  const id = new URL(req.url).searchParams.get('fileId')
  if (!validFileId(id)) throw new HttpError(400, 'File non valido')
  const { email } = await whoami(env, req)
  const house = await loadHouse(env, id)
  if (!house) throw new HttpError(404, 'Famiglia non collegata: il capofamiglia deve riaprire l\'app con l\'accesso persistente.')
  const owner = await houseToken(env, id, house)
  const role = (await permissionsOf(env, owner, id)).find((p) => p.emailAddress?.toLowerCase() === email)?.role
  if (!role || (write && !WRITER_ROLES.includes(role))) throw new HttpError(403, 'Nessun accesso al database della famiglia')
  return { token: owner, id }
}

/** POST /db/meta?fileId=: i metadati del file, come li vedrebbe il membro (non è lui il proprietario e non può condividere). */
export async function dbMeta(env: Env, req: Request): Promise<unknown> {
  const { token, id } = await asHouse(env, req, false)
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 404) throw new HttpError(404, 'File non trovato')
  if (!r.ok) throw new HttpError(502, 'Google non risponde')
  return { ...((await r.json()) as object), ownedByMe: false, capabilities: { canEdit: true, canShare: false } }
}

/** POST /db/read?fileId= → il contenuto del database, passato così com'è (senza leggerlo: pesa megabyte e il Worker ha poca CPU). */
export async function dbRead(env: Env, req: Request, cors: Record<string, string>): Promise<Response> {
  const { token, id } = await asHouse(env, req, false)
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'Impossibile leggere il database')
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } })
}

/**
 * Controllo veloce della forma (senza interpretare 4 MB di JSON: il Worker ha pochissima CPU): un oggetto con `schemaVersion` numerico
 * in testa e le raccolte principali presenti. Chi scrive è comunque un membro autorizzato; serve a scartare corpi sbagliati o troncati.
 */
export function plausibleDb(text: string): boolean {
  const t = text.trimEnd()
  if (!t.startsWith('{') || !t.endsWith('}')) return false
  if (!/^\{\s*"schemaVersion"\s*:\s*\d+/.test(t.slice(0, 200))) return false
  return ['"members"', '"accounts"', '"transactions"'].every((k) => t.includes(k))
}

/**
 * POST /db/write?fileId=&expectedVersion= (corpo = il database): scrive solo se la versione di Drive coincide con `expectedVersion`
 * (altrimenti 409: l'app rilegge, fa il merge e riprova). Il contenuto non viene salvato né registrato.
 */
export async function dbWrite(env: Env, req: Request): Promise<unknown> {
  const url = new URL(req.url)
  const expected = url.searchParams.get('expectedVersion')
  if (!expected) throw new HttpError(400, 'Versione mancante')
  const len = Number(req.headers.get('Content-Length') ?? '0')
  if (len > MAX_DB_BYTES) throw new HttpError(413, 'Database troppo grande')
  const { token, id } = await asHouse(env, req, true)
  const text = await req.text()
  if (!text || text.length > MAX_DB_BYTES) throw new HttpError(text ? 413 : 400, text ? 'Database troppo grande' : 'Database mancante')
  if (!plausibleDb(text)) throw new HttpError(400, 'Database non valido')
  const cur = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=version&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (cur.status === 404) throw new HttpError(404, 'File non trovato')
  if (!cur.ok) throw new HttpError(502, 'Google non risponde')
  if (((await cur.json()) as { version?: string }).version !== expected) throw new HttpError(409, 'Versione cambiata')
  const r = await fetch(`${google(env)}/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: text,
  })
  if (!r.ok) throw new HttpError(502, 'Impossibile scrivere il database')
  return { ...((await r.json()) as object), ownedByMe: false, capabilities: { canEdit: true, canShare: false } }
}
