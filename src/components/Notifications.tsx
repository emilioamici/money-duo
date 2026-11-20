import { MascotImg } from './Mascots'
import { Bell, Receipt, Wallet, X } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { Sheet } from './ui'
import type { Notif } from '../lib/notifications'
import { locale, t } from '../i18n'

export function NotificationBell() {
  const { unread, setCenterOpen } = useApp()
  return (
    <button className="icon-btn" aria-label={unread ? t('Notifiche ({n} non lette)', { n: unread }) : t('Notifiche')} onClick={() => setCenterOpen(true)}>
      <Bell size={20} />
      {unread > 0 && <span className="absolute right-0.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-exp px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
    </button>
  )
}

const ago = (iso: string): string => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return t('ora')
  if (m < 60) return t('{n} min fa', { n: m })
  if (m < 1440) return t('{n} h fa', { n: Math.round(m / 60) })
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(iso))
}

const Icon = ({ n }: { n: Notif }) => (
  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${n.kind === 'tx' ? 'bg-brand/15 text-brand' : 'bg-inc/15 text-inc'}`}>
    {n.kind === 'tx' ? <Receipt size={18} /> : <Wallet size={18} />}
  </span>
)

/** Elenco delle notifiche; toccandone una si apre la transazione o la pagina Conti. */
export function NotificationCenter({ onOpenAccounts }: { onOpenAccounts: () => void }) {
  const { notifications, centerOpen, setCenterOpen, markRead, markAllRead, clearNotifications, db, openTx, unread } = useApp()
  const open = (n: Notif) => {
    markRead(n.id)
    const tx = n.txId ? db.transactions.find((t) => t.id === n.txId) : undefined
    if (tx) { setCenterOpen(false); openTx({ tx }) } else if (n.accountId) { setCenterOpen(false); onOpenAccounts() }
  }
  return (
    <Sheet open={centerOpen} onClose={() => setCenterOpen(false)} title={t('Notifiche')}
      footer={notifications.length > 0 ? (
        <div className="flex gap-2">
          <button className="btn-soft flex-1" disabled={unread === 0} onClick={markAllRead}>{t('Segna tutte come lette')}</button>
          <button className="btn-ghost" onClick={clearNotifications}>{t('Svuota')}</button>
        </div>
      ) : undefined}>
      {notifications.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          <MascotImg kind="mochi" className="mx-auto mb-3 h-20 w-auto" />
          <p className="font-semibold text-ink">{t('Nessuna notifica')}</p>
          <p className="mx-auto mt-1 max-w-xs">{t('Ti avviso quando un altro membro aggiunge una transazione che ti riguarda o un conto in comune, o condivide un conto con te.')}</p>
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-line/50">
          {notifications.map((n) => (
            <li key={n.id}>
              <button className="flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left hover:bg-line/30" onClick={() => open(n)}>
                <Icon n={n} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read ? 'font-medium' : 'font-bold'}`}>{n.title}</span>
                  <span className="block text-xs text-muted">{n.body}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{ago(n.at)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label={t('Non letta')} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/** Avviso in primo piano quando arriva una nuova notifica mentre l'app è aperta. */
export function NotificationToast() {
  const { toast, dismissToast, setCenterOpen } = useApp()
  if (!toast) return null
  return (
    <div className="pt-safe fixed inset-x-0 top-0 z-[65] flex justify-center px-3 pt-3" role="status" aria-live="polite">
      <div className="flex w-full max-w-md animate-sheet items-start gap-3 glass-strong rounded-3xl p-3">
        <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => { dismissToast(); setCenterOpen(true) }}>
          <Icon n={toast} />
          <span className="min-w-0"><span className="block text-sm font-bold">{toast.title}</span><span className="block truncate text-xs text-muted">{toast.body}</span></span>
        </button>
        <button className="rounded-full p-1 text-muted hover:bg-line/60" aria-label={t('Chiudi')} onClick={dismissToast}><X size={16} /></button>
      </div>
    </div>
  )
}
