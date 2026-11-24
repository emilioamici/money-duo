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

const readId = (): string | null => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id?: string } | null; return v?.id || null } catch { return null } }
const saveId = (id: string | null): void => { try { if (id) localStorage.setItem(KEY, JSON.stringify({ id })); else localStorage.removeItem(KEY) } catch { /* noop */ } }

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
export async function enableLock(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32), rp: { name: 'Money Duo', id: location.hostname }, user: { id: rand(16), name: 'moneyduo', displayName: 'Money Duo' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, attestation: 'none', timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('annullato')
  saveId(b64u.enc(cred.rawId))
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

export async function unlock(): Promise<void> { await verify(); set({ locked: false }) }
/** Si disattiva solo dopo aver confermato l'identità. */
export async function disableLock(): Promise<void> { await verify(); saveId(null); set({ enabled: false, locked: false }) }
/** Toglie il blocco senza chiedere nulla (solo per «scollega questo dispositivo»). */
export function forgetLock(): void { saveId(null); set({ enabled: false, locked: false }) }
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
