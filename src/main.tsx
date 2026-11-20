import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Background } from './components/Background'
import './index.css'
import { initCache } from './store/cache'
import { consumeSessionFromUrl } from './sync/auth'

consumeSessionFromUrl() // ritorno dal login con il server: salva la sessione e ripulisce l'indirizzo

// la copia locale (IndexedDB) si legge prima di mostrare l'app, così parte subito con i dati
void initCache().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><Background /><App /></StrictMode>))

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => undefined) })
}
