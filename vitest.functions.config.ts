import { defineConfig } from 'vitest/config'

// Tests de la lógica de las Edge Functions (sin base de datos ni Deno).
export default defineConfig({
  test: { include: ['tests/functions/**/*.test.ts'] },
})
