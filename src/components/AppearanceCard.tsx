import { useState } from 'react'
import { Check } from 'lucide-react'
import { THEME_NAME, getTheme, setTheme, type Theme } from '../lib/theme'
import { MascotImg } from './Mascots'

const OPTIONS: Array<{ id: Theme; hint: string }> = [
  { id: 'light', hint: 'Chiara, crema e arancio come il gatto bianco e arancione' },
  { id: 'dark', hint: 'Scura, ardesia come il gatto grigio scuro' },
  { id: 'auto', hint: 'Segue la modalità del telefono' },
]

/** Scelta del tema: Mochi (chiaro), Zenitsu (scuro) o automatico. */
export function AppearanceCard() {
  const [theme, set] = useState<Theme>(getTheme)
  const pick = (t: Theme) => { setTheme(t); set(t) }
  return (
    <div role="radiogroup" aria-label="Tema dell'app" className="space-y-2">
      {OPTIONS.map((o) => {
        const on = theme === o.id
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => pick(o.id)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-brand bg-brand/10' : 'border-line hover:bg-line/30'}`}>
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: o.id === 'dark' ? '#16181d' : o.id === 'light' ? '#fff7ee' : 'linear-gradient(135deg,#fff7ee 50%,#16181d 50%)' }}>
              {o.id === 'auto' ? <MascotImg kind="pair" className="h-10 w-auto" /> : <MascotImg kind={o.id === 'dark' ? 'zenitsu' : 'mochi'} className="h-12 w-auto" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{THEME_NAME[o.id]}</span>
              <span className="block text-xs text-muted">{o.hint}</span>
            </span>
            {on && <Check size={20} className="shrink-0 text-brand" />}
          </button>
        )
      })}
    </div>
  )
}
