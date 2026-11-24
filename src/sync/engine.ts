import type { Db } from '../types'
import { createFamilyDb, isPristine } from '../lib/defaults'
import { mergeDb, parseDb, sameData } from '../lib/merge'
import { nowIso } from '../lib/ids'
import type { CacheState } from '../store/cache'
import * as drive from './drive'
import { DriveError, isBridged, setBridged } from './drive'
import { GoogleAuthError, cachedToken, clearToken, requestToken, revokeToken, setToken, tokenRemainingMs, type Prompt } from './google'
import { SessionExpired, brokerAvailable, hasSession, logoutBroker, refreshAccessToken, startBrokerLogin } from './auth'
import { t } from '../i18n'
import { pickDatabase, pickFolder, pickerConfigured, type Picked } from './picker'
import { ensureRegistered, joinHouse, myHouses, type BridgeHouse, type JoinResult } from './bridge'
import { inviteLink } from './invite'

/**
 * Motore di sincronizzazione con un file JSON su Google Drive.
 * Ciclo: leggi `version` remota → se cambiata scarica+merge per record → carica solo se serve.
 */

/** ogni quanto si controlla se ci sono novità su Drive (anche in background) */
export const SYNC_EVERY_MS = 120_000
/** il token Google dura 1 ora: si prova a rinnovarlo (in silenzio) negli ultimi 15 minuti o dopo la scadenza */
const RENEW_WINDOW_MS = 15 * 60_000
const RENEW_RETRY_MS = 10 * 60_000
/** con l'accesso persistente il token si rinnova quando mancano meno di 10 minuti */
const SILENT_RENEW_MS = 10 * 60_000

const KEY = 'moneyduo:sync'
const CLIENT_KEY = 'moneyduo:clientId'

interface Persisted {
  fileId: string | null
  fileName: string | null
  email: string | null
  /** nome Google dell'account (usato come nome predefinito del membro) */
  name: string | null
  /** email del capofamiglia = proprietario del file */
  ownerEmail: string | null
  /** può invitare/rimuovere persone (proprietario del file) */
  canShare: boolean
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
  /** i dati locali sono stati allineati a Drive in questa sessione (false = la copia locale non è affidabile: niente invii) */
  reconciled: boolean
  /** accesso persistente attivo: il token Google si rinnova da solo, senza popup */
  persistent: boolean
}

export interface SyncHost {
  getDb: () => Db
  /** applica una trasformazione al DB; `dirty` = va poi sincronizzato */
  /** `source: 'remote'` = dati arrivati da un altro dispositivo/membro (da cui si ricavano le notifiche) */
  applyDb: (fn: (prev: Db) => Db, dirty: boolean, source?: 'remote') => void
  /** dopo un ciclo riuscito senza modifiche in attesa: i dati locali sono su Drive (serve a inviare le notifiche push in coda) */
  afterSync?: () => void
}

const EMPTY: Persisted = { fileId: null, fileName: null, email: null, name: null, ownerEmail: null, canShare: false, remoteVersion: null, lastSyncAt: null, dirty: false }

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
  private renewing = false
  private reconciled = true
  /** come riallineare la copia locale alla prossima lettura di Drive: 'replace' = la copia manca, si adotta Drive; 'merge' = copia datata, si unisce */
  private pullMode: 'merge' | 'replace' = 'merge'
  private lastRenewTry = 0

  constructor() {
    // all'avvio: con la sessione persistente il rinnovo è in corso (niente schermata di accesso); offline si resta sui dati locali
    this.status = !this.p.fileId ? 'off'
      : cachedToken() ? (this.p.dirty ? 'pending' : 'synced')
      : hasSession() ? 'syncing'
      : typeof navigator !== 'undefined' && !navigator.onLine ? 'offline'
      : 'auth'
    this.rebuild()
  }

  // ----- store esterno per React -----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): SyncState => this.snapshot

  private rebuild(): void {
    this.snapshot = { ...this.p, status: this.status, error: this.error, clientId: this.clientId, signedIn: !!cachedToken(), reconciled: this.reconciled, persistent: hasSession() }
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
    // anche con l'app in background (i browser rallentano i timer): serve a ricevere le notifiche
    setInterval(() => void this.syncNow(), SYNC_EVERY_MS)
    // accesso persistente: il token si rinnova da solo, anche in background e senza tocchi
    setInterval(() => { if (tokenRemainingMs() < SILENT_RENEW_MS) void this.brokerRenew() }, 60_000)
    void this.brokerRenew().then(() => this.syncNow())
    // il rinnovo silenzioso del token va chiesto durante un gesto dell'utente, altrimenti il browser blocca il popup
    document.addEventListener('pointerdown', () => void this.renewIfNeeded(), { capture: true, passive: true })
    void this.syncNow()
  }

  /**
   * Da chiamare all'avvio con lo stato della copia locale. Se la copia manca o non corrisponde all'ultima versione di Drive
   * si dimentica la versione ricordata, così il prossimo ciclo RILEGGE Drive; finché non è fatto non si invia nulla.
   * (Prima si saltava la lettura quando la versione coincideva, e una copia vuota poteva sovrascrivere Drive.)
   */
  checkCache(state: CacheState): void {
    if (!this.p.fileId) { this.reconciled = true; return this.rebuild() }
    if (state === 'ok') { this.reconciled = true; return this.rebuild() }
    this.reconciled = false
    this.pullMode = state === 'missing' ? 'replace' : 'merge'
    this.p.remoteVersion = null
    if (state === 'missing') this.p.dirty = false // le modifiche locali non inviate stavano nella copia persa
    this.persist()
    this.rebuild()
  }

  setClientId(id: string): void {
    this.clientId = id.trim()
    try { localStorage.setItem(CLIENT_KEY, this.clientId) } catch { /* noop */ }
    this.rebuild()
  }

  private brokerBusy: Promise<boolean> | null = null
  /**
   * Rinnova il token Google tramite la sessione persistente (nessun popup). Ritorna true se ora c'è un token valido.
   * Se la sessione non vale più la cancella: tornerà l'avviso «Riconnetti».
   */
  brokerRenew(): Promise<boolean> {
    if (!hasSession()) return Promise.resolve(!!cachedToken())
    this.brokerBusy ??= (async () => {
      try {
        const r = await refreshAccessToken()
        if (!r) return !!cachedToken()
        setToken(r.token, r.expiresIn)
        if (r.email && r.email !== this.p.email) { this.p.email = r.email; this.persist() }
        if (this.status === 'auth') this.set(this.p.dirty ? 'pending' : 'synced')
        else this.rebuild()
        return true
      } catch (e) {
        if (!cachedToken()) {
          // sessione revocata o scaduta: serve un nuovo accesso; server non raggiungibile: si resta sui dati locali e si riprova
          if (e instanceof SessionExpired) this.set('auth')
          else if (this.p.fileId) this.set('offline')
        } else this.rebuild()
        return !!cachedToken()
      } finally { this.brokerBusy = null }
    })()
    return this.brokerBusy
  }

  /** Token Google valido adesso, oppure null: non apre mai popup. */
  currentToken(): string | null {
    return cachedToken()
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
    // con il server di accesso configurato si passa da lì (accesso persistente): la pagina va su Google e torna qui
    if (await brokerAvailable()) { startBrokerLogin(opts.selectAccount ? null : this.p.email); return }
    const prompt: Prompt = opts.selectAccount ? 'select_account' : ''
    const token = await requestToken(this.clientId, { prompt, hint: opts.selectAccount ? undefined : this.p.email ?? undefined })
    const me = await drive.about(token)
    this.p.email = me.email
    this.p.name = me.name
    this.persist()
    if (this.status === 'auth') this.set(this.p.dirty ? 'pending' : 'synced')
    else this.rebuild()
    if (this.p.fileId) void this.syncNow()
  }

  /**
   * Rinnovo silenzioso del token (`prompt: 'none'`, senza schermate se l'utente è ancora collegato a Google e ha già dato il consenso).
   * Si chiama a ogni tocco dell'utente: così, finché usi l'app, la sessione non scade mai; se il rinnovo non è possibile
   * (sessione Google chiusa, consenso da rifare, popup bloccato) non succede nulla e resta il pulsante «Riconnetti».
   */
  async renewIfNeeded(): Promise<void> {
    if (hasSession()) return // ci pensa il rinnovo con la sessione persistente
    if (this.status === 'auth') return // sessione scaduta: l'accesso lo avvia il pulsante nella schermata di login (evita due popup)
    if (!this.p.fileId || !this.p.email || this.renewing || !this.clientId) return
    if (tokenRemainingMs() > RENEW_WINDOW_MS) return
    if (Date.now() - this.lastRenewTry < RENEW_RETRY_MS) return
    this.renewing = true
    this.lastRenewTry = Date.now()
    try {
      await requestToken(this.clientId, { prompt: 'none', hint: this.p.email })
      this.lastRenewTry = 0 // riuscito: nessun ritardo per il prossimo rinnovo
      this.rebuild()
      void this.syncNow()
    } catch { /* non riuscito: si riprova più tardi; alla scadenza compare la schermata di accesso */ } finally {
      this.renewing = false
    }
  }

  async signOut(): Promise<void> {
    void logoutBroker()
    revokeToken()
    this.p = { ...EMPTY }
    this.persist()
    this.set('off')
  }

  async listCandidates(): Promise<drive.DriveFile[]> {
    return drive.listCandidates(await this.token())
  }

  /**
   * Crea la famiglia: un nuovo database nella cartella scelta del Drive di chi lo crea (capofamiglia).
   * Se sul dispositivo ci sono già dati propri (es. un import) li tiene e dà solo il nome alla famiglia.
   */
  async createFamily(opts: { familyName: string; memberName: string; folderId: string | null }): Promise<void> {
    const token = await this.token()
    const email = this.p.email ?? ''
    const local = this.host!.getDb()
    const fresh = createFamilyDb(opts.familyName, { name: opts.memberName, email })
    const db = this.stamp(isPristine(local) ? fresh : { ...local, family: fresh.family }, 1)
    const slug = opts.familyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'famiglia'
    const f = await drive.createFile(token, JSON.stringify(db), `moneyduo-db-${slug}.json`, opts.folderId)
    // si riapplicano solo i metadati: eventuali modifiche fatte durante l'upload non vanno perse
    this.host!.applyDb((prev) => (isPristine(prev) ? db : { ...prev, family: db.family, meta: db.meta }), false)
    this.reconciled = true
    this.p = { ...this.p, fileId: f.id, fileName: f.name, ownerEmail: this.p.email, canShare: true, remoteVersion: f.version, lastSyncAt: nowIso(), dirty: false }
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
    this.reconciled = true
    this.p = { ...this.p, fileId: file.id, fileName: file.name, ownerEmail: file.owners?.[0]?.emailAddress ?? null, canShare: !!(file.ownedByMe || file.capabilities?.canShare), remoteVersion: file.version, lastSyncAt: nowIso(), dirty: mode === 'merge' }
    this.persist()
    this.set(mode === 'merge' ? 'pending' : 'synced')
    if (mode === 'merge') void this.syncNow()
  }

  unlink(): void {
    if (this.p.fileId) setBridged(this.p.fileId, false)
    this.p = { ...this.p, fileId: null, fileName: null, remoteVersion: null, dirty: false, lastSyncAt: null }
    this.persist()
    this.set('off')
  }

  /** Invita un account Google: concede l'accesso in modifica al file (solo il capofamiglia). */
  async invite(email: string, familyName: string): Promise<void> {
    if (!this.p.fileId) return
    const token = await this.token()
    await drive.shareFile(token, this.p.fileId, email.trim(), t('Ti invito nella famiglia «{name}» su Money Duo. Apri questo link e accedi con questo account Google: {link} Oppure apri l\'app e inserisci il codice famiglia: {code}', { name: familyName, link: inviteLink(this.p.fileId), code: this.p.fileId }))
    void this.registerFamily(true) // il nuovo invitato deve trovare subito la famiglia dal ponte
  }

  /** Revoca l'accesso al file a un account. Ritorna false se non aveva permessi. */
  async revoke(email: string): Promise<boolean> {
    if (!this.p.fileId) return false
    return drive.removeShare(await this.token(), this.p.fileId, email.trim())
  }

  /** Nome della cartella che contiene il file (null se non visibile, es. file condiviso da altri). */
  async currentFolder(): Promise<{ id: string; name: string } | null> {
    if (!this.p.fileId) return null
    const token = await this.token()
    const meta = await drive.getMeta(token, this.p.fileId)
    const id = meta.parents?.[0]
    return id ? { id, name: await drive.folderName(token, id).catch(() => t('Cartella')) } : null
  }

  /** Selettore di Google: il database di famiglia (anche condiviso da altri). Solo con il permesso `drive.file`. */
  async pickDatabase(onlyFileId?: string): Promise<Picked | null> {
    return pickDatabase(await this.token(), onlyFileId)
  }

  /** Entra con il codice famiglia: il Worker, con l'accesso del capofamiglia, ti aggiunge tra gli scrittori del file. */
  async joinFamily(fileId: string): Promise<JoinResult> {
    return joinHouse(fileId, await this.token())
  }

  /** Le famiglie a cui sono stato invitato, aperte dal ponte del Worker (nessun selettore, nessun codice). */
  async houses(): Promise<BridgeHouse[]> {
    const token = cachedToken()
    return token ? myHouses(token) : []
  }

  /** Il capofamiglia (proprietario del file, con accesso persistente) affida la famiglia al ponte del Worker: gli invitati entrano senza Selettore. */
  async registerFamily(force = false): Promise<boolean> {
    const id = this.p.fileId, token = cachedToken()
    if (!id || !token || isBridged(id)) return false
    const owner = !!this.p.ownerEmail && this.p.ownerEmail.toLowerCase() === (this.p.email ?? '').toLowerCase()
    return ensureRegistered(id, token, { owner, force })
  }
  /** Selettore di Google: una cartella del proprio Drive. */
  async pickFolder(): Promise<Picked | null> {
    return pickFolder(await this.token())
  }

  async listFolders(parentId: string): Promise<drive.DriveFolder[]> {
    return drive.listFolders(await this.token(), parentId)
  }
  async createFolder(name: string, parentId: string): Promise<drive.DriveFolder> {
    return drive.createFolder(await this.token(), name, parentId)
  }
  /** Sposta il database in un'altra cartella (solo il proprietario). */
  async moveTo(folderId: string): Promise<void> {
    if (!this.p.fileId) return
    const token = await this.token()
    const meta = await drive.getMeta(token, this.p.fileId)
    await drive.moveFile(token, this.p.fileId, folderId, meta.parents ?? [])
  }

  // ----- core -----
  private async token(): Promise<string> {
    const t = cachedToken() ?? ((await this.brokerRenew()) ? cachedToken() : null)
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
    let token = cachedToken()
    if (!token && hasSession()) { await this.brokerRenew(); token = cachedToken() }
    if (!token) {
      // server di accesso non raggiungibile (non sessione revocata): si resta sui dati locali, senza schermata di accesso
      if (hasSession() && (this.status as SyncStatus) === 'offline') return
      return this.set('auth')
    }

    this.running = true
    clearTimeout(this.debounce)
    this.set('syncing')
    try {
      const id = this.p.fileId
      const meta = await drive.getMeta(token, id)
      let version = meta.version
      const owner = meta.owners?.[0]?.emailAddress ?? this.p.ownerEmail
      const canShare = !!(meta.ownedByMe || meta.capabilities?.canShare)
      if (owner !== this.p.ownerEmail || canShare !== this.p.canShare) { this.p.ownerEmail = owner; this.p.canShare = canShare; this.persist() }
      let needPush = this.p.dirty

      // si legge Drive se la versione è cambiata OPPURE se la copia locale non è affidabile (versione dimenticata)
      if (this.p.remoteVersion === null || meta.version !== this.p.remoteVersion) {
        const remote = parseDb(await drive.download(token, id))
        if (this.pullMode === 'replace') {
          this.host.applyDb(() => remote, false) // copia persa: si adotta Drive così com'è (senza notifiche)
        } else {
          let merged = this.host.getDb()
          this.host.applyDb((prev) => (merged = mergeDb(prev, remote)), false, 'remote')
          if (!sameData(merged, remote)) needPush = true
        }
        this.pullMode = 'merge'
        this.reconciled = true
      }
      if (!this.reconciled) throw new Error(t('Copia locale non allineata a Drive: invio annullato per non sovrascrivere i dati.'))

      if (needPush) {
        const seq = this.dirtySeq
        const out = this.stamp(this.host.getDb(), 1)
        const f = await drive.updateFile(token, id, JSON.stringify(out), version)
        this.host.applyDb((prev) => ({ ...prev, meta: out.meta }), false)
        version = f.version
        // se nel frattempo ci sono state altre modifiche locali, restano "dirty" per il ciclo successivo
        this.p.dirty = this.dirtySeq !== seq
      }
      this.p.remoteVersion = version
      this.p.lastSyncAt = nowIso()
      this.persist()
      this.set(this.p.dirty ? 'pending' : 'synced')
      void this.registerFamily(false)
      if (this.p.dirty) this.debounce = setTimeout(() => void this.syncNow(), 1000)
      else this.host.afterSync?.()
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
      return this.set('auth', t('Sessione Google scaduta: riconnettiti per continuare a sincronizzare.'))
    }
    // dal ponte: nel frattempo un altro dispositivo ha scritto (409). Non è un errore: si rilegge, si fa il merge e si riprova
    if (e instanceof DriveError && e.status === 409) {
      this.p.remoteVersion = null; this.p.dirty = true; this.persist()
      this.set('pending')
      this.debounce = setTimeout(() => void this.syncNow(), 300)
      return
    }
    if (e instanceof DriveError) {
      if (e.status === 404 && this.p.fileId && isBridged(this.p.fileId)) return this.set('error', e.message || t('Non riesco ad aprire la famiglia dal server: il capofamiglia deve riaprire l\'app con l\'accesso persistente.'))
      if (e.status === 404 && pickerConfigured()) return this.set('error', t('Non riesco ad aprire il database: scegli di nuovo il file con il selettore di Google (dalle Impostazioni → Sincronizzazione). Se non lo vedi, forse sei stato rimosso dalla famiglia o il file è stato spostato.'))
      if (e.status === 404) return this.set('error', t('Non hai più accesso al database: forse sei stato rimosso dalla famiglia o il file è stato spostato. Puoi scollegarti da Impostazioni.'))
      if (e.status === 403) return this.set('error', t('Permesso negato: serve l\'accesso in modifica al file.') + ' ' + e.message)
      return this.set('error', t('Errore Google Drive ({status}): {message}', { status: e.status, message: e.message }))
    }
    if (e instanceof TypeError || !navigator.onLine) return this.set('offline')
    this.set('error', e instanceof Error ? e.message : String(e))
  }
}

export const engine = new SyncEngine()
