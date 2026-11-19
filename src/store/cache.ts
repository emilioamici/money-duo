import type { Db } from '../types'
import { parseDb } from '../lib/merge'

/**
 * Copia locale del database, per aprire l'app subito e usarla offline.
 * Vive in IndexedDB (decine di MB) e non in localStorage (~5 MB, su iPhone si riempiva e il salvataggio falliva in silenzio).
 * Insieme ai dati si salva la versione del file Drive a cui corrispondono: così, se la copia manca o è disallineata,
 * il motore di sincronizzazione sa di doverla ricostruire da Drive PRIMA di inviare qualsiasi cosa.
 */

const IDB_NAME = 'moneyduo-cache'
const STORE = 'kv'
const KEY = 'db'
const LEGACY_KEY = 'moneyduo:db:v1'
const LEGACY_VERSION_KEY = 'moneyduo:db:ver'

export type CacheState = 'ok' | 'stale' | 'missing'
interface Rec { db: Db; version: string | null; savedAt: string }

let idb: IDBDatabase | null = null
let loaded: { db: Db | null; version: string | null } = { db: null, version: null }
let healthy = true
const listeners = new Set<() => void>()
const setHealthy = (v: boolean) => { if (healthy !== v) { healthy = v; listeners.forEach((l) => l()) } }

export const subscribeCacheHealth = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** false = non riesco a salvare la copia locale (spazio del browser esaurito o archiviazione bloccata) */
export const getCacheHealth = (): boolean => healthy

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
}

const idbGet = (): Promise<Rec | null> =>
  new Promise((resolve) => {
    if (!idb) return resolve(null)
    try {
      const r = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      r.onsuccess = () => resolve((r.result as Rec | undefined) ?? null)
      r.onerror = () => resolve(null)
    } catch { resolve(null) }
  })

const idbPut = (rec: Rec): Promise<boolean> =>
  new Promise((resolve) => {
    if (!idb) return resolve(false)
    try {
      const tx = idb.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec, KEY)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch { resolve(false) }
  })

/** Da chiamare una volta, prima di avviare l'app. Legge la copia da IndexedDB (o, se vecchia, da localStorage). */
export async function initCache(): Promise<void> {
  idb = await openDb()
  const rec = await idbGet()
  if (rec?.db) {
    try { loaded = { db: parseDb(rec.db), version: rec.version } } catch { loaded = { db: null, version: null } }
    return
  }
  // copia delle versioni precedenti (localStorage): versione di Drive sconosciuta → verrà riallineata da Drive
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw) loaded = { db: parseDb(JSON.parse(raw)), version: localStorage.getItem(LEGACY_VERSION_KEY) }
  } catch { loaded = { db: null, version: null } }
}

export const getLoadedCache = (): { db: Db | null; version: string | null } => loaded

/** Stato della copia rispetto alla versione di Drive ricordata dalla sincronizzazione. */
export function cacheState(syncVersion: string | null): CacheState {
  if (!loaded.db) return 'missing'
  return loaded.version === syncVersion ? 'ok' : 'stale'
}

let timer: ReturnType<typeof setTimeout> | undefined
let pending: { db: Db; version: string | null } | null = null

/** Salva la copia (con un breve ritardo, per non scrivere a ogni tasto). */
export function writeCache(db: Db, version: string | null): void {
  pending = { db, version }
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), 300)
}

export async function flush(): Promise<void> {
  if (!pending) return
  const { db, version } = pending
  pending = null
  const rec: Rec = { db, version, savedAt: new Date().toISOString() }
  if (await idbPut(rec)) {
    setHealthy(true)
    try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_VERSION_KEY) } catch { /* noop */ }
    return
  }
  // IndexedDB non disponibile (es. navigazione privata): ripiego su localStorage
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(db))
    localStorage.setItem(LEGACY_VERSION_KEY, version ?? '')
    setHealthy(true)
  } catch {
    setHealthy(false)
  }
}

// salva subito quando l'app va in background o si chiude
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush() })
  window.addEventListener('pagehide', () => void flush())
}
