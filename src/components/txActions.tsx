import { Copy, Star } from 'lucide-react'
import type { Transaction } from '../types'
import { useApp } from '../store/AppProvider'
import { isSplit } from '../lib/calc'
import { addFavorite, copyOf, deleteFavorite, findFavorite } from '../lib/mutations'
import { t } from '../i18n'

/** Copia e preferiti: usati dal form di modifica e dallo swipe sulla riga. */
export function useTxActions() {
  const { db, commit, me, openTx, openSplit } = useApp()
  const meId = me?.id ?? null
  /** apre il form di una nuova transazione con gli stessi dati e la data di adesso */
  const copy = (tx: Transaction) => (isSplit(tx) ? openSplit : openTx)({ initial: copyOf(tx) })
  const favoriteOf = (tx: Transaction) => findFavorite(db, tx, meId)
  const toggleFavorite = (tx: Transaction) => {
    const f = findFavorite(db, tx, meId)
    commit((d) => (f ? deleteFavorite(d, f.id) : addFavorite(d, tx, meId)))
  }
  return { copy, favoriteOf, toggleFavorite }
}

/** Pulsanti «Copia» e «Preferito» per il piè del form di modifica. */
export function TxFooterActions({ tx }: { tx: Transaction }) {
  const { copy, favoriteOf, toggleFavorite } = useTxActions()
  const fav = !!favoriteOf(tx)
  return (
    <>
      <button type="button" className="btn-soft !px-3" onClick={() => copy(tx)} aria-label={t('Copia transazione')} title={t('Copia con la data di oggi')}><Copy size={18} /></button>
      <button type="button" className={`btn-soft !px-3 ${fav ? '!text-warn' : ''}`} onClick={() => toggleFavorite(tx)} aria-pressed={fav}
        aria-label={fav ? t('Rimuovi dai preferiti') : t('Aggiungi ai preferiti')} title={fav ? t('Rimuovi dai preferiti') : t('Aggiungi ai preferiti')}><Star size={18} fill={fav ? 'currentColor' : 'none'} /></button>
    </>
  )
}
