import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['tests/db/global-setup.ts'],
    setupFiles: ['tests/db/setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
