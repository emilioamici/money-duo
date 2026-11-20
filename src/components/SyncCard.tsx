import { useEffect, useState } from 'react'
import { Cloud, CloudOff, LogOut, RefreshCw, ShieldCheck, Unplug, UserRound } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { brokerAvailable } from '../sync/auth'
import { pickerConfigured } from '../sync/picker'
import { dateTimeLabel } from '../lib/format'
import { ask } from './dialogs'
import { t } from '../i18n'

export const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Stato della sincronizzazione e gestione dell'account (il collegamento al database avviene dalla schermata di accesso). */
export function SyncCard() {
  const { sync, cacheOk } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [broker, setBroker] = useState(false)
  useEffect(() => { void brokerAvailable().then(setBroker) }, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.status === 'synced' ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.status === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('Sincronizzazione Google Drive')}</p>
          <p className="truncate text-xs text-muted">{t(STATUS_LABEL[sync.status])}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${dateTimeLabel(sync.lastSyncAt)}` : ''}</p>
        </div>
      </div>
      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}
      {sync.persistent ? (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-inc/10 p-3 text-sm text-inc"><ShieldCheck size={16} className="mt-0.5 shrink-0" />{t('Accesso persistente attivo: la sessione Google si rinnova da sola, anche in background.')}</p>
      ) : broker && sync.fileId ? (
        <button className="btn-soft mb-3 w-full" disabled={busy} onClick={() => run(() => engine.signIn())}><ShieldCheck size={18} />{t('Attiva l\'accesso persistente')}</button>
      ) : null}
      {!cacheOk && <p className="mb-3 rounded-xl bg-warn/15 p-3 text-sm text-warn">{t('Non riesco a salvare una copia dei dati su questo dispositivo (spazio del browser esaurito o archiviazione bloccata). L\'app funziona, ma a ogni apertura deve riscaricare tutto da Drive e serve la connessione.')}</p>}
      {(sync.error || err) && <p className="mb-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err || sync.error}</p>}
      {pickerConfigured() && sync.status === 'error' && sync.fileId && (
        <button className="btn-soft mb-3 w-full" disabled={busy} onClick={() => run(async () => {
          const f = await engine.pickDatabase()
          if (!f) return
          if (f.id !== sync.fileId) throw new Error(t('Hai scelto un file diverso da quello collegato: scegli «{name}».', { name: sync.fileName ?? '' }))
          await engine.syncNow()
        })}><Cloud size={18} />{t('Scegli di nuovo il database')}</button>
      )}
      {!sync.signedIn ? (
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => engine.signIn())}>{t('Riconnetti Google Drive')}</button>
      ) : (
        <button className="btn-soft w-full" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />{t('Sincronizza ora')}</button>
      )}
      <div className="mt-3 flex gap-2 border-t border-line/70 pt-3">
        <button className="btn-ghost flex-1 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={16} />{t('Cambia account')}</button>
        <button className="btn-ghost flex-1 !text-xs" onClick={async () => { if (await ask({ title: t('Cambiare famiglia?'), message: t('Il database resta su Drive e in questo browser, ma non verrà più sincronizzato finché non lo ricolleghi.'), ok: t('Scollega') })) engine.unlink() }}><Unplug size={16} />{t('Scollega')}</button>
        <button className="btn-ghost flex-1 !text-xs" onClick={() => void engine.signOut()}><LogOut size={16} />{t('Esci')}</button>
      </div>
    </div>
  )
}
