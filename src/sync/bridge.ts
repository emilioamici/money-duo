import { pushUrl } from './push'
import { sessionId } from './auth'

/**
 * Ponte del Worker verso il database su Drive (vedi worker/src/bridge.ts): un invitato che non ha accesso diretto al file
 * (permesso ristretto `drive.file`) lo legge e lo scrive passando dal Worker, senza Selettore di Google.
 * Funziona se il capofamiglia ha registrato la famiglia aprendo l'app con l'accesso persistente.
 */

let availability: Promise<boolean> | null = null
/** Il Worker ha il ponte attivo? Un Worker vecchio (senza ponte) o non raggiungibile → false, e l'app usa i percorsi di prima. */
export function bridgeAvailable(): Promise<boolean> {
  const base = pushUrl()
  if (!base) return Promise.resolve(false)
  availability ??= fetch(base + '/health').then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.bridge).catch(() => false)
  return availability
}

/** Chiamata al ponte (POST). Non lancia per gli errori HTTP: li interpreta il chiamante. */
export function bridgeFetch(path: string, token: string, body?: string): Promise<Response> {
  return fetch(pushUrl() + path, { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ?? '{}' })
}

const REG_KEY = 'moneyduo:bridgeReg:'
const REG_EVERY_MS = 3 * 24 * 3600 * 1000

/**
 * Il capofamiglia (proprietario del file, con accesso persistente) affida la famiglia al ponte.
 * Si ripete ogni 3 giorni; `force` subito (per esempio dopo aver invitato qualcuno). Silenzioso se non applicabile.
 */
export async function ensureRegistered(fileId: string, token: string, opts: { owner: boolean; force?: boolean }): Promise<boolean> {
  const session = sessionId()
  if (!opts.owner || !session || !(await bridgeAvailable())) return false
  try {
    const last = Number(localStorage.getItem(REG_KEY + fileId)) || 0
    if (!opts.force && Date.now() - last < REG_EVERY_MS) return false
  } catch { /* storage non disponibile: si prova comunque */ }
  try {
    const r = await bridgeFetch('/house/register', token, JSON.stringify({ fileId, session }))
    if (r.status !== 200) return false
    try { localStorage.setItem(REG_KEY + fileId, String(Date.now())) } catch { /* noop */ }
    return true
  } catch { return false }
}

export interface BridgeHouse { id: string; name: string; modifiedTime: string }

/** Le famiglie a cui questo account è stato invitato e che si possono aprire dal ponte. */
export async function myHouses(token: string): Promise<BridgeHouse[]> {
  if (!(await bridgeAvailable())) return []
  try {
    const r = await bridgeFetch('/house/mine', token)
    const j = (await r.json().catch(() => ({}))) as { houses?: BridgeHouse[] }
    return r.status === 200 && Array.isArray(j.houses) ? j.houses : []
  } catch { return [] }
}
