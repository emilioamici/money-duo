import { useEffect } from 'react'
import { UserCheck } from 'lucide-react'
import { useApp } from '../store/AppProvider'
import { newMember, saveMember } from '../lib/mutations'
import { nowIso } from '../lib/ids'
import { Sheet, MemberAvatar } from './ui'

/**
 * Collega l'account Google al membro della famiglia:
 * - invitato per email: il membro esiste già → si segna il primo accesso
 * - database migrato o file condiviso a mano: se ci sono membri senza account chiede «chi sei?», altrimenti aggiunge chi accede
 */
export function IdentityGuard() {
  const { db, commit, me, sync } = useApp()
  const ready = sync.status === 'synced' && !!sync.email && sync.reconciled
  const unclaimed = db.members.filter((m) => m.active && !m.email)

  useEffect(() => {
    if (me && !me.joinedAt) commit((d) => saveMember(d, { ...me, joinedAt: nowIso() }))
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  // nessun membro da associare: chi accede viene aggiunto alla famiglia.
  // Le condizioni sono rivalutate sul DB più recente dentro commit: l'operazione è idempotente (mai membri duplicati).
  useEffect(() => {
    if (!ready || me || unclaimed.length > 0) return
    const mail = sync.email!.toLowerCase()
    commit((d) => (d.members.some((m) => m.active && (!m.email || m.email.toLowerCase() === mail)) ? d : saveMember(d, newMember(d, sync.name || mail.split('@')[0], sync.email, true))))
  }, [ready, me, unclaimed.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || me || unclaimed.length === 0) return null
  const claim = (id: string) => commit((d) => saveMember(d, { ...d.members.find((m) => m.id === id)!, email: sync.email, joinedAt: nowIso() }))
  const addNew = () => commit((d) => (d.members.some((m) => m.active && m.email?.toLowerCase() === sync.email!.toLowerCase()) ? d : saveMember(d, newMember(d, sync.name || sync.email!.split('@')[0], sync.email, true))))

  return (
    <Sheet open onClose={() => undefined} title="Chi sei?">
      <p className="mb-4 flex items-start gap-2 text-sm text-muted"><UserCheck size={18} className="mt-0.5 shrink-0 text-brand" />Hai effettuato l'accesso come <b className="text-ink">{sync.email}</b>. Scegli quale membro della famiglia sei: l'account verrà associato e vedrai i tuoi conti.</p>
      <div className="space-y-2">
        {unclaimed.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-line/40" onClick={() => claim(m.id)}>
            <MemberAvatar name={m.name} color={m.color} /><span className="font-semibold">Sono {m.name}</span>
          </button>
        ))}
        <button className="btn-soft w-full" onClick={addNew}>Nessuno di questi: aggiungimi come nuovo membro</button>
      </div>
    </Sheet>
  )
}
