import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('el chunk de entrada pesa menos de 180 kB gzip y no incluye exceljs', () => {
  const dist = join(__dirname, '..', 'dist-presupuesto')
  execSync(`npx vite build --outDir "${dist}" --emptyOutDir`, { cwd: join(__dirname, '..'), stdio: 'pipe' })
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const entrada = /src="\/assets\/(index-[^"]+\.js)"/.exec(html)![1]
  const codigo = readFileSync(join(dist, 'assets', entrada))
  expect(gzipSync(codigo).length).toBeLessThan(180 * 1024)
  expect(codigo.toString()).not.toMatch(/ExcelJS|exceljs/)
  expect(readdirSync(join(dist, 'assets')).some((f) => f.startsWith('exceljs'))).toBe(true)
}, 120_000)
