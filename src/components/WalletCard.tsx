import { useState } from 'react'
import { CreditCard, Copy, Download, RefreshCw, Trash2, Wallet, XCircle } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { createToken, ingestUrl, revokeWallet, savedToken, saveToken, setWalletOn, walletAvailable, walletOn } from '../sync/wallet'
import { ask } from './dialogs'
import { accountMemberIds, sortedAccounts } from '../lib/calc'
import { nowIso } from '../lib/ids'
import { cardsOf, removeCard, setCardAccount } from '../lib/wallet'
import { t } from '../i18n'

/**
 * Apple Wallet: ogni persona collega i propri pagamenti con Apple Pay. Il Comando Rapido dell'iPhone (automazione «Transazione»)
 * scrive su un indirizzo personale; l'app importa le spese come «da approvare».
 */
export function WalletCard() {
  const { sync, me, importWalletNow, prefs } = useApp()
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
          <CardList />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft" disabled={busy} onClick={() => void importNow()}><Download size={16} />{t('Importa ora')}</button>
            <button className="btn-soft" disabled={busy} onClick={() => void activate(true)}><RefreshCw size={16} />{t('Nuovo indirizzo')}</button>
          </div>
          <button className="btn-danger w-full" data-testid="wallet-off" disabled={busy} onClick={() => void deactivate()}><XCircle size={16} />{t('Disattiva')}</button>
        </>
      )}
      {on && !prefs.pushEnabled && <p className="rounded-xl bg-warn/15 p-3 text-warn">{t('Per ricevere una notifica a ogni pagamento, anche con l\'app chiusa, attiva le notifiche in Impostazioni → Notifiche.')}</p>}
      {msg && <p className={msg.bad ? 'font-medium text-exp' : 'text-muted'}>{msg.text}</p>}
      <details className="rounded-xl bg-bg p-3">
        <summary className="cursor-pointer font-semibold">{t('Come si configura sull\'iPhone')}</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
          <li>{t('Apri l\'app Comandi, scheda Automazione, tocca + e scegli «Transazione».')}</li>
          <li>{t('Scegli le carte da collegare e seleziona «Esegui immediatamente» (così non chiede conferma a ogni pagamento).')}</li>
          <li>{t('Aggiungi l\'azione «Ottieni contenuti dell\'URL» e incolla il tuo indirizzo.')}</li>
          <li>{t('Metodo: POST. Corpo della richiesta: JSON, con tre campi di testo: amount = «Importo», merchant = «Commerciante», card = «Carta o tessera» (si scelgono dalle variabili dell\'automazione).')}</li>
          <li>{t('Fatto: al prossimo pagamento con Apple Pay la spesa compare in Transazioni e la carta compare nell\'elenco «Le tue carte»: scegli a quale conto associarla, e da lì in poi i pagamenti di quella carta vanno direttamente su quel conto.')}</li>
        </ol>
        <p className="mt-2 text-xs text-muted">{t('Funziona solo con i pagamenti Apple Pay su iPhone, non con la carta fisica. Le spese restano sul server cifrate fino all\'importazione (al massimo 30 giorni).')}</p>
      </details>
    </div>
  )
}

/** Le carte di Wallet usate finora: ognuna si associa a un conto (le nuove compaiono qui «da associare» al primo pagamento). */
function CardList() {
  const { db, commit, me } = useApp()
  if (!me) return null
  const cards = cardsOf(db, me.id)
  const accounts = sortedAccounts(db).filter((a) => !a.hidden && accountMemberIds(db, a).includes(me.id))
  const unlinked = cards.filter((c) => !c.accountId || !accounts.some((a) => a.id === c.accountId)).length
  return (
    <div data-testid="wallet-cards" className="rounded-xl bg-bg p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><CreditCard size={14} />{t('Le tue carte')}{unlinked > 0 && <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[11px] font-bold text-warn">{t('{n} da associare', { n: unlinked })}</span>}</p>
      {cards.length === 0 ? (
        <p className="text-muted">{t('Nessuna carta ancora: compare qui al primo pagamento con Apple Pay, e poi scegli a quale conto va associata.')}</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => {
            const linked = !!c.accountId && accounts.some((a) => a.id === c.accountId)
            return (
              <li key={c.name} data-testid="wallet-card" className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <select aria-label={t('Conto per la carta {name}', { name: c.name })} value={linked ? c.accountId! : ''} className="input mt-1 !py-1.5 text-sm"
                    onChange={(e) => commit((d) => setCardAccount(d, me.id, c.name, e.target.value || null, nowIso()))}>
                    <option value="">{t('Da associare')}</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <button className="icon-btn text-muted" aria-label={t('Rimuovi la carta {name}', { name: c.name })} onClick={() => commit((d) => removeCard(d, me.id, c.name, nowIso()))}><Trash2 size={16} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
