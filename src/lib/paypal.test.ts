import { describe, expect, it } from 'vitest'
import { parsePaypalHandle, paypalUrl } from './paypal'

describe('PayPal.Me', () => {
  it('accetta nome, @nome e link in vari formati', () => {
    for (const raw of ['mario', '@mario', ' mario ', 'paypal.me/mario', 'https://www.paypal.me/mario', 'https://paypal.me/mario/12.5EUR?x=1'])
      expect(parsePaypalHandle(raw)).toEqual({ handle: 'mario' })
  })
  it('vuoto = scollegato; il resto è un errore', () => {
    expect(parsePaypalHandle('  ')).toEqual({ handle: null })
    for (const bad of ['ma rio', 'mario/rossi', 'http://evil.example/x', 'a'.repeat(41), '<script>']) expect(parsePaypalHandle(bad)).toHaveProperty('error')
  })
  it('importo in euro con due decimali e punto', () => {
    expect(paypalUrl('mario', 1250)).toBe('https://www.paypal.me/mario/12.50EUR')
    expect(paypalUrl('mario', 5)).toBe('https://www.paypal.me/mario/0.05EUR')
    expect(paypalUrl('mario', 100000)).toBe('https://www.paypal.me/mario/1000.00EUR')
  })
  it('il nome è codificato nel link', () => { expect(paypalUrl('a.b-c_d', 100)).toBe('https://www.paypal.me/a.b-c_d/1.00EUR') })
})
