import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Db, Member, Transaction } from '../types'
import { emptyFilters, type Scope, type TxFilters } from '../lib/calc'
import { createDefaultDb } from '../lib/defaults'
import { nowIso } from '../lib/ids'
import { diffNotifications, mergeNotifications, type Notif } from '../lib/notifications'
import { engine, type SyncState } from '../sync/engine'
import { PushHttpError, enablePush, pushConfigured, pushSupported, refreshPush, sendPush } from '../sync/push'
import { enqueue, flushQueue, type QueuedPush, type SendResult } from '../sync/pushQueue'
import { cacheState, getCacheHealth, getLoadedCache, subscribeCacheHealth, writeCache } from './cache'
import { t } from '../i18n'

const PREFS_KEY = 'moneyduo:prefs'

export interface View {
  month: Date
  /** mese singolo oppure intero anno (l'anno è quello di `month`) */
  period: 'month' | 'year'
  scope: Scope
  accountId: string
  q: string
  /** filtri avanzati della schermata Transazioni */
  filters: TxFilters
}

export interface TxFormState {
  tx?: Transaction
  initial?: Partial<Transaction>
  /** quale form aprire per una nuova voce (modificando si sceglie in base alla transazione) */
  kind?: 'normal' | 'split'
  /** cambia a ogni apertura: forza un form nuovo anche se ne è già aperto uno (es. copia o preferito) */
  nonce?: number
}

interface Prefs {
  lastAccountId: string
  /** notifiche di sistema attive su questo dispositivo */
  systemNotif: boolean
  /** notifiche push dal server attive su questo dispositivo */
  pushEnabled: boolean
}

interface AppCtx {
  db: Db
  /** applica una modifica utente: salva in locale e programma la sincronizzazione */
  commit: (fn: (db: Db) => Db) => void
  /** sostituisce il DB senza segnarlo come modifica (uso interno: reset) */
  resetLocal: () => void
  sync: SyncState
  view: View
  setView: (patch: Partial<View>) => void
  txForm: TxFormState | null
  openTx: (s?: TxFormState) => void
  openSplit: (s?: TxFormState) => void
  closeTx: () => void
  prefs: Prefs
  setPrefs: (p: Partial<Prefs>) => void
  /** il membro che corrisponde all'account Google con cui si è entrati (null = non ancora associato) */
  me: Member | null
  /** membri attivi della famiglia */
  members: Member[]
  /** nome di un membro; null = conto condiviso */
  nameOf: (id: string | null) => string
  notifications: Notif[]
  unread: number
  markRead: (id: string) => void
  markAllRead: () => void
  clearNotifications: () => void
  /** ultimo avviso arrivato mentre l'app è in primo piano (si chiude da solo) */
  toast: Notif | null
  dismissToast: () => void
  centerOpen: boolean
  setCenterOpen: (open: boolean) => void
  /** false = non riesco a salvare la copia locale */
  cacheOk: boolean
}

const NOTIF_PREFIX = 'moneyduo:notifs:'

/**
 * Dopo una modifica fatta qui, mette in coda le notifiche push per gli altri membri (stesse regole delle notifiche nell'app).
 * Partono dopo l'invio dei dati a Drive (vedi flushPush), anche se la modifica è stata fatta offline.
 * Le modifiche "di massa" (import, ripristini) non notificano.
 */
function queuePeers(prev: Db, next: Db, me: Member | null): void {
  if (!pushConfigured() || !me?.email) return
  const fileId = engine.getSnapshot().fileId
  if (!fileId) return
  if (next.transactions.length - prev.transactions.length > 3 || next.accounts.length - prev.accounts.length > 3) return
  const items: QueuedPush[] = []
  for (const m of next.members) {
    if (!m.active || !m.email || m.id === me.id || m.email.toLowerCase() === me.email.toLowerCase()) continue
    for (const d of diffNotifications(prev, next, m.id).slice(0, 1)) {
      items.push({ key: `${d.id}|${m.email.toLowerCase()}`, fileId, email: m.email, title: d.title, body: d.body, tag: d.id, at: Date.now(), txId: d.txId, accountId: d.accountId })
    }
  }
  enqueue(items)
}

/** Invia le notifiche in coda (i dati sono già su Drive). Errori di rete o del server: si tiene e si riprova al prossimo ciclo. */
async function flushPush(getDb: () => Db): Promise<void> {
  const snap = engine.getSnapshot()
  const token = engine.currentToken()
  if (!pushConfigured() || !snap.fileId || !token) return
  const db = getDb()
  await flushQueue({
    fileId: snap.fileId,
    // se la spesa o il conto è stato eliminato prima dell'invio, la notifica non ha più senso
    exists: (q) => (q.txId ? db.transactions.some((t) => t.id === q.txId) : q.accountId ? db.accounts.some((a) => a.id === q.accountId) : true),
    send: async (q): Promise<SendResult> => {
      try { await sendPush(snap.fileId!, token, { recipients: [q.email], title: q.title, body: q.body, tag: q.tag }); return 'ok' } catch (e) {
        return e instanceof PushHttpError && [400, 403, 404, 413].includes(e.status) ? 'drop' : 'retry'
      }
    },
  })
}

function loadNotifs(key: string): Notif[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as Notif[] } catch { return [] }
}

/** Notifica di sistema (Android/desktop/iOS con app installata), mostrata solo se l'app non è in primo piano. */
async function systemNotify(n: Notif): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const opts: NotificationOptions = { body: n.body, icon: './icon-192.png', badge: './icon-192.png', tag: n.id }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(n.title, opts)
    else new Notification(n.title, opts)
  } catch { /* notifiche non disponibili */ }
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Db>(null as unknown as Db)
  if (!dbRef.current) {
    const cached = getLoadedCache()
    dbRef.current = cached.db ?? createDefaultDb()
    // se la copia locale manca o è datata, il motore rilegge Drive prima di inviare qualsiasi cosa
    engine.checkCache(cacheState(engine.getSnapshot().remoteVersion))
  }
  // anche il DB è un "external store": così si aggiorna in modo sincrono insieme allo stato di sync (niente render con dati vecchi)
  const listeners = useRef(new Set<() => void>())
  const subscribeDb = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const db = useSyncExternalStore(subscribeDb, () => dbRef.current)

  const meIdRef = useRef<string | null>(null)
  const meRef = useRef<Member | null>(null)
  const onRemote = useRef<(prev: Db, next: Db) => void>(() => undefined)

  const apply = useCallback((fn: (prev: Db) => Db, dirty: boolean, source?: 'remote') => {
    const prev = dbRef.current
    const next = fn(prev)
    if (next === prev) return
    dbRef.current = next
    listeners.current.forEach((l) => l())
    writeCache(next, engine.getSnapshot().remoteVersion)
    if (dirty) { engine.markDirty(); queuePeers(prev, next, meRef.current) }
    if (source === 'remote') onRemote.current(prev, next) // dati arrivati da altri: possibili notifiche
  }, [])

  // il motore di sync si collega una sola volta (idempotente con StrictMode)
  const attached = useRef(false)
  if (!attached.current) {
    attached.current = true
    engine.attach({ getDb: () => dbRef.current, applyDb: apply, afterSync: () => void flushPush(() => dbRef.current) })
  }

  const commit = useCallback((fn: (d: Db) => Db) => apply((prev) => { const n = fn(prev); return n === prev ? prev : { ...n, meta: { ...n.meta, updatedAt: nowIso() } } }, true), [apply])
  const resetLocal = useCallback(() => { engine.unlink(); apply(() => createDefaultDb(), false) }, [apply])

  const sync = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const cacheOk = useSyncExternalStore(subscribeCacheHealth, getCacheHealth)
  // quando cambia la versione di Drive a cui corrisponde la copia, si aggiorna anche la copia
  const lastVersion = useRef<string | null>(sync.remoteVersion)
  useEffect(() => {
    if (sync.remoteVersion !== lastVersion.current) { lastVersion.current = sync.remoteVersion; writeCache(dbRef.current, sync.remoteVersion) }
  }, [sync.remoteVersion])

  const [view, setViewState] = useState<View>({ month: new Date(), period: 'month', scope: 'all', accountId: 'all', q: '', filters: emptyFilters() })
  const setView = useCallback((p: Partial<View>) => setViewState((v) => ({ ...v, ...p })), [])

  const [txForm, setTxForm] = useState<TxFormState | null>(null)
  const formNonce = useRef(0)
  const openTx = useCallback((s: TxFormState = {}) => setTxForm({ ...s, nonce: ++formNonce.current }), [])
  const openSplit = useCallback((s: TxFormState = {}) => setTxForm({ ...s, kind: 'split', nonce: ++formNonce.current }), [])
  const closeTx = useCallback(() => setTxForm(null), [])

  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try { return { lastAccountId: '', systemNotif: false, pushEnabled: false, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>) } } catch { return { lastAccountId: '', systemNotif: false, pushEnabled: false } }
  })
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const n = { ...old, ...p }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)) } catch { /* noop */ }
      return n
    })
  }, [])

  const members = useMemo(() => db.members.filter((m) => m.active), [db.members])
  const me = useMemo(() => {
    const e = sync.email?.toLowerCase()
    return (e && db.members.find((m) => m.active && m.email?.toLowerCase() === e)) || null
  }, [db.members, sync.email])
  meIdRef.current = me?.id ?? null
  meRef.current = me
  const nameOf = useCallback((id: string | null) => (id ? db.members.find((m) => m.id === id)?.name ?? t('Ex membro') : t('Conto condiviso')), [db.members])

  // push: a ogni apertura si rinnova l'iscrizione; un messaggio dal service worker (app in primo piano) fa sincronizzare subito
  useEffect(() => {
    if (prefs.pushEnabled && sync.fileId && sync.signedIn && pushConfigured()) {
      const t = engine.currentToken()
      if (t) void refreshPush(sync.fileId, t).catch(() => undefined)
    }
  }, [prefs.pushEnabled, sync.fileId, sync.signedIn])
  // notifiche già attive su questo dispositivo ma senza push (il server è stato configurato dopo): le iscrive da sole, una volta per apertura
  const autoPush = useRef(false)
  useEffect(() => {
    if (autoPush.current || !prefs.systemNotif || prefs.pushEnabled || !sync.fileId || !sync.signedIn || !pushConfigured() || !pushSupported()) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const t = engine.currentToken()
    if (!t) return
    autoPush.current = true
    void enablePush(sync.fileId, t).then(() => setPrefs({ pushEnabled: true })).catch(() => undefined)
  }, [prefs.systemNotif, prefs.pushEnabled, sync.fileId, sync.signedIn, setPrefs])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'moneyduo-push') void engine.syncNow() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // ----- notifiche (per famiglia e per membro, solo su questo dispositivo)
  const notifKey = sync.fileId && me ? `${NOTIF_PREFIX}${sync.fileId}:${me.id}` : null
  const [notifications, setNotifications] = useState<Notif[]>([])
  const [toast, setToast] = useState<Notif | null>(null)
  const notifKeyRef = useRef<string | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  useEffect(() => { notifKeyRef.current = notifKey; setNotifications(notifKey ? loadNotifs(notifKey) : []) }, [notifKey])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t) }, [toast])

  const persistNotifs = useCallback((list: Notif[]) => {
    const key = notifKeyRef.current
    if (key) try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* noop */ }
  }, [])

  onRemote.current = (prev, next) => {
    const me = meIdRef.current
    if (!me || !notifKeyRef.current) return
    const fresh = diffNotifications(prev, next, me)
    if (!fresh.length) return
    setNotifications((cur) => { const merged = mergeNotifications(cur, fresh); persistNotifs(merged); return merged })
    if (document.visibilityState === 'visible') setToast(fresh[0])
    else if (prefsRef.current.systemNotif) for (const n of fresh.slice(0, 3)) void systemNotify(n)
  }
  const markRead = useCallback((id: string) => setNotifications((cur) => { const n = cur.map((x) => (x.id === id ? { ...x, read: true } : x)); persistNotifs(n); return n }), [persistNotifs])
  const markAllRead = useCallback(() => setNotifications((cur) => { const n = cur.map((x) => ({ ...x, read: true })); persistNotifs(n); return n }), [persistNotifs])
  const clearNotifications = useCallback(() => { setNotifications([]); persistNotifs([]) }, [persistNotifs])
  const dismissToast = useCallback(() => setToast(null), [])
  const [centerOpen, setCenterOpen] = useState(false)
  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  const value = useMemo<AppCtx>(
    () => ({ db, commit, resetLocal, sync, view, setView, txForm, openTx, openSplit, closeTx, prefs, setPrefs, me, members, nameOf, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen, setCenterOpen, cacheOk }),
    [db, commit, resetLocal, sync, view, setView, txForm, openTx, openSplit, closeTx, prefs, setPrefs, me, members, nameOf, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen, cacheOk],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp fuori da AppProvider')
  return c
}
