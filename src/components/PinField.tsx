import { PIN_LENGTH } from '../lib/appLock'

/** Campo per il codice a 6 cifre: tastierino numerico, cifre nascoste. */
export function PinField({ value, onChange, label, testId, autoFocus }: { value: string; onChange: (v: string) => void; label: string; testId: string; autoFocus?: boolean }) {
  return (
    <input
      type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={PIN_LENGTH} autoFocus={autoFocus}
      aria-label={label} placeholder="••••••" data-testid={testId} value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      className="w-full rounded-xl border border-line bg-bg px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand"
    />
  )
}
