import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Db, Member, Transaction } from '../types'
import type { Scope } from '../lib/calc'
import { createDefaultDb } from '../lib/defaults'
import { nowIso } from '../lib/ids'
import { parseDb } from '../lib/merge'
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
}

interface Prefs { lastAccountId: string }

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
  closeTx: () => void
  prefs: Prefs
  setPrefs: (p: Partial<Prefs>) => void
  /** il membro che corrisponde all'account Google con cui si è entrati (null = non ancora associato) */
  me: Member | null
  /** membri attivi della famiglia */
  members: Member[]
  /** nome di un membro; null = conto condiviso */
  nameOf: (id: string | null) => string
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Db>(null as unknown as Db)
  if (!dbRef.current) dbRef.current = loadDb()
  // anche il DB è un "external store": così si aggiorna in modo sincrono insieme allo stato di sync (niente render con dati vecchi)
  const listeners = useRef(new Set<() => void>())
  const subscribeDb = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const db = useSyncExternalStore(subscribeDb, () => dbRef.current)

  const apply = useCallback((fn: (prev: Db) => Db, dirty: boolean) => {
    const next = fn(dbRef.current)
    if (next === dbRef.current) return
    dbRef.current = next
    listeners.current.forEach((l) => l())
    saveDb(next)
    if (dirty) engine.markDirty()
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
  const closeTx = useCallback(() => setTxForm(null), [])

  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try { return { lastAccountId: '', ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>) } } catch { return { lastAccountId: '' } }
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
  const nameOf = useCallback((id: string | null) => (id ? db.members.find((m) => m.id === id)?.name ?? 'Ex membro' : 'Conto condiviso'), [db.members])

  const value = useMemo<AppCtx>(
    () => ({ db, commit, resetLocal, sync, view, setView, txForm, openTx, closeTx, prefs, setPrefs, me, members, nameOf }),
    [db, commit, resetLocal, sync, view, setView, txForm, openTx, closeTx, prefs, setPrefs, me, members, nameOf],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp fuori da AppProvider')
  return c
}
