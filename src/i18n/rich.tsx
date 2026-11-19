import type { ReactNode } from 'react'
import { t } from './index'

/** Come `t` ma il testo può contenere <b>…</b>, che diventa grassetto. */
export function tb(it: string, params?: Record<string, string | number>): ReactNode {
  const parts = t(it, params).split(/(<b>.*?<\/b>)/g)
  return parts.map((p, i) => (p.startsWith('<b>') ? <b key={i}>{p.slice(3, -4)}</b> : p))
}
