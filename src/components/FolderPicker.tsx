import { useEffect, useState } from 'react'
import { ChevronRight, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { engine } from '../sync/engine'
import type { DriveFolder } from '../sync/drive'
import { Sheet } from './ui'

export interface PickedFolder { id: string; name: string }

/** Esplora le cartelle del Drive dell'utente e permette di sceglierne una (o di crearne una nuova). */
export function FolderPicker({ title = 'Scegli la cartella', onPick, onClose }: { title?: string; onPick: (f: PickedFolder) => void; onClose: () => void }) {
  const [trail, setTrail] = useState<PickedFolder[]>([{ id: 'root', name: 'Il mio Drive' }])
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const here = trail[trail.length - 1]

  useEffect(() => {
    let live = true
    setFolders(null); setErr('')
    engine.listFolders(here.id).then((f) => live && setFolders(f)).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [here.id])

  const create = async () => {
    if (!newName.trim()) return
    setErr('')
    try {
      const f = await engine.createFolder(newName.trim(), here.id)
      setTrail([...trail, f]); setCreating(false); setNewName('')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <Sheet open onClose={onClose} title={title} footer={<button className="btn-primary w-full" onClick={() => onPick(here)}>Usa «{here.name}»</button>}>
      <nav className="no-scrollbar mb-3 flex items-center gap-1 overflow-x-auto text-sm" aria-label="Percorso">
        {trail.map((f, i) => (
          <span key={f.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-muted" />}
            <button className={`rounded-lg px-2 py-1 ${i === trail.length - 1 ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-line/50'}`} onClick={() => setTrail(trail.slice(0, i + 1))}>{f.name}</button>
          </span>
        ))}
      </nav>
      {err && <p className="mb-3 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
      {folders === null && !err && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-brand" /></div>}
      {folders && folders.length === 0 && <p className="py-4 text-center text-sm text-muted">Nessuna sottocartella.</p>}
      <ul className="divide-y divide-line/50">
        {folders?.map((f) => (
          <li key={f.id}>
            <button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setTrail([...trail, f])}>
              <Folder size={20} className="text-brand" /><span className="flex-1 truncate font-medium">{f.name}</span><ChevronRight size={16} className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {creating ? (
        <div className="mt-3 flex gap-2">
          <input autoFocus className="input" placeholder="Nome della nuova cartella" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
          <button className="btn-primary" onClick={() => void create()}>Crea</button>
        </div>
      ) : (
        <button className="btn-soft mt-3 w-full" onClick={() => setCreating(true)}><FolderPlus size={18} />Nuova cartella qui</button>
      )}
    </Sheet>
  )
}
