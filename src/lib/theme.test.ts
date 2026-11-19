import { describe, expect, it } from 'vitest'
import { THEME_NAME, parseTheme } from './theme'

describe('tema', () => {
  it('solo «light» e «dark» sono scelte esplicite, il resto è automatico', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    for (const v of [null, undefined, '', 'auto', 'Dark', 42, {}]) expect(parseTheme(v)).toBe('auto')
  })
  it('i nomi nelle impostazioni', () => {
    expect(THEME_NAME.light).toBe('Modalità Mochi')
    expect(THEME_NAME.dark).toBe('Modalità Zenitsu')
  })
})
