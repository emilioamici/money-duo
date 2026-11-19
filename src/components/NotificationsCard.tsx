import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { disablePush, enablePush, pushConfigured, pushSupported, savePushConfig, pushUrl, vapidPublicKey, sendPush } from '../sync/push'
import { Toggle } from './ui'

/** Impostazioni delle notifiche di sistema di questo dispositivo (le notifiche nell'app sono sempre attive). */
export function NotificationsCard() {
  const { prefs, setPrefs, sync, me } = useApp()
  const [pushMsg, setPushMsg] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [, bump] = useState(0)
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : 'denied')
  const [msg, setMsg] = useState('')

  const toggle = async (on: boolean) => {
    setMsg('')
    if (!on) return setPrefs({ systemNotif: false })
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setPerm(p)
    if (p === 'granted') setPrefs({ systemNotif: true })
    else setMsg('Il permesso per le notifiche è stato negato: abilitalo dalle impostazioni del browser o del telefono per questo sito.')
  }

  const test = async () => {
    const opts: NotificationOptions = { body: 'Le notifiche di MoneyDuo funzionano su questo dispositivo.', icon: './icon-192.png', tag: 'moneyduo-test' }
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) await reg.showNotification('Notifica di prova', opts)
      else new Notification('Notifica di prova', opts)
    } catch { setMsg('Non riesco a mostrare la notifica su questo browser.') }
  }

  const needToken = (): string => {
    const t = engine.currentToken()
    if (!t) throw new Error('Sessione Google scaduta: riconnettiti e riprova.')
    return t
  }
  const togglePush = async (on: boolean) => {
    setPushMsg(''); setPushBusy(true)
    try {
      if (!sync.fileId) throw new Error('Nessuna famiglia collegata.')
      if (on) { await enablePush(sync.fileId, needToken()); setPrefs({ pushEnabled: true }); setPushMsg('Notifiche push attivate su questo dispositivo.') }
      else { await disablePush(sync.fileId, engine.currentToken()); setPrefs({ pushEnabled: false }) }
    } catch (e) { setPushMsg(e instanceof Error ? e.message : String(e)) } finally { setPushBusy(false) }
  }
  const testPush = async () => {
    setPushMsg(''); setPushBusy(true)
    try {
      if (!sync.fileId || !me?.email) throw new Error('Serve una famiglia collegata e un account associato.')
      await sendPush(sync.fileId, needToken(), { recipients: [me.email], title: 'Notifica push di prova', body: 'Il server delle notifiche funziona.', tag: 'moneyduo-push-test', test: true })
      setPushMsg('Prova inviata: dovrebbe arrivare tra pochi secondi (con l\'app in background).')
    } catch (e) { setPushMsg(e instanceof Error ? e.message : String(e)) } finally { setPushBusy(false) }
  }

  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><BellRing size={18} className="text-brand" />Notifiche</h2>
      <p className="mb-3 text-xs text-muted">
        Nell'app trovi sempre la campanella: ti avviso quando un altro membro aggiunge una transazione che ti riguarda o un conto in comune, o condivide un conto con te.
        Puoi ricevere anche una notifica del dispositivo.
      </p>
      {!supported ? (
        <p className="rounded-xl bg-bg p-3 text-sm text-muted">Questo browser non supporta le notifiche di sistema. Su iPhone servono iOS 16.4+ e l'app aggiunta alla schermata Home.</p>
      ) : (
        <>
          <Toggle checked={prefs.systemNotif && perm === 'granted'} onChange={(v) => void toggle(v)} label="Notifiche del dispositivo" hint="Quando l'app è in background" />
          {prefs.systemNotif && perm === 'granted' && <button className="btn-soft w-full" onClick={() => void test()}>Invia una notifica di prova</button>}
          {msg && <p className="mt-2 text-sm text-exp">{msg}</p>}
        </>
      )}
      <div className="mt-4 border-t border-line/70 pt-4">
        <p className="mb-1 font-semibold">Notifiche push (anche ad app chiusa)</p>
        {!pushConfigured() ? (
          <div className="space-y-2 text-xs text-muted">
            <p>Serve il piccolo server di notifiche (guida in <b>worker/README.md</b>). Quando è pronto, inserisci qui i due valori.</p>
            <input className="input" placeholder="Indirizzo del server (https://….workers.dev)" defaultValue={pushUrl()} onBlur={(e) => { savePushConfig(e.target.value, vapidPublicKey()); bump((n) => n + 1) }} />
            <input className="input" placeholder="Chiave pubblica VAPID" defaultValue={vapidPublicKey()} onBlur={(e) => { savePushConfig(pushUrl(), e.target.value); bump((n) => n + 1) }} />
          </div>
        ) : !pushSupported() ? (
          <p className="text-xs text-muted">Questo browser non supporta le notifiche push. Su iPhone servono iOS 16.4+ e l'app aggiunta alla schermata Home.</p>
        ) : (
          <>
            <Toggle checked={prefs.pushEnabled} onChange={(v) => void togglePush(v)} label="Ricevi le notifiche anche con l'app chiusa" hint="Su questo dispositivo" />
            {prefs.pushEnabled && <button className="btn-soft w-full" disabled={pushBusy} onClick={() => void testPush()}>Invia una notifica push di prova</button>}
          </>
        )}
        {pushMsg && <p className="mt-2 text-sm text-muted">{pushMsg}</p>}
      </div>
      <p className="mt-3 text-xs text-muted">
        Senza il server push, il sito non può svegliare il telefono: le notifiche arrivano mentre l'app è aperta o in background (si controlla ogni 2 minuti),
        e quelle perse mentre era chiusa le trovi alla riapertura. {sync.persistent ? "L'accesso persistente tiene attiva la sessione Google anche in background." : "La sessione Google dura 1 ora: finché usi l'app si rinnova da sola; se resta in background senza essere toccata, dopo un'ora le notifiche si fermano finché non la riapri."}
      </p>
    </section>
  )
}
