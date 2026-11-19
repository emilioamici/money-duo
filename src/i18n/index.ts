import { useSyncExternalStore } from 'react'
import { EN } from './en'

/**
 * Lingue dell'app: italiano (la lingua dei testi nel codice) e inglese.
 * `t('testo in italiano', { n: 3 })` restituisce il testo nella lingua in uso: in inglese lo cerca nel dizionario (`en.ts`),
 * dove la chiave è il testo italiano; se manca torna l'italiano. I segnaposto sono {nome}.
 */
export type Lang = 'it' | 'en'
export type LangPref = 'auto' | Lang

export const LANG_KEY = 'moneyduo:lang'
export const LANG_NAME: Record<LangPref, string> = { auto: 'Automatico / Automatic', it: 'Italiano', en: 'English' }

export const parseLangPref = (v: unknown): LangPref => (v === 'it' || v === 'en' ? v : 'auto')

export function getLangPref(): LangPref {
  try { return parseLangPref(localStorage.getItem(LANG_KEY)) } catch { return 'auto' }
}

/** La lingua del dispositivo: italiano se il browser è in italiano, altrimenti inglese. */
export function systemLang(): Lang {
  if (typeof window === 'undefined') return 'it'   // test e server: italiano
  const l = navigator.languages?.[0] || navigator.language || 'it'
  return /^it\b/i.test(l) ? 'it' : 'en'
}

const resolve = (pref: LangPref): Lang => (pref === 'auto' ? systemLang() : pref)

let current: Lang = resolve(getLangPref())
const listeners = new Set<() => void>()

export const lang = (): Lang => current
/** Impostazioni internazionali per date e numeri. */
export const locale = (): string => (current === 'en' ? 'en-GB' : 'it-IT')

export function setLangPref(pref: LangPref): void {
  try { if (pref === 'auto') localStorage.removeItem(LANG_KEY); else localStorage.setItem(LANG_KEY, pref) } catch { /* noop */ }
  applyLang(resolve(pref))
}

export function applyLang(l: Lang): void {
  current = l
  if (typeof document !== 'undefined') document.documentElement.lang = l
  listeners.forEach((f) => f())
}

if (typeof document !== 'undefined') document.documentElement.lang = current

const fill = (s: string, params?: Record<string, string | number>): string =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s

export function t(it: string, params?: Record<string, string | number>): string {
  return fill(current === 'en' ? EN[it] ?? it : it, params)
}

/** Fa rileggere i testi ai componenti quando cambia la lingua. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, lang, lang)
}
