/**
 * Link d'invito: `…/money-duo/#join=<codice famiglia>` (il codice famiglia è l'ID del file del database su Drive).
 * Chi lo apre e accede con Google trova la famiglia già pronta: dal ponte del Worker, oppure con un tocco sul Selettore di Google.
 */
const KEY = 'moneyduo:joinId'
const ID = /^[\w-]{10,100}$/

export const inviteLink = (fileId: string): string => `${window.location.origin}${import.meta.env.BASE_URL}#join=${fileId}`

/** Dal testo incollato (codice, link d'invito o link di Drive) al codice famiglia; null se non è valido. */
export function parseFamilyCode(input: string): string | null {
  const s = input.trim()
  const m = /#join=([\w-]+)/.exec(s) ?? /\/d\/([\w-]+)/.exec(s) ?? /[?&]id=([\w-]+)/.exec(s)
  const id = m ? m[1] : s
  return ID.test(id) ? id : null
}

/** All'apertura: se l'indirizzo contiene un invito lo si ricorda (sopravvive al giro su Google) e lo si toglie dalla barra. */
export function consumeInviteFromUrl(): boolean {
  try {
    const m = /^#join=([\w-]+)$/.exec(window.location.hash)
    if (!m) return false
    if (ID.test(m[1])) localStorage.setItem(KEY, m[1])
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return true
  } catch { return false }
}

export function pendingInvite(): string | null {
  try { const v = localStorage.getItem(KEY); return v && ID.test(v) ? v : null } catch { return null }
}
export function setPendingInvite(id: string): void { try { if (ID.test(id)) localStorage.setItem(KEY, id) } catch { /* noop */ } }
export function clearInvite(): void { try { localStorage.removeItem(KEY) } catch { /* noop */ } }
