import { expect, test } from 'vitest'
import { extraerDominio, normalizarDocumento, normalizarNombre } from './normalizar'

test('extraerDominio', () => {
  expect(extraerDominio('ACOSTA BRUNO DANIEL AF869NV')).toBe('AF869NV')
  expect(extraerDominio('HEBRAL JUAN KQC140')).toBe('KQC140')
  expect(extraerDominio('AE3IIFY')).toBe('AE311FY')
  expect(extraerDominio('PEREZ JUAN CARLOS')).toBeNull()
  expect(extraerDominio('Chapa Patente: aa111aa')).toBe('AA111AA')
  expect(extraerDominio('Chapa Patente: AC1lIBD')).toBe('AC111BD')
})

test('normalizarNombre', () => {
  expect(normalizarNombre('Pérez  Juan Manuel AE197DG')).toBe('PEREZ JUAN MANUEL')
  expect(normalizarNombre('  muñoz, josé ')).toBe('MUNOZ JOSE')
})

test('normalizarDocumento', () => {
  expect(normalizarDocumento('DNI 30.123.456')).toBe('30123456')
  expect(normalizarDocumento('20-30123456-7')).toBe('20301234567')
  expect(normalizarDocumento('123')).toBeNull()
})
