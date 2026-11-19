import { useState } from 'react'
import { Cloud, CloudOff, LogOut, RefreshCw, Unplug, UserRound } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { dateTimeLabel } from '../lib/format'
import { ask } from './dialogs'

export const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Stato della sincronizzazione e gestione dell'account (il collegamento al database avviene dalla schermata di accesso). */
export function SyncCard() {
  const { sync } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.status === 'synced' ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.status === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Sincronizzazione Google Drive</p>
          <p className="truncate text-xs text-muted">{STATUS_LABEL[sync.status]}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${dateTimeLabel(sync.lastSyncAt)}` : ''}</p>
        </div>
      </div>
      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}
      {(sync.error || err) && <p className="mb-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err || sync.error}</p>}
      {!sync.signedIn ? (
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => engine.signIn())}>Riconnetti Google Drive</button>
      ) : (
        <button className="btn-soft w-full" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />Sincronizza ora</button>
      )}
      <div className="mt-3 flex gap-2 border-t border-line/70 pt-3">
        <button className="btn-ghost flex-1 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={16} />Cambia account</button>
        <button className="btn-ghost flex-1 !text-xs" onClick={async () => { if (await ask({ title: 'Cambiare famiglia?', message: 'Il database resta su Drive e in questo browser, ma non verrà più sincronizzato finché non lo ricolleghi.', ok: 'Scollega' })) engine.unlink() }}><Unplug size={16} />Scollega</button>
        <button className="btn-ghost flex-1 !text-xs" onClick={() => void engine.signOut()}><LogOut size={16} />Esci</button>
      </div>
    </div>
  )
}
