import { describe, expect, it } from 'vitest'
import { LOCK_AFTER_MS, shouldLock } from './appLock'

describe('blocco dell\'app: quando scatta', () => {
  it('dopo almeno 1 minuto in background, non prima', () => {
    expect(LOCK_AFTER_MS).toBe(60_000)
    expect(shouldLock(1000, 1000 + 59_999)).toBe(false)
    expect(shouldLock(1000, 1000 + 60_000)).toBe(true)
    expect(shouldLock(1000, 1000 + 10 * 60_000)).toBe(true)
  })
  it('se l\'app non è mai stata in background non blocca', () => {
    expect(shouldLock(null, 999_999_999)).toBe(false)
  })
  it('un tempo diverso si può passare (es. «subito»)', () => {
    expect(shouldLock(5, 5, 0)).toBe(true)
  })
})
