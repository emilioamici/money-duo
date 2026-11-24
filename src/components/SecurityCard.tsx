import { useEffect, useState } from 'react'
import { disableLock, enableLock, getLockState, lockSupported, subscribeLock, LOCK_AFTER_MS } from '../lib/appLock'
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

  const change = async (on: boolean) => {
    setMsg(null); setBusy(true)
    try {
      if (on) { await enableLock(); setMsg({ text: t('Blocco attivato su questo dispositivo.') }) } else { await disableLock(); setMsg({ text: t('Blocco disattivato.') }) }
    } catch (e) {
      setMsg({ text: e instanceof Error && e.name === 'NotAllowedError' ? t('Operazione annullata: il telefono non ha confermato l\'identità.') : t('Non riesco a completare l\'operazione con questo dispositivo.'), bad: true })
    } finally { setBusy(false) }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">{t('Chiede il Face ID, l\'impronta o il codice del telefono quando riapri l\'app dopo averla lasciata in background per {min} minuto. È un blocco della schermata per questo dispositivo, non una cifratura dei dati.', { min: LOCK_AFTER_MS / 60000 })}</p>
      {supported === false ? (
        <p className="rounded-xl bg-bg p-3 text-sm text-muted" data-testid="lock-unsupported">{t('Il blocco biometrico non è disponibile su questo dispositivo o browser. Su iPhone servono iOS 16 o successivo e l\'app aggiunta alla schermata Home, con Face ID o Touch ID attivi.')}</p>
      ) : (
        <div className={busy || supported === null ? 'pointer-events-none opacity-60' : ''}>
          <Toggle checked={s.enabled} onChange={(v) => void change(v)} label={t('Blocca l\'app con Face ID / impronta')} hint={t('Solo su questo dispositivo')} />
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.bad ? 'text-exp' : 'text-muted'}`}>{msg.text}</p>}
    </div>
  )
}
