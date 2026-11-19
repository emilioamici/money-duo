// Service worker minimale: guscio dell'app disponibile offline.
// Le chiamate cross-origin (Google Drive / Identity) non vengono MAI intercettate né messe in cache.
const CACHE = 'moneyduo-shell-v3'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // navigazione: rete prima, cache come ripiego offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { if (!/privacy\.html$/.test(new URL(req.url).pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)) } return r }).catch(() => caches.match('./')))
    return
  }
  // asset (hash nel nome): stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return r }).catch(() => hit)
      return hit || net
    }),
  )
})

// Tocco su una notifica: riporta in primo piano l'app (o la apre)
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./'))),
  )
})

// Notifica push dal server (anche ad app chiusa). Se l'app è in primo piano non si mostra nulla: la sincronizza subito e
// mostra la propria campanella. Lo stesso `tag` della notifica locale evita doppioni.
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (wins.some((c) => c.visibilityState === 'visible')) {
        wins.forEach((c) => c.postMessage({ type: 'moneyduo-push' }))
        return undefined
      }
      return self.registration.showNotification(data.title || 'MoneyDuo', {
        body: data.body || '', tag: data.tag || undefined, icon: './icon-192.png', badge: './icon-192.png',
      })
    }),
  )
})
