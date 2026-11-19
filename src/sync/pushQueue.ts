/**
 * Coda delle notifiche push da inviare agli altri membri.
 * Una notifica si mette in coda quando si fa la modifica, ma parte solo DOPO che i dati sono arrivati su Drive:
 * così chi la riceve apre l'app e trova già la spesa. Se la rete manca, la coda resta (anche dopo un riavvio) e si svuota
 * al primo invio riuscito. Le voci troppo vecchie, o riferite a elementi eliminati nel frattempo, vengono scartate.
 */

const KEY = 'moneyduo:pushQueue'
const MAX_ITEMS = 100
export const MAX_AGE_MS = 24 * 3600 * 1000

export interface QueuedPush {
  /** identificativo della notifica + destinatario: serve a non accodare due volte la stessa */
  key: string
  fileId: string
  email: string
  title: string
  body: string
  tag: string
  at: number
  /** elemento a cui si riferisce: se non esiste più, la notifica non ha senso */
  txId?: string
  accountId?: string
}

export type SendResult = 'ok' | 'retry' | 'drop'

export function loadQueue(): QueuedPush[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as QueuedPush[] } catch { return [] }
}
function saveQueue(list: QueuedPush[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ITEMS))) } catch { /* noop */ }
}

/** Aggiunge le voci nuove (senza doppioni). */
export function enqueue(items: QueuedPush[]): void {
  if (!items.length) return
  const cur = loadQueue()
  const seen = new Set(cur.map((q) => q.key))
  const fresh = items.filter((q) => (seen.has(q.key) ? false : (seen.add(q.key), true)))
  saveQueue([...cur, ...fresh])
}

let flushing = false

/**
 * Svuota la coda. `send` dice come è andato ogni invio: 'ok' (consegnato al server), 'drop' (errore definitivo: si scarta),
 * 'retry' (rete o server in errore: si tiene e ci si ferma, per non insistere). Ritorna quante voci sono rimaste.
 */
export async function flushQueue(opts: { fileId: string; exists: (q: QueuedPush) => boolean; send: (q: QueuedPush) => Promise<SendResult>; now?: number }): Promise<{ sent: number; dropped: number; left: number }> {
  if (flushing) return { sent: 0, dropped: 0, left: loadQueue().length }
  flushing = true
  try {
    const now = opts.now ?? Date.now()
    const out: QueuedPush[] = []
    let sent = 0
    let dropped = 0
    const list = loadQueue()
    for (let i = 0; i < list.length; i++) {
      const q = list[i]
      if (q.fileId !== opts.fileId || now - q.at > MAX_AGE_MS || !opts.exists(q)) { dropped++; continue }
      const r = await opts.send(q)
      if (r === 'ok') sent++
      else if (r === 'drop') dropped++
      else { out.push(q, ...list.slice(i + 1)); break }
    }
    saveQueue(out)
    return { sent, dropped, left: out.length }
  } finally { flushing = false }
}
