import { useRef, useState } from 'react'
import { ChevronRight, Download, RotateCcw, ShieldCheck, Tags, Upload } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { SyncCard } from '../components/SyncCard'
import { FamilyCard } from '../components/FamilyCard'
import { ask } from '../components/dialogs'
import { CategoriesPage } from './CategoriesPage'
import { mergeDb, parseDb, replaceData } from '../lib/merge'

export function SettingsPage({ syncRef }: { syncRef: React.RefObject<HTMLDivElement> }) {
  const { db, commit, resetLocal } = useApp()
  const [sub, setSub] = useState<'cats' | null>(null)
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)

  if (sub === 'cats') return <CategoriesPage onBack={() => setSub(null)} />

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `moneyduo-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setMsg('Backup esportato. Conservalo fuori dal repository Git.')
  }

  const importJson = async (f: File) => {
    try {
      const incoming = parseDb(JSON.parse(await f.text()))
      const r = await ask({
        title: 'Importa backup', ok: 'Unisci ai dati attuali', alt: 'Sostituisci tutto',
        message: `Il file contiene ${incoming.accounts.length} conti e ${incoming.transactions.length} transazioni.\n«Unisci» mantiene i dati attuali; «Sostituisci» li rimpiazza.`,
      })
      if (!r) return
      commit((d) => (r === 'ok' ? mergeDb(d, { ...incoming, meta: { ...incoming.meta, dbId: d.meta.dbId } }) : replaceData(d, incoming)))
      setMsg('Backup importato.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'File non valido.')
    }
  }

  const reset = async () => {
    if (await ask({ title: 'Ripristinare i dati iniziali?', message: 'Cancella i dati salvati in questo browser e scollega Drive. Il file su Drive NON viene toccato.', ok: 'Ripristina', danger: true })) resetLocal()
  }

  return (
    <div>
      <div className="px-4 pb-3 pt-safe"><h1 className="pt-3 text-xl font-extrabold tracking-tight">Impostazioni</h1></div>
      <div className="space-y-4 px-4">
        <FamilyCard />

        <div ref={syncRef}><SyncCard /></div>

        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => setSub('cats')}>
          <Tags className="text-brand" /><span className="flex-1"><span className="block font-semibold">Categorie e sottocategorie</span><span className="text-xs text-muted">Aggiungi, modifica, nascondi o mostra</span></span><ChevronRight className="text-muted" />
        </button>

        <section className="card p-4">
          <h2 className="mb-3 font-bold">Backup</h2>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft" onClick={exportJson}><Download size={18} />Esporta JSON</button>
            <button className="btn-soft" onClick={() => file.current?.click()}><Upload size={18} />Importa JSON</button>
          </div>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = '' }} />
          {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
          <button className="btn-danger mt-3 w-full" onClick={reset}><RotateCcw size={18} />Ripristina dati iniziali</button>
        </section>

        <p className="flex gap-2 px-1 pb-4 text-xs text-muted"><ShieldCheck size={16} className="shrink-0" />I tuoi dati vivono solo in questo browser e nel file su Google Drive scelto da te: nessun server di terze parti e nessun dato nel repository del codice.</p>
      </div>
    </div>
  )
}
