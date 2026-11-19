/** Google Identity Services (token model). Il token vive in memoria + sessionStorage (scade dopo ~1h). */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

export class GoogleAuthError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any
  }
}

let scriptPromise: Promise<void> | null = null

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new GoogleAuthError('Impossibile caricare Google Identity Services (sei offline?).'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

interface Tok { value: string; exp: number }
const SK = 'moneyduo:token'
let tok: Tok | null = null
try {
  const raw = sessionStorage.getItem(SK)
  if (raw) tok = JSON.parse(raw) as Tok
} catch { /* storage non disponibile */ }

export function cachedToken(): string | null {
  return tok && tok.exp - Date.now() > 60_000 ? tok.value : null
}

/** Millisecondi di validità residua del token (0 se assente o scaduto). */
export function tokenRemainingMs(): number {
  return tok ? Math.max(0, tok.exp - Date.now()) : 0
}

export function clearToken(): void {
  tok = null
  try { sessionStorage.removeItem(SK) } catch { /* noop */ }
}

export type Prompt = '' | 'none' | 'consent' | 'select_account'

/** Richiede un token. Da chiamare in risposta a un gesto dell'utente (altrimenti il popup può essere bloccato). */
export async function requestToken(clientId: string, opts: { prompt?: Prompt; hint?: string } = {}): Promise<string> {
  if (!clientId) throw new GoogleAuthError('Client ID Google non configurato.')
  await loadGis()
  return new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      prompt: opts.prompt ?? '',
      hint: opts.hint || undefined,
      callback: (r: any) => {
        if (r.error) return reject(new GoogleAuthError(r.error_description || r.error))
        tok = { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 }
        try { sessionStorage.setItem(SK, JSON.stringify(tok)) } catch { /* noop */ }
        resolve(tok.value)
      },
      error_callback: (e: any) => reject(new GoogleAuthError(e?.type === 'popup_closed' ? 'Accesso annullato.' : e?.message || e?.type || 'Accesso non riuscito.')),
    })
    client.requestAccessToken()
  })
}

export function revokeToken(): void {
  const v = tok?.value
  clearToken()
  if (v && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(v, () => undefined)
}
