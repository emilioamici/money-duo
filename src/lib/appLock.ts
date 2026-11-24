/**
 * Blocco dell'app con Face ID / impronta / codice del telefono (WebAuthn, «platform authenticator»).
 * È un blocco della schermata per questo dispositivo: protegge da chi ha il telefono sbloccato in mano, non è una cifratura dei dati.
 * La credenziale non va verificata da nessun server: basta che il telefono confermi l'identità dell'utente.
 */
const KEY = 'moneyduo:lock'
/** Dopo quanto tempo in background l'app si blocca. */
export const LOCK_AFTER_MS = 60_000

const b64u = {
  enc: (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
}
const rand = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

interface Rec { id: string; salt?: string; hash?: string }
const readRec = (): Rec | null => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Rec | null; return v?.id ? v : null } catch { return null } }
const saveRec = (r: Rec | null): void => { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else { localStorage.removeItem(KEY); localStorage.removeItem(FAILS) } } catch { /* noop */ } }
const readId = (): string | null => readRec()?.id ?? null
const FAILS = 'moneyduo:lock:fails'
export const PIN_LENGTH = 6
export const isPin = (s: string): boolean => /^\d{6}$/.test(s)
export const hasPin = (): boolean => !!readRec()?.hash

const hashPin = async (pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return b64u.enc(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256))
}

export interface LockState { enabled: boolean; locked: boolean }
// all'avvio, con il blocco attivo, l'app parte già bloccata (niente lampo dei dati)
let state: LockState = (() => { const on = typeof localStorage !== 'undefined' && !!readId(); return { enabled: on, locked: on } })()
const listeners = new Set<() => void>()
const set = (p: Partial<LockState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()) }
export const getLockState = (): LockState => state
export const subscribeLock = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Il dispositivo sa fare l'autenticazione biometrica del browser (serve un contesto sicuro e un autenticatore di piattaforma)? */
export async function lockSupported(): Promise<boolean> {
  try {
    return typeof window !== 'undefined' && window.isSecureContext && 'PublicKeyCredential' in window && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  } catch { return false }
}

/** Chiede al telefono di registrare la credenziale (Face ID / impronta) e attiva il blocco. Lancia se l'utente annulla. */
export async function enableLock(pin: string): Promise<void> {
  if (!isPin(pin)) throw new Error('codice non valido')
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32), rp: { name: 'Money Duo', id: location.hostname }, user: { id: rand(16), name: 'moneyduo', displayName: 'Money Duo' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, attestation: 'none', timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('annullato')
  const salt = rand(16)
  saveRec({ id: b64u.enc(cred.rawId), salt: b64u.enc(salt.buffer), hash: await hashPin(pin, salt) })
  set({ enabled: true, locked: false })
}

/** Chiede al telefono di confermare l'identità (Face ID / impronta / codice). Lancia se fallisce o l'utente annulla. */
export async function verify(): Promise<void> {
  const id = readId()
  if (!id) throw new Error('nessuna credenziale')
  await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: b64u.dec(id), transports: ['internal'] }], userVerification: 'required', timeout: 60_000 },
  })
}

/** Esito del controllo del codice: giusto, sbagliato, oppure bloccato per `wait` secondi dopo troppi errori. */
export type PinResult = { ok: true } | { ok: false; wait: number }
const readFails = (): { n: number; until: number } => { try { return JSON.parse(localStorage.getItem(FAILS) ?? '') as { n: number; until: number } } catch { return { n: 0, until: 0 } } }
/** Attesa dopo `n` errori di fila: nessuna fino a 4, poi 30 s, 60 s, 120 s… fino a 1 ora. */
export const waitAfter = (n: number): number => (n < 5 ? 0 : Math.min(3600, 30 * 2 ** (n - 5)))

export async function verifyPin(pin: string): Promise<PinResult> {
  const f = readFails(), now = Date.now()
  if (f.until > now) return { ok: false, wait: Math.ceil((f.until - now) / 1000) }
  const r = readRec()
  if (!r?.hash || !r.salt) return { ok: false, wait: 0 }
  if (isPin(pin) && (await hashPin(pin, b64u.dec(r.salt))) === r.hash) { try { localStorage.removeItem(FAILS) } catch { /* noop */ } return { ok: true } }
  const n = f.n + 1, wait = waitAfter(n)
  try { localStorage.setItem(FAILS, JSON.stringify({ n, until: wait ? now + wait * 1000 : 0 })) } catch { /* noop */ }
  return { ok: false, wait }
}

export async function unlock(): Promise<void> { await verify(); set({ locked: false }) }
export async function unlockWithPin(pin: string): Promise<PinResult> { const r = await verifyPin(pin); if (r.ok) set({ locked: false }); return r }
/** Si disattiva solo dopo aver confermato l'identità (Face ID / impronta, oppure il codice). */
export async function disableLock(pin?: string): Promise<PinResult> {
  if (pin !== undefined) { const r = await verifyPin(pin); if (!r.ok) return r } else await verify()
  saveRec(null); set({ enabled: false, locked: false }); return { ok: true }
}
/** Toglie il blocco senza chiedere nulla (solo per «scollega questo dispositivo»). */
export function forgetLock(): void { saveRec(null); set({ enabled: false, locked: false }) }
export const lockNow = (): void => { if (state.enabled) set({ locked: true }) }

/** Il tempo in background è sufficiente per bloccare? */
export const shouldLock = (hiddenAt: number | null, now: number, after: number = LOCK_AFTER_MS): boolean => hiddenAt !== null && now - hiddenAt >= after

/** Blocca l'app quando torna in primo piano dopo `LOCK_AFTER_MS` in background. Ritorna la funzione per smettere di ascoltare. */
export function watchVisibility(): () => void {
  let hiddenAt: number | null = null
  const on = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    if (shouldLock(hiddenAt, Date.now())) lockNow()
    hiddenAt = null
  }
  document.addEventListener('visibilitychange', on)
  return () => document.removeEventListener('visibilitychange', on)
}
