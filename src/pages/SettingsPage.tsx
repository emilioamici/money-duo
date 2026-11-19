import { useEffect, useRef, useState } from 'react'
import { BellRing, ChevronRight, Cloud, Database, Download, Palette, RotateCcw, ShieldCheck, Tags, Upload, Users } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { NotificationBell } from '../components/Notifications'
import { SyncCard, STATUS_LABEL } from '../components/SyncCard'
import { Accordion } from '../components/ui'
import { MascotPeek } from '../components/Mascots'
import { AppearanceCard } from '../components/AppearanceCard'
import { THEME_NAME, getTheme } from '../lib/theme'
import { getLangPref } from '../i18n'
import { FamilyCard } from '../components/FamilyCard'
import { NotificationsCard } from '../components/NotificationsCard'
import { ask } from '../components/dialogs'
import { CategoriesPage } from './CategoriesPage'
import { mergeDb, parseDb, replaceData } from '../lib/merge'
import { t } from '../i18n'

const LANG_SHORT = { auto: 'Auto', it: 'Italiano', en: 'English' } as const
const OPEN_KEY = 'moneyduo:settingsOpen'
type Section = 'look' | 'family' | 'sync' | 'notif' | 'data'
const loadOpen = (): Partial<Record<Section, boolean>> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') } catch { return {} } }

/** Impostazioni a schede: ognuna si apre e si chiude (lo stato si ricorda su questo dispositivo). `openSync` aumenta quando si arriva dal pulsante di sincronizzazione. */
export function SettingsPage({ syncRef, openSync = 0 }: { syncRef: React.RefObject<HTMLDivElement>; openSync?: number }) {
  const { db, commit, resetLocal, sync, prefs } = useApp()
  const [open, setOpen] = useState(loadOpen)
  const flip = (k: Section) => setOpen((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* noop */ } return n })
  useEffect(() => { if (openSync > 0) setOpen((o) => (o.sync ? o : { ...o, sync: true })) }, [openSync])
  const [sub, setSub] = useState<'cats' | null>(null)
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)

  if (sub === 'cats') return <CategoriesPage onBack={() => setSub(null)} />

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `moneyduo-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setMsg(t('Backup esportato. Conservalo fuori dal repository Git.'))
  }

  const importJson = async (f: File) => {
    try {
      const incoming = parseDb(JSON.parse(await f.text()))
      const r = await ask({
        title: t('Importa backup'), ok: t('Unisci ai dati attuali'), alt: t('Sostituisci tutto'),
        message: t('Il file contiene {a} conti e {b} transazioni.\n«Unisci» mantiene i dati attuali; «Sostituisci» li rimpiazza.', { a: incoming.accounts.length, b: incoming.transactions.length }),
      })
      if (!r) return
      commit((d) => (r === 'ok' ? mergeDb(d, { ...incoming, meta: { ...incoming.meta, dbId: d.meta.dbId } }) : replaceData(d, incoming)))
      setMsg(t('Backup importato.'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('File non valido.'))
    }
  }

  const reset = async () => {
    if (await ask({ title: t('Ripristinare i dati iniziali?'), message: t('Cancella i dati salvati in questo browser e scollega Drive. Il file su Drive NON viene toccato.'), ok: t('Ripristina'), danger: true })) resetLocal()
  }

  return (
    <div>
      <div className="px-4 pb-3 pt-safe"><div className="flex items-center justify-between pt-3"><h1 className="text-xl font-extrabold tracking-tight">{t('Impostazioni')}</h1><NotificationBell /></div></div>
      <div className="space-y-3 px-4">
        <MascotPeek kind="pair">
          <Accordion title={t('Aspetto')} icon={<Palette size={20} />} open={!!open.look} onToggle={() => flip('look')} summary={`${t(THEME_NAME[getTheme()])} · ${LANG_SHORT[getLangPref()]}`}>
            <AppearanceCard />
          </Accordion>
        </MascotPeek>

        <Accordion title={t('Famiglia')} icon={<Users size={20} />} open={!!open.family} onToggle={() => flip('family')}
          summary={`${db.family.name} · ${db.members.filter((m) => m.active).length === 1 ? t('1 membro') : t('{n} membri', { n: db.members.filter((m) => m.active).length })}`}>
          <FamilyCard />
        </Accordion>

        <div ref={syncRef}>
          <Accordion title={t('Sincronizzazione e account')} icon={<Cloud size={20} />} open={!!open.sync} onToggle={() => flip('sync')}
            summary={`${t(STATUS_LABEL[sync.status] ?? '')}${sync.email ? ` · ${sync.email}` : ''}`}>
            <SyncCard />
          </Accordion>
        </div>

        <Accordion title={t('Notifiche')} icon={<BellRing size={20} />} open={!!open.notif} onToggle={() => flip('notif')}
          summary={prefs.systemNotif || prefs.pushEnabled ? t('Attive su questo dispositivo') : t('Disattivate (solo la campanella)')}>
          <NotificationsCard />
        </Accordion>

        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => setSub('cats')}>
          <Tags className="text-brand" /><span className="flex-1"><span className="block font-bold">{t('Categorie e sottocategorie')}</span><span className="text-xs text-muted">{t('Aggiungi, modifica, nascondi o mostra')}</span></span><ChevronRight className="text-muted" />
        </button>

        <Accordion title={t('Backup e dati')} icon={<Database size={20} />} open={!!open.data} onToggle={() => flip('data')}
          summary={t('{a} conti · {b} transazioni', { a: db.accounts.length, b: db.transactions.length })}>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft" onClick={exportJson}><Download size={18} />{t('Esporta JSON')}</button>
            <button className="btn-soft" onClick={() => file.current?.click()}><Upload size={18} />{t('Importa JSON')}</button>
          </div>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = '' }} />
          {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
          <button className="btn-danger mt-3 w-full" onClick={reset}><RotateCcw size={18} />{t('Ripristina dati iniziali')}</button>
        </Accordion>

        <p className="flex gap-2 px-1 pb-4 text-xs text-muted"><ShieldCheck size={16} className="shrink-0" />{t('I tuoi dati vivono solo in questo browser e nel file su Google Drive scelto da te: nessun server di terze parti e nessun dato nel repository del codice.')}</p>
      </div>
    </div>
  )
}
