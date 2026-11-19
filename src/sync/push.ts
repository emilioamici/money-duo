/**
 * Notifiche push dal server (Cloudflare Worker, vedi worker/README.md).
 * Il server conosce solo i dispositivi iscritti e non ha mai accesso a Drive: chi fa una modifica gli dice a chi inviare.
 */

const URL_KEY = 'moneyduo:pushUrl'
const VAPID_KEY = 'moneyduo:vapidKey'

const read = (k: string): string => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const strip = (s: string) => s.trim().replace(/\/+$/, '')

/** Indirizzo del server: dalla build (VITE_PUSH_URL) oppure inserito nell'app. */
export const pushUrl = (): string => strip(read(URL_KEY) || (import.meta.env.VITE_PUSH_URL as string | undefined) || '')
export const vapidPublicKey = (): string => read(VAPID_KEY) || (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || ''
export const pushConfigured = (): boolean => !!pushUrl() && !!vapidPublicKey()

export function savePushConfig(url: string, vapid: string): void {
  try { localStorage.setItem(URL_KEY, strip(url)); localStorage.setItem(VAPID_KEY, vapid.trim()) } catch { /* noop */ }
}

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'

const keyBytes = (b64u: string): Uint8Array => {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4)
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function post(path: string, token: string, body: unknown): Promise<unknown> {
  const r = await fetch(pushUrl() + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(j.error || `Server notifiche: errore ${r.status}`)
  return j
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('./sw.js'))
  await navigator.serviceWorker.ready
  return reg
}

/** Dispositivo attualmente iscritto al push (null se no). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try { return await (await registration()).pushManager.getSubscription() } catch { return null }
}

/** Chiede il permesso (da chiamare in risposta a un tocco), iscrive il dispositivo e lo registra sul server. */
export async function enablePush(fileId: string, token: string): Promise<void> {
  if (!pushConfigured()) throw new Error('Server delle notifiche non configurato.')
  if (!pushSupported()) throw new Error('Questo browser non supporta le notifiche push. Su iPhone servono iOS 16.4+ e l\'app aggiunta alla schermata Home.')
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (perm !== 'granted') throw new Error('Permesso negato: abilitalo dalle impostazioni del browser o del telefono per questo sito.')
  const reg = await registration()
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey()) as BufferSource }))
  await post('/subscribe', token, { fileId, subscription: sub.toJSON() })
}

/** Rinnova la registrazione sul server (si fa a ogni apertura: tiene viva la sottoscrizione). */
export async function refreshPush(fileId: string, token: string): Promise<void> {
  const sub = await currentSubscription()
  if (sub) await post('/subscribe', token, { fileId, subscription: sub.toJSON() })
}

export async function disablePush(fileId: string, token: string | null): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => false)
  if (token) await post('/unsubscribe', token, { fileId, endpoint }).catch(() => undefined)
}

export interface PushMessage { recipients: string[]; title: string; body: string; tag?: string; test?: boolean }

/** Chiede al server di inviare una notifica ai destinatari. */
export async function sendPush(fileId: string, token: string, m: PushMessage): Promise<void> {
  await post('/notify', token, { fileId, ...m })
}
