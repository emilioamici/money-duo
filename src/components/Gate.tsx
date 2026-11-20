import { MascotImg } from './Mascots'
import { useEffect, useRef, useState } from 'react'
import { Folder, Loader2, RefreshCw, UserRound, Users } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { isDatabaseFile, parseFileId, type DriveFile } from '../sync/drive'
import { dateTimeLabel } from '../lib/format'
import { linkDatabase } from './linkFlow'
import { FolderPicker, type PickedFolder } from './FolderPicker'
import { t } from '../i18n'
import { tb } from '../i18n/rich'
import { pickerConfigured } from '../sync/picker'

type Phase = 'login' | 'searching' | 'choose' | 'none'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Schermata iniziale: accesso con Google, poi la famiglia viene trovata e collegata in automatico (o se ne crea una). */
export function Gate({ reconnect = false }: { reconnect?: boolean }) {
  const { sync, db } = useApp()
  const [phase, setPhase] = useState<Phase>(!reconnect && sync.signedIn ? 'searching' : 'login')
  const [dbs, setDbs] = useState<DriveFile[]>([])
  const [others, setOthers] = useState<DriveFile[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState('')
  const [familyName, setFamilyName] = useState(() => t('Famiglia'))
  const [myName, setMyName] = useState(sync.name ?? '')
  const [folder, setFolder] = useState<PickedFolder>({ id: 'root', name: 'Il mio Drive' })
  const [picking, setPicking] = useState(false)
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
      const found = all.filter(isDatabaseFile)
      setDbs(found); setOthers(all.filter((f) => !isDatabaseFile(f)))
      if (found.length === 1) return await connect(found[0].id) // una sola famiglia: collegamento automatico
      setPhase(found.length > 1 ? 'choose' : 'none')
    } catch (e) {
      setErr(msg(e)); setPhase('none')
    }
  }

  // appena si è autenticati si cerca il database (una sola volta, anche con StrictMode)
  useEffect(() => {
    // in riconnessione la famiglia è già collegata: basta rifare l'accesso, non si cerca nulla
    if (!reconnect && sync.signedIn && !started.current) { started.current = true; void search() }
  }, [sync.signedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!myName && sync.name) setMyName(sync.name) }, [sync.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = (selectAccount = false) => guard(async () => { started.current = false; await engine.signIn({ selectAccount }) })
  const pickFolderNow = () => guard(async () => { const f = await engine.pickFolder(); if (f) setFolder(f) })
  const pickDatabaseNow = () => guard(async () => { const f = await engine.pickDatabase(); if (f) await connect(f.id) })
  const create = () => guard(() => engine.createFamily({ familyName, memberName: myName || sync.email || '', folderId: folder.id === 'root' ? null : folder.id }))

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <MascotImg kind="pair" className="mx-auto mb-3 w-44" />
        <h1 className="text-3xl font-extrabold tracking-tight">Money <span className="text-brand">Duo</span></h1>
        <p className="mt-2 text-sm text-muted">{t('Spese personali e conti di famiglia, nel tuo Google Drive.')}</p>
      </div>

      <div className="card space-y-4 p-5">
        {err && <p className="rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}

        {phase === 'login' && reconnect && (
          <>
            <h2 className="text-lg font-bold">{t('Sessione Google scaduta')}</h2>
            <p className="text-sm text-muted">{sync.email ? tb('Per continuare accedi di nuovo come <b>{email}</b>. I tuoi dati sono al sicuro su Drive e rimangono nascosti finché non accedi.', { email: sync.email }) : t('Per continuare accedi di nuovo con il tuo account Google. I tuoi dati sono al sicuro su Drive e rimangono nascosti finché non accedi.')}</p>
            <button className="btn-primary w-full" disabled={busy} onClick={() => void login()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}
            </button>
            <button className="btn-ghost w-full !text-xs" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
            <button className="btn-ghost w-full !text-xs" disabled={busy} onClick={() => engine.unlink()}>{t('Scollega questa famiglia')}</button>
          </>
        )}

        {phase === 'login' && !reconnect && (
          <>
            <p className="text-sm text-muted">{tb('Accedi con il <b>tuo account Google</b>. Se qualcuno ti ha invitato in una famiglia, la ritrovo io; altrimenti puoi crearne una nuova.')}</p>
            {!sync.clientId && (
              <div className="rounded-xl bg-brand/10 p-3 text-sm">
                <p className="mb-2">{t('Manca il Client ID OAuth di Google Cloud (vedi README).')}</p>
                <input className="input" placeholder={t('xxxx.apps.googleusercontent.com')} onBlur={(e) => engine.setClientId(e.target.value)} />
              </div>
            )}
            <button className="btn-primary w-full" disabled={busy || !sync.clientId} onClick={() => void login()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}
            </button>
          </>
        )}

        {phase === 'searching' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted">
            <Loader2 className="animate-spin text-brand" />{t('Cerco la tua famiglia su Drive…')}
          </div>
        )}

        {phase === 'choose' && (
          <>
            <p className="text-sm text-muted">{t('Hai accesso a più famiglie. Quale vuoi aprire?')}</p>
            <FileList files={dbs} busy={busy} onPick={(id) => void guard(() => connect(id))} />
          </>
        )}

        {phase === 'none' && (
          <>
            <p className="text-sm">{tb('Nessuna famiglia trovata per <b>{email}</b>.', { email: sync.email ?? t('questo account') })}</p>

            <div className="space-y-3 rounded-2xl border border-line p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-brand" />{t('Crea la tua famiglia')}</p>
              <p className="text-xs text-muted">{t('Il database sarà un file nel tuo Drive: tu sei il capofamiglia e inviti gli altri membri dalle Impostazioni.')}</p>
              <input className="input" placeholder={t('Nome della famiglia')} value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
              <input className="input" placeholder={t('Il tuo nome')} value={myName} onChange={(e) => setMyName(e.target.value)} />
              <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm hover:bg-line/40" onClick={() => (pickerConfigured() ? void pickFolderNow() : setPicking(true))}>
                <Folder size={18} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{t('Cartella del database')}</span><span className="block truncate font-semibold">{folder.id === 'root' ? t('Il mio Drive') : folder.name}</span></span>
                <span className="text-xs font-semibold text-brand">{t('Cambia')}</span>
              </button>
              <button className="btn-primary w-full" disabled={busy || !familyName.trim()} onClick={() => void create()}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}{t('Crea famiglia')}</button>
            </div>

            {pickerConfigured() && (
              <div className="space-y-2 rounded-2xl border border-line p-3">
                <p className="flex items-center gap-2 text-sm font-semibold"><Folder size={16} className="text-brand" />{t('Hai ricevuto un invito?')}</p>
                <p className="text-xs text-muted">{t('Il capofamiglia ha condiviso il database con te: scegli quel file su Drive (lo trovi in «Condivisi con me»). Lo si fa una volta sola.')}</p>
                <button className="btn-primary w-full" disabled={busy} onClick={() => void pickDatabaseNow()}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Folder size={18} />}{t('Scegli il database di famiglia')}</button>
              </div>
            )}

            <div className="rounded-xl bg-brand/10 p-3 text-sm text-muted">
              {tb('Aspetti un invito? Chiedi al capofamiglia di aggiungere <b>{email}</b> tra i membri, poi', { email: sync.email ?? t('questa email') })}
              <button className="ml-1 inline-flex items-center gap-1 font-semibold text-brand" disabled={busy} onClick={() => void search()}><RefreshCw size={14} />{t('cerca di nuovo')}</button>.
            </div>

            {others.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">{t('Altri file con «moneyduo» nel nome')}</summary>
                <div className="mt-2"><FileList files={others} busy={busy} onPick={(id) => void guard(() => connect(id))} /></div>
              </details>
            )}
            {!pickerConfigured() && <details className="text-sm">
              <summary className="cursor-pointer text-muted">{t('Ho il link o l\'ID del file')}</summary>
              <div className="mt-2 flex gap-2">
                <input className="input" placeholder={t('Link o ID del file Drive')} value={link} onChange={(e) => setLink(e.target.value)} />
                <button className="btn-primary" disabled={busy || !parseFileId(link)} onClick={() => void guard(() => connect(parseFileId(link)!))}>{t('Collega')}</button>
              </div>
            </details>}
          </>
        )}

        {!reconnect && phase !== 'login' && phase !== 'searching' && (
          <button className="btn-ghost w-full !text-xs" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-muted">{t('I dati restano nel Drive del capofamiglia e in questo browser: nessun server di terze parti.')}</p>
      {picking && <FolderPicker onClose={() => setPicking(false)} onPick={(f) => { setFolder(f); setPicking(false) }} />}
    </div>
  )
}

function FileList({ files, busy, onPick }: { files: DriveFile[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {files.map((f) => (
        <button key={f.id} disabled={busy} onClick={() => onPick(f.id)} className="w-full rounded-xl border border-line p-3 text-left text-sm hover:bg-line/40">
          <p className="font-semibold">{f.name}</p>
          <p className="text-xs text-muted">{f.ownedByMe ? t('Creato da te') : t('Capofamiglia: {email}', { email: f.owners?.[0]?.emailAddress ?? t('altro account') })} · {dateTimeLabel(f.modifiedTime)}</p>
        </button>
      ))}
    </div>
  )
}
