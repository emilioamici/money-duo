import { t } from '../i18n'

/** Collegamento a PayPal.Me: ogni persona indica il proprio nome utente, gli altri lo usano per pagarla con l'importo già impostato. */

/** Estrae il nome utente da «mario», «@mario», «paypal.me/mario» o dal link completo. Restituisce null se vuoto, un messaggio d'errore se non valido. */
export function parsePaypalHandle(raw: string): { handle: string | null } | { error: string } {
  const text = raw.trim()
  if (!text) return { handle: null }
  const fromLink = /paypal\.me\/([^/?#\s]+)/i.exec(text)
  const name = (fromLink ? fromLink[1] : text).replace(/^@/, '')
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(name)) return { error: t('Nome PayPal.Me non valido: usa solo lettere e numeri (es. mario.rossi) oppure incolla il tuo link paypal.me/…') }
  return { handle: name }
}

/** Link che apre PayPal per inviare `cents` centesimi di euro alla persona. */
export function paypalUrl(handle: string, cents: number): string {
  return `https://www.paypal.me/${encodeURIComponent(handle)}/${(cents / 100).toFixed(2)}EUR`
}
