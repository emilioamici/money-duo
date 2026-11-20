import { describe, expect, it } from 'vitest'
import worker, { type Env } from './index'
import { seal } from './auth'

const SID = 'S'.repeat(40)
const FILE = 'FILEID12345'
const EMAILS: Record<string, string> = { 'tok-owner': 'owner@example.com', 'tok-house': 'owner@example.com', 'tok-anna': 'anna@example.com', 'tok-lettore': 'lettore@example.com', 'tok-eve': 'eve@example.com', 'tok-alien': 'anna@example.com' }

function setup(opts: { shared?: Array<[string, string]> } = {}) {
  const kv = new Map<string, string>()
  const state = { version: '5', db: JSON.stringify({ schemaVersion: 2, family: { name: 'Casa' }, transactions: [] }), revoked: false, patches: 0 }
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
    if (u.pathname === '/tokeninfo') return new Response(JSON.stringify({ aud: u.searchParams.get('access_token') === 'tok-alien' ? 'altra-app' : 'cid' }))
    if (u.pathname.endsWith('/about')) return EMAILS[bearer] ? ok({ user: { emailAddress: EMAILS[bearer] } }) : new Response('{}', { status: 401 })
    const direct = bearer === 'tok-owner' || bearer === 'tok-house'
    if (u.pathname.endsWith('/permissions')) return direct ? ok({ permissions: shared.map(([emailAddress, role]) => ({ emailAddress, role })) }) : new Response('{}', { status: 404 })
    if (u.pathname.startsWith('/upload/')) {
      if (!direct) return new Response('{}', { status: 404 })
      state.patches++; state.version = String(Number(state.version) + 1); state.db = await new Response(init!.body as ReadableStream).text()
      return ok({ id: FILE, name: 'moneyduo-db.json', version: state.version, modifiedTime: 'now', ownedByMe: true })
    }
    if (u.pathname.includes('/files/')) {
      if (!direct) return new Response('{}', { status: 404 })
      if (u.searchParams.get('alt') === 'media') return new Response(state.db)
      if (u.searchParams.get('fields') === 'ownedByMe') return ok({ ownedByMe: bearer === 'tok-owner' })
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
    const w = await t.call(`/db/write?fileId=${FILE}`, 'tok-anna', null, JSON.stringify({ ...read.json, family: { name: 'Nuova' } }))
    expect(w.status).toBe(200); expect(w.json.version).toBe('6'); expect(w.json.ownedByMe).toBe(false)
    expect(JSON.parse(t.state.db).family.name).toBe('Nuova')
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-eve')).status).toBe(403) // non condiviso
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-alien')).status).toBe(403) // token emesso per un'altra app
    expect((await t.call('/house/mine', 'tok-eve')).json.houses).toEqual([])
  })

  it('chi ha solo lettura non scrive; il corpo troppo grande è rifiutato', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    EMAILS['tok-lettore'] = 'lettore@example.com'
    expect((await t.call(`/db/read?fileId=${FILE}`, 'tok-lettore')).status).toBe(200)
    expect((await t.call(`/db/write?fileId=${FILE}`, 'tok-lettore', null, '{}')).status).toBe(403)
    expect(t.state.patches).toBe(0)
    expect((await t.call(`/db/write?fileId=${FILE}`, 'tok-anna', null, 'x'.repeat(12_000_001))).status).toBe(413)
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
})
