import type { Member, SplitMode } from '../types'
import { expenseShares } from '../lib/calc'
import { centsToInput, formatMoney, parseAmount } from '../lib/format'
import { MemberAvatar, MemberChips, Segmented } from './ui'
import { parsePercent, pctToInput } from './formParts'

export interface SplitState {
  mode: SplitMode
  participants: string[]
  vals: Record<string, string>
}

/** Valori digitati -> divisione valida, oppure un messaggio d'errore leggibile. */
export function resolveSplit(s: SplitState, cents: number | null, memberIds: string[]):
  { participants: string[]; splitMode: SplitMode; splitValues: Record<string, number> | null } | string {
  if (s.mode === 'equal') {
    return s.participants.length ? { participants: s.participants, splitMode: 'equal', splitValues: null } : 'Scegli con chi dividere la spesa.'
  }
  const values: Record<string, number> = {}
  for (const id of memberIds) {
    const raw = s.vals[id] ?? ''
    const v = s.mode === 'percent' ? parsePercent(raw) : raw.trim() ? parseAmount(raw) : 0
    if (v === null || v < 0) return 'Valore non valido nella divisione.'
    if (v > 0) values[id] = v
  }
  const ids = Object.keys(values)
  if (!ids.length) return 'Inserisci almeno un valore nella divisione.'
  const sum = ids.reduce((a, id) => a + values[id], 0)
  if (s.mode === 'amount' && cents !== null && sum !== cents) return `Gli importi sommano ${formatMoney(sum)}, ma la spesa è di ${formatMoney(cents)}.`
  if (s.mode === 'percent' && sum !== 10000) return `Le percentuali sommano ${pctToInput(sum)}%: devono fare 100%.`
  return { participants: ids, splitMode: s.mode, splitValues: values }
}

/** Valori precompilati in parti uguali per le modalità "importi" e "percentuali". */
export function equalPrefill(mode: SplitMode, ids: string[], cents: number | null): Record<string, string> {
  if (mode === 'equal' || !ids.length) return {}
  const eq = expenseShares({ amount: mode === 'percent' ? 10000 : cents ?? 0, participants: ids })
  return Object.fromEntries(eq.map((s) => [s.member, mode === 'percent' ? pctToInput(s.amount) : s.amount ? centsToInput(s.amount) : '']))
}

/** Parti uguali / importi / percentuali: scelta della modalità e dei valori per membro. */
export function SplitEditor({ state, onChange, members, cents, payerIds }: {
  state: SplitState; onChange: (s: SplitState) => void; members: Member[]; cents: number | null; payerIds: string[]
}) {
  const { mode, participants, vals } = state
  const ids = members.map((m) => m.id)
  const base = participants.length ? participants : ids

  const changeMode = (m: SplitMode) => onChange({ mode: m, participants, vals: equalPrefill(m, base, cents) })

  let assigned = 0
  if (mode !== 'equal') for (const m of members) { const raw = vals[m.id] ?? ''; const v = mode === 'percent' ? parsePercent(raw) : raw.trim() ? parseAmount(raw) : 0; assigned += v && v > 0 ? v : 0 }
  const target = mode === 'percent' ? 10000 : cents ?? 0
  const remaining = target - assigned
  const fmt = (v: number) => (mode === 'percent' ? `${pctToInput(Math.abs(v))}%` : formatMoney(Math.abs(v)))

  return (
    <div className="rounded-2xl bg-bg p-3">
      <Segmented<SplitMode> value={mode} onChange={changeMode} options={[
        { value: 'equal', label: 'Parti uguali' }, { value: 'amount', label: 'Importi' }, { value: 'percent', label: 'Percentuali' },
      ]} />

      {mode === 'equal' ? (
        <>
          <p className="mb-2 mt-3 text-xs text-muted">Chi si divide la spesa in parti uguali (se chi ha pagato non è selezionato, ha anticipato per gli altri):</p>
          <MemberChips multi value={participants} onChange={(p: string[]) => onChange({ ...state, participants: p })} includeIds={participants} />
        </>
      ) : (
        <>
          <p className="mb-1 mt-3 text-xs text-muted">{mode === 'amount' ? 'Quanto spetta a ciascuno (in euro). Lascia vuoto chi non partecipa.' : 'Che percentuale spetta a ciascuno. Lascia vuoto chi non partecipa.'}</p>
          <ul className="divide-y divide-line/60">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <MemberAvatar name={m.name} color={m.color} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}{payerIds.includes(m.id) ? ' (ha pagato)' : ''}</span>
                <span className="flex w-28 items-center rounded-lg border border-line bg-surface px-2">
                  <input inputMode="decimal" aria-label={`${mode === 'amount' ? 'Importo' : 'Percentuale'} di ${m.name}`} placeholder="0" className="w-full bg-transparent py-1.5 text-right text-sm outline-none"
                    value={vals[m.id] ?? ''} onChange={(e) => onChange({ ...state, vals: { ...vals, [m.id]: e.target.value } })} />
                  <span className="pl-1 text-sm text-muted">{mode === 'amount' ? '€' : '%'}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className={remaining === 0 && assigned > 0 ? 'font-semibold text-inc' : remaining < 0 ? 'font-semibold text-exp' : 'text-muted'}>
              {remaining === 0 && assigned > 0 ? 'Divisione completa' : remaining > 0 ? `Restano ${fmt(remaining)} da assegnare` : remaining < 0 ? `Superato di ${fmt(remaining)}` : 'Nessun valore inserito'}
            </span>
            <button type="button" className="font-semibold text-brand" onClick={() => onChange({ ...state, vals: equalPrefill(mode, base, cents) })}>Ripartisci in parti uguali</button>
          </div>
        </>
      )}
    </div>
  )
}
