import { defineConfig, devices } from '@playwright/test'
import { SUPABASE_URL } from './e2e/mock-supabase'

const PUERTO = 5179

// Los E2E corren contra el dev server con la API de Supabase simulada (e2e/mock-supabase.ts).
// Las variables VITE_* del proceso tienen prioridad sobre web/.env.local, así que el navegador
// nunca apunta a staging. Ver docs/OPERACION.md para correrlos contra staging más adelante.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PUERTO} --strictPort`,
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'e2e-anon-key' },
  },
})
