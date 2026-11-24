import { useEffect, useState, useSyncExternalStore } from 'react'
import { Loader2, ScanFace } from 'lucide-react'
import { getLockState, forgetLock, hasPin, isPin, subscribeLock, unlock, unlockWithPin, watchVisibility } from '../lib/appLock'
import { PinField } from './PinField'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { MascotImg } from './Mascots'
import { t } from '../i18n'

/** Schermata di blocco: copre tutta l'app finché il telefono non conferma l'identità (Face ID, impronta o codice). */
export function AppLock() {
  const s = useSyncExternalStore(subscribeLock, getLockState)
  const { resetLocal } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [pinMode, setPinMode] = useState(false)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState('')

  useEffect(() => watchVisibility(), [])

  const attempt = async (silent: boolean) => {
    setBusy(true); if (!silent) setErr('')
    try { await unlock(); setConfirm(false) } catch (e) {
      // dopo un tentativo fallito (non quello automatico) si passa al codice di sblocco
      if (!silent && hasPin()) setPinMode(true)
      // su iPhone l'autenticazione parte solo da un tocco: il tentativo automatico può fallire senza che sia un problema
      if (!silent) setErr(e instanceof Error && e.name === 'NotAllowedError' ? t('Sblocco annullato o non riuscito: riprova.') : t('Non riesco a sbloccare con questo dispositivo.'))
    } finally { setBusy(false) }
  }
  // appena l'app si blocca prova da sola; se serve un tocco, resta il pulsante
  useEffect(() => { if (s.locked) void attempt(true); else { setErr(''); setConfirm(false); setPinMode(false); setPin(''); setPinErr('') } }, [s.locked]) // eslint-disable-line react-hooks/exhaustive-deps

  const tryPin = async (v: string) => {
    if (!isPin(v)) return
    const r = await unlockWithPin(v)
    if (r.ok) return
    setPin('')
    setPinErr(r.wait ? t('Troppi tentativi: riprova tra {s} secondi.', { s: r.wait }) : t('Codice errato.'))
  }
  if (!s.locked) return null
  // anche l'accesso Google va chiuso: altrimenti il login persistente riscaricherebbe i dati senza passare dal blocco
  const detach = () => { forgetLock(); void engine.signOut(); resetLocal() }
  return (
    <div role="dialog" aria-modal="true" aria-label={t('App bloccata')} data-testid="app-lock" className="fixed inset-0 z-[110] flex flex-col items-center justify-center overflow-y-auto bg-bg px-6 py-10 text-center">
      <MascotImg kind="pair" className="mx-auto mb-4 w-44" />
      <h1 className="text-3xl font-extrabold tracking-tight">Money <span className="text-brand">Duo</span></h1>
      <p className="mt-2 text-sm text-muted">{t('App bloccata')}</p>
      <div className="glass-strong mt-8 w-full max-w-sm space-y-3 p-5">
        <button className="btn-primary w-full !py-3.5" disabled={busy} onClick={() => void attempt(false)}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ScanFace size={18} />}{t('Sblocca con Face ID o impronta')}
        </button>
        {pinMode && (
          <div className="space-y-2" data-testid="pin-box">
            <p className="text-sm text-muted">{t('Oppure inserisci il codice di sblocco a 6 cifre')}</p>
            <PinField value={pin} onChange={(v) => { setPin(v); setPinErr(''); void tryPin(v) }} label={t('Codice di sblocco')} testId="pin-input" autoFocus />
            {pinErr && <p className="rounded-xl bg-exp/10 p-3 text-sm text-exp" data-testid="pin-error">{pinErr}</p>}
          </div>
        )}
        {err && !pinMode && <p className="rounded-xl bg-exp/10 p-3 text-sm text-exp" data-testid="lock-error">{err}</p>}
        {err && pinMode && <p className="text-xs text-muted" data-testid="lock-error">{err}</p>}
        {!confirm ? (
          <button className="btn-ghost w-full !text-xs" onClick={() => setConfirm(true)}>{t('Non riesci a sbloccare?')}</button>
        ) : (
          <div className="space-y-2 rounded-xl bg-bg p-3 text-left text-sm">
            <p>{t('Puoi scollegare questo dispositivo: il blocco si toglie e i dati locali vengono cancellati. Per rientrare serve l\'accesso con Google; i dati della famiglia restano su Drive.')}</p>
            <button className="btn-danger w-full" onClick={detach}>{t('Scollega questo dispositivo')}</button>
            <button className="btn-ghost w-full !text-xs" onClick={() => setConfirm(false)}>{t('Annulla')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
