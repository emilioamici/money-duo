import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type KV } from './index'
import { b64u } from './webpush'
import { seal, unseal } from './auth'

const ORIGIN = 'https://utente.github.io'
const APP = `${ORIGIN}/money-duo/`
const WORKER = 'https://push.example.workers.dev'

class MemKV implements KV {
  data = new Map<string, string>(); writes = 0
  async get(k: string) { return this.data.get(k) ?? null }
  async put(k: string, v: string) { this.writes++; this.data.set(k, v) }
  async delete(k: string) { this.data.delete(k) }
  async list(o: { prefix: string }) { return { keys: [...this.data.keys()].filter((k) => k.startsWith(o.prefix)).map((name) => ({ name })) } }
}

let env: Env, kv: MemKV
let googleToken: (form: URLSearchParams) => Response
let tokenCalls: URLSearchParams[]

beforeEach(() => {
  kv = new MemKV()
  env = {
    SUBS: kv, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'super-secret', SESSION_KEY: b64u.enc(crypto.getRandomValues(new Uint8Array(32))),
  }
  tokenCalls = []
  googleToken = (f) => (f.get('grant_type') === 'authorization_code'
    ? Response.json({ access_token: 'at-1', expires_in: 3599, refresh_token: 'rt-SEGRETO', scope: 'https://www.googleapis.com/auth/drive' })
    : Response.json({ access_token: 'at-fresh', expires_in: 3599 }))
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url
    if (url === 'https://oauth2.googleapis.com/token') { const f = new URLSearchParams(init!.body as URLSearchParams); tokenCalls.push(f); return googleToken(f) }
    if (url.includes('/drive/v3/about')) return Response.json({ user: { emailAddress: 'Emilio@Example.com' } })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const get = (path: string) => worker.fetch(new Request(WORKER + path), env)
const post = (path: string, token?: string, origin = ORIGIN) =>
  worker.fetch(new Request(WORKER + path, { method: 'POST', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: '{}' }), env)

/** percorre /auth/start e /auth/callback come farebbe il browser; ritorna l'identificativo di sessione */
async function login(): Promise<{ sid: string; location: string }> {
  const start = await get(`/auth/start?return=${encodeURIComponent(APP)}&hint=emilio@example.com`)
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')!
  const cb = await get(`/auth/callback?code=codice-google&state=${state}`)
  const location = cb.headers.get('Location')!
  return { sid: new URL(location).hash.replace('#moneyduo_session=', ''), location }
}

describe('/auth/start', () => {
  it('con scope=file chiede solo il permesso ristretto drive.file', async () => {
    const r = await get(`/auth/start?return=${encodeURIComponent(APP)}&scope=file`)
    expect(new URL(r.headers.get('Location')!).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    const other = await get(`/auth/start?return=${encodeURIComponent(APP)}&scope=qualunque`)
    expect(new URL(other.headers.get('Location')!).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive')   // valori sconosciuti: come prima
  })
  it('reindirizza a Google chiedendo il token di rinnovo e il consenso', async () => {
    const r = await get(`/auth/start?return=${encodeURIComponent(APP)}&hint=emilio@example.com`)
    expect(r.status).toBe(302)
    const u = new URL(r.headers.get('Location')!)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${WORKER}/auth/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/drive', login_hint: 'emilio@example.com',
    })
    expect(kv.data.get(`st:${u.searchParams.get('state')}`)).toBe(APP)
  })
  it('rifiuta indirizzi di ritorno non autorizzati o assenti (niente redirect aperti)', async () => {
    expect((await get(`/auth/start?return=${encodeURIComponent('https://evil.test/')}`)).status).toBe(403)
    expect((await get('/auth/start')).status).toBe(400)
    expect((await get(`/auth/start?return=${encodeURIComponent('https://utente.github.io.evil.test/')}`)).status).toBe(403)
    expect(kv.data.size).toBe(0)
  })
  it('non configurato: pagina di spiegazione, mai un redirect', async () => {
    env.GOOGLE_CLIENT_SECRET = undefined
    const r = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    expect(r.status).toBe(503)
    expect((await r.text())).toContain('non configurato')
  })
})

describe('/auth/callback', () => {
  it('scambia il codice, salva la sessione CIFRATA e rimanda all\'app con l\'id nel frammento', async () => {
    const { sid, location } = await login()
    expect(location.startsWith(APP + '#moneyduo_session=')).toBe(true)
    expect(sid).toMatch(/^[\w-]{40,}$/)
    const f = tokenCalls[0]
    expect(Object.fromEntries(f)).toMatchObject({ code: 'codice-google', client_id: env.GOOGLE_CLIENT_ID, client_secret: 'super-secret', redirect_uri: `${WORKER}/auth/callback`, grant_type: 'authorization_code' })
    const stored = kv.data.get(`sess:${sid}`)!
    expect(stored).toBeTruthy()
    expect(stored).not.toContain('rt-SEGRETO')              // il token di rinnovo non è in chiaro
    expect(JSON.stringify([...kv.data.values()])).not.toContain('rt-SEGRETO')
    expect(await unseal(env, stored)).toMatchObject({ rt: 'rt-SEGRETO', email: 'emilio@example.com' })
  })
  it('lo stato è monouso e scade; stato inventato rifiutato', async () => {
    const start = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!
    expect((await get(`/auth/callback?code=c&state=${state}`)).status).toBe(302)
    expect((await get(`/auth/callback?code=c&state=${state}`)).status).toBe(400) // già usato
    expect((await get('/auth/callback?code=c&state=inventato')).status).toBe(400)
    expect((await get('/auth/callback?code=c')).status).toBe(400)
  })
  it('Google senza token di rinnovo: spiega cosa fare e non crea sessioni', async () => {
    googleToken = () => Response.json({ access_token: 'at', scope: 'https://www.googleapis.com/auth/drive' })
    const start = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    const r = await get(`/auth/callback?code=c&state=${new URL(start.headers.get('Location')!).searchParams.get('state')}`)
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('myaccount.google.com/permissions')
    expect([...kv.data.keys()].filter((k) => k.startsWith('sess:'))).toHaveLength(0)
  })
  it('permessi Drive negati, scambio rifiutato, consenso annullato', async () => {
    googleToken = () => Response.json({ access_token: 'at', refresh_token: 'rt', scope: 'openid' })
    let start = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    expect((await get(`/auth/callback?code=c&state=${new URL(start.headers.get('Location')!).searchParams.get('state')}`)).status).toBe(400)
    googleToken = () => new Response('{}', { status: 400 })
    start = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    expect((await get(`/auth/callback?code=c&state=${new URL(start.headers.get('Location')!).searchParams.get('state')}`)).status).toBe(502)
    start = await get(`/auth/start?return=${encodeURIComponent(APP)}`)
    expect((await get(`/auth/callback?error=access_denied&state=${new URL(start.headers.get('Location')!).searchParams.get('state')}`)).status).toBe(400)
  })
})

describe('/auth/refresh', () => {
  it('con la sessione dà un token d\'accesso fresco; il token di rinnovo resta sul server', async () => {
    const { sid } = await login()
    const r = await post('/auth/refresh', sid)
    expect(r.status).toBe(200)
    const body = await r.json() as Record<string, unknown>
    expect(body).toEqual({ access_token: 'at-fresh', expires_in: 3599, email: 'emilio@example.com' })
    expect(JSON.stringify(body)).not.toContain('rt-SEGRETO')
    expect(Object.fromEntries(tokenCalls[tokenCalls.length - 1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-SEGRETO', client_secret: 'super-secret' })
  })
  it('non scrive su KV a ogni rinnovo (limite di scritture del piano gratuito)', async () => {
    const { sid } = await login()
    const w = kv.writes
    for (let i = 0; i < 5; i++) await post('/auth/refresh', sid)
    expect(kv.writes).toBe(w)
  })
  it('sessione vecchia di oltre 30 giorni: si rinnova la scadenza', async () => {
    const { sid } = await login()
    const s = (await unseal(env, kv.data.get(`sess:${sid}`)!))!
    kv.data.set(`sess:${sid}`, await seal(env, { ...s, touched: Date.now() - 40 * 24 * 3600 * 1000 }))
    const w = kv.writes
    await post('/auth/refresh', sid)
    expect(kv.writes).toBe(w + 1)
  })
  it('mancante, sconosciuta o manomessa: 401; origine non autorizzata: 403', async () => {
    const { sid } = await login()
    expect((await post('/auth/refresh')).status).toBe(401)
    expect((await post('/auth/refresh', 'x'.repeat(43))).status).toBe(401)
    const sealed = kv.data.get(`sess:${sid}`)!
    const i = sealed.indexOf('.') + 6 // un carattere nel mezzo del testo cifrato (sempre significativo)
    kv.data.set(`sess:${sid}`, sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1)) // manomissione: il tag GCM non quadra
    expect((await post('/auth/refresh', sid)).status).toBe(401)
    expect((await post('/auth/refresh', sid, 'https://evil.test')).status).toBe(403)
  })
  it('accesso revocato su Google (invalid_grant): sessione eliminata, serve nuovo accesso', async () => {
    const { sid } = await login()
    googleToken = () => Response.json({ error: 'invalid_grant' }, { status: 400 })
    expect((await post('/auth/refresh', sid)).status).toBe(401)
    expect(kv.data.has(`sess:${sid}`)).toBe(false)
  })
  it('Google non raggiungibile: 502 e la sessione resta', async () => {
    const { sid } = await login()
    googleToken = () => new Response('{}', { status: 503 })
    expect((await post('/auth/refresh', sid)).status).toBe(502)
    expect(kv.data.has(`sess:${sid}`)).toBe(true)
  })
})

describe('/auth/logout e /health', () => {
  it('elimina solo la sessione di quel dispositivo', async () => {
    const a = await login(), b = await login()
    expect((await post('/auth/logout', a.sid)).status).toBe(200)
    expect(kv.data.has(`sess:${a.sid}`)).toBe(false)
    expect(kv.data.has(`sess:${b.sid}`)).toBe(true)
    expect((await post('/auth/refresh', a.sid)).status).toBe(401)
    expect((await post('/auth/refresh', b.sid)).status).toBe(200)
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/revoke'))).toBe(false) // non si revoca su Google: scollegherebbe gli altri dispositivi
  })
  it('/health dice se l\'accesso persistente è configurato', async () => {
    expect(await (await get('/health')).json()).toEqual({ ok: true, auth: true })
    env.SESSION_KEY = undefined
    expect(await (await get('/health')).json()).toEqual({ ok: true, auth: false })
  })
})
