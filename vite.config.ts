import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base relativa: funziona su GitHub Pages (/nome-repo/) e in locale senza configurazione.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
})
