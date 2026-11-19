import { useState } from 'react'
import type { Account, AccountGroup } from '../types'
import { useApp } from '../store/AppProvider'
import { centsToInput, parseAmount } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { accountInUse, deleteAccount, nextOrder, saveAccount } from '../lib/mutations'
import { Field, MemberChips, Sheet, Toggle } from './ui'
import { ask } from './dialogs'

export const GROUP_LABEL: Record<AccountGroup, string> = {
  cash: 'Contanti', bank: 'Conto corrente', card: 'Carta', savings: 'Risparmi', investment: 'Investimenti', other: 'Altro',
}

export function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { db, commit, me } = useApp()
  const [name, setName] = useState(account?.name ?? '')
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? 'bank')
  const [everyone, setEveryone] = useState(account ? account.members.length === 0 : false)
  const [ids, setIds] = useState<string[]>(account ? account.members : me ? [me.id] : [])
  const [initial, setInitial] = useState(account ? centsToInput(account.initialBalance) : '')
  const [exclude, setExclude] = useState(account?.excludeFromTotal ?? false)
  const [hidden, setHidden] = useState(account?.hidden ?? false)
  const [error, setError] = useState('')
  const used = account ? accountInUse(db, account.id) : false

  const save = () => {
    if (!name.trim()) return setError('Inserisci un nome.')
    if (!everyone && ids.length === 0) return setError('Scegli almeno un membro oppure «Tutta la famiglia».')
    const bal = initial.trim() ? parseAmount(initial) : 0
    if (bal === null) return setError('Saldo iniziale non valido.')
    const t = nowIso()
    commit((d) => saveAccount(d, {
      id: account?.id ?? uid(), name: name.trim(), group, members: everyone ? [] : ids, initialBalance: bal, excludeFromTotal: exclude, hidden,
      order: account?.order ?? nextOrder(d.accounts), createdAt: account?.createdAt ?? t, updatedAt: t,
    }))
    onClose()
  }

  const remove = async () => {
    if (account && (await ask({ title: 'Eliminare il conto?', message: 'Il conto non ha storico, quindi può essere eliminato.', ok: 'Elimina', danger: true }))) {
      commit((d) => deleteAccount(d, account.id))
      onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title={account ? 'Modifica conto' : 'Nuovo conto'} footer={
      <div className="flex gap-2">
        {account && !used && <button className="btn-danger" onClick={remove}>Elimina</button>}
        <button className="btn-primary flex-1" onClick={save}>Salva</button>
      </div>
    }>
      <Field label="Nome"><input className="input" autoFocus={!account} placeholder="Es. Conto corrente" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Gruppo / tipologia">
        <select className="input" value={group} onChange={(e) => { const g = e.target.value as AccountGroup; setGroup(g); if (!account && g === 'investment') setExclude(true) }}>
          {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Condiviso con" hint="Un solo membro = conto personale. Chi non è selezionato non lo vede nell'app (il file su Drive resta però leggibile da tutta la famiglia).">
        <div className="mb-2"><Toggle checked={everyone} onChange={setEveryone} label="Tutta la famiglia" hint="Include anche i membri che verranno aggiunti in futuro" /></div>
        {!everyone && <MemberChips multi value={ids} onChange={setIds} includeIds={account?.members ?? []} />}
      </Field>
      <Field label="Saldo iniziale (opzionale)"><input className="input" inputMode="decimal" placeholder="0,00" value={initial} onChange={(e) => setInitial(e.target.value)} /></Field>
      <Toggle checked={exclude} onChange={setExclude} label="Escludi dal totale liquidità" hint="Per investimenti o fondi vincolati" />
      <Toggle checked={hidden} onChange={setHidden} label="Nascondi conto" hint="Lo storico resta salvato; riattivabile da Conti → Mostra nascosti" />
      {used && account && <p className="text-xs text-muted">Il conto ha transazioni collegate: non può essere eliminato, ma solo nascosto.</p>}
      {error && <p className="mt-2 text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
