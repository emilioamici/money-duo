import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => { document.title = 'MoneyDuo' }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-5xl">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-line/70 p-4 md:flex">
        <p className="mb-4 px-3 text-xl font-extrabold tracking-tight">Money<span className="text-brand">Duo</span></p>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === t.id ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-line/50'}`}><t.icon size={20} />{t.label}</button>
        ))}
        <button className="btn-primary mt-4" onClick={() => openTx()}><Plus size={18} />Nuova transazione</button>
        <button className="btn-soft" onClick={() => openSplit()}><Users size={18} />Nuovo split</button>
        <button className="btn-soft" onClick={() => setFavOpen(true)}><Star size={18} />Preferiti</button>
      </aside>

      <main className="min-w-0 flex-1 pb-36 md:pb-10">
        {tab === 'home' && <HomePage onOpenSync={goSync} />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'accounts' && <AccountsPage />}
        {tab === 'settings' && <SettingsPage syncRef={syncRef} openSync={syncReq} />}
      </main>

      {fabOpen && <div className="fixed inset-0 z-30 animate-fade bg-black/40 md:hidden" onClick={() => setFabOpen(false)} />}
      <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-3 md:hidden">
        {fabOpen && (
          <>
            <button onClick={() => { setFabOpen(false); setFavOpen(true) }} className="flex animate-sheet items-center gap-2 rounded-full bg-surface py-3 pl-4 pr-5 text-sm font-semibold shadow-lg">
              <Star size={18} className="text-brand" />Preferiti
            </button>
            <button onClick={() => { setFabOpen(false); openSplit() }} className="flex animate-sheet items-center gap-2 rounded-full bg-surface py-3 pl-4 pr-5 text-sm font-semibold shadow-lg">
              <Users size={18} className="text-brand" />Nuovo split
            </button>
            <button onClick={() => { setFabOpen(false); openTx() }} className="flex animate-sheet items-center gap-2 rounded-full bg-surface py-3 pl-4 pr-5 text-sm font-semibold shadow-lg">
              <Receipt size={18} className="text-brand" />Nuova transazione
            </button>
          </>
        )}
        <button onClick={() => setFabOpen((o) => !o)} aria-label={fabOpen ? 'Chiudi' : 'Aggiungi'} aria-expanded={fabOpen}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-onbrand shadow-lg shadow-brand/30 transition active:scale-95">
          {fabOpen ? <X size={26} /> : <Plus size={28} />}
        </button>
      </div>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line/70 bg-surface/95 backdrop-blur md:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${tab === t.id ? 'text-brand' : 'text-muted'}`}><t.icon size={22} />{t.label}</button>
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
