import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from './en'
import { applyLang, lang, parseLangPref, t } from './index'

/** Tutti i testi passati a t('…') / tb('…') / tr('…') nel codice. */
function usedKeys(): string[] {
  const out = new Set<string>()
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !p.includes('i18n/en.ts') && !p.includes('i18n/index.ts')) {
        const s = readFileSync(p, 'utf8')
        for (const m of s.matchAll(/\b(?:t|tr|tb)\('((?:[^'\\\n]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n'))
      }
    }
  }
  walk('src')
  return [...out]
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const bolds = (s: string) => (s.match(/<b>/g) ?? []).length

describe('traduzioni in inglese', () => {
  it('ogni testo usato nel codice ha la traduzione inglese', () => {
    const missing = usedKeys().filter((k) => !(k in EN))
    expect(missing).toEqual([])
  })
  it('segnaposto e grassetti coincidono con l\'originale', () => {
    const bad = Object.entries(EN).filter(([k, v]) => placeholders(k) !== placeholders(v) || bolds(k) !== bolds(v)).map(([k]) => k)
    expect(bad).toEqual([])
  })
  it('nessuna traduzione vuota', () => { expect(Object.entries(EN).filter(([, v]) => !v.trim())).toEqual([]) })
})

describe('t()', () => {
  it('in italiano restituisce il testo e riempie i segnaposto', () => {
    applyLang('it')
    expect(t('{n} membri', { n: 3 })).toBe('3 membri')
  })
  it('in inglese traduce, riempie i segnaposto e, se manca la traduzione, torna l\'italiano', () => {
    applyLang('en')
    try {
      expect(lang()).toBe('en')
      expect(t('{n} membri', { n: 3 })).toBe('3 members')
      expect(t('testo senza traduzione')).toBe('testo senza traduzione')
    } finally { applyLang('it') }
  })
  it('la preferenza: solo it/en sono scelte esplicite', () => {
    expect(parseLangPref('en')).toBe('en'); expect(parseLangPref('it')).toBe('it')
    for (const v of [null, '', 'fr', 'auto', 7]) expect(parseLangPref(v)).toBe('auto')
  })
})
