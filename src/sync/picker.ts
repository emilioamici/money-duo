import { t } from '../i18n'

/**
 * Selettore di file di Google (Google Picker). Serve quando l'app usa il permesso ristretto `drive.file`:
 * l'app vede solo i file che ha creato lei o che tu scegli qui, quindi il database condiviso da un altro membro
 * e la cartella dove creare un nuovo database si scelgono con il selettore.
 *
 * Si attiva solo se sono configurate la chiave API e il numero del progetto (variabili del repository
 * `VITE_GOOGLE_API_KEY` e `VITE_GOOGLE_APP_ID`); altrimenti l'app usa il permesso su tutto Drive, come prima.
 */

const KEY_STORE = 'moneyduo:googleApiKey'
const APP_STORE = 'moneyduo:googleAppId'
const read = (k: string): string => { try { return localStorage.getItem(k) || '' } catch { return '' } }

/** Dalla build; solo in sviluppo (senza variabili) si leggono da `localStorage`. */
export const googleApiKey = (): string => ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) || read(KEY_STORE)).trim()
export const googleAppId = (): string => ((import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) || read(APP_STORE)).trim()
export const pickerConfigured = (): boolean => !!googleApiKey() && !!googleAppId()

export interface Picked { id: string; name: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any
  }
}

let loading: Promise<void> | null = null

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const fail = () => { loading = null; reject(new Error(t('Impossibile caricare il selettore di Google (sei offline?).'))) }
    const ready = () => window.gapi.load('picker', { callback: () => resolve(), onerror: fail })
    if (window.gapi?.load) return ready()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.onload = ready
    s.onerror = fail
    document.head.appendChild(s)
  })
  return loading
}

/** Apre il selettore con le viste date; ritorna il file scelto, oppure null se si annulla. */
async function open(token: string, views: (g: any) => any[], title: string): Promise<Picked | null> {
  if (!pickerConfigured()) throw new Error(t('Selettore di Google non configurato.'))
  await loadPicker()
  const g = window.google.picker
  return new Promise<Picked | null>((resolve) => {
    let b = new g.PickerBuilder()
    for (const v of views(g)) b = b.addView(v)
    const picker = b
      .setOAuthToken(token)
      .setDeveloperKey(googleApiKey())
      .setAppId(googleAppId())
      .setTitle(title)
      .setLocale(document.documentElement.lang === 'en' ? 'en' : 'it')
      .setCallback((data: any) => {
        const action = data?.[g.Response.ACTION]
        if (action === g.Action.PICKED) {
          const d = data[g.Response.DOCUMENTS]?.[0]
          resolve(d ? { id: d[g.Document.ID], name: d[g.Document.NAME] } : null)
        } else if (action === g.Action.CANCEL) resolve(null)
      })
      .build()
    picker.setVisible(true)
  })
}

/** Sceglie il file del database di famiglia (anche uno condiviso da un altro account). */
export function pickDatabase(token: string): Promise<Picked | null> {
  return open(token, (g) => [
    new g.DocsView(g.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(false).setOwnedByMe(false),
    new g.DocsView(g.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(false),
  ], t('Scegli il database di famiglia'))
}

/** Sceglie una cartella del proprio Drive. */
export function pickFolder(token: string): Promise<Picked | null> {
  return open(token, (g) => [
    new g.DocsView(g.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder'),
  ], t('Scegli la cartella'))
}
