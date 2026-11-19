import { lang, locale, t } from '../i18n'

const eurCache = new Map<string, Intl.NumberFormat>()
const eur = (): Intl.NumberFormat => {
  const l = locale()
  let f = eurCache.get(l)
  if (!f) { f = new Intl.NumberFormat(l, { style: 'currency', currency: 'EUR' }); eurCache.set(l, f) }
  return f
}

/** centesimi -> "1.234,56 €" (italiano) o "€1,234.56" (inglese) */
export const formatMoney = (cents: number): string => eur().format(cents / 100)

/** Come formatMoney ma con segno esplicito (+/−) */
export function formatSigned(cents: number): string {
  if (cents === 0) return formatMoney(0)
  return (cents > 0 ? '+' : '−') + formatMoney(Math.abs(cents))
}

/** "12,50" | "1.234,56" | "1,234.56" | "12.5" | "-3" -> centesimi; null se non valido */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/\s/g, '').replace(/€/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) {
    // con entrambi i simboli, l'ultimo è quello dei decimali
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    s = dec === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (s.includes(',')) {
    const parts = s.split(',')
    // in inglese «1,234» sono migliaia; in italiano la virgola è sempre il separatore dei decimali
    if (parts.length > 2 || (lang() === 'en' && parts[1].length === 3)) s = parts.join('')
    else s = s.replace(',', '.')
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Math.round(parseFloat(s) * 100)
  return Number.isFinite(n) ? n : null
}

/** centesimi -> testo da mostrare in un campo ("12,5" in italiano, "12.5" in inglese) */
export function centsToInput(cents: number): string {
  const sep = lang() === 'en' ? '.' : ','
  const s = (cents / 100).toFixed(2).replace('.', sep)
  return s.endsWith(sep + '00') ? s.slice(0, -3) : s
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO -> valore per <input type="datetime-local"> (ora locale) */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (v: string): string => new Date(v).toISOString()

export function monthLabel(d: Date): string {
  const s = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const periodLabel = (d: Date, period: 'month' | 'year'): string => (period === 'year' ? String(d.getFullYear()) : monthLabel(d))

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - date.getTime()) / 86_400_000)
  if (diff === 0) return t('Oggi')
  if (diff === 1) return t('Ieri')
  const s = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const timeLabel = (iso: string): string =>
  new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const dateTimeLabel = (iso: string): string =>
  new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

const MONTHS_SHORT = { it: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] }
const MONTHS_LONG = {
  it: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
/** Nome del mese (0 = gennaio) nella lingua in uso. */
export const monthShort = (i: number): string => MONTHS_SHORT[lang()][i]
export const monthLong = (i: number): string => MONTHS_LONG[lang()][i]
