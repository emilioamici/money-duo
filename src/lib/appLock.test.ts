import { describe, expect, it } from 'vitest'
import { LOCK_AFTER_MS, isPin, shouldLock, waitAfter } from './appLock'

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

describe('codice di sblocco a 6 cifre', () => {
  it('accetta solo 6 cifre', () => {
    expect(isPin('123456')).toBe(true)
    for (const bad of ['12345', '1234567', '12345a', '', '12 456']) expect(isPin(bad)).toBe(false)
  })
  it('dopo 5 errori di fila impone un\'attesa che raddoppia, fino a 1 ora', () => {
    expect([1, 2, 3, 4].map(waitAfter)).toEqual([0, 0, 0, 0])
    expect([5, 6, 7].map(waitAfter)).toEqual([30, 60, 120])
    expect(waitAfter(30)).toBe(3600)
  })
})
