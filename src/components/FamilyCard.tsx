import { useEffect, useState } from 'react'
import { Crown, FolderOpen, Mail, UserMinus, Wallet } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { deactivateMember, newMember, saveFamilyName, saveMember } from '../lib/mutations'
import { Field, MemberAvatar } from './ui'
import { ask } from './dialogs'
import { FolderPicker } from './FolderPicker'
import { pickerConfigured } from '../sync/picker'
import { parsePaypalHandle } from '../lib/paypal'
import { t } from '../i18n'
import { tb } from '../i18n/rich'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** Gestione della famiglia: nome, membri (inviti / rimozioni), cartella Drive del database. */
export function FamilyCard() {
  const { db, commit, sync, me } = useApp()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('new') // 'new' = nuovo membro, altrimenti id di un membro esistente senza account
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const owner = sync.ownerEmail?.toLowerCase() ?? ''
  const canManage = sync.canShare
  const unclaimed = db.members.filter((m) => m.active && !m.email && m.id !== me?.id)

  useEffect(() => { if (sync.signedIn && !pickerConfigured()) engine.currentFolder().then((f) => setFolder(f?.name ?? null)).catch(() => undefined) }, [sync.signedIn, sync.fileId])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setInfo('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const invite = () => guard(async () => {
    const mail = email.trim()
    if (db.members.some((m) => m.active && m.email?.toLowerCase() === mail.toLowerCase())) throw new Error(t('Questa persona è già nella famiglia. Se non ha ancora accesso al database, usa «Reinvia invito» accanto al suo nome.'))
    await engine.invite(mail, db.family.name)
    const existing = db.members.find((m) => !m.active && m.email?.toLowerCase() === mail.toLowerCase())
    const claimed = target !== 'new' ? db.members.find((m) => m.id === target && m.active && !m.email) : undefined
    // l'invito si collega a un membro già presente (es. dopo un import) invece di crearne uno duplicato
    commit((d) => saveMember(d, claimed ? { ...claimed, email: mail } : existing ? { ...existing, active: true } : newMember(d, name.trim() || mail.split('@')[0], mail)))
    setInfo(t('Invito inviato a {mail}. Deve accedere all\'app con quell\'account Google.', { mail }))
    setEmail(''); setName(''); setTarget('new')
  })

  /** Per chi ha l'email ma non è mai entrato (es. membri importati): concede (di nuovo) l'accesso al file su Drive. */
  const resend = (mail: string) => guard(async () => {
    await engine.invite(mail, db.family.name)
    setInfo(t('Invito inviato a {mail}. Deve accedere all\'app con quell\'account Google.', { mail }))
  })

  const remove = async (id: string) => {
    const m = db.members.find((x) => x.id === id)
    if (!m) return
    const ok = await ask({
      title: t('Rimuovere {name}?', { name: m.name }),
      message: (m.email ? t('{email} perderà l\'accesso al database su Drive.', { email: m.email }) + ' ' : '') + t('Lo storico (pagamenti e divisioni) resta, ma non sarà più selezionabile.'),
      ok: t('Rimuovi'), danger: true,
    })
    if (!ok) return
    await guard(async () => {
      if (m.email) await engine.revoke(m.email)
      commit((d) => deactivateMember(d, id))
    })
  }

  return (
    <div>
      <Field label={t('Nome della famiglia')}>
        <input className="input" value={db.family.name} readOnly={!canManage} onChange={(e) => commit((d) => saveFamilyName(d, e.target.value))} />
      </Field>

      <p className="label">{t('Membri')}</p>
      <ul className="mb-4 divide-y divide-line/50">
        {db.members.filter((m) => m.active).map((m) => {
          const isOwner = !!m.email && m.email.toLowerCase() === owner
          return (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <MemberAvatar name={m.name} color={m.color} />
              <div className="min-w-0 flex-1">
                <input className="w-full truncate bg-transparent font-semibold outline-none" value={m.name} aria-label={t('Nome di {name}', { name: m.name })}
                  readOnly={!canManage && m.id !== me?.id} onChange={(e) => commit((d) => saveMember(d, { ...m, name: e.target.value }))} />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span className="truncate">{m.email ?? t('account non associato')}</span>
                  {isOwner && <span className="flex items-center gap-0.5 font-semibold text-amber-600"><Crown size={12} />{t('Capofamiglia')}</span>}
                  {m.id === me?.id && <span className="font-semibold text-brand">{t('Tu')}</span>}
                  {!m.joinedAt && m.email && <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-600">{t('Invitato')}</span>}
                  {m.paypal && <span className="font-semibold text-trf">{t('PayPal ✓')}</span>}
                </p>
              </div>
              {canManage && !isOwner && m.id !== me?.id && m.email && !m.joinedAt && (
                <button className="btn-soft !px-2.5 !py-1 !text-xs" disabled={busy} onClick={() => void resend(m.email!)}>{t('Reinvia invito')}</button>
              )}
              {canManage && !isOwner && m.id !== me?.id && (
                <button className="rounded-full p-2 text-muted hover:bg-exp/10 hover:text-exp" aria-label={t('Rimuovi {name}', { name: m.name })} disabled={busy} onClick={() => void remove(m.id)}><UserMinus size={18} /></button>
              )}
            </li>
          )
        })}
      </ul>

      {me && <PaypalField key={me.id + (me.paypal ?? '')} handle={me.paypal ?? ''} onSave={(h) => commit((d) => saveMember(d, { ...me, paypal: h }))} />}

      {canManage ? (
        <div className="space-y-2 rounded-2xl bg-bg p-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Mail size={16} className="text-brand" />{t('Invita un membro')}</p>
          <input className="input" type="email" placeholder={t('Email Google della persona')} value={email} onChange={(e) => setEmail(e.target.value)} />
          {unclaimed.length > 0 && (
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('Associa a')}>
              <option value="new">{t('Nuovo membro')}</option>
              {unclaimed.map((m) => <option key={m.id} value={m.id}>{t('È {name} (membro senza account)', { name: m.name })}</option>)}
            </select>
          )}
          {target === 'new' && <input className="input" placeholder={t('Nome (opzionale)')} value={name} onChange={(e) => setName(e.target.value)} />}
          <button className="btn-primary w-full" disabled={busy || !validEmail(email)} onClick={() => void invite()}>{t('Invia invito')}</button>
          <p className="text-xs text-muted">{tb('L\'invito dà accesso in modifica al database su Drive. Se l\'app Google è in modalità <b>Testing</b>, aggiungi la stessa email anche tra gli <b>utenti di prova</b> in Google Cloud Console, altrimenti la persona non potrà accedere.')}</p>
        </div>
      ) : (
        <p className="rounded-xl bg-bg p-3 text-xs text-muted">{t('Solo il capofamiglia ({owner}) può invitare o rimuovere membri.', { owner: sync.ownerEmail ?? t('proprietario del file') })}</p>
      )}
      {err && <p className="mt-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
      {info && <p className="mt-3 rounded-xl bg-inc/10 p-3 text-sm text-inc">{info}</p>}

      <div className="mt-4 flex items-center gap-3 border-t border-line/70 pt-3 text-sm">
        <FolderOpen size={18} className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('Posizione del database')}</p>
          <p className="truncate text-xs text-muted">{sync.fileName}{folder ? ` · ${folder}` : ''}</p>
        </div>
        {canManage && !pickerConfigured() && <button className="btn-soft !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => setPicking(true)}>{t('Sposta…')}</button>}
      </div>
      {picking && (
        <FolderPicker title={t('Sposta il database in…')} onClose={() => setPicking(false)}
          onPick={(f) => { setPicking(false); void guard(async () => { await engine.moveTo(f.id); setFolder(f.name); setInfo(t('Database spostato in «{name}».', { name: f.name })) }) }} />
      )}
    </div>
  )
}

/** Il PayPal.Me di chi usa l'app: serve agli altri membri per rimborsarti con l'importo già impostato. */
function PaypalField({ handle, onSave }: { handle: string; onSave: (h: string | null) => void }) {
  const [text, setText] = useState(handle)
  const [err, setErr] = useState('')
  const save = () => {
    const r = parsePaypalHandle(text)
    if ('error' in r) return setErr(r.error)
    setErr(''); setText(r.handle ?? '')
    if (r.handle !== (handle || null)) onSave(r.handle)
  }
  return (
    <div className="mb-4 rounded-2xl bg-bg p-3">
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Wallet size={16} className="text-trf" />{t('Il tuo PayPal')}</p>
      <input className="input" aria-label={t('Nome PayPal.Me')} placeholder={t('Il tuo nome PayPal.Me (es. mario.rossi)')} value={text} autoCapitalize="none" autoCorrect="off"
        onChange={(e) => { setText(e.target.value); setErr('') }} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      {err && <p className="mt-1 text-xs text-exp">{err}</p>}
      <p className="mt-1 text-xs text-muted">{t('È il nome dopo paypal.me/ nel tuo link (lo crei dall\'app PayPal → «Il mio link PayPal.Me»). Gli altri membri lo useranno per rimborsarti: sarà visibile a tutta la famiglia.')}</p>
    </div>
  )
}
