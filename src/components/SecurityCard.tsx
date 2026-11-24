import { useEffect, useState } from 'react'
import { disableLock, enableLock, getLockState, hasPin, isPin, lockSupported, subscribeLock, LOCK_AFTER_MS } from '../lib/appLock'
import { PinField } from './PinField'
import { useSyncExternalStore } from 'react'
import { Toggle } from './ui'
import { t } from '../i18n'

/** Impostazioni → Sicurezza: blocco dell'app con Face ID / impronta, per questo dispositivo. */
export function SecurityCard() {
  const s = useSyncExternalStore(subscribeLock, getLockState)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  useEffect(() => { void lockSupported().then(setSupported) }, [])
  const [step, setStep] = useState<'off' | 'set' | 'off-pin'>('off')
  const [pin, setPin] = useState(''), [pin2, setPin2] = useState('')
  const close = () => { setStep('off'); setPin(''); setPin2('') }

  const activate = async () => {
    if (!isPin(pin)) return setMsg({ text: t('Il codice deve avere 6 cifre.'), bad: true })
    if (pin !== pin2) return setMsg({ text: t('I due codici non coincidono.'), bad: true })
    setMsg(null); setBusy(true)
    try { await enableLock(pin); close(); setMsg({ text: t('Blocco attivato su questo dispositivo.') }) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const fail = (e: unknown) =>
      setMsg({ text: e instanceof Error && e.name === 'NotAllowedError' ? t('Operazione annullata: il telefono non ha confermato l\'identità.') : t('Non riesco a completare l\'operazione con questo dispositivo.'), bad: true })
  const change = async (on: boolean) => {
    setMsg(null)
    if (on) { setStep('set'); return }
    setBusy(true)
    try { await disableLock(); close(); setMsg({ text: t('Blocco disattivato.') }) } catch (e) {
      // Face ID non confermato: si può disattivare anche con il codice
      if (hasPin()) setStep('off-pin'); else fail(e)
    } finally { setBusy(false) }
  }
  const disableWithPin = async (v: string) => {
    if (!isPin(v)) return
    const r = await disableLock(v)
    if (r.ok) { close(); setMsg({ text: t('Blocco disattivato.') }); return }
    setPin('')
    setMsg({ text: r.wait ? t('Troppi tentativi: riprova tra {s} secondi.', { s: r.wait }) : t('Codice errato.'), bad: true })
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">{t('Chiede il Face ID o l\'impronta (e, se non funzionano, il codice a 6 cifre che scegli tu) quando riapri l\'app dopo averla lasciata in background per {min} minuto. È un blocco della schermata per questo dispositivo, non una cifratura dei dati.', { min: LOCK_AFTER_MS / 60000 })}</p>
      {supported === false ? (
        <p className="rounded-xl bg-bg p-3 text-sm text-muted" data-testid="lock-unsupported">{t('Il blocco biometrico non è disponibile su questo dispositivo o browser. Su iPhone servono iOS 16 o successivo e l\'app aggiunta alla schermata Home, con Face ID o Touch ID attivi.')}</p>
      ) : (
        <div className={busy || supported === null ? 'pointer-events-none opacity-60' : ''}>
          <Toggle checked={s.enabled} onChange={(v) => void change(v)} label={t('Blocca l\'app con Face ID / impronta')} hint={t('Solo su questo dispositivo')} />
        </div>
      )}
      {step === 'set' && (
        <div className="mt-3 space-y-2 rounded-xl bg-bg p-3" data-testid="pin-setup">
          <p className="text-sm">{t('Scegli un codice di sblocco a 6 cifre: ti servirà se Face ID o l\'impronta non funzionano.')}</p>
          <PinField value={pin} onChange={setPin} label={t('Codice di sblocco')} testId="pin-new" autoFocus />
          <PinField value={pin2} onChange={setPin2} label={t('Ripeti il codice')} testId="pin-new2" />
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => { close(); setMsg(null) }}>{t('Annulla')}</button>
            <button className="btn-primary flex-1" disabled={busy} data-testid="pin-activate" onClick={() => void activate()}>{t('Attiva il blocco')}</button>
          </div>
        </div>
      )}
      {step === 'off-pin' && (
        <div className="mt-3 space-y-2 rounded-xl bg-bg p-3" data-testid="pin-disable">
          <p className="text-sm">{t('Face ID non confermato. Per disattivare il blocco inserisci il codice di sblocco.')}</p>
          <PinField value={pin} onChange={(v) => { setPin(v); void disableWithPin(v) }} label={t('Codice di sblocco')} testId="pin-off" autoFocus />
          <button className="btn-ghost w-full" onClick={() => { close(); setMsg(null) }}>{t('Annulla')}</button>
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.bad ? 'text-exp' : 'text-muted'}`}>{msg.text}</p>}
    </div>
  )
}
