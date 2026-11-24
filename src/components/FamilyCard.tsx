import { useEffect, useState } from 'react'
import { Copy, Crown, FolderOpen, KeyRound, Mail, Share2, UserMinus, Wallet } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { deactivateMember, newMember, saveFamilyName, saveMember } from '../lib/mutations'
import { Field, MemberAvatar } from './ui'
import { ask } from './dialogs'
import { FolderPicker } from './FolderPicker'
import { SubSection } from './SubSection'
import { pickerConfigured } from '../sync/picker'
import { inviteLink, setPendingInvite } from '../sync/invite'
import { bridgeAvailable, isRegistered, type BridgeHouse } from '../sync/bridge'
import { hasSession } from '../sync/auth'
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
                  {isOwner && <span className="flex items-center gap-0.5 font-semibold text-warn"><Crown size={12} />{t('Capofamiglia')}</span>}
                  {m.id === me?.id && <span className="font-semibold text-brand">{t('Tu')}</span>}
                  {!m.joinedAt && m.email && <span className="rounded-full bg-warn/15 px-1.5 text-warn">{t('Invitato')}</span>}
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
        <SubSection storageKey="moneyduo:familySections" id="invite" testId="family-invite" icon={<Mail size={16} className="text-brand" />} title={t('Invita un membro')} summary={t('Invia un invito per email')}>
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
        </SubSection>
      ) : (
        <p className="rounded-xl bg-bg p-3 text-xs text-muted">{t('Solo il capofamiglia ({owner}) può invitare o rimuovere membri.', { owner: sync.ownerEmail ?? t('proprietario del file') })}</p>
      )}
      {sync.fileId && <ReceivedInvites currentId={sync.fileId} dirty={sync.dirty} />}
      {sync.fileId && <FamilyCode fileId={sync.fileId} family={db.family.name} owner={canManage} />}
      {err && <p className="mt-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
      {info && <p className="mt-3 rounded-xl bg-inc/10 p-3 text-sm text-inc">{info}</p>}

      <SubSection storageKey="moneyduo:familySections" id="location" testId="family-location" icon={<FolderOpen size={16} className="text-brand" />} title={t('Posizione del database')} summary={`${sync.fileName ?? ''}${folder ? ` · ${folder}` : ''}`}>
        <div className="flex items-center gap-3 text-sm">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{sync.fileName}{folder ? ` · ${folder}` : ''}</p>
          {canManage && !pickerConfigured() && <button className="btn-soft !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => setPicking(true)}>{t('Sposta…')}</button>}
        </div>
      </SubSection>
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
    <SubSection storageKey="moneyduo:familySections" id="paypal" testId="family-paypal" icon={<Wallet size={16} className="text-trf" />} title={t('Il tuo PayPal')} summary={handle ? `paypal.me/${handle}` : t('Non collegato')}>
      <input className="input" aria-label={t('Nome PayPal.Me')} placeholder={t('Il tuo nome PayPal.Me (es. mario.rossi)')} value={text} autoCapitalize="none" autoCorrect="off"
        onChange={(e) => { setText(e.target.value); setErr('') }} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      {err && <p className="mt-1 text-xs text-exp">{err}</p>}
      <p className="mt-1 text-xs text-muted">{t('È il nome dopo paypal.me/ nel tuo link (lo crei dall\'app PayPal → «Il mio link PayPal.Me»). Gli altri membri lo useranno per rimborsarti: sarà visibile a tutta la famiglia.')}</p>
    </SubSection>
  )
}

/** Il codice famiglia (l'ID del file del database) e il link d'invito: chi li riceve entra nella famiglia dopo l'accesso con Google. */
function FamilyCode({ fileId, family, owner }: { fileId: string; family: string; owner: boolean }) {
  const [msg, setMsg] = useState('')
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null)
  useEffect(() => { void bridgeAvailable().then(setBridgeUp) }, [])
  // onestà: il codice basta davvero solo se il Worker ha il ponte e il capofamiglia ha registrato la famiglia con l'accesso persistente
  const works = bridgeUp && owner && hasSession() && isRegistered(fileId)
  const note = bridgeUp === null ? '' : !bridgeUp
    ? t('Il server non ha il ponte attivo: chi riceve il codice deve prima essere invitato per email e scegliere il file con il selettore di Google.')
    : !owner ? t('Chi lo riceve entra con il link o il codice se il capofamiglia ha attivato l\'accesso persistente; altrimenti il capofamiglia deve invitarlo per email.')
    : works ? t('Il codice basta: chi lo riceve entra da solo con l\'accesso Google, anche senza invito per email. Chiunque abbia il codice può entrare: per togliere qualcuno rimuovilo dalle condivisioni del file su Drive.')
    : t('Per ora il codice non basta: chi lo riceve deve prima essere invitato per email. Per farlo entrare con il solo codice attiva l\'accesso persistente (Impostazioni → Sincronizzazione) e riapri l\'app.')
  const link = inviteLink(fileId)
  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(done) } catch { setMsg(t('Non riesco a copiare: tieni premuto sul testo e copialo a mano.')) }
  }
  const share = async () => {
    const text = t('Entra nella famiglia «{name}» su Money Duo: apri il link e accedi con il tuo account Google.', { name: family })
    try {
      if (navigator.share) await navigator.share({ title: 'Money Duo', text, url: link })
      else await copy(link, t('Link d\'invito copiato.'))
    } catch { /* condivisione annullata */ }
  }
  return (
    <SubSection storageKey="moneyduo:familySections" id="code" testId="family-code" icon={<KeyRound size={16} className="text-brand" />} title={t('Codice famiglia')} summary={t('Copia il codice o condividi il link d\'invito')}>
      <p className="break-all font-mono text-xs" data-testid="family-code-value">{fileId}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-soft !px-3 !text-xs" onClick={() => void copy(fileId, t('Codice copiato.'))}><Copy size={14} />{t('Copia codice')}</button>
        <button className="btn-soft !px-3 !text-xs" onClick={() => void share()}><Share2 size={14} />{t('Condividi link d\'invito')}</button>
      </div>
      {note && <p className="text-xs text-muted" data-testid="family-code-note">{note}</p>}
      {msg && <p className="text-xs text-inc">{msg}</p>}
    </SubSection>
  )
}

/** Le altre famiglie a cui sono stato invitato (se oggi sono collegato a una): si può passare a una di quelle. */
function ReceivedInvites({ currentId, dirty }: { currentId: string; dirty: boolean }) {
  const [list, setList] = useState<BridgeHouse[]>([])
  useEffect(() => { void engine.houses().then((h) => setList(h.filter((x) => x.id !== currentId))).catch(() => undefined) }, [currentId])
  if (list.length === 0) return null
  const switchTo = async (h: BridgeHouse) => {
    if (dirty) return void ask({ title: t('Prima sincronizza'), message: t('Ci sono modifiche di questo dispositivo non ancora inviate a Drive: aspetta che la sincronizzazione finisca, poi riprova.'), ok: t('Ho capito') })
    if (!(await ask({ title: t('Passare a «{name}»?', { name: h.name }), message: t('Questo dispositivo si scollega dalla famiglia attuale (i dati restano su Drive) e apre quella dell\'invito.'), ok: t('Passa') }))) return
    setPendingInvite(h.id)
    engine.unlink()
  }
  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-trf/10 p-3" data-testid="received-invites">
      <p className="text-sm font-semibold text-trf">{list.length === 1 ? t('Hai un invito in un\'altra famiglia') : t('Hai {n} inviti in altre famiglie', { n: list.length })}</p>
      {list.map((h) => (
        <div key={h.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
          <button className="btn-soft !px-3 !py-1.5 !text-xs" onClick={() => void switchTo(h)}>{t('Collega')}</button>
        </div>
      ))}
    </div>
  )
}
