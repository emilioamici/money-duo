import type { Transaction } from '../types'
import { t } from '../i18n'
import { isWalletTx } from '../lib/wallet'

/**
 * Il simbolo dell'app Wallet di Apple: un portafoglio scuro con le carte colorate che spuntano.
 * Sono gli unici colori fissi dell'app (come un marchio): servono a riconoscere al volo le spese arrivate da Wallet.
 */
export function WalletGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#1c1c1e" />
      <rect x="4.5" y="5" width="15" height="2.6" rx="1.3" fill="#ff3b30" />
      <rect x="4.5" y="8.6" width="15" height="2.6" rx="1.3" fill="#ff9500" />
      <rect x="4.5" y="12.2" width="15" height="2.6" rx="1.3" fill="#ffcc00" />
      <rect x="4.5" y="15.8" width="15" height="3.2" rx="1.3" fill="#34c759" />
    </svg>
  )
}

/** Piccolo simbolo di Wallet: nella lista sta sopra l'importo delle spese arrivate da Apple Pay (badge sui toni del blu). */
export function WalletMark({ tx }: { tx: Pick<Transaction, 'id'> }) {
  if (!isWalletTx(tx)) return null
  return <span data-testid="wallet-mark" role="img" aria-label={t('Aggiunta via Wallet')} className="flex h-5 w-5 items-center justify-center rounded-full bg-trf/15"><WalletGlyph size={13} /></span>
}

/** Nel riquadro dell'importo, in alto a destra: simbolo e scritta. */
export function WalletTag({ tx }: { tx?: Pick<Transaction, 'id'> }) {
  if (!tx || !isWalletTx(tx)) return null
  return (
    <span data-testid="wallet-tag" className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-trf/15 py-0.5 pl-1 pr-2 text-[11px] font-semibold text-trf">
      <WalletGlyph size={14} />{t('Aggiunta via Wallet')}
    </span>
  )
}
