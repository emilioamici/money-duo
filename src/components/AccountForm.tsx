import { useState } from 'react'
import type { Account, AccountGroup } from '../types'
import { useApp } from '../store/AppProvider'
import { centsToInput, parseAmount } from '../lib/format'
import { nowIso, uid } from '../lib/ids'
import { accountInUse, deleteAccount, nextOrder, saveAccount } from '../lib/mutations'
import { Field, MemberChips, Sheet, Toggle } from './ui'
import { ask } from './dialogs'
import { t } from '../i18n'

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
  const [split, setSplit] = useState(account?.splitAccount ?? false)
  const [error, setError] = useState('')
  const used = account ? accountInUse(db, account.id) : false

  const save = () => {
    if (!name.trim()) return setError(t('Inserisci un nome.'))
    if (!everyone && ids.length === 0) return setError(t('Scegli almeno un membro oppure «Tutta la famiglia».'))
    const bal = initial.trim() ? parseAmount(initial) : 0
    if (bal === null) return setError(t('Saldo iniziale non valido.'))
    const now = nowIso()
    commit((d) => saveAccount(d, {
      id: account?.id ?? uid(), name: name.trim(), group, members: everyone ? [] : ids, initialBalance: bal, excludeFromTotal: exclude, splitAccount: split && !everyone && ids.length === 1, hidden,
      order: account?.order ?? nextOrder(d.accounts), by: me?.id ?? null, createdAt: account?.createdAt ?? now, updatedAt: now,
    }))
    onClose()
  }

  const remove = async () => {
    if (account && (await ask({ title: t('Eliminare il conto?'), message: t('Il conto non ha storico, quindi può essere eliminato.'), ok: t('Elimina'), danger: true }))) {
      commit((d) => deleteAccount(d, account.id))
      onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title={account ? t('Modifica conto') : t('Nuovo conto')} footer={
      <div className="flex gap-2">
        {account && !used && <button className="btn-danger" onClick={remove}>{t('Elimina')}</button>}
        <button className="btn-primary flex-1" onClick={save}>{t('Salva')}</button>
      </div>
    }>
      <Field label={t('Nome')}><input className="input" autoFocus={!account} placeholder={t('Es. Conto corrente')} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('Gruppo / tipologia')}>
        <select className="input" value={group} onChange={(e) => { const g = e.target.value as AccountGroup; setGroup(g); if (!account && g === 'investment') setExclude(true) }}>
          {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
      </Field>
      <Field label={t('Condiviso con')} hint={t('Un solo membro = conto personale. Chi non è selezionato non lo vede nell\'app (il file su Drive resta però leggibile da tutta la famiglia).')}>
        <div className="mb-2"><Toggle checked={everyone} onChange={setEveryone} label={t('Tutta la famiglia')} hint={t('Include anche i membri che verranno aggiunti in futuro')} /></div>
        {!everyone && <MemberChips multi value={ids} onChange={setIds} includeIds={account?.members ?? []} />}
      </Field>
      <Field label={t('Saldo iniziale (opzionale)')}><input className="input" inputMode="decimal" placeholder={t('0,00')} value={initial} onChange={(e) => setInitial(e.target.value)} /></Field>
      {!everyone && ids.length === 1 && (
        <Toggle checked={split} onChange={setSplit} label={t('Conto Split')} hint={t('Il conto che si usa per dividere le spese: uno solo per persona, preselezionato quando paghi uno split. Il suo saldo è sempre zero, qualunque spesa ci finisca.')} />
      )}
      <Toggle checked={exclude} onChange={setExclude} label={t('Escludi dal totale liquidità')} hint={t('Per investimenti o fondi vincolati')} />
      <Toggle checked={hidden} onChange={setHidden} label={t('Nascondi conto')} hint={t('Lo storico resta salvato; riattivabile da Conti → Mostra nascosti')} />
      {used && account && <p className="text-xs text-muted">{t('Il conto ha transazioni collegate: non può essere eliminato, ma solo nascosto.')}</p>}
      {error && <p className="mt-2 text-sm font-medium text-exp">{error}</p>}
    </Sheet>
  )
}
