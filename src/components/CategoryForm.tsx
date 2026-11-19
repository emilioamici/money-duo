import { useState } from 'react'
import type { Category, CategoryType } from '../types'
import { useApp } from '../store/AppProvider'
import { ICONS, PALETTE } from '../lib/defaults'
import { uid, nowIso } from '../lib/ids'
import { categoryInUse, deleteCategory, nextOrder, saveCategory, setCategoryHidden } from '../lib/mutations'
import { topCategories } from '../lib/calc'
import { Field, Sheet, Toggle } from './ui'
import { ask } from './dialogs'

export function CategoryForm({ category, type, parentId, onClose }: { category?: Category; type: CategoryType; parentId?: string | null; onClose: () => void }) {
  const { db, commit } = useApp()
  const catType = category?.type ?? type
  const hasChildren = category ? db.categories.some((c) => c.parentId === category.id) : false
  const parent0 = category ? category.parentId : parentId ?? null
  const parentCat = db.categories.find((c) => c.id === parent0)
  const [name, setName] = useState(category?.name ?? '')
  const [parent, setParent] = useState<string | null>(parent0)
  const [icon, setIcon] = useState(category?.icon ?? parentCat?.icon ?? '📦')
  const [color, setColor] = useState(category?.color ?? parentCat?.color ?? PALETTE[7])
  const [hidden, setHidden] = useState(category?.hidden ?? false)
  const [error, setError] = useState('')
  const used = category ? categoryInUse(db, category.id) : false

  const save = () => {
    if (!name.trim()) return setError('Inserisci un nome.')
    const t = nowIso()
    const id = category?.id ?? uid()
    commit((d) => {
      let n = saveCategory(d, { id, name: name.trim(), type: catType, parentId: parent, icon, color, hidden, order: category?.order ?? nextOrder(d.categories), updatedAt: t })
      // l'eventuale cascata di visibilità passa da setCategoryHidden per coerenza padre/figli
      if (category && category.hidden !== hidden) n = setCategoryHidden(n, id, hidden)
      return n
    })
    onClose()
  }

  const remove = async () => {
    if (category && (await ask({ title: 'Eliminare la categoria?', message: 'Non ha transazioni né sottocategorie.', ok: 'Elimina', danger: true }))) {
      commit((d) => deleteCategory(d, category.id))
      onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title={category ? 'Modifica categoria' : parent0 ? 'Nuova sottocategoria' : 'Nuova categoria'} footer={
      <div className="flex gap-2">
        {category && !used && <button className="btn-danger" onClick={remove}>Elimina</button>}
        <button className="btn-primary flex-1" onClick={save}>Salva</button>
      </div>
    }>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full text-2xl" style={{ background: color + '33' }}>{icon}</span>
        <input className="input" autoFocus={!category} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Field label="Categoria padre" hint={hasChildren ? 'Ha sottocategorie: non può diventare a sua volta una sottocategoria.' : undefined}>
        <select className="input" value={parent ?? ''} disabled={hasChildren} onChange={(e) => setParent(e.target.value || null)}>
          <option value="">Nessuna (categoria principale)</option>
          {topCategories(db, catType, true).filter((c) => c.id !== category?.id).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </Field>
      <Field label="Icona">
        <div className="grid grid-cols-9 gap-1">
          {ICONS.map((i) => <button key={i} type="button" onClick={() => setIcon(i)} className={`rounded-lg p-1.5 text-xl ${icon === i ? 'bg-brand/20 ring-2 ring-brand' : 'hover:bg-line/50'}`}>{i}</button>)}
        </div>
      </Field>
      <Field label="Colore">
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />)}
        </div>
      </Field>
      <div className="mt-4"><Toggle checked={hidden} onChange={setHidden} label="Nascondi" hint="Le sottocategorie seguono il padre; riattivabile in qualsiasi momento" /></div>
      {error && <p className="text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
