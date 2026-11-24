import { describe, expect, it } from 'vitest'
import worker, { type Env } from './index'
import { seal } from './auth'

const SID = 'S'.repeat(40)
const VALID = JSON.stringify({ schemaVersion: 2, family: { name: 'X' }, members: [], accounts: [], transactions: [] })
const FILE = 'FILEID12345'
const EMAILS: Record<string, string> = { 'tok-owner': 'owner@example.com', 'tok-house': 'owner@example.com', 'tok-anna': 'anna@example.com', 'tok-lettore': 'lettore@example.com', 'tok-eve': 'eve@example.com', 'tok-alien': 'anna@example.com', 'tok-noscope': 'anna@example.com', 'tok-nuovo': 'nuovo@example.com' }

function setup(opts: { shared?: Array<[string, string]> } = {}) {
  const kv = new Map<string, string>()
  const state = { version: '5', db: JSON.stringify({ schemaVersion: 2, family: { name: 'Casa' }, members: [], accounts: [], transactions: [] }), revoked: false, patches: 0, shares: [] as Array<{ emailAddress: string; role: string }> }
  const shared = opts.shared ?? [['owner@example.com', 'owner'], ['anna@example.com', 'writer'], ['lettore@example.com', 'reader']]
  const env = {
    SUBS: {
      get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k),
      list: async ({ prefix }: { prefix: string }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    },
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y', ALLOWED_ORIGINS: 'https://utente.github.io',
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', SESSION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
  } as unknown as Env
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    const bearer = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('Authorization') ?? '')?.[1] ?? ''
    const ok = (o: unknown) => new Response(JSON.stringify(o))
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') return state.revoked ? new Response('{"error":"invalid_grant"}', { status: 400 }) : ok({ access_token: 'tok-house' })
    if (u.pathname === '/tokeninfo') {
      const t = u.searchParams.get('access_token')
      return new Response(JSON.stringify({ aud: t === 'tok-alien' ? 'altra-app' : 'cid', scope: t === 'tok-noscope' ? 'https://www.googleapis.com/auth/userinfo.email' : 'https://www.googleapis.com/auth/drive.file' }))
    }
    if (u.pathname.endsWith('/about')) return EMAILS[bearer] ? ok({ user: { emailAddress: EMAILS[bearer] } }) : new Response('{}', { status: 401 })
    const direct = bearer === 'tok-owner' || bearer === 'tok-house'
    if (u.pathname.endsWith('/permissions') && init?.method === 'POST') {
      if (!direct || u.searchParams.get('sendNotificationEmail') !== 'false') return new Response('{}', { status: 400 })
      const b = JSON.parse(String(init.body)) as { emailAddress: string; role: string }
      state.shares.push(b); shared.push([b.emailAddress, b.role]); return ok({ id: 'perm', ...b })
    }
    if (u.pathname.endsWith('/permissions')) return direct ? ok({ permissions: shared.map(([emailAddress, role]) => ({ emailAddress, role })) }) : new Response('{}', { status: 404 })
    if (u.pathname.startsWith('/upload/')) {
      if (!direct) return new Response('{}', { status: 404 })
      state.patches++; state.version = String(Number(state.version) + 1); state.db = String(init!.body)
      return ok({ id: FILE, name: 'moneyduo-db.json', version: state.version, modifiedTime: 'now', ownedByMe: true })
    }
    if (u.pathname.includes('/files/')) {
      if (!direct) return new Response('{}', { status: 404 })
      if (u.searchParams.get('alt') === 'media') return new Response(state.db)
      if (u.searchParams.get('fields') === 'ownedByMe') return ok({ ownedByMe: bearer === 'tok-owner' })
      if (u.searchParams.get('fields') === 'version') return ok({ version: state.version })
      return ok({ id: FILE, name: 'moneyduo-db.json', version: state.version, modifiedTime: 'now', ownedByMe: true, owners: [{ emailAddress: 'owner@example.com' }], capabilities: { canShare: true } })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const call = async (path: string, token: string, body: unknown = {}, raw?: string) => {
    const res = await worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers: { Origin: 'https://utente.github.io', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(raw !== undefined ? { 'Content-Length': String(raw.length) } : {}) }, body: raw ?? JSON.stringify(body) }), env)
    const text = await res.text()
    return { status: res.status, text, json: (() => { try { return JSON.parse(text) } catch { return {} } })() as any }
  }
  const seed = async () => void kv.set(`sess:${SID}`, await seal(env, { rt: 'rt1', email: 'owner@example.com', touched: Date.now() }))
  return { env, kv, state, call, seed }
}

describe('ponte verso il database', () => {
  it('/health dichiara il ponte solo se l\'accesso persistente è configurato', async () => {
    const { env } = setup()
    expect(((await (await worker.fetch(new Request('https://w.example/health'), env)).json()) as any).bridge).toBe(true)
    delete (env as any).SESSION_KEY
    expect(((await (await worker.fetch(new Request('https://w.example/health'), env)).json()) as any).bridge).toBe(false)
  })

  it('registra solo il proprietario del file, con la sessione del suo account', async () => {
    const t = setup(); await t.seed()
    expect((await t.call('/house/register', 'tok-anna', { fileId: FILE, session: SID })).status).toBe(403) // niente accesso diretto
    const other = setup(); await other.kv.set(`sess:${SID}`, await seal(other.env, { rt: 'rt1', email: 'qualcun.altro@example.com', touched: 1 }))
    expect((await other.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })).status).toBe(403) // sessione di un altro
    const ok = await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect(ok.status).toBe(200)
    expect(t.kv.get(`house:${FILE}`)).not.toContain('rt1') // il token è cifrato
    expect(JSON.parse(t.kv.get('inv:anna@example.com')!)).toEqual([FILE])
  })

  it('un membro con il file condiviso legge e scrive; uno non condiviso o con token di un\'altra app no', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/house/mine', 'tok-anna')).json.houses.map((h: any) => h.id)).toEqual([FILE])
    const meta = await t.call(`/db/meta?fileId=${FILE}`, 'tok-anna')
    expect(meta.json).toMatchObject({ version: '5', ownedByMe: false, capabilities: { canShare: false } }) // per il membro non è il proprietario
    const read = await t.call(`/db/read?fileId=${FILE}`, 'tok-anna')
    expect(read.status).toBe(200); expect(read.json.family.name).toBe('Casa')
    const w = await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-anna', null, JSON.stringify({ ...read.json, family: { name: 'Nuova' } }))
    expect(w.status).toBe(200); expect(w.json.version).toBe('6'); expect(w.json.ownedByMe).toBe(false)
    expect(JSON.parse(t.state.db).family.name).toBe('Nuova')
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-eve')).status).toBe(403) // non condiviso
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-alien')).status).toBe(401) // token emesso per un'altra app
    expect((await t.call('/house/mine', 'tok-eve')).json.houses).toEqual([])
  })

  it('chi ha solo lettura non scrive; il corpo troppo grande è rifiutato', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    EMAILS['tok-lettore'] = 'lettore@example.com'
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-lettore')).status).toBe(200)
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-lettore', null, VALID)).status).toBe(403)
    expect(t.state.patches).toBe(0)
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-anna', null, 'x'.repeat(8_000_001))).status).toBe(413)
  })

  it('tolta la condivisione su Drive l\'accesso si chiude; revocato l\'accesso del capofamiglia la famiglia si scollega', async () => {
    const shared: Array<[string, string]> = [['owner@example.com', 'owner'], ['anna@example.com', 'writer']]
    const t = setup({ shared }); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    shared.pop()
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-anna')).status).toBe(403)
    shared.push(['anna@example.com', 'writer'])
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-anna')).status).toBe(200)
    t.state.revoked = true
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-anna')).status).toBe(410)
    expect(t.kv.has(`house:${FILE}`)).toBe(false)
  })

  it('senza famiglia registrata non c\'è accesso via ponte', async () => {
    const t = setup()
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-anna')).status).toBe(404)
  })

  it('anche notifiche e Wallet passano dal ponte per chi ha il file condiviso', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/wallet/token', 'tok-anna', { fileId: FILE })).status).toBe(200)
    expect((await t.call('/wallet/token', 'tok-eve', { fileId: FILE })).status).toBe(403)
  })

  it('token senza lo scope drive.file, o emesso per un\'altra app: 401', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-noscope')).status).toBe(401)
    expect((await t.call('/house/join', 'tok-alien', { fileId: FILE })).status).toBe(401)
  })

  it('scrittura: 409 se la versione è cambiata, 400 se manca la versione o la forma non è valida', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=4`, 'tok-anna', null, VALID)).status).toBe(409) // la versione su Drive è 5
    expect((await t.call(`/db/write?fileId=${FILE}`, 'tok-anna', null, VALID)).status).toBe(400)
    for (const bad of ['{}', 'non json', '{"schemaVersion":2', JSON.stringify({ schemaVersion: 2, members: [] }), JSON.stringify({ family: {}, members: [], accounts: [], transactions: [] })]) {
      expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-anna', null, bad)).status).toBe(400)
    }
    expect(t.state.patches).toBe(0)
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-anna', null, VALID)).status).toBe(200)
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-anna', null, VALID)).status).toBe(409) // ora la versione è 6
  })

  it('codice famiglia: chi lo presenta viene aggiunto come scrittore (senza email), poi legge e scrive; ripetere non duplica', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-nuovo')).status).toBe(403) // non ancora condiviso
    const j = await t.call('/house/join', 'tok-nuovo', { fileId: FILE })
    expect(j.status).toBe(200)
    expect(t.state.shares).toEqual([{ type: 'user', role: 'writer', emailAddress: 'nuovo@example.com' }]) // e niente email di notifica (controllato dal mock)
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-nuovo')).status).toBe(200)
    expect((await t.call(`/db/write?fileId=${FILE}&expectedVersion=5`, 'tok-nuovo', null, VALID)).status).toBe(200)
    expect((await t.call('/house/join', 'tok-nuovo', { fileId: FILE })).status).toBe(200)
    expect(t.state.shares).toHaveLength(1)
    expect(JSON.parse(t.kv.get('inv:nuovo@example.com')!)).toEqual([FILE])
  })

  it('codice sconosciuto: 404; famiglia al completo: 403; file non valido: 400', async () => {
    const t = setup(); await t.seed()
    expect((await t.call('/house/join', 'tok-nuovo', { fileId: FILE })).status).toBe(404) // famiglia non registrata
    await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/house/join', 'tok-nuovo', { fileId: 'x' })).status).toBe(400)
    const full = setup({ shared: Array.from({ length: 20 }, (_, i): [string, string] => [i === 0 ? 'owner@example.com' : `p${i}@example.com`, i === 0 ? 'owner' : 'writer']) })
    await full.seed(); await full.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await full.call('/house/join', 'tok-nuovo', { fileId: FILE })).status).toBe(403)
    expect(full.state.shares).toEqual([])
  })

  it('le chiamate dal browser solo dalle origini autorizzate', async () => {
    const t = setup(); await t.seed()
    const res = await worker.fetch(new Request('https://w.example/house/join', { method: 'POST', headers: { Origin: 'https://evil.test', Authorization: 'Bearer tok-nuovo', 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: FILE }) }), t.env)
    expect(res.status).toBe(403)
  })

  it('iscrizione push per chi passa dal ponte', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    const sub = { endpoint: 'https://fcm.googleapis.com/send/abc', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }
    expect((await t.call('/subscribe', 'tok-anna', { fileId: FILE, subscription: sub })).status).toBe(200)
    expect((await t.call('/subscribe', 'tok-eve', { fileId: FILE, subscription: sub })).status).toBe(403)
  })
})
