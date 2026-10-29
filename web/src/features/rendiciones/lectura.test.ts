import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { decidirOcr, hashArchivo } from './lectura'

test('decidirOcr: sin texto útil va a OCR; un recibo con texto no', () => {
  expect(decidirOcr('')).toBe(true)
  expect(decidirOcr('  \n 12 / ab ')).toBe(true)
  expect(decidirOcr(readFileSync(join(__dirname, '__fixtures__', 'recibo-dnrpa.txt'), 'utf8'))).toBe(false)
})

test('hashArchivo: sha256 en hexadecimal', async () => {
  expect(await hashArchivo(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
