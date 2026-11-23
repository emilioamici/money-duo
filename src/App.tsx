import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { ListChecks, PieChart, Plus, Receipt, Settings, Star, Users, Wallet, X } from 'lucide-react'
import { AppProvider, useApp } from './store/AppProvider'
import { DialogHost } from './components/dialogs'
import { TransactionForm } from './components/TransactionForm'
import { SplitForm } from './components/SplitForm'
import { FavoritesSheet } from './components/FavoritesSheet'
import { isSplit } from './lib/calc'
import { HomePage } from './pages/HomePage'
import { StatsPage } from './pages/StatsPage'
import { AccountsPage } from './pages/AccountsPage'
import { SettingsPage } from './pages/SettingsPage'
import { Gate } from './components/Gate'
import { IdentityGuard } from './components/IdentityGuard'
import { NotificationCenter, NotificationToast } from './components/Notifications'
import { t, useLang } from './i18n'

type Tab = 'home' | 'stats' | 'accounts' | 'settings'
const TABS: Array<{ id: Tab; label: string; icon: typeof Plus }> = [
  { id: 'home', label: 'Transazioni', icon: ListChecks },
  { id: 'stats', label: 'Statistiche', icon: PieChart },
  { id: 'accounts', label: 'Conti', icon: Wallet },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
]

function Shell() {
  const { txForm, openTx, openSplit, closeTx } = useApp()
  const [fabOpen, setFabOpen] = useState(false)
  const [favOpen, setFavOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('home')
  const syncRef = useRef<HTMLDivElement>(null)
  const [syncReq, setSyncReq] = useState(0)
  const goSync = () => { setTab('settings'); setSyncReq((n) => n + 1); setTimeout(() => syncRef.current?.scrollIntoView({ behavior: 'smooth' }), 80) }

  useEffect(() => { document.title = 'Money Duo' }, [])
  // cambiando scheda si riparte dall'alto (la pagina è una sola e manterrebbe la posizione di scorrimento di quella prima)
  useEffect(() => { window.scrollTo(0, 0) }, [tab])

  return (
    <div className="mx-auto flex min-h-full max-w-5xl">
      <aside className="glass sticky top-0 m-3 hidden h-[calc(100dvh-1.5rem)] w-56 shrink-0 flex-col gap-1 rounded-[28px] p-4 md:flex">
        <p className="mb-4 px-3 text-xl font-extrabold tracking-tight">Money <span className="text-brand">Duo</span></p>
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === tb.id ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-line/50'}`}><tb.icon size={20} />{t(tb.label)}</button>
        ))}
        <button className="btn-primary mt-4" onClick={() => openTx()}><Plus size={18} />{t('Nuova transazione')}</button>
        <button className="btn-soft" onClick={() => openSplit()}><Users size={18} />{t('Nuovo split')}</button>
        <button className="btn-soft" onClick={() => setFavOpen(true)}><Star size={18} />{t('Preferiti')}</button>
      </aside>

      <main className="min-w-0 flex-1 pb-40 md:pb-10">
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tab === 'home' && <HomePage onOpenSync={goSync} />}
            {tab === 'stats' && <StatsPage />}
            {tab === 'accounts' && <AccountsPage />}
            {tab === 'settings' && <SettingsPage syncRef={syncRef} openSync={syncReq} />}
          </m.div>
        </AnimatePresence>
      </main>

      {fabOpen && <div className="fixed inset-0 z-20 animate-fade bg-ink/30 md:hidden" onClick={() => setFabOpen(false)} />}
      <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-5 z-30 flex flex-col items-end gap-3 md:hidden">
        {fabOpen && (
          <>
            <button onClick={() => { setFabOpen(false); setFavOpen(true) }} className="flex animate-sheet items-center gap-2 glass rounded-full py-3 pl-4 pr-5 text-sm font-semibold">
              <Star size={18} className="text-brand" />{t('Preferiti')}
            </button>
            <button onClick={() => { setFabOpen(false); openSplit() }} className="flex animate-sheet items-center gap-2 glass rounded-full py-3 pl-4 pr-5 text-sm font-semibold">
              <Users size={18} className="text-brand" />{t('Nuovo split')}
            </button>
            <button onClick={() => { setFabOpen(false); openTx() }} className="flex animate-sheet items-center gap-2 glass rounded-full py-3 pl-4 pr-5 text-sm font-semibold">
              <Receipt size={18} className="text-brand" />{t('Nuova transazione')}
            </button>
          </>
        )}
        <m.button whileTap={{ scale: 0.9 }} onClick={() => setFabOpen((o) => !o)} aria-label={fabOpen ? t('Chiudi') : t('Aggiungi')} aria-expanded={fabOpen}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-onbrand shadow-lg shadow-brand/30 ring-1 ring-inset ring-white/30">
          {fabOpen ? <X size={26} /> : <Plus size={28} />}
        </m.button>
      </div>

      <nav className="glass fixed inset-x-4 bottom-4 z-40 grid grid-cols-4 !rounded-full p-1.5 md:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} aria-current={tab === tb.id ? 'page' : undefined}
            className="relative flex flex-col items-center gap-0.5 rounded-full py-2 text-[10px] font-semibold transition active:scale-90">
            {/* la «goccia» di vetro è un solo elemento che passa da una scheda all'altra: Framer Motion la anima con una molla */}
            {tab === tb.id && <m.span layoutId="nav-drop" className="glass-active absolute inset-0 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.9 }} />}
            <span className={`relative flex flex-col items-center gap-0.5 transition ${tab === tb.id ? 'text-brand' : 'text-muted'}`}><tb.icon size={22} strokeWidth={tab === tb.id ? 2.6 : 2.1} />{t(tb.label)}</span>
          </button>
        ))}
      </nav>

      {favOpen && <FavoritesSheet onClose={() => setFavOpen(false)} />}
      <IdentityGuard />
      <NotificationCenter onOpenAccounts={() => setTab('accounts')} />
      <NotificationToast />
      {txForm && (txForm.kind === 'split' || (txForm.tx && isSplit(txForm.tx))
        ? <SplitForm key={txForm.tx?.id ?? `new-split-${txForm.nonce ?? 0}`} state={txForm} onClose={closeTx} />
        : <TransactionForm key={txForm.tx?.id ?? `new-${txForm.nonce ?? 0}`} state={txForm} onClose={closeTx} />)}
    </div>
  )
}

/** Senza un database collegato si passa dal login Google; con il database collegato l'app funziona anche offline. */
function Root() {
  const { sync } = useApp()
  useLang()   // al cambio lingua si ridisegna tutto
  if (!sync.fileId) return <><Gate /><DialogHost /></>
  // sessione scaduta (e online): la schermata di accesso copre tutto e i dati non si vedono. L'app resta montata sotto, inerte,
  // così quello che stavi scrivendo non si perde e dopo l'accesso si riprende da dove si era.
  const locked = sync.status === 'auth'
  return (
    <>
      <div aria-hidden={locked || undefined} {...(locked ? { inert: '' } : {})} data-locked={locked || undefined}><Shell /></div>
      {locked && <div className="fixed inset-0 z-[100] overflow-y-auto bg-bg" data-testid="login-overlay"><Gate reconnect /></div>}
      <DialogHost />
    </>
  )
}

export default function App() {
  return <AppProvider><Root /></AppProvider>
}
