import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { Account } from '../types'
import { useApp } from '../store/AppProvider'
import { allTags, childCategories, normalizeTag, titleSuggestions, topCategories } from '../lib/calc'
import { CatBubble, Sheet } from './ui'
import { lang, t } from '../i18n'

/** Riga del form in stile elenco: etichetta a sinistra, valore a destra, linea sottile sotto. */
export function Row({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <span className="w-[5.5rem] shrink-0 pt-2 text-[15px] text-muted">{label}</span>
      <div className="min-w-0 flex-1 py-1">{children}</div>
    </>
  )
  const cls = 'flex w-full items-start gap-3 border-b border-line/70 px-1 py-1.5 text-left'
  return onClick ? <button type="button" className={cls} onClick={onClick}>{inner}</button> : <div className={cls}>{inner}</div>
}
export const plain = 'w-full bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted/70'

export const pctToInput = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace('.', lang() === 'en' ? '.' : ','))
/** "33,33" -> 3333 (centesimi di punto); null se non valido */
export const parsePercent = (s: string): number | null => {
  const t = s.trim().replace('%', '').replace(',', '.')
  if (!t) return 0
  if (!/^\d*\.?\d+$/.test(t)) return null
  const bp = Math.round(parseFloat(t) * 100)
  return bp >= 0 && bp <= 10000 ? bp : null
}

export function CategoryPicker({ type, value, onChange }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void }) {
  const { db } = useApp()
  const cur = db.categories.find((c) => c.id === value)
  const parentId = cur ? cur.parentId ?? cur.id : null
  const tops = topCategories(db, type)
  // se la categoria corrente è nascosta la mostriamo comunque, così la modifica non la perde
  const list = cur && !tops.some((t) => t.id === parentId) ? [...tops, db.categories.find((c) => c.id === parentId)!].filter(Boolean) : tops
  const subs = parentId ? childCategories(db, parentId).concat(cur && cur.parentId && cur.hidden ? [cur] : []) : []
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(parentId === c.id && !cur?.parentId ? null : c.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] font-medium transition ${parentId === c.id ? 'border-brand bg-brand/10' : 'border-line'}`}>
            <CatBubble icon={c.icon} color={c.color} size={34} />
            <span className="w-full truncate text-center">{c.name}</span>
          </button>
        ))}
      </div>
      {subs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {subs.map((s) => (
            <button key={s.id} type="button" onClick={() => onChange(value === s.id ? parentId : s.id)} className={`chip ${value === s.id ? 'chip-on' : ''}`}>
              <span>{s.icon}</span>{s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Finestra di scelta della categoria: si chiude da sola quando si sceglie una categoria "foglia". */
function CategorySheet({ type, value, onChange, onClose }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void; onClose: () => void }) {
  const { db } = useApp()
  return (
    <Sheet open onClose={onClose} title={t('Categoria')} footer={<button className="btn-primary w-full" onClick={onClose}>{t('Fatto')}</button>}>
      <CategoryPicker type={type} value={value} onChange={(id) => {
        onChange(id)
        if (!id || childCategories(db, id).length === 0) onClose()
      }} />
    </Sheet>
  )
}

/** Riga "Categoria": mostra la scelta corrente e apre la finestra di selezione. */
export function CategoryRow({ type, value, onChange }: { type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void }) {
  const { db } = useApp()
  const [open, setOpen] = useState(false)
  const cat = db.categories.find((c) => c.id === value)
  const parent = cat?.parentId ? db.categories.find((c) => c.id === cat.parentId) : undefined
  return (
    <>
      <Row label={t('Categoria')} onClick={() => setOpen(true)}>
        <span className="flex items-center gap-2 py-1.5 text-[15px]">
          {cat ? <><CatBubble icon={cat.icon} color={cat.color} size={24} /><span className="min-w-0 flex-1 truncate">{parent ? `${parent.name} › ${cat.name}` : cat.name}</span></> : <span className="flex-1 text-muted/70">{t('Seleziona')}</span>}
          <ChevronRight size={16} className="shrink-0 text-muted" />
        </span>
      </Row>
      {open && <CategorySheet type={type} value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Riga "Tag": etichette libere; si aggiungono con Invio o virgola e si suggeriscono quelle già usate. */
export function TagsRow({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { db } = useApp()
  const [text, setText] = useState('')
  const has = (g: string) => value.some((x) => x.toLowerCase() === g.toLowerCase())
  const add = (raw: string) => {
    const g = normalizeTag(raw)
    if (g && !has(g)) onChange([...value, g])
    setText('')
  }
  const suggestions = allTags(db).filter((g) => !has(g) && (!text || g.toLowerCase().includes(text.toLowerCase().replace(/^#/, '')))).slice(0, 8)
  return (
    <Row label={t('Tag')}>
      <div className="flex flex-wrap items-center gap-1.5 py-1">
        {value.map((g) => (
          <span key={g} className="inline-flex items-center gap-1 rounded-full bg-brand/15 py-1 pl-2.5 pr-1.5 text-sm font-medium text-brand">
            #{g}
            <button type="button" aria-label={t('Rimuovi il tag {g}', { g })} className="rounded-full p-0.5 hover:bg-brand/20" onClick={() => onChange(value.filter((x) => x !== g))}><X size={13} /></button>
          </span>
        ))}
        <span className="flex min-w-[7rem] flex-1 items-center gap-1">
          <Plus size={14} className="shrink-0 text-muted" />
          <input className={plain} placeholder={t('Aggiungi un tag')} aria-label={t('Aggiungi un tag')} value={text} enterKeyHint="done"
            onChange={(e) => { const v = e.target.value; if (v.includes(',')) { v.split(',').forEach((p, i, a) => i < a.length - 1 && add(p)); setText(v.split(',').pop() ?? '') } else setText(v) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)) }}
            onBlur={() => text.trim() && add(text)} />
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {suggestions.map((g) => <button key={g} type="button" className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:bg-line/40" onMouseDown={(e) => e.preventDefault()} onClick={() => add(g)}>#{g}</button>)}
        </div>
      )}
    </Row>
  )
}

export const accountLabel = (a: Account, nameOf: (id: string | null) => string) =>
  `${a.name}${a.members.length === 1 ? ` · ${nameOf(a.members[0])}` : a.members.length === 0 ? ' · ' + t('Famiglia') : ' · ' + t('condiviso')}${a.hidden ? ' ' + t('(nascosto)') : ''}`

/** Menu a tendina nativo (comodo su mobile) con la freccia, in stile "valore a destra". */
export function SelectField({ value, onChange, options, ariaLabel, className = plain }: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; ariaLabel?: string; className?: string
}) {
  return (
    <div className="relative">
      <select aria-label={ariaLabel} className={`${className} appearance-none pr-6`} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
}

/** Titolo con proposte: mentre scrivi compaiono i titoli già usati che corrispondono. */
export function TitleRow({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { db } = useApp()
  const [focus, setFocus] = useState(false)
  // su iPhone toccare una proposta toglie prima il fuoco al campo: se la lista sparisse subito, il tocco andrebbe perso. Si chiude con un attimo di ritardo.
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const list = useMemo(() => (focus ? titleSuggestions(db, value) : []), [db, value, focus])
  return (
    <Row label={t('Titolo')}>
      <input className={plain} placeholder={placeholder} value={value} autoComplete="off" autoCapitalize="sentences" role="combobox" aria-expanded={list.length > 0} aria-autocomplete="list" aria-label={t('Titolo')}
        onChange={(e) => { onChange(e.target.value); setFocus(true) }} onFocus={() => { clearTimeout(closeTimer.current); setFocus(true) }} onBlur={() => { closeTimer.current = setTimeout(() => setFocus(false), 250) }} />
      {list.length > 0 && (
        <ul role="listbox" aria-label={t('Titoli già usati')} className="mt-1 overflow-hidden rounded-xl border border-line bg-bg">
          {list.map((t) => (
            <li key={t} role="option" aria-selected={false}>
              <button type="button" className="block w-full truncate px-3 py-2 text-left text-[15px] hover:bg-line/50 active:bg-line/70"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { clearTimeout(closeTimer.current); onChange(t); setFocus(false) }}>{t}</button>
            </li>
          ))}
        </ul>
      )}
    </Row>
  )
}
