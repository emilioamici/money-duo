import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
})

const KEY = 'B' + 'a'.repeat(86)

describe('configError', () => {
  it('valori giusti o vuoti: nessun errore', async () => {
    const { configError } = await import('./push')
    expect(configError('https://moneyduo-push.nome.workers.dev', KEY)).toBeNull()
    expect(configError('', '')).toBeNull()
  })
  it('indirizzo: schema, percorso e spazi', async () => {
    const { configError } = await import('./push')
    expect(configError('moneyduo-push.nome.workers.dev', KEY)).toContain('non è valido')
    expect(configError('http://moneyduo-push.nome.workers.dev', KEY)).toContain('non è valido')
    expect(configError('https://moneyduo-push.nome.workers.dev/health', KEY)).toContain('senza percorso')
    expect(configError('https://moneyduo push.dev', KEY)).toContain('non è valido')
  })
  it('chiave pubblica: lunghezza, prima lettera, prefisso incollato per errore, chiave privata', async () => {
    const { configError } = await import('./push')
    const url = 'https://x.workers.dev'
    expect(configError(url, 'VAPID_PUBLIC_KEY=' + KEY)).toContain('87 caratteri')
    expect(configError(url, 'a'.repeat(43))).toContain('chiave privata')          // la privata è lunga 43
    expect(configError(url, KEY.slice(0, 80))).toContain('87 caratteri')
    expect(configError(url, 'C' + 'a'.repeat(86))).toContain('iniziare con B')
  })
  it('la chiave generata dallo script ha il formato atteso', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { configError } = await import('./push')
    const pub = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' })
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]).toString('base64url')
    expect(raw).toHaveLength(87)
    expect(configError('https://x.workers.dev', raw)).toBeNull()
  })
})
