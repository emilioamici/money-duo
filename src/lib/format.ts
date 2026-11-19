const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

/** centesimi -> "1.234,56 €" */
export const formatMoney = (cents: number): string => eur.format(cents / 100)

/** Come formatMoney ma con segno esplicito (+/−) */
export function formatSigned(cents: number): string {
  if (cents === 0) return formatMoney(0)
  return (cents > 0 ? '+' : '−') + formatMoney(Math.abs(cents))
}

/** "12,50" | "1.234,56" | "12.5" | "-3" -> centesimi; null se non valido */
export function parseAmount(input: string): number | null {
  let t = input.trim().replace(/\s/g, '').replace(/€/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Math.round(parseFloat(t) * 100)
  return Number.isFinite(n) ? n : null
}

export function centsToInput(cents: number): string {
  const s = (cents / 100).toFixed(2).replace('.', ',')
  return s.endsWith(',00') ? s.slice(0, -3) : s
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO -> valore per <input type="datetime-local"> (ora locale) */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (v: string): string => new Date(v).toISOString()

export function monthLabel(d: Date): string {
  const s = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(d)
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
  if (diff === 0) return 'Oggi'
  if (diff === 1) return 'Ieri'
  const s = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const timeLabel = (iso: string): string =>
  new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const dateTimeLabel = (iso: string): string =>
  new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
