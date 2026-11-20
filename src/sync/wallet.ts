import { t } from '../i18n'
import type { WalletItem } from '../lib/wallet'
import { pushUrl } from './push'

/**
 * Apple Wallet → MoneyDuo: parla con lo stesso server delle notifiche (worker/src/wallet.ts).
 * L'indirizzo a cui scrive il Comando Rapido contiene un token personale che il server non conserva in chiaro: si vede una volta sola.
 */

const TOKEN_KEY = 'moneyduo:walletToken:'
const ON_KEY = 'moneyduo:walletOn:'
const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* noop */ } }

export const walletAvailable = (): boolean => !!pushUrl()
/** Questo dispositivo importa le spese di Wallet (si attiva dalle Impostazioni). */
export const walletOn = (fileId: string): boolean => read(ON_KEY + fileId) === '1'
export const setWalletOn = (fileId: string, on: boolean): void => write(ON_KEY + fileId, on ? '1' : null)
/** Token mostrato all'attivazione e ricordato solo su questo dispositivo, per poter rivedere l'indirizzo. */
export const savedToken = (fileId: string): string | null => read(TOKEN_KEY + fileId)
export const saveToken = (fileId: string, token: string | null): void => write(TOKEN_KEY + fileId, token)
export const ingestUrl = (token: string): string => `${pushUrl()}/wallet/in/${token}`

async function post<T>(path: string, auth: string, body: unknown): Promise<T> {
  const r = await fetch(pushUrl() + path, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(j.error || t('Server notifiche: errore {status}', { status: r.status }))
  return j
}

/** `rotate` = genera un nuovo token (il Comando Rapido va aggiornato). Senza, se esiste già, `token` è assente. */
export const createToken = (fileId: string, auth: string, rotate = false) => post<{ exists: boolean; token?: string }>('/wallet/token', auth, { fileId, rotate })
export const revokeWallet = (fileId: string, auth: string) => post<{ ok: true }>('/wallet/revoke', auth, { fileId })
export const pullWallet = (fileId: string, auth: string) => post<{ enabled: boolean; items: WalletItem[] }>('/wallet/pull', auth, { fileId })
export const ackWallet = (fileId: string, auth: string, ids: string[]) => post<{ ok: true }>('/wallet/ack', auth, { fileId, ids })
