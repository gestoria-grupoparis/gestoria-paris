import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // Las pruebas unitarias no hablan con Supabase: valores fijos para que no dependan del
    // .env.local de cada máquina (en CI no existe y lib/supabase.ts falla al importarse).
    env: {
      VITE_SUPABASE_URL: 'http://supabase.unit.test',
      VITE_SUPABASE_ANON_KEY: 'clave-de-prueba',
    },
  },
})
