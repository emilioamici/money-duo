import { useState } from 'react'
import { Copy, Download, RefreshCw, Wallet, XCircle } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { createToken, ingestUrl, revokeWallet, savedToken, saveToken, setWalletOn, walletAvailable, walletOn } from '../sync/wallet'
import { ask } from './dialogs'
import { t } from '../i18n'

/**
 * Apple Wallet: ogni persona collega i propri pagamenti con Apple Pay. Il Comando Rapido dell'iPhone (automazione «Transazione»)
 * scrive su un indirizzo personale; l'app importa le spese come «da approvare».
 */
export function WalletCard() {
  const { sync, me, importWalletNow } = useApp()
  const fileId = sync.fileId
  const [on, setOn] = useState(() => !!fileId && walletOn(fileId))
  const [token, setToken] = useState<string | null>(() => (fileId ? savedToken(fileId) : null))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)

  if (!walletAvailable()) return <p className="text-sm text-muted">{t('Serve il server delle notifiche (lo stesso della configurazione push): non risulta configurato su questa app.')}</p>
  if (!fileId || !me) return <p className="text-sm text-muted">{t('Collega prima una famiglia e accedi con il tuo account Google.')}</p>

  const run = async (fn: (auth: string) => Promise<void>) => {
    setMsg(null); setBusy(true)
    try {
      const auth = engine.currentToken()
      if (!auth) throw new Error(t('Sessione Google scaduta: riconnettiti e riprova.'))
      await fn(auth)
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), bad: true }) } finally { setBusy(false) }
  }

  const activate = (rotate: boolean) => run(async (auth) => {
    const r = await createToken(fileId, auth, rotate)
    setWalletOn(fileId, true); setOn(true)
    if (r.token) { saveToken(fileId, r.token); setToken(r.token); setMsg({ text: t('Fatto. Copia l\'indirizzo e segui i passi qui sotto sul tuo iPhone.') }) }
    else setMsg({ text: t('Già attivo con il tuo account: questo dispositivo ora importa le spese. L\'indirizzo si vede solo dove è stato creato; per rivederlo premi «Nuovo indirizzo» (quello vecchio smette di funzionare).') })
  })
  const deactivate = async () => {
    if (!(await ask({ title: t('Disattivare Apple Wallet?'), message: t('L\'indirizzo smette di funzionare e le spese in attesa sul server vengono cancellate. Le transazioni già importate restano.'), ok: t('Disattiva'), danger: true }))) return
    await run(async (auth) => { await revokeWallet(fileId, auth); setWalletOn(fileId, false); saveToken(fileId, null); setOn(false); setToken(null) })
  }
  const importNow = () => run(async () => {
    const n = await importWalletNow()
    setMsg({ text: n > 0 ? t('Importate {n} spese: le trovi in Transazioni con il segno giallo.', { n }) : t('Nessuna nuova spesa da importare.') })
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(ingestUrl(token!)); setMsg({ text: t('Indirizzo copiato.') }) } catch { setMsg({ text: t('Non riesco a copiare: tieni premuto sull\'indirizzo e copialo a mano.'), bad: true }) }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{t('Le spese pagate con Apple Pay arrivano da sole in Transazioni, con la categoria da scegliere e un segno giallo: le approvi o le modifichi tu. Ognuno collega il proprio iPhone.')}</p>
      {!on ? (
        <button className="btn-primary w-full" disabled={busy} onClick={() => void activate(false)}><Wallet size={18} />{t('Attiva Apple Wallet')}</button>
      ) : (
        <>
          {token && (
            <div className="rounded-xl bg-bg p-3">
              <p className="mb-1 text-xs font-semibold text-muted">{t('Il tuo indirizzo personale (non condividerlo)')}</p>
              <p data-testid="wallet-url" className="break-all font-mono text-xs">{ingestUrl(token)}</p>
              <button className="btn-soft mt-2 w-full" onClick={() => void copy()}><Copy size={16} />{t('Copia indirizzo')}</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft" disabled={busy} onClick={() => void importNow()}><Download size={16} />{t('Importa ora')}</button>
            <button className="btn-soft" disabled={busy} onClick={() => void activate(true)}><RefreshCw size={16} />{t('Nuovo indirizzo')}</button>
          </div>
          <button className="btn-danger w-full" data-testid="wallet-off" disabled={busy} onClick={() => void deactivate()}><XCircle size={16} />{t('Disattiva')}</button>
        </>
      )}
      {msg && <p className={msg.bad ? 'font-medium text-exp' : 'text-muted'}>{msg.text}</p>}
      <details className="rounded-xl bg-bg p-3">
        <summary className="cursor-pointer font-semibold">{t('Come si configura sull\'iPhone')}</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
          <li>{t('Apri l\'app Comandi, scheda Automazione, tocca + e scegli «Transazione».')}</li>
          <li>{t('Scegli le carte da collegare e seleziona «Esegui immediatamente» (così non chiede conferma a ogni pagamento).')}</li>
          <li>{t('Aggiungi l\'azione «Ottieni contenuti dell\'URL» e incolla il tuo indirizzo.')}</li>
          <li>{t('Metodo: POST. Corpo della richiesta: JSON, con tre campi di testo: amount = «Importo», merchant = «Commerciante», card = «Carta o tessera» (si scelgono dalle variabili dell\'automazione).')}</li>
          <li>{t('Fatto: al prossimo pagamento con Apple Pay, la spesa compare qui. Perché il conto sia riconosciuto da solo, il suo nome deve contenere quello della carta (es. «Visa Emilio»).')}</li>
        </ol>
        <p className="mt-2 text-xs text-muted">{t('Funziona solo con i pagamenti Apple Pay su iPhone, non con la carta fisica. Le spese restano sul server cifrate fino all\'importazione (al massimo 30 giorni).')}</p>
      </details>
    </div>
  )
}
