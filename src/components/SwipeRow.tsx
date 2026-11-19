import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'

export interface SwipeAction {
  label: string
  /** nome accessibile completo (se più lungo dell'etichetta mostrata) */
  ariaLabel?: string
  icon: ReactNode
  /** colori del pulsante, es. 'bg-brand' */
  className: string
  onClick: () => void
}

/**
 * Riga con azioni nascoste: scorrendola verso sinistra compaiono i pulsanti. Un tocco esegue `onTap`
 * (o richiude la riga se era aperta); un trascinamento non è mai un tocco.
 */
export function SwipeRow({ actions, onTap, buttonClass, testId = 'swipe-row', actionWidth = 68, className = '', children }: {
  actions: SwipeAction[]
  onTap: () => void
  buttonClass: string
  testId?: string
  actionWidth?: number
  className?: string
  children: ReactNode
}) {
  const total = actionWidth * actions.length
  const rootRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [drag, setDrag] = useState(false)
  const g = useRef({ id: -1, sx: 0, sy: 0, base: 0, mode: '' as '' | 'h' | 'v', swiped: false })
  const opened = offset < 0
  // i pulsanti esistono solo mentre servono (aperti, trascinando o durante la chiusura)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (opened || drag) { setShow(true); return }
    const t = setTimeout(() => setShow(false), 250)
    return () => clearTimeout(t)
  }, [opened, drag])

  // una sola riga aperta: toccando altrove si chiude
  useEffect(() => {
    if (!opened) return
    const away = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOffset(0) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [opened])

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    g.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, base: offset, mode: '', swiped: false }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (e.pointerId !== s.id || s.mode === 'v') return
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy
    if (!s.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v'
      if (s.mode === 'h') { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true) } else s.swiped = true   // un trascinamento non è un tocco
      return
    }
    s.swiped = true
    setOffset(Math.max(-total, Math.min(0, s.base + dx)))
  }
  const up = (e: React.PointerEvent) => {
    const s = g.current
    if (e.pointerId !== s.id) return
    if (s.mode === 'h') { setDrag(false); setOffset((o) => (o < -total / 2 ? -total : 0)) }
    s.id = -1
  }
  const click = (e: React.MouseEvent) => {
    if (g.current.swiped) { g.current.swiped = false; e.preventDefault(); return }
    if (opened) { setOffset(0); return }
    onTap()
  }

  return (
    <div ref={rootRef} className={`relative overflow-hidden ${className}`} data-testid={testId}>
      {show && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: total }}>
          {actions.map((a) => (
            <button key={a.label} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-onbrand ${a.className}`} style={{ width: actionWidth }}
              aria-label={t(a.ariaLabel ?? a.label)} onClick={() => { setOffset(0); a.onClick() }}>{a.icon}{t(a.label)}</button>
          ))}
        </div>
      )}
      <div className="relative touch-pan-y bg-surface" style={{ transform: `translateX(${offset}px)`, transition: drag ? 'none' : 'transform .2s ease-out' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button onClick={click} className={buttonClass}>{children}</button>
      </div>
    </div>
  )
}
