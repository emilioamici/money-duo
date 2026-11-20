import { Wallet } from 'lucide-react'
import type { Transaction } from '../types'
import { t } from '../i18n'
import { isWalletTx } from '../lib/wallet'

/** Piccolo simbolo di Wallet: nella lista sta sopra l'importo delle spese arrivate da Apple Pay. */
export function WalletMark({ tx }: { tx: Pick<Transaction, 'id'> }) {
  if (!isWalletTx(tx)) return null
  return <span data-testid="wallet-mark" role="img" aria-label={t('Aggiunta via Wallet')} className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-brand"><Wallet size={12} strokeWidth={2.4} /></span>
}

/** Nel riquadro dell'importo, in alto a destra: simbolo e scritta. */
export function WalletTag({ tx }: { tx?: Pick<Transaction, 'id'> }) {
  if (!tx || !isWalletTx(tx)) return null
  return (
    <span data-testid="wallet-tag" className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand/15 py-0.5 pl-1.5 pr-2 text-[11px] font-semibold text-brand">
      <Wallet size={12} strokeWidth={2.4} />{t('Aggiunta via Wallet')}
    </span>
  )
}
