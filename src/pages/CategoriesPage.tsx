import { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Plus } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { childCategories, topCategories } from '../lib/calc'
import { setCategoryHidden } from '../lib/mutations'
import { CategoryForm } from '../components/CategoryForm'
import { CatBubble, Segmented, Toggle } from '../components/ui'
import type { Category, CategoryType } from '../types'
import { t } from '../i18n'

export function CategoriesPage({ onBack }: { onBack: () => void }) {
  const { db, commit } = useApp()
  const [type, setType] = useState<CategoryType>('expense')
  const [showHidden, setShowHidden] = useState(false)
  const [form, setForm] = useState<{ category?: Category; parentId?: string | null } | null>(null)
  const hiddenCount = db.categories.filter((c) => c.hidden && c.type === type).length

  const Row = ({ c, sub }: { c: Category; sub?: boolean }) => (
    <div className={`flex items-center gap-2 pr-2 ${sub ? 'pl-8' : ''} ${c.hidden ? 'opacity-55' : ''}`}>
      <button className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left" onClick={() => setForm({ category: c })}>
        <CatBubble icon={c.icon} color={c.color} size={sub ? 30 : 38} /><span className="truncate font-medium">{c.name}</span>
      </button>
      {!sub && <button className="rounded-full p-2 text-muted hover:bg-line/60" aria-label={t('Aggiungi sottocategoria')} onClick={() => setForm({ parentId: c.id })}><Plus size={18} /></button>}
      <button className="rounded-full p-2 text-muted hover:bg-line/60" aria-label={c.hidden ? t('Mostra') : t('Nascondi')} onClick={() => commit((d) => setCategoryHidden(d, c.id, !c.hidden))}>{c.hidden ? <Eye size={18} /> : <EyeOff size={18} />}</button>
    </div>
  )

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pb-3 pt-safe">
        <button className="icon-btn mt-3" onClick={onBack} aria-label={t('Indietro')}><ArrowLeft /></button>
        <h1 className="pt-3 text-xl font-extrabold tracking-tight">{t('Categorie')}</h1>
      </div>
      <div className="space-y-3 px-4">
        <Segmented<CategoryType> value={type} onChange={setType} options={[{ value: 'expense', label: t('Uscite'), color: 'text-exp' }, { value: 'income', label: t('Entrate'), color: 'text-inc' }]} />
        <div className="card divide-y divide-line/50 overflow-hidden">
          {topCategories(db, type, showHidden).map((c) => (
            <div key={c.id}><Row c={c} />{childCategories(db, c.id, showHidden).map((s) => <Row key={s.id} c={s} sub />)}</div>
          ))}
        </div>
        <button className="btn-soft w-full" onClick={() => setForm({ parentId: null })}><Plus size={18} />{t('Nuova categoria')}</button>
        {hiddenCount > 0 && <div className="card px-4 pt-3"><Toggle checked={showHidden} onChange={setShowHidden} label={t('Mostra nascoste ({n})', { n: hiddenCount })} hint={t('Nascondendo un padre si nascondono anche le sottocategorie')} /></div>}
      </div>
      {form && <CategoryForm key={form.category?.id ?? 'new'} category={form.category} type={type} parentId={form.parentId} onClose={() => setForm(null)} />}
    </div>
  )
}
