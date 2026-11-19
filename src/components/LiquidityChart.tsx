import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { liquiditySeries } from '../lib/calc'
import { formatMoney, formatSigned } from '../lib/format'

const W = 340
const H = 150
const PAD = { l: 38, r: 14, t: 14, b: 22 }
const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
const MONTHS_LONG = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** 12.345 € -> "12K"; sotto i mille, intero. Solo per le etichette dell'asse. */
const compact = (cents: number) => {
  const v = cents / 100
  const a = Math.abs(v)
  return a >= 1000 ? `${(v / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',').replace(',0', '')}K` : String(Math.round(v))
}

/** Valori "tondi" per le tacche dell'asse verticale. */
function niceTicks(min: number, max: number, n = 3): number[] {
  const span = Math.max(max - min, 1)
  const raw = span / n
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const first = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = first; v <= max + step * 0.001; v += step) out.push(Math.round(v))
  return out
}

/** Andamento della liquidità nell'anno: fine di ogni mese, sui conti che contano nel totale. */
export function LiquidityChart() {
  const { db, me, view, setView } = useApp()
  const year = view.month.getFullYear()
  const series = useMemo(() => liquiditySeries(db, year, me?.id ?? null), [db, year, me])
  const [active, setActive] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const pts = series.points
  const filled = pts.filter((p) => p.value !== null) as Array<{ month: number; value: number }>
  const values = [series.start, ...filled.map((p) => p.value)]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.12, 100)
  const ticks = niceTicks(lo - pad, hi + pad)
  const yMin = Math.min(ticks[0], lo - pad)
  const yMax = Math.max(ticks[ticks.length - 1], hi + pad)
  const x = (m: number) => PAD.l + (m / 11) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)

  const line = filled.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = filled[filled.length - 1]
  const area = last && filled.length > 1 ? `${line} L${x(last.month).toFixed(1)},${y(yMin)} L${x(filled[0].month).toFixed(1)},${y(yMin)} Z` : ''
  const delta = last ? last.value - series.start : 0
  const shown = active !== null ? filled.find((p) => p.month === active) ?? null : null
  const prevValue = shown ? (shown.month === 0 ? series.start : pts[shown.month - 1].value ?? series.start) : 0

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !filled.length) return
    const vx = ((clientX - r.left) / r.width) * W
    const month = Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * 11)
    setActive(filled.reduce((best, p) => (Math.abs(p.month - month) < Math.abs(best - month) ? p.month : best), filled[0].month))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!filled.length || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const cur = filled.findIndex((p) => p.month === active)
    const next = e.key === 'ArrowRight' ? Math.min(cur < 0 ? 0 : cur + 1, filled.length - 1) : Math.max((cur < 0 ? filled.length : cur) - 1, 0)
    setActive(filled[next].month)
  }
  const goYear = (d: number) => setView({ month: new Date(year + d, view.month.getMonth(), 1) })
  const empty = filled.length === 0

  return (
    <section className="card p-4" aria-label={`Andamento della liquidità nel ${year}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Liquidità nel {year}</h2>
          <p className="text-2xl font-extrabold tabular-nums">{last ? formatMoney(last.value) : formatMoney(series.start)}</p>
          {!empty && <p className={`text-xs font-semibold ${delta < 0 ? 'text-exp' : 'text-inc'}`}>{formatSigned(delta)} <span className="font-normal text-muted">da inizio anno</span></p>}
        </div>
        <div className="flex items-center">
          <button className="rounded-full p-1.5 hover:bg-line/60" aria-label="Anno precedente" onClick={() => goYear(-1)}><ChevronLeft size={18} /></button>
          <button className="rounded-full p-1.5 hover:bg-line/60" aria-label="Anno successivo" onClick={() => goYear(1)}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div ref={box} className="relative touch-pan-y select-none" onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full outline-none" role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}
          aria-label={empty ? 'Nessun dato per questo anno' : `Liquidità da ${formatMoney(series.start)} a inizio anno a ${formatMoney(last.value)}`}>
          {/* griglia e asse Y: tratto sottile pieno, in secondo piano */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth="1" />
              <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="rgb(var(--muted))">{compact(t)}</text>
            </g>
          ))}
          {MONTHS.map((m, i) => <text key={m} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="rgb(var(--muted))">{m.charAt(0)}</text>)}

          {area && <path d={area} fill="rgb(var(--chart-line) / 0.1)" />}
          {filled.length > 1 && <path d={line} fill="none" stroke="rgb(var(--chart-line))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

          {/* mirino sul mese selezionato */}
          {shown && <line x1={x(shown.month)} x2={x(shown.month)} y1={PAD.t} y2={H - PAD.b} stroke="rgb(var(--muted))" strokeWidth="1" />}
          {/* punto finale: >= 8px con anello del colore dello sfondo; l'etichetta del valore va nel titolo, non sul punto */}
          {last && <circle cx={x(last.month)} cy={y(last.value)} r="4.5" fill="rgb(var(--chart-line))" stroke="rgb(var(--surface))" strokeWidth="2" />}
          {shown && shown.month !== last?.month && <circle cx={x(shown.month)} cy={y(shown.value)} r="4.5" fill="rgb(var(--chart-line))" stroke="rgb(var(--surface))" strokeWidth="2" />}
        </svg>

        {shown && (
          <div className="pointer-events-none absolute top-0 z-10 w-40 rounded-xl border border-line bg-surface p-2.5 text-xs shadow-lg"
            style={{ left: `${Math.min(Math.max((x(shown.month) / W) * 100, 24), 76)}%`, transform: 'translateX(-50%)' }} role="status">
            <p className="text-muted">{MONTHS_LONG[shown.month]} {year}{shown.month === last?.month && year === new Date().getFullYear() ? ' (oggi)' : ''}</p>
            <p className="mt-0.5 flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded-full" style={{ background: 'rgb(var(--chart-line))' }} /><b className="text-sm tabular-nums">{formatMoney(shown.value)}</b></p>
            <p className="mt-0.5 text-muted">{formatSigned(shown.value - prevValue)} nel mese</p>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">Mostra tabella</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="text-muted"><th className="py-1 font-medium">Mese</th><th className="py-1 text-right font-medium">Liquidità a fine mese</th></tr></thead>
          <tbody>
            <tr><td className="py-0.5">Inizio anno</td><td className="py-0.5 text-right tabular-nums">{formatMoney(series.start)}</td></tr>
            {pts.map((p) => <tr key={p.month}><td className="py-0.5">{MONTHS_LONG[p.month]}</td><td className="py-0.5 text-right tabular-nums">{p.value === null ? '—' : formatMoney(p.value)}</td></tr>)}
          </tbody>
        </table>
      </details>
      <p className="mt-2 text-[11px] text-muted">Conti che contano nel totale: visibili a te, non nascosti e non esclusi.</p>
    </section>
  )
}
