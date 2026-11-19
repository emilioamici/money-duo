import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Db, Member, Transaction } from '../types'
import type { Scope } from '../lib/calc'
import { createDefaultDb } from '../lib/defaults'
import { nowIso } from '../lib/ids'
import { parseDb } from '../lib/merge'
import { diffNotifications, mergeNotifications, type Notif } from '../lib/notifications'
import { engine, type SyncState } from '../sync/engine'

const DB_KEY = 'moneyduo:db:v1'
const PREFS_KEY = 'moneyduo:prefs'

function loadDb(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) return parseDb(JSON.parse(raw))
  } catch { /* cache corrotta: si riparte dai dati neutri */ }
  return createDefaultDb()
}

function saveDb(db: Db): void {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)) } catch { /* quota / storage non disponibile */ }
}

export interface View {
  month: Date
  scope: Scope
  accountId: string
  q: string
}

export interface TxFormState {
  tx?: Transaction
  initial?: Partial<Transaction>
  /** quale form aprire per una nuova voce (modificando si sceglie in base alla transazione) */
  kind?: 'normal' | 'split'
}

interface Prefs { lastAccountId: string; /** notifiche di sistema attive su questo dispositivo */ systemNotif: boolean }

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
}

const NOTIF_PREFIX = 'moneyduo:notifs:'

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
  if (!dbRef.current) dbRef.current = loadDb()
  // anche il DB è un "external store": così si aggiorna in modo sincrono insieme allo stato di sync (niente render con dati vecchi)
  const listeners = useRef(new Set<() => void>())
  const subscribeDb = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const db = useSyncExternalStore(subscribeDb, () => dbRef.current)

  const meIdRef = useRef<string | null>(null)
  const onRemote = useRef<(prev: Db, next: Db) => void>(() => undefined)

  const apply = useCallback((fn: (prev: Db) => Db, dirty: boolean, source?: 'remote') => {
    const prev = dbRef.current
    const next = fn(prev)
    if (next === prev) return
    dbRef.current = next
    listeners.current.forEach((l) => l())
    saveDb(next)
    if (dirty) engine.markDirty()
    if (source === 'remote') onRemote.current(prev, next) // dati arrivati da altri: possibili notifiche
  }, [])

  // il motore di sync si collega una sola volta (idempotente con StrictMode)
  const attached = useRef(false)
  if (!attached.current) {
    attached.current = true
    engine.attach({ getDb: () => dbRef.current, applyDb: apply })
  }

  const commit = useCallback((fn: (d: Db) => Db) => apply((prev) => { const n = fn(prev); return n === prev ? prev : { ...n, meta: { ...n.meta, updatedAt: nowIso() } } }, true), [apply])
  const resetLocal = useCallback(() => { engine.unlink(); apply(() => createDefaultDb(), false) }, [apply])

  const sync = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  const [view, setViewState] = useState<View>({ month: new Date(), scope: 'all', accountId: 'all', q: '' })
  const setView = useCallback((p: Partial<View>) => setViewState((v) => ({ ...v, ...p })), [])

  const [txForm, setTxForm] = useState<TxFormState | null>(null)
  const openTx = useCallback((s: TxFormState = {}) => setTxForm(s), [])
  const openSplit = useCallback((s: TxFormState = {}) => setTxForm({ ...s, kind: 'split' }), [])
  const closeTx = useCallback(() => setTxForm(null), [])

  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try { return { lastAccountId: '', systemNotif: false, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>) } } catch { return { lastAccountId: '', systemNotif: false } }
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
  const nameOf = useCallback((id: string | null) => (id ? db.members.find((m) => m.id === id)?.name ?? 'Ex membro' : 'Conto condiviso'), [db.members])

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
    () => ({ db, commit, resetLocal, sync, view, setView, txForm, openTx, openSplit, closeTx, prefs, setPrefs, me, members, nameOf, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen, setCenterOpen }),
    [db, commit, resetLocal, sync, view, setView, txForm, openTx, openSplit, closeTx, prefs, setPrefs, me, members, nameOf, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp fuori da AppProvider')
  return c
}
