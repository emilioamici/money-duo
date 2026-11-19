import type { Db } from '../types'
import { isPristine } from '../lib/defaults'
import { engine } from '../sync/engine'
import { ask } from './dialogs'

/**
 * Collega il database Drive indicato. Se sul dispositivo ci sono dati propri (non i dati di esempio)
 * chiede se unirli al file o usare solo il file. Ritorna false se l'utente annulla.
 */
export async function linkDatabase(db: Db, fileId: string): Promise<boolean> {
  const { file, remote } = await engine.inspect(fileId)
  let mode: 'merge' | 'replace' = 'replace'
  if (!isPristine(db)) {
    const r = await ask({
      title: `Collegare «${file.name}»`,
      message: `Su questo dispositivo ci sono dati non ancora presenti nel file (${db.transactions.length} transazioni locali). Vuoi unirli ai dati del file Drive o usare solo il file Drive? In quel caso i dati locali verranno scartati.`,
      ok: 'Unisci ai dati del file',
      alt: 'Usa solo il file Drive',
    })
    if (!r) return false
    mode = r === 'ok' ? 'merge' : 'replace'
  }
  await engine.link(file, remote, mode)
  return true
}
