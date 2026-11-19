import type { Db } from '../types'
import { mergeDb, parseDb, sameData } from '../lib/merge'
import { nowIso } from '../lib/ids'
import * as drive from './drive'
import { DriveError } from './drive'
import { GoogleAuthError, cachedToken, clearToken, requestToken, revokeToken, type Prompt } from './google'

/**
 * Motore di sincronizzazione con un file JSON su Google Drive.
 * Ciclo: leggi `version` remota → se cambiata scarica+merge per record → carica solo se serve.
 */

const KEY = 'moneyduo:sync'
const CLIENT_KEY = 'moneyduo:clientId'

interface Persisted {
  fileId: string | null
  fileName: string | null
  email: string | null
  remoteVersion: string | null
  lastSyncAt: string | null
  dirty: boolean
}

export type SyncStatus = 'off' | 'auth' | 'pending' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState extends Persisted {
  status: SyncStatus
  error: string | null
  clientId: string
  signedIn: boolean
}

export interface SyncHost {
  getDb: () => Db
  /** applica una trasformazione al DB; `dirty` = va poi sincronizzato */
  applyDb: (fn: (prev: Db) => Db, dirty: boolean) => void
}

const EMPTY: Persisted = { fileId: null, fileName: null, email: null, remoteVersion: null, lastSyncAt: null, dirty: false }

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch { /* noop */ }
  return { ...EMPTY }
}

function loadClientId(): string {
  try {
    return localStorage.getItem(CLIENT_KEY) || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
  } catch {
    return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
  }
}

export class SyncEngine {
  private p: Persisted = loadPersisted()
  private clientId = loadClientId()
  private status: SyncStatus = 'off'
  private error: string | null = null
  private snapshot!: SyncState
  private listeners = new Set<() => void>()
  private host: SyncHost | null = null
  private debounce: ReturnType<typeof setTimeout> | undefined
  private running = false
  private rerun = false
  private dirtySeq = 0
  private started = false

  constructor() {
    this.status = this.p.fileId ? (cachedToken() ? (this.p.dirty ? 'pending' : 'synced') : 'auth') : 'off'
    this.rebuild()
  }

  // ----- store esterno per React -----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): SyncState => this.snapshot

  private rebuild(): void {
    this.snapshot = { ...this.p, status: this.status, error: this.error, clientId: this.clientId, signedIn: !!cachedToken() }
    this.listeners.forEach((l) => l())
  }
  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.p)) } catch { /* noop */ }
  }
  private set(status: SyncStatus, error: string | null = null): void {
    this.status = status
    this.error = error
    this.rebuild()
  }

  // ----- ciclo di vita -----
  attach(host: SyncHost): void {
    this.host = host
    if (this.started) return
    this.started = true
    window.addEventListener('online', () => void this.syncNow())
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.syncNow() })
    setInterval(() => { if (document.visibilityState === 'visible') void this.syncNow() }, 45_000)
    void this.syncNow()
  }

  setClientId(id: string): void {
    this.clientId = id.trim()
    try { localStorage.setItem(CLIENT_KEY, this.clientId) } catch { /* noop */ }
    this.rebuild()
  }

  /** Va chiamato dopo ogni modifica locale. */
  markDirty(): void {
    if (!this.p.fileId) return
    this.p.dirty = true
    this.dirtySeq++
    this.persist()
    if (this.status !== 'syncing' && this.status !== 'auth') this.set('pending')
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.syncNow(), 2000)
  }

  // ----- azioni utente -----
  async signIn(opts: { selectAccount?: boolean } = {}): Promise<void> {
    const prompt: Prompt = opts.selectAccount ? 'select_account' : ''
    const token = await requestToken(this.clientId, { prompt, hint: opts.selectAccount ? undefined : this.p.email ?? undefined })
    const me = await drive.about(token)
    this.p.email = me.email
    this.persist()
    if (this.status === 'auth') this.set(this.p.dirty ? 'pending' : 'synced')
    else this.rebuild()
    if (this.p.fileId) void this.syncNow()
  }

  async signOut(): Promise<void> {
    revokeToken()
    this.p = { ...EMPTY }
    this.persist()
    this.set('off')
  }

  async listCandidates(): Promise<drive.DriveFile[]> {
    return drive.listCandidates(await this.token())
  }

  /** Crea un nuovo file su Drive con il DB locale corrente. */
  async createNew(): Promise<void> {
    const token = await this.token()
    const db = this.stamp(this.host!.getDb(), 1)
    const f = await drive.createFile(token, JSON.stringify(db))
    // si riapplicano solo i metadati: eventuali modifiche fatte durante l'upload non vanno perse
    this.host!.applyDb((prev) => ({ ...prev, meta: db.meta }), false)
    this.p = { ...this.p, fileId: f.id, fileName: f.name, remoteVersion: f.version, lastSyncAt: nowIso(), dirty: false }
    this.persist()
    this.set('synced')
  }

  /** Scarica e valida un file Drive (senza ancora collegarlo). */
  async inspect(fileId: string): Promise<{ file: drive.DriveFile; remote: Db }> {
    const token = await this.token()
    const file = await drive.getMeta(token, fileId)
    const remote = parseDb(await drive.download(token, fileId))
    return { file, remote }
  }

  /** Collega un file esistente: `merge` unisce i dati locali, `replace` usa solo il file. */
  async link(file: drive.DriveFile, remote: Db, mode: 'merge' | 'replace'): Promise<void> {
    // replace: si adotta il file Drive così com'è (i dati locali non ancora sincronizzati vengono scartati)
    this.host!.applyDb((prev) => (mode === 'merge' ? mergeDb(prev, remote) : remote), false)
    this.p = { ...this.p, fileId: file.id, fileName: file.name, remoteVersion: file.version, lastSyncAt: nowIso(), dirty: mode === 'merge' }
    this.persist()
    this.set(mode === 'merge' ? 'pending' : 'synced')
    if (mode === 'merge') void this.syncNow()
  }

  unlink(): void {
    this.p = { ...this.p, fileId: null, fileName: null, remoteVersion: null, dirty: false, lastSyncAt: null }
    this.persist()
    this.set('off')
  }

  async share(email: string): Promise<void> {
    if (!this.p.fileId) return
    await drive.shareFile(await this.token(), this.p.fileId, email.trim())
  }

  // ----- core -----
  private async token(): Promise<string> {
    const t = cachedToken()
    if (t) return t
    // gesto utente in corso (azioni dalla UI): richiede un nuovo token senza dialoghi se già autorizzato
    const fresh = await requestToken(this.clientId, { prompt: '', hint: this.p.email ?? undefined })
    this.rebuild()
    return fresh
  }

  private stamp(db: Db, bump: number): Db {
    return { ...db, meta: { ...db.meta, updatedAt: nowIso(), updatedBy: this.p.email ?? db.meta.updatedBy, revision: db.meta.revision + bump } }
  }

  async syncNow(): Promise<void> {
    if (!this.p.fileId || !this.host) return
    if (this.running) { this.rerun = true; return }
    if (!navigator.onLine) return this.set('offline')
    const token = cachedToken()
    if (!token) return this.set('auth')

    this.running = true
    clearTimeout(this.debounce)
    this.set('syncing')
    try {
      const id = this.p.fileId
      const meta = await drive.getMeta(token, id)
      let version = meta.version
      let needPush = this.p.dirty

      if (meta.version !== this.p.remoteVersion) {
        const remote = parseDb(await drive.download(token, id))
        let merged = this.host.getDb()
        this.host.applyDb((prev) => (merged = mergeDb(prev, remote)), false)
        if (!sameData(merged, remote)) needPush = true
      }

      if (needPush) {
        const seq = this.dirtySeq
        const out = this.stamp(this.host.getDb(), 1)
        const f = await drive.updateFile(token, id, JSON.stringify(out))
        this.host.applyDb((prev) => ({ ...prev, meta: out.meta }), false)
        version = f.version
        // se nel frattempo ci sono state altre modifiche locali, restano "dirty" per il ciclo successivo
        this.p.dirty = this.dirtySeq !== seq
      }
      this.p.remoteVersion = version
      this.p.lastSyncAt = nowIso()
      this.persist()
      this.set(this.p.dirty ? 'pending' : 'synced')
      if (this.p.dirty) this.debounce = setTimeout(() => void this.syncNow(), 1000)
    } catch (e) {
      this.handleError(e)
    } finally {
      this.running = false
      if (this.rerun) {
        this.rerun = false
        void this.syncNow()
      }
    }
  }

  private handleError(e: unknown): void {
    if (e instanceof GoogleAuthError || (e instanceof DriveError && e.status === 401)) {
      clearToken()
      return this.set('auth', 'Sessione Google scaduta: riconnettiti per continuare a sincronizzare.')
    }
    if (e instanceof DriveError) {
      if (e.status === 404) return this.set('error', 'File non trovato o non più condiviso con questo account.')
      if (e.status === 403) return this.set('error', 'Permesso negato: serve l\'accesso in modifica al file. ' + e.message)
      return this.set('error', `Errore Google Drive (${e.status}): ${e.message}`)
    }
    if (e instanceof TypeError || !navigator.onLine) return this.set('offline')
    this.set('error', e instanceof Error ? e.message : String(e))
  }
}

export const engine = new SyncEngine()
