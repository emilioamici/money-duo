import { useEffect, useRef, useState } from 'react'
import { ListChecks, PieChart, Plus, Settings, Wallet } from 'lucide-react'
import { AppProvider, useApp } from './store/AppProvider'
import { DialogHost } from './components/dialogs'
import { TransactionForm } from './components/TransactionForm'
import { HomePage } from './pages/HomePage'
import { StatsPage } from './pages/StatsPage'
import { AccountsPage } from './pages/AccountsPage'
import { SettingsPage } from './pages/SettingsPage'
import { engine } from './sync/engine'
import { Gate } from './components/Gate'
import { IdentityGuard } from './components/IdentityGuard'

type Tab = 'home' | 'stats' | 'accounts' | 'settings'
const TABS: Array<{ id: Tab; label: string; icon: typeof Plus }> = [
  { id: 'home', label: 'Transazioni', icon: ListChecks },
  { id: 'stats', label: 'Statistiche', icon: PieChart },
  { id: 'accounts', label: 'Conti', icon: Wallet },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
]

function Shell() {
  const { txForm, openTx, closeTx, sync } = useApp()
  const [tab, setTab] = useState<Tab>('home')
  const syncRef = useRef<HTMLDivElement>(null)
  const goSync = () => { setTab('settings'); setTimeout(() => syncRef.current?.scrollIntoView({ behavior: 'smooth' }), 80) }

  useEffect(() => { document.title = 'MoneyDuo' }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-5xl">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-line/70 p-4 md:flex">
        <p className="mb-4 px-3 text-xl font-extrabold tracking-tight">Money<span className="text-brand">Duo</span></p>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === t.id ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-line/50'}`}><t.icon size={20} />{t.label}</button>
        ))}
        <button className="btn-primary mt-4" onClick={() => openTx()}><Plus size={18} />Nuova transazione</button>
      </aside>

      <main className="min-w-0 flex-1 pb-36 md:pb-10">
        {sync.status === 'auth' && (
          <button onClick={() => void engine.signIn().catch(() => undefined)} className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-xl bg-exp/10 p-3 text-left text-sm font-medium text-exp pt-safe">
            Sessione Google scaduta: tocca per riconnetterti. Le modifiche restano salvate in locale e verranno inviate dopo.
          </button>
        )}
        {tab === 'home' && <HomePage onOpenSync={goSync} />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'accounts' && <AccountsPage />}
        {tab === 'settings' && <SettingsPage syncRef={syncRef} />}
      </main>

      <button onClick={() => openTx()} aria-label="Aggiungi transazione"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-onbrand shadow-lg shadow-brand/30 transition active:scale-95 md:hidden">
        <Plus size={28} />
      </button>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line/70 bg-surface/95 backdrop-blur md:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${tab === t.id ? 'text-brand' : 'text-muted'}`}><t.icon size={22} />{t.label}</button>
        ))}
      </nav>

      <IdentityGuard />
      {txForm && <TransactionForm key={txForm.tx?.id ?? 'new'} state={txForm} onClose={closeTx} />}
    </div>
  )
}

/** Senza un database collegato si passa dal login Google; con il database collegato l'app funziona anche offline. */
function Root() {
  const { sync } = useApp()
  return <>{sync.fileId ? <Shell /> : <Gate />}<DialogHost /></>
}

export default function App() {
  return <AppProvider><Root /></AppProvider>
}
