import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearInvite, consumeInviteFromUrl, inviteLink, parseFamilyCode, pendingInvite } from './invite'

const store = new Map<string, string>()
let hash = ''
const replaced: string[] = []
beforeEach(() => {
  store.clear(); replaced.length = 0; hash = ''
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('window', { location: { origin: 'https://utente.github.io', pathname: '/money-duo/', search: '', get hash() { return hash } } })
  vi.stubGlobal('history', { replaceState: (_: unknown, __: string, url: string) => { replaced.push(url); hash = '' } })
})

describe('link d\'invito e codice famiglia', () => {
  it('si ricorda il codice del link e si ripulisce l\'indirizzo', () => {
    hash = '#join=1WkGOPnfJ38bOLB5UmZED'
    expect(consumeInviteFromUrl()).toBe(true)
    expect(pendingInvite()).toBe('1WkGOPnfJ38bOLB5UmZED')
    expect(replaced).toEqual(['/money-duo/'])
    clearInvite()
    expect(pendingInvite()).toBeNull()
  })
  it('ignora gli indirizzi senza invito e i codici non validi', () => {
    hash = '#altro'
    expect(consumeInviteFromUrl()).toBe(false)
    hash = '#join=x'
    expect(consumeInviteFromUrl()).toBe(true)
    expect(pendingInvite()).toBeNull()
  })
  it('il codice famiglia si ricava da codice, link d\'invito o link di Drive', () => {
    const id = '1WkGOPnfJ38bOLB5UmZED'
    expect(parseFamilyCode(id)).toBe(id)
    expect(parseFamilyCode(`  ${id}  `)).toBe(id)
    expect(parseFamilyCode(`https://utente.github.io/money-duo/#join=${id}`)).toBe(id)
    expect(parseFamilyCode(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(id)
    expect(parseFamilyCode('corto')).toBeNull()
    expect(parseFamilyCode('non è un codice!')).toBeNull()
  })
  it('il link contiene il codice', () => {
    expect(inviteLink('ABCDEFGHIJK')).toMatch(/^https:\/\/utente\.github\.io\/.*#join=ABCDEFGHIJK$/)
  })
})
