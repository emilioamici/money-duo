import { useMemo } from 'react'
import { ArrowLeftRight, Trash2 } from 'lucide-react'
import type { Favorite } from '../types'
import { useApp } from '../store/AppProvider'
import { accountById, categoryById, isSplit, visibleTo } from '../lib/calc'
import { formatMoney } from '../lib/format'
import { copyOf, deleteFavorite } from '../lib/mutations'
import { CatBubble, Sheet } from './ui'
import { MascotImg } from './Mascots'
import { ask } from './dialogs'

/** Elenco dei preferiti: toccandone uno si apre il form di una nuova transazione con quei dati e la data di adesso. */
export function FavoritesSheet({ onClose }: { onClose: () => void }) {
  const { db, me, commit, openTx, openSplit } = useApp()
  const accs = useMemo(() => accountById(db), [db])
  const cats = useMemo(() => categoryById(db), [db])
  const mine = useMemo(
    () => db.favorites.filter((f) => !me || f.by === me.id || f.by === null).sort((a, b) => a.title.localeCompare(b.title, 'it') || a.createdAt.localeCompare(b.createdAt)),
    [db.favorites, me],
  )

  const use = (f: Favorite) => { onClose(); (isSplit(f) ? openSplit : openTx)({ initial: copyOf(f) }) }
  const remove = async (f: Favorite) => {
    if (await ask({ title: 'Rimuovere dai preferiti?', message: 'Le transazioni già inserite non cambiano.', ok: 'Rimuovi', danger: true })) commit((d) => deleteFavorite(d, f.id))
  }

  return (
    <Sheet open onClose={onClose} title="Preferiti">
      {mine.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <MascotImg kind="zenitsu" className="h-20 w-auto" />
          <p className="font-semibold text-ink">Nessun preferito</p>
          <p className="max-w-xs text-sm">Apri una transazione e tocca la stella, oppure scorri una riga verso sinistra: la ritroverai qui, pronta da copiare con la data di oggi.</p>
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-line/60">
          {mine.map((f) => {
            const cat = f.categoryId ? cats.get(f.categoryId) : undefined
            const acc = accs.get(f.accountId)
            const hidden = acc && !visibleTo(db, acc, me?.id ?? null)
            const title = f.title || (f.type === 'transfer' ? 'Trasferimento' : cat?.name ?? (f.type === 'income' ? 'Entrata' : 'Uscita'))
            return (
              <li key={f.id} className="flex items-center gap-1">
                <button type="button" onClick={() => use(f)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-line/30 active:bg-line/50" aria-label={`Usa il preferito ${title}`}>
                  {f.type === 'transfer'
                    ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-trf/15 text-trf"><ArrowLeftRight size={18} /></span>
                    : <CatBubble icon={cat?.icon ?? '❔'} color={cat?.color ?? '#94a3b8'} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{title}</span>
                    <span className="block truncate text-xs text-muted">{[cat?.name, hidden ? 'Conto privato' : acc?.name, isSplit(f) ? 'Split' : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`shrink-0 font-bold tabular-nums ${f.type === 'income' ? 'text-inc' : f.type === 'expense' ? 'text-exp' : 'text-trf'}`}>{formatMoney(f.amount)}</span>
                </button>
                <button type="button" onClick={() => void remove(f)} className="rounded-full p-2 text-muted hover:bg-line/60" aria-label={`Rimuovi ${title} dai preferiti`}><Trash2 size={17} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
