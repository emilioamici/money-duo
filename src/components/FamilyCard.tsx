import { useEffect, useState } from 'react'
import { Crown, FolderOpen, Mail, UserMinus } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { deactivateMember, newMember, saveFamilyName, saveMember } from '../lib/mutations'
import { Field, MemberAvatar } from './ui'
import { ask } from './dialogs'
import { FolderPicker } from './FolderPicker'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** Gestione della famiglia: nome, membri (inviti / rimozioni), cartella Drive del database. */
export function FamilyCard() {
  const { db, commit, sync, me } = useApp()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const owner = sync.ownerEmail?.toLowerCase() ?? ''
  const canManage = sync.canShare

  useEffect(() => { if (sync.signedIn) engine.currentFolder().then((f) => setFolder(f?.name ?? null)).catch(() => undefined) }, [sync.signedIn, sync.fileId])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setInfo('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const invite = () => guard(async () => {
    const mail = email.trim()
    if (db.members.some((m) => m.active && m.email?.toLowerCase() === mail.toLowerCase())) throw new Error('Questa persona è già nella famiglia.')
    await engine.invite(mail, db.family.name)
    const existing = db.members.find((m) => !m.active && m.email?.toLowerCase() === mail.toLowerCase())
    commit((d) => saveMember(d, existing ? { ...existing, active: true } : newMember(d, name.trim() || mail.split('@')[0], mail)))
    setInfo(`Invito inviato a ${mail}. Deve accedere all'app con quell'account Google.`)
    setEmail(''); setName('')
  })

  const remove = async (id: string) => {
    const m = db.members.find((x) => x.id === id)
    if (!m) return
    const ok = await ask({
      title: `Rimuovere ${m.name}?`,
      message: `${m.email ? `${m.email} perderà l'accesso al database su Drive. ` : ''}Lo storico (pagamenti e divisioni) resta, ma non sarà più selezionabile.`,
      ok: 'Rimuovi', danger: true,
    })
    if (!ok) return
    await guard(async () => {
      if (m.email) await engine.revoke(m.email)
      commit((d) => deactivateMember(d, id))
    })
  }

  return (
    <section className="card p-4">
      <h2 className="mb-3 font-bold">Famiglia</h2>
      <Field label="Nome della famiglia">
        <input className="input" value={db.family.name} readOnly={!canManage} onChange={(e) => commit((d) => saveFamilyName(d, e.target.value))} />
      </Field>

      <p className="label">Membri</p>
      <ul className="mb-4 divide-y divide-line/50">
        {db.members.filter((m) => m.active).map((m) => {
          const isOwner = !!m.email && m.email.toLowerCase() === owner
          return (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <MemberAvatar name={m.name} color={m.color} />
              <div className="min-w-0 flex-1">
                <input className="w-full truncate bg-transparent font-semibold outline-none" value={m.name} aria-label={`Nome di ${m.name}`}
                  readOnly={!canManage && m.id !== me?.id} onChange={(e) => commit((d) => saveMember(d, { ...m, name: e.target.value }))} />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span className="truncate">{m.email ?? 'account non associato'}</span>
                  {isOwner && <span className="flex items-center gap-0.5 font-semibold text-amber-600"><Crown size={12} />Capofamiglia</span>}
                  {m.id === me?.id && <span className="font-semibold text-brand">Tu</span>}
                  {!m.joinedAt && m.email && <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-600">Invitato</span>}
                </p>
              </div>
              {canManage && !isOwner && m.id !== me?.id && (
                <button className="rounded-full p-2 text-muted hover:bg-exp/10 hover:text-exp" aria-label={`Rimuovi ${m.name}`} disabled={busy} onClick={() => void remove(m.id)}><UserMinus size={18} /></button>
              )}
            </li>
          )
        })}
      </ul>

      {canManage ? (
        <div className="space-y-2 rounded-2xl bg-bg p-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Mail size={16} className="text-brand" />Invita un membro</p>
          <input className="input" type="email" placeholder="Email Google della persona" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="Nome (opzionale)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || !validEmail(email)} onClick={() => void invite()}>Invia invito</button>
          <p className="text-xs text-muted">L'invito dà accesso in modifica al database su Drive. Se l'app Google è in modalità <b>Testing</b>, aggiungi la stessa email anche tra gli <b>utenti di prova</b> in Google Cloud Console, altrimenti la persona non potrà accedere.</p>
        </div>
      ) : (
        <p className="rounded-xl bg-bg p-3 text-xs text-muted">Solo il capofamiglia ({sync.ownerEmail ?? 'proprietario del file'}) può invitare o rimuovere membri.</p>
      )}
      {err && <p className="mt-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
      {info && <p className="mt-3 rounded-xl bg-inc/10 p-3 text-sm text-inc">{info}</p>}

      <div className="mt-4 flex items-center gap-3 border-t border-line/70 pt-3 text-sm">
        <FolderOpen size={18} className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Posizione del database</p>
          <p className="truncate text-xs text-muted">{sync.fileName}{folder ? ` · ${folder}` : ''}</p>
        </div>
        {canManage && <button className="btn-soft !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => setPicking(true)}>Sposta…</button>}
      </div>
      {picking && (
        <FolderPicker title="Sposta il database in…" onClose={() => setPicking(false)}
          onPick={(f) => { setPicking(false); void guard(async () => { await engine.moveTo(f.id); setFolder(f.name); setInfo(`Database spostato in «${f.name}».`) }) }} />
      )}
    </section>
  )
}
