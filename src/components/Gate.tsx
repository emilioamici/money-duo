import { useEffect, useRef, useState } from 'react'
import { FilePlus2, Loader2, RefreshCw, UserRound } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { DB_FILE_NAME, parseFileId, type DriveFile } from '../sync/drive'
import { dateTimeLabel } from '../lib/format'
import { linkDatabase } from './linkFlow'

type Phase = 'login' | 'searching' | 'choose' | 'none'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Schermata iniziale: accesso con Google, poi il database Drive viene trovato e collegato in automatico. */
export function Gate() {
  const { sync, db } = useApp()
  const [phase, setPhase] = useState<Phase>(sync.signedIn ? 'searching' : 'login')
  const [exact, setExact] = useState<DriveFile[]>([])
  const [others, setOthers] = useState<DriveFile[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState('')
  const started = useRef(false)

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const connect = async (id: string) => {
    const ok = await linkDatabase(db, id)
    if (!ok) setPhase('choose')
  }

  const search = async () => {
    setPhase('searching'); setErr('')
    try {
      const all = await engine.listCandidates()
      const ex = all.filter((f) => f.name === DB_FILE_NAME)
      setExact(ex); setOthers(all.filter((f) => f.name !== DB_FILE_NAME))
      if (ex.length === 1) return await connect(ex[0].id) // un solo database: collegamento automatico
      setPhase(ex.length > 1 ? 'choose' : 'none')
    } catch (e) {
      setErr(msg(e)); setPhase('none')
    }
  }

  // appena si è autenticati si cerca il database (una sola volta, anche con StrictMode)
  useEffect(() => {
    if (sync.signedIn && !started.current) { started.current = true; void search() }
  }, [sync.signedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = (selectAccount = false) => guard(async () => { started.current = false; await engine.signIn({ selectAccount }) })

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <img src="./icon.svg" alt="" className="mx-auto mb-4 h-20 w-20 rounded-3xl shadow-lg" />
        <h1 className="text-3xl font-extrabold tracking-tight">Money<span className="text-brand">Duo</span></h1>
        <p className="mt-2 text-sm text-muted">Spese personali e conti in comune, sincronizzati su Google Drive.</p>
      </div>

      <div className="card space-y-4 p-5">
        {err && <p className="rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}

        {phase === 'login' && (
          <>
            <p className="text-sm text-muted">Accedi con il <b>tuo account Google</b>. I dati sono nel file «{DB_FILE_NAME}» su Drive, condiviso con l'altra persona: lo trovo io, non devi collegare nulla.</p>
            {!sync.clientId && (
              <div className="rounded-xl bg-brand/10 p-3 text-sm">
                <p className="mb-2">Manca il Client ID OAuth di Google Cloud (vedi README).</p>
                <input className="input" placeholder="xxxx.apps.googleusercontent.com" onBlur={(e) => engine.setClientId(e.target.value)} />
              </div>
            )}
            <button className="btn-primary w-full" disabled={busy || !sync.clientId} onClick={() => void login()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}Accedi con Google
            </button>
          </>
        )}

        {phase === 'searching' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted">
            <Loader2 className="animate-spin text-brand" />Cerco il database su Drive…
          </div>
        )}

        {phase === 'choose' && (
          <>
            <p className="text-sm text-muted">Ho trovato più di un database. Quale vuoi usare?</p>
            <FileList files={exact} busy={busy} onPick={(id) => void guard(() => connect(id))} />
          </>
        )}

        {phase === 'none' && (
          <>
            <p className="text-sm">Non ho trovato nessun database accessibile da <b>{sync.email ?? 'questo account'}</b>.</p>
            <p className="rounded-xl bg-brand/10 p-3 text-sm text-muted">
              Se l'altra persona lo ha già creato, chiedile di condividere il file con <b className="text-ink">{sync.email ?? 'questo indirizzo'}</b> (Impostazioni → Google Drive), poi premi «Cerca di nuovo». Crea un nuovo database solo se non esiste ancora: due database separati non si vedrebbero tra loro.
            </p>
            <button className="btn-soft w-full" disabled={busy} onClick={() => void search()}><RefreshCw size={18} />Cerca di nuovo</button>
            <button className="btn-primary w-full" disabled={busy} onClick={() => void guard(async () => { await engine.createNew() })}><FilePlus2 size={18} />Crea nuovo database</button>
            {others.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Altri file con «moneyduo» nel nome</summary>
                <div className="mt-2"><FileList files={others} busy={busy} onPick={(id) => void guard(() => connect(id))} /></div>
              </details>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Ho il link o l'ID del file</summary>
              <div className="mt-2 flex gap-2">
                <input className="input" placeholder="Link o ID del file Drive" value={link} onChange={(e) => setLink(e.target.value)} />
                <button className="btn-primary" disabled={busy || !parseFileId(link)} onClick={() => void guard(() => connect(parseFileId(link)!))}>Collega</button>
              </div>
            </details>
          </>
        )}

        {phase !== 'login' && phase !== 'searching' && (
          <button className="btn-ghost w-full !text-xs" disabled={busy} onClick={() => void login(true)}>Usa un altro account Google</button>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-muted">I dati restano nel tuo Drive e in questo browser: nessun server di terze parti.</p>
    </div>
  )
}

function FileList({ files, busy, onPick }: { files: DriveFile[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {files.map((f) => (
        <button key={f.id} disabled={busy} onClick={() => onPick(f.id)} className="w-full rounded-xl border border-line p-3 text-left text-sm hover:bg-line/40">
          <p className="font-semibold">{f.name}</p>
          <p className="text-xs text-muted">{f.ownedByMe ? 'Creato da te' : `Condiviso da ${f.owners?.[0]?.emailAddress ?? 'un altro account'}`} · {dateTimeLabel(f.modifiedTime)}</p>
        </button>
      ))}
    </div>
  )
}
