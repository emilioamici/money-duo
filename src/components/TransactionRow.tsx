import type { Transaction } from '../types'
import { useApp } from '../store/AppProvider'
import { accountById, categoryById, involvedAccountIds, isSplit, txPayerIds, visibleTo } from '../lib/calc'
import { formatMoney, timeLabel } from '../lib/format'
import { CatBubble } from './ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Copy, Pencil, Trash2 } from 'lucide-react'
import { deleteTransaction } from '../lib/mutations'
import { ask } from './dialogs'
import { useTxActions } from './txActions'

const ACTION_W = 68
const ACTIONS_W = ACTION_W * 3

/** Riga della lista: scorrendola verso sinistra compaiono «Modifica», «Copia» ed «Elimina». */
export function TransactionRow({ tx }: { tx: Transaction }) {
  const { db, nameOf, openTx, me, commit } = useApp()
  const { copy } = useTxActions()
  const rootRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [drag, setDrag] = useState(false)
  const g = useRef({ id: -1, sx: 0, sy: 0, base: 0, mode: '' as '' | 'h' | 'v', swiped: false })
  const opened = offset < 0
  // i pulsanti esistono solo mentre servono (aperti, trascinando o durante la chiusura)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (opened || drag) { setShow(true); return }
    const t = setTimeout(() => setShow(false), 250)
    return () => clearTimeout(t)
  }, [opened, drag])

  // una sola riga aperta: toccando altrove si chiude
  useEffect(() => {
    if (!opened) return
    const away = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOffset(0) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [opened])

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    g.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, base: offset, mode: '', swiped: false }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (e.pointerId !== s.id || s.mode === 'v') return
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy
    if (!s.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v'
      if (s.mode === 'h') { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true) } else s.swiped = true   // un trascinamento non è un tocco
      return
    }
    s.swiped = true
    setOffset(Math.max(-ACTIONS_W, Math.min(0, s.base + dx)))
  }
  const up = (e: React.PointerEvent) => {
    const s = g.current
    if (e.pointerId !== s.id) return
    if (s.mode === 'h') { setDrag(false); setOffset((o) => (o < -ACTIONS_W / 2 ? -ACTIONS_W : 0)) }
    s.id = -1
  }
  const click = (e: React.MouseEvent) => {
    if (g.current.swiped) { g.current.swiped = false; e.preventDefault(); return }
    if (opened) { setOffset(0); return }
    openTx({ tx })
  }
  const remove = async () => {
    if (await ask({ title: 'Eliminare la transazione?', message: 'I saldi verranno ricalcolati.', ok: 'Elimina', danger: true })) commit((d) => deleteTransaction(d, tx.id))
    else setOffset(0)
  }

  const accs = useMemo(() => accountById(db), [db])
  const cats = useMemo(() => categoryById(db), [db])
  const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined
  const parent = cat?.parentId ? cats.get(cat.parentId) : undefined
  const from = accs.get(tx.accountId)
  const payerIds = txPayerIds(tx)
  const extraAccounts = tx.type === 'expense' ? involvedAccountIds(tx).length - 1 : 0
  const to = tx.toAccountId ? accs.get(tx.toAccountId) : undefined

  const title = tx.title || (tx.type === 'transfer' ? 'Trasferimento' : cat?.name ?? (tx.type === 'income' ? 'Entrata' : 'Uscita'))
  const accName = (a?: typeof from) => (!a ? '?' : visibleTo(db, a, me?.id ?? null) ? a.name : 'Conto privato')
  const sub = tx.type === 'transfer'
    ? `${accName(from)} → ${accName(to)}`
    : [parent ? `${parent.name} › ${cat?.name}` : cat?.name, accName(from) + (extraAccounts > 0 ? ` +${extraAccounts}` : '')].filter(Boolean).join(' · ')
  const badge = isSplit(tx)
    ? `Split · ${tx.participants.length}${payerIds.length ? ` · ${payerIds.map(nameOf).join(' + ')}` : ''}`
    : tx.type !== 'transfer' && tx.paidBy && !(from?.members.length === 1 && from.members[0] === tx.paidBy) ? `Pagato da ${nameOf(tx.paidBy)}` : ''
  const color = tx.type === 'income' ? 'text-inc' : tx.type === 'expense' ? 'text-exp' : 'text-trf'

  return (
    <div ref={rootRef} className="relative overflow-hidden" data-testid="tx-row">
      {show && <div className="absolute inset-y-0 right-0 flex" style={{ width: ACTIONS_W }}>
        <button className="flex flex-col items-center justify-center gap-1 bg-brand text-[11px] font-semibold text-onbrand" style={{ width: ACTION_W }} onClick={() => { setOffset(0); openTx({ tx }) }} aria-label="Modifica"><Pencil size={18} />Modifica</button>
        <button className="flex flex-col items-center justify-center gap-1 bg-trf text-[11px] font-semibold text-onbrand" style={{ width: ACTION_W }} onClick={() => { setOffset(0); copy(tx) }} aria-label="Copia"><Copy size={18} />Copia</button>
        <button className="flex flex-col items-center justify-center gap-1 bg-exp text-[11px] font-semibold text-onbrand" style={{ width: ACTION_W }} onClick={() => void remove()} aria-label="Elimina"><Trash2 size={18} />Elimina</button>
      </div>}
      <div className="relative touch-pan-y bg-surface" style={{ transform: `translateX(${offset}px)`, transition: drag ? 'none' : 'transform .2s ease-out' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    <button onClick={click} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-line/30 active:bg-line/50">
      {tx.type === 'transfer'
        ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-trf/15 text-trf"><ArrowLeftRight size={18} /></span>
        : <CatBubble icon={cat?.icon ?? '❔'} color={cat?.color ?? '#94a3b8'} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{timeLabel(tx.date)} · {sub}</span>
        <span className="mt-0.5 flex flex-wrap gap-1">
          {badge && <span className="inline-block rounded-lg bg-brand/10 px-2 py-0.5 text-[10px] font-semibold leading-tight text-brand">{badge}</span>}
          {(tx.tags ?? []).map((g) => <span key={g} className="inline-block rounded-full bg-line/70 px-2 py-0.5 text-[10px] font-medium text-muted">#{g}</span>)}
        </span>
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${color}`}>{tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}{formatMoney(tx.amount)}</span>
    </button>
      </div>
    </div>
  )
}
