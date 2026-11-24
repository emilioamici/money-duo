import { t } from '../i18n'
import { bridgeFetch } from './bridge'
/** Wrapper minimale della Drive REST API v3. */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** Marcatore pubblico (`properties`, non `appProperties`) per riconoscere i database MoneyDuo. */
export const DB_PROPERTY = { key: 'moneyduo', value: 'db' }
/** Nome dei file creati prima dell'introduzione delle famiglie (ancora riconosciuto). */
export const LEGACY_NAME = /^moneyduo-(shared-)?db/i

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface DriveFile {
  id: string
  name: string
  version: string
  modifiedTime: string
  ownedByMe?: boolean
  owners?: Array<{ emailAddress?: string; displayName?: string }>
  parents?: string[]
  properties?: Record<string, string>
  capabilities?: { canEdit?: boolean; canShare?: boolean }
}

export interface DriveFolder {
  id: string
  name: string
}

const FIELDS = 'id,name,version,modifiedTime,ownedByMe,owners(emailAddress,displayName),parents,properties,capabilities(canEdit,canShare)'
const q = encodeURIComponent
const enc = encodeURIComponent

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (!r.ok) {
    let msg = r.statusText
    try { msg = ((await r.json()) as { error?: { message?: string } }).error?.message || msg } catch { /* corpo non JSON */ }
    throw new DriveError(r.status, msg)
  }
  return r
}

export async function about(token: string): Promise<{ email: string; name: string }> {
  const j = (await (await call(token, `${API}/about?fields=user(displayName,emailAddress)`)).json()) as { user: { displayName: string; emailAddress: string } }
  return { email: j.user.emailAddress, name: j.user.displayName }
}

export const isDatabaseFile = (f: DriveFile): boolean => f.properties?.[DB_PROPERTY.key] === DB_PROPERTY.value || LEGACY_NAME.test(f.name)

/** File accessibili all'account (propri e condivisi): database marcati + file con "moneyduo" nel nome. */
export async function listCandidates(token: string): Promise<DriveFile[]> {
  const query = q(`(properties has { key='${DB_PROPERTY.key}' and value='${DB_PROPERTY.value}' } or name contains 'moneyduo') and trashed = false and mimeType != '${FOLDER_MIME}'`)
  const url = `${API}/files?q=${query}&orderBy=modifiedTime desc&pageSize=30&fields=files(${FIELDS})&supportsAllDrives=true&includeItemsFromAllDrives=true`
  return ((await (await call(token, url)).json()) as { files: DriveFile[] }).files
}

// ---------- famiglie aperte dal ponte del Worker (senza accesso diretto al file) ----------
const BRIDGED_KEY = 'moneyduo:bridged'
const bridgedIds = (): string[] => { try { return JSON.parse(localStorage.getItem(BRIDGED_KEY) ?? '[]') as string[] } catch { return [] } }
export const isBridged = (fileId: string): boolean => bridgedIds().includes(fileId)
export function setBridged(fileId: string, on: boolean): void {
  try {
    const rest = bridgedIds().filter((x) => x !== fileId)
    localStorage.setItem(BRIDGED_KEY, JSON.stringify(on ? [...rest, fileId] : rest))
  } catch { /* noop */ }
}

/** Chiamata al ponte con gli stessi errori di Drive: 401 = sessione scaduta, 403/404/410 = niente accesso (con il messaggio del server). */
async function bridgeCall(token: string, path: string, fileId: string, body?: string, expectedVersion?: string): Promise<Response> {
  const r = await bridgeFetch(`${path}?fileId=${enc(fileId)}${expectedVersion ? `&expectedVersion=${enc(expectedVersion)}` : ''}`, token, body)
  if (r.ok) return r
  let msg = r.statusText
  try { msg = ((await r.json()) as { error?: string }).error || msg } catch { /* corpo non JSON */ }
  throw new DriveError([403, 404, 410].includes(r.status) ? 404 : r.status, msg) // 409 resta 409: versione cambiata
}

export async function getMeta(token: string, id: string): Promise<DriveFile> {
  if (isBridged(id)) return (await bridgeCall(token, '/db/meta', id)).json()
  return (await call(token, `${API}/files/${enc(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json()
}

export async function download(token: string, id: string): Promise<unknown> {
  if (isBridged(id)) return (await bridgeCall(token, '/db/read', id)).json()
  return (await call(token, `${API}/files/${enc(id)}?alt=media&supportsAllDrives=true`)).json()
}

/** Crea il database nella cartella scelta (null = radice di Drive). `writersCanShare: false`: solo il proprietario può invitare. */
export async function createFile(token: string, content: string, name: string, folderId: string | null): Promise<DriveFile> {
  const b = 'moneyduo' + Math.random().toString(36).slice(2)
  const metadata = {
    name, mimeType: 'application/json', writersCanShare: false,
    properties: { [DB_PROPERTY.key]: DB_PROPERTY.value },
    ...(folderId && folderId !== 'root' ? { parents: [folderId] } : {}),
  }
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`
  const r = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  })
  return r.json()
}

/** `expectedVersion`: per i file aperti dal ponte, la versione letta; se su Drive è cambiata il server risponde 409 (DriveError 409). */
export async function updateFile(token: string, id: string, content: string, expectedVersion?: string): Promise<DriveFile> {
  if (isBridged(id)) return (await bridgeCall(token, '/db/write', id, content, expectedVersion ?? '0')).json()
  const r = await call(token, `${UPLOAD}/files/${enc(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  })
  return r.json()
}

// ---------- cartelle ----------

/** Sottocartelle di una cartella ('root' = Il mio Drive). */
export async function listFolders(token: string, parentId: string): Promise<DriveFolder[]> {
  const out: DriveFolder[] = []
  let page = ''
  for (let i = 0; i < 5; i++) {
    const query = q(`mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`)
    const url = `${API}/files?q=${query}&orderBy=name&pageSize=100&fields=nextPageToken,files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${enc(page)}` : ''}`
    const j = (await (await call(token, url)).json()) as { files: DriveFolder[]; nextPageToken?: string }
    out.push(...j.files)
    if (!j.nextPageToken) break
    page = j.nextPageToken
  }
  return out
}

export async function createFolder(token: string, name: string, parentId: string): Promise<DriveFolder> {
  const r = await call(token, `${API}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId !== 'root' ? { parents: [parentId] } : {}) }),
  })
  return r.json()
}

export async function folderName(token: string, id: string): Promise<string> {
  if (id === 'root') return t('Il mio Drive')
  return ((await (await call(token, `${API}/files/${enc(id)}?fields=name&supportsAllDrives=true`)).json()) as { name: string }).name
}

/** Sposta il file in un'altra cartella (solo il proprietario). */
export async function moveFile(token: string, id: string, newParentId: string, oldParents: string[]): Promise<DriveFile> {
  const remove = oldParents.filter((p) => p !== newParentId).join(',')
  const url = `${API}/files/${enc(id)}?addParents=${enc(newParentId)}${remove ? `&removeParents=${enc(remove)}` : ''}&fields=${FIELDS}&supportsAllDrives=true`
  return (await call(token, url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
}

// ---------- condivisione ----------

/** Invita un account Google con permesso di modifica. */
export async function shareFile(token: string, id: string, email: string, message: string): Promise<void> {
  await call(token, `${API}/files/${enc(id)}/permissions?sendNotificationEmail=true&emailMessage=${enc(message)}&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  })
}

/** Revoca l'accesso a un account (non fa nulla se non aveva permessi). */
export async function removeShare(token: string, id: string, email: string): Promise<boolean> {
  const j = (await (await call(token, `${API}/files/${enc(id)}/permissions?fields=permissions(id,emailAddress,role,type)&supportsAllDrives=true`)).json()) as {
    permissions: Array<{ id: string; emailAddress?: string; role: string }>
  }
  const hit = j.permissions.filter((p) => p.emailAddress?.toLowerCase() === email.toLowerCase() && p.role !== 'owner')
  for (const p of hit) await call(token, `${API}/files/${enc(id)}/permissions/${enc(p.id)}?supportsAllDrives=true`, { method: 'DELETE' })
  return hit.length > 0
}

/** Accetta un ID o un link Drive (…/d/<id>/… oppure ?id=<id>). */
export function parseFileId(input: string): string | null {
  const t = input.trim()
  const m = t.match(/\/d\/([\w-]{20,})/) || t.match(/[?&]id=([\w-]{20,})/) || t.match(/^([\w-]{20,})$/)
  return m ? m[1] : null
}
