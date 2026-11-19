import { useEffect, useState } from 'react'
import { Sheet } from './ui'
import { t } from '../i18n'

/** Dialogo di conferma imperativo: `await ask({...})` -> 'ok' | 'alt' | null (annullato). */
export interface AskOptions {
  title: string
  message: string
  ok: string
  alt?: string
  danger?: boolean
}

type Pending = AskOptions & { resolve: (v: 'ok' | 'alt' | null) => void }
let show: ((p: Pending) => void) | null = null

export function ask(opts: AskOptions): Promise<'ok' | 'alt' | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(`${opts.title}\n\n${opts.message}`) ? 'ok' : null)
    show({ ...opts, resolve })
  })
}

export function DialogHost() {
  const [p, setP] = useState<Pending | null>(null)
  useEffect(() => { show = setP; return () => { show = null } }, [])
  if (!p) return null
  const done = (v: 'ok' | 'alt' | null) => { p.resolve(v); setP(null) }
  return (
    <Sheet open onClose={() => done(null)} title={p.title}>
      <p className="whitespace-pre-line text-sm text-muted">{p.message}</p>
      <div className="mt-5 flex flex-col gap-2">
        <button className={p.danger ? 'btn-danger' : 'btn-primary'} onClick={() => done('ok')}>{p.ok}</button>
        {p.alt && <button className="btn-soft" onClick={() => done('alt')}>{p.alt}</button>}
        <button className="btn-ghost" onClick={() => done(null)}>{t('Annulla')}</button>
      </div>
    </Sheet>
  )
}
