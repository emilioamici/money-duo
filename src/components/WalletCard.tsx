import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, CreditCard, Copy, Download, Inbox, KeyRound, RefreshCw, Star, Store, Trash2, Wallet, XCircle } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { engine } from '../sync/engine'
import { createToken, ingestUrl, pullWallet, revokeWallet, savedToken, saveToken, setWalletOn, walletAvailable, walletOn, type WalletLogEntry } from '../sync/wallet'
import { ask } from './dialogs'
import { accountMemberIds, sortedAccounts } from '../lib/calc'
import { nowIso } from '../lib/ids'
import { cardsOf, favoritesForMerchants, merchantsOf, removeCard, removeMerchant, setCardAccount, setMerchantFavorite } from '../lib/wallet'
import { dateTimeLabel } from '../lib/format'
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
  const [log, setLog] = useState<WalletLogEntry[] | null>(null)
  /** Chiede al server cosa ha ricevuto e cosa è in attesa (non importa nulla). */
  const checkServer = async () => {
    const auth = engine.currentToken()
    if (!auth || !fileId) return null
    try { const r = await pullWallet(fileId, auth); setLog(r.log ?? []); return r } catch { return null }
  }
  useEffect(() => { if (on) void checkServer() }, [on, fileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const importNow = () => run(async () => {
    const n = await importWalletNow()
    if (n > 0) return setMsg({ text: t('Importate {n} spese: le trovi in Transazioni con il segno giallo.', { n }) })
    // nessuna spesa importata: il server dice perché (indirizzo non attivo su questo database, spese in attesa, nulla arrivato)
    const r = await checkServer()
    if (r && !r.enabled) setMsg({ text: t('Su questo database non risulta nessun indirizzo attivo (l\'hai creato con un altro database?): premi «Nuovo indirizzo» e aggiorna il Comando Rapido.'), bad: true })
    else if (r && r.items.length > 0) setMsg({ text: t('Sul server ci sono {n} spese in attesa ma non sono state importate: controlla di avere un conto che puoi usare.', { n: r.items.length }), bad: true })
    else setMsg({ text: t('Nessuna nuova spesa da importare. Se ne hai appena fatta una, guarda «Ultimi arrivi» qui sotto: dice cosa ha ricevuto il server.') })
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
            <SubSection id="address" testId="wallet-address" icon={<KeyRound size={16} />} title={t('Il tuo indirizzo personale (non condividerlo)')} summary={t('Copialo o rivedilo')}>
              <p data-testid="wallet-url" className="break-all font-mono text-xs">{ingestUrl(token)}</p>
              <button className="btn-soft mt-2 w-full" onClick={() => void copy()}><Copy size={16} />{t('Copia indirizzo')}</button>
            </SubSection>
          )}
          <CardList />
          <MerchantList />
          <Arrivals log={log} onRefresh={() => void checkServer()} />
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
    <SubSection id="cards" testId="wallet-cards" icon={<CreditCard size={16} />} title={t('Le tue carte')}
      summary={cards.length === 0 ? t('Nessuna carta ancora') : cards.length === 1 ? t('1 carta') : t('{n} carte', { n: cards.length })}
      badge={unlinked > 0 ? <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[11px] font-bold text-warn">{t('{n} da associare', { n: unlinked })}</span> : undefined}>
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
    </SubSection>
  )
}

/** Gli esercenti da cui sono arrivate spese: ognuno si lega a un preferito, e le sue spese arrivano già compilate e approvate. */
function MerchantList() {
  const { db, commit, me } = useApp()
  if (!me) return null
  const list = [...merchantsOf(db, me.id)].reverse() // i più recenti in alto
  const favs = favoritesForMerchants(db, me.id)
  const cats = new Map(db.categories.map((c) => [c.id, c.name]))
  // nel menu solo il nome del preferito (l'importo lo decide Wallet); se due si chiamano uguale si aggiunge la categoria o il conto per distinguerli
  const baseLabel = (f: (typeof favs)[number]) => f.title || (f.categoryId && cats.get(f.categoryId)) || t('Preferito')
  const accNames = new Map(db.accounts.map((a) => [a.id, a.name]))
  const label = (f: (typeof favs)[number]) => (favs.filter((x) => baseLabel(x) === baseLabel(f)).length > 1 ? `${baseLabel(f)} · ${(f.categoryId && cats.get(f.categoryId)) || accNames.get(f.accountId) || ''}` : baseLabel(f))
  const linked = list.filter((m) => m.favoriteId && favs.some((f) => f.id === m.favoriteId)).length
  return (
    <SubSection id="merchants" testId="wallet-merchants" icon={<Store size={16} />} title={t('I tuoi esercenti')}
      summary={list.length === 0 ? t('Nessun esercente ancora') : list.length === 1 ? t('1 esercente') : t('{n} esercenti', { n: list.length })}
      badge={linked > 0 ? <span className="rounded-full bg-trf/15 px-2 py-0.5 text-[11px] font-bold text-trf">{t('{n} con preferito', { n: linked })}</span> : undefined}>
      <p className="mb-2 text-xs text-muted">{t('Lega un esercente a un preferito: quando arriva una sua spesa è già compilata come il preferito (con l\'importo pagato) e approvata.')}</p>
      {list.length === 0 ? (
        <p className="text-muted">{t('Nessun esercente ancora: compare qui al primo pagamento con Apple Pay.')}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {list.map((m) => {
            const ok = !!m.favoriteId && favs.some((f) => f.id === m.favoriteId)
            return (
              <li key={m.name} data-testid="wallet-merchant" className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate font-semibold">{ok && <Star size={12} className="shrink-0 text-warn" />}{m.name}</p>
                  <select aria-label={t('Preferito per {name}', { name: m.name })} value={ok ? m.favoriteId! : ''} className="input mt-1 !py-1.5 text-sm"
                    onChange={(e) => commit((d) => setMerchantFavorite(d, me.id, m.name, e.target.value || null, nowIso()))}>
                    <option value="">{t('Nessun preferito')}</option>
                    {favs.map((f) => <option key={f.id} value={f.id}>{label(f)}</option>)}
                  </select>
                </div>
                <button className="icon-btn text-muted" aria-label={t('Rimuovi l\'esercente {name}', { name: m.name })} onClick={() => commit((d) => removeMerchant(d, me.id, m.name, nowIso()))}><Trash2 size={16} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </SubSection>
  )
}

/** Gli ultimi arrivi dal Comando Rapido registrati dal server: se una spesa non compare, qui si vede se è arrivata e perché è stata rifiutata. */
function Arrivals({ log, onRefresh }: { log: WalletLogEntry[] | null; onRefresh: () => void }) {
  return (
    <SubSection id="arrivals" testId="wallet-arrivals" icon={<Inbox size={16} />} title={t('Ultimi arrivi dal Comando Rapido')}
      summary={log === null ? t('Controllo…') : log.length === 0 ? t('Nessun arrivo registrato') : `${dateTimeLabel(log[0].at)} · ${log[0].status === 200 ? t('ricevuta') : t('rifiutata: {reason}', { reason: log[0].reason ?? String(log[0].status) })}`}>
      <p className="mb-2 text-right"><button className="rounded-full px-2 py-0.5 text-xs font-semibold text-brand" onClick={onRefresh}>{t('Aggiorna')}</button></p>
      {log === null ? (
        <p className="text-muted">{t('Controllo…')}</p>
      ) : log.length === 0 ? (
        <p className="text-muted">{t('Nessun arrivo registrato: il Comando Rapido non ha ancora contattato il server (oppure il Worker non è aggiornato all\'ultima versione).')}</p>
      ) : (
        <ul className="space-y-1.5">
          {log.map((e, i) => (
            <li key={e.at + i} className="text-xs">
              <span className="text-muted">{dateTimeLabel(e.at)}</span>{' · '}
              {e.status === 200
                ? <span className="font-semibold text-inc">{t('ricevuta')}</span>
                : <span className="font-semibold text-exp">{t('rifiutata: {reason}', { reason: e.reason ?? String(e.status) })}</span>}
              {e.status !== 200 && (e.amount || e.fields?.length) && (
                <span className="block text-muted">{t('arrivato: importo «{amount}», campi {fields}', { amount: e.amount ?? '—', fields: (e.fields ?? []).join(', ') || '—' })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SubSection>
  )
}

const SECTIONS_KEY = 'moneyduo:walletSections'
const loadSections = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') } catch { return {} } }

/** Sotto-sezione a scomparsa della scheda Wallet: da chiusa mostra un riepilogo in una riga; lo stato si ricorda su questo dispositivo. */
function SubSection({ id, testId, icon, title, summary, badge, children }: { id: string; testId: string; icon: ReactNode; title: string; summary?: string; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => !!loadSections()[id])
  const flip = () => setOpen((o) => {
    const n = !o
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...loadSections(), [id]: n })) } catch { /* noop */ }
    return n
  })
  return (
    <div data-testid={testId} data-open={open || undefined} className="rounded-xl bg-bg">
      <button type="button" onClick={flip} aria-expanded={open} className="flex w-full items-center gap-2 p-3 text-left active:bg-line/30">
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {!open && summary && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        {badge}
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}
