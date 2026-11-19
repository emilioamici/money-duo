import { useState } from 'react'
import { Cloud, CloudOff, FilePlus2, Link2, LogOut, RefreshCw, Share2, Unplug, UserRound } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { parseFileId, type DriveFile } from '../sync/drive'
import { dateTimeLabel } from '../lib/format'
import { ask } from './dialogs'

export const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function SyncCard() {
  const { sync, db } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [link, setLink] = useState('')
  const [shareEmail, setShareEmail] = useState('')
  const [info, setInfo] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setInfo('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const connectFile = (id: string) => run(async () => {
    const { file, remote } = await engine.inspect(id)
    const hasLocal = db.transactions.length > 0
    let mode: 'merge' | 'replace' = 'replace'
    if (hasLocal) {
      const r = await ask({
        title: `Collegare «${file.name}»`,
        message: `Su questo dispositivo ci sono ${db.transactions.length} transazioni locali. Vuoi unirle ai dati del file Drive o usare solo il file Drive (i dati locali verranno scartati)?`,
        ok: 'Unisci ai dati del file', alt: 'Usa solo il file Drive',
      })
      if (!r) return
      mode = r === 'ok' ? 'merge' : 'replace'
    }
    await engine.link(file, remote, mode)
    setFiles(null); setLink('')
  })

  const refresh = () => run(async () => setFiles(await engine.listCandidates()))

  const needsId = !sync.clientId

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.fileId ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.fileId ? <Cloud size={20} /> : <CloudOff size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Google Drive</p>
          <p className="truncate text-xs text-muted">
            {STATUS_LABEL[sync.status]}{sync.fileName ? ` · ${sync.fileName}` : ''}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${dateTimeLabel(sync.lastSyncAt)}` : ''}
          </p>
        </div>
      </div>

      {needsId && (
        <div className="mb-3 rounded-xl bg-brand/10 p-3 text-sm">
          <p className="mb-2">Inserisci il <b>Client ID OAuth</b> di Google Cloud Console (vedi README). Resta solo in questo browser.</p>
          <input className="input" placeholder="xxxx.apps.googleusercontent.com" onBlur={(e) => engine.setClientId(e.target.value)} />
        </div>
      )}

      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}
      {(sync.error || err) && <p className="mb-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err || sync.error}</p>}
      {info && <p className="mb-3 rounded-xl bg-inc/10 p-3 text-sm text-inc">{info}</p>}

      {!sync.signedIn && !sync.fileId && (
        <button className="btn-primary w-full" disabled={busy || needsId} onClick={() => run(() => engine.signIn())}>Accedi con Google</button>
      )}

      {sync.signedIn && !sync.fileId && (
        <div className="space-y-3">
          <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => engine.createNew())}><FilePlus2 size={18} />Crea nuovo database su Drive</button>
          <button className="btn-soft w-full" disabled={busy} onClick={refresh}><Link2 size={18} />Collega file esistente / condiviso</button>
          {files && (
            <div className="space-y-2">
              {files.length === 0 && <p className="text-sm text-muted">Nessun file «moneyduo» trovato. Incolla qui sotto il link o l'ID.</p>}
              {files.map((f) => (
                <button key={f.id} onClick={() => connectFile(f.id)} disabled={busy} className="w-full rounded-xl border border-line p-3 text-left text-sm hover:bg-line/40">
                  <p className="font-semibold">{f.name}</p>
                  <p className="text-xs text-muted">{f.ownedByMe ? 'Creato da te' : `Condiviso da ${f.owners?.[0]?.emailAddress ?? 'altro account'}`} · {dateTimeLabel(f.modifiedTime)}</p>
                </button>
              ))}
              <div className="flex gap-2">
                <input className="input" placeholder="Link o ID del file Drive" value={link} onChange={(e) => setLink(e.target.value)} />
                <button className="btn-primary" disabled={busy || !parseFileId(link)} onClick={() => connectFile(parseFileId(link)!)}>Collega</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!sync.signedIn && sync.fileId && (
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => engine.signIn())}>Riconnetti Google Drive</button>
      )}

      {sync.fileId && sync.signedIn && (
        <div className="space-y-3">
          <button className="btn-soft w-full" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />Sincronizza ora</button>
          <div className="flex gap-2">
            <input className="input" type="email" placeholder="Email dell'altra persona" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} />
            <button className="btn-soft" disabled={busy || !shareEmail.includes('@')} onClick={() => run(async () => { await engine.share(shareEmail); setInfo(`File condiviso con ${shareEmail}.`); setShareEmail('') })}><Share2 size={18} /></button>
          </div>
          <p className="text-xs text-muted">L'altra persona accede con il proprio account Google e sceglie «Collega file esistente».</p>
        </div>
      )}

      {sync.fileId && (
        <div className="mt-3 flex gap-2 border-t border-line/70 pt-3">
          <button className="btn-ghost flex-1 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={16} />Cambia account</button>
          <button className="btn-ghost flex-1 !text-xs" onClick={async () => { if (await ask({ title: 'Scollegare il database?', message: 'I dati restano su Drive e in questo browser, ma non verranno più sincronizzati.', ok: 'Scollega' })) engine.unlink() }}><Unplug size={16} />Scollega</button>
          <button className="btn-ghost flex-1 !text-xs" onClick={() => void engine.signOut()}><LogOut size={16} />Esci</button>
        </div>
      )}
    </div>
  )
}
