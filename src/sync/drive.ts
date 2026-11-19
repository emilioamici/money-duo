/** Wrapper minimale della Drive REST API v3. */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const DB_FILE_NAME = 'moneyduo-shared-db.json'

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
  capabilities?: { canEdit?: boolean }
}

const FIELDS = 'id,name,version,modifiedTime,ownedByMe,owners(emailAddress,displayName),capabilities(canEdit)'

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

/** File accessibili all'account (propri e condivisi) con "moneyduo" nel nome. */
export async function listCandidates(token: string): Promise<DriveFile[]> {
  const q = encodeURIComponent("name contains 'moneyduo' and trashed = false and mimeType != 'application/vnd.google-apps.folder'")
  const url = `${API}/files?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(${FIELDS})&supportsAllDrives=true&includeItemsFromAllDrives=true`
  return ((await (await call(token, url)).json()) as { files: DriveFile[] }).files
}

export async function getMeta(token: string, id: string): Promise<DriveFile> {
  return (await call(token, `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json()
}

export async function download(token: string, id: string): Promise<unknown> {
  return (await call(token, `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).json()
}

export async function createFile(token: string, content: string, name = DB_FILE_NAME): Promise<DriveFile> {
  const b = 'moneyduo' + Math.random().toString(36).slice(2)
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/json' })}\r\n` +
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`
  const r = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  })
  return r.json()
}

export async function updateFile(token: string, id: string, content: string): Promise<DriveFile> {
  const r = await call(token, `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  })
  return r.json()
}

/** Condivide il file con un altro account Google (ruolo: modifica). */
export async function shareFile(token: string, id: string, email: string): Promise<void> {
  await call(token, `${API}/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  })
}

/** Accetta un ID o un link Drive (…/d/<id>/… oppure ?id=<id>). */
export function parseFileId(input: string): string | null {
  const t = input.trim()
  const m = t.match(/\/d\/([\w-]{20,})/) || t.match(/[?&]id=([\w-]{20,})/) || t.match(/^([\w-]{20,})$/)
  return m ? m[1] : null
}
