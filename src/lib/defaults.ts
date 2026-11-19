import type { Account, Category, Db } from '../types'
import { SCHEMA_VERSION } from '../types'
import { nowIso, uid } from './ids'

/** I dati di esempio non sono "modifiche dell'utente": con timestamp epoch perdono sempre contro qualsiasi modifica reale nei merge. */
export const SEED_TIME = '1970-01-01T00:00:00.000Z'

/**
 * Struttura di avvio NEUTRA: nessun dato personale.
 * I conti reali, i saldi e le transazioni vengono creati nell'app e salvati su Google Drive.
 */

export const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6',
  '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#64748b', '#78716c',
]

export const ICONS = [
  '🍽️', '🛒', '🍕', '☕', '🏠', '💡', '🔧', '🚗', '⛽', '🚌', '✈️', '🎉',
  '🎬', '🏃', '💊', '🛍️', '👕', '📱', '🎓', '👶', '🐶', '🎁', '💼', '💰',
  '🏦', '📈', '🧾', '🔑', '🧴', '🎮', '📚', '🍷', '🏖️', '🚲', '🔌', '📦',
]

type Seed = { id: string; name: string; icon: string; color: string; subs?: Array<[string, string]> }

const EXPENSE: Seed[] = [
  { id: 'food', name: 'Cibo', icon: '🍽️', color: '#f97316', subs: [['Spesa', '🛒'], ['Ristoranti', '🍕'], ['Caffè e bar', '☕']] },
  { id: 'home', name: 'Casa', icon: '🏠', color: '#6366f1', subs: [['Affitto / Mutuo', '🔑'], ['Bollette', '💡'], ['Manutenzione', '🔧']] },
  { id: 'transport', name: 'Trasporti', icon: '🚗', color: '#0ea5e9', subs: [['Carburante', '⛽'], ['Mezzi pubblici', '🚌'], ['Auto', '🚗']] },
  { id: 'fun', name: 'Svago', icon: '🎉', color: '#ec4899', subs: [['Cinema ed eventi', '🎬'], ['Sport', '🏃'], ['Viaggi', '✈️']] },
  { id: 'health', name: 'Salute', icon: '💊', color: '#10b981' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', color: '#a855f7' },
  { id: 'other-exp', name: 'Altro', icon: '📦', color: '#64748b' },
]

const INCOME: Seed[] = [
  { id: 'salary', name: 'Stipendio', icon: '💼', color: '#059669' },
  { id: 'gift', name: 'Regalo', icon: '🎁', color: '#14b8a6' },
  { id: 'other-inc', name: 'Altre entrate', icon: '💰', color: '#84cc16' },
]

export function defaultCategories(): Category[] {
  const t = SEED_TIME
  const out: Category[] = []
  let order = 0
  const push = (type: Category['type'], seeds: Seed[]) => {
    for (const s of seeds) {
      const id = `cat-${s.id}`
      out.push({ id, name: s.name, type, parentId: null, icon: s.icon, color: s.color, hidden: false, order: order++, updatedAt: t })
      s.subs?.forEach(([name, icon], i) =>
        out.push({ id: `${id}-${i}`, name, type, parentId: id, icon, color: s.color, hidden: false, order: order++, updatedAt: t }),
      )
    }
  }
  push('expense', EXPENSE)
  push('income', INCOME)
  return out
}

export function defaultAccounts(): Account[] {
  const t = SEED_TIME
  return [
    { id: 'acc-cash', name: 'Contanti', group: 'cash', owner: 'a', initialBalance: 0, excludeFromTotal: false, hidden: false, order: 0, createdAt: t, updatedAt: t },
    { id: 'acc-shared', name: 'Conto Comune', group: 'bank', owner: 'shared', initialBalance: 0, excludeFromTotal: false, hidden: false, order: 1, createdAt: t, updatedAt: t },
  ]
}

export function createDefaultDb(): Db {
  const t = nowIso()
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { dbId: uid(), createdAt: t, updatedAt: t, updatedBy: '', revision: 0 },
    profiles: { a: 'Emilio', b: 'Sara', shared: 'In Comune', updatedAt: SEED_TIME },
    accounts: defaultAccounts(),
    categories: defaultCategories(),
    transactions: [],
    deleted: {},
  }
}

/** Dati ancora quelli di esempio, mai modificati dall'utente (nessuna transazione, nessuna modifica). */
export function isPristine(db: Db): boolean {
  return (
    db.transactions.length === 0 &&
    Object.keys(db.deleted).length === 0 &&
    db.profiles.updatedAt === SEED_TIME &&
    [...db.accounts, ...db.categories].every((x) => x.updatedAt === SEED_TIME)
  )
}
