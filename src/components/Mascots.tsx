import type { ReactNode } from 'react'

/** I due gattini dell'icona: sempre sorridenti, accompagnano la navigazione. Zenitsu è il gatto scuro, Mochi quello bianco e arancione. */
export type Mascot = 'zenitsu' | 'mochi' | 'pair'
const SRC: Record<Mascot, string> = { zenitsu: './cats/zenitsu.png', mochi: './cats/mochi.png', pair: './cats/pair.png' }

export function MascotImg({ kind, className = '' }: { kind: Mascot; className?: string }) {
  // immagine decorativa: nessun testo alternativo e non trascinabile
  return <img src={SRC[kind]} alt="" draggable={false} decoding="async" data-mascot={kind} className={`pointer-events-none select-none ${className}`} />
}

/** Il gattino fa capolino da dietro il bordo superiore di una scheda. `pair` = tutti e due, uno per lato. */
export function MascotPeek({ kind, side = 'right', children }: { kind: Mascot; side?: 'left' | 'right'; children: ReactNode }) {
  return (
    <div className="relative pt-11">
      {kind === 'pair' ? (
        <>
          <MascotImg kind="zenitsu" className="absolute left-6 top-0 h-16 w-auto" />
          <MascotImg kind="mochi" className="absolute right-6 top-0 h-16 w-auto" />
        </>
      ) : <MascotImg kind={kind} className={`absolute top-0 h-16 w-auto ${side === 'left' ? 'left-6' : 'right-6'}`} />}
      <div className="relative">{children}</div>
    </div>
  )
}
