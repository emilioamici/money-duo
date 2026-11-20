import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('selettore di Google: configurazione e permesso richiesto', () => {
  it('senza chiave e numero del progetto: tutto Drive, come prima', async () => {
    const { pickerConfigured } = await import('./picker')
    const { driveScope, DRIVE_FULL_SCOPE } = await import('./google')
    expect(pickerConfigured()).toBe(false)
    expect(driveScope()).toBe(DRIVE_FULL_SCOPE)
  })
  it('con entrambi i valori: solo drive.file', async () => {
    store.set('moneyduo:googleApiKey', 'AIzaTest'); store.set('moneyduo:googleAppId', '123456789')
    const { pickerConfigured } = await import('./picker')
    const { driveScope, DRIVE_FILE_SCOPE } = await import('./google')
    expect(pickerConfigured()).toBe(true)
    expect(driveScope()).toBe(DRIVE_FILE_SCOPE)
  })
  it('ne basta uno solo? No: servono tutti e due', async () => {
    store.set('moneyduo:googleApiKey', 'AIzaTest')
    expect((await import('./picker')).pickerConfigured()).toBe(false)
  })
  it('le variabili della build hanno la precedenza sui valori salvati', async () => {
    store.set('moneyduo:googleApiKey', 'vecchia'); store.set('moneyduo:googleAppId', '1')
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIzaBuild'); vi.stubEnv('VITE_GOOGLE_APP_ID', '999')
    const m = await import('./picker')
    expect(m.googleApiKey()).toBe('AIzaBuild'); expect(m.googleAppId()).toBe('999')
  })
  it('il permesso ristretto non include l\'accesso a tutto Drive', async () => {
    const { DRIVE_FILE_SCOPE, DRIVE_FULL_SCOPE } = await import('./google')
    expect(DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file')
    expect(DRIVE_FILE_SCOPE).not.toBe(DRIVE_FULL_SCOPE)
  })
})
