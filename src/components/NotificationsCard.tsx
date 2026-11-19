import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { Toggle } from './ui'

/** Impostazioni delle notifiche di sistema di questo dispositivo (le notifiche nell'app sono sempre attive). */
export function NotificationsCard() {
  const { prefs, setPrefs } = useApp()
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
      <p className="mt-3 text-xs text-muted">
        Il sito non ha un server che possa svegliare il telefono: le notifiche arrivano mentre l'app è aperta o in background (si controlla ogni 2 minuti),
        e quelle perse mentre era chiusa le trovi alla riapertura. La sessione Google dura 1 ora: finché usi l'app si rinnova da sola; se resta in background senza essere toccata, dopo un'ora le notifiche si fermano finché non la riapri.
      </p>
    </section>
  )
}
