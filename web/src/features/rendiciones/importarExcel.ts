// Importa la planilla mensual desde Excel (.xlsx) o CSV: busca la fila de encabezados con
// NOMBRE, PAGO y HONORARIOS (sin importar mayúsculas ni tildes) y lee las filas de abajo.
import { parsearMonto } from './montos'
import { extraerDominio, normalizarNombre } from './normalizar'
import type { FilaPlanilla } from './parsers'

const clave = (s: unknown) => normalizarNombre(String(s ?? ''))

/** Celda a centavos sin aritmética de punto flotante: un número se pasa a texto con 2 decimales. */
function aCentavos(v: unknown): bigint | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? parsearMonto(v.toFixed(2)) : null
  if (typeof v === 'object' && v && 'result' in v) return aCentavos((v as { result: unknown }).result)
  return parsearMonto(String(v))
}

function desdeTabla(filas: unknown[][]): FilaPlanilla[] {
  const iEnc = filas.findIndex((f) => f.some((c) => clave(c) === 'NOMBRE'))
  if (iEnc < 0) throw new Error('No se encontró la columna NOMBRE (con PAGO y HONORARIOS) en la planilla.')
  const enc = filas[iEnc].map(clave)
  const col = (n: string) => enc.findIndex((c) => c === n || c.startsWith(n))
  const [cn, cp, ch] = [col('NOMBRE'), col('PAGO'), col('HONORARIO')]
  if (cp < 0 || ch < 0) throw new Error('La planilla tiene NOMBRE pero le faltan las columnas PAGO u HONORARIOS.')
  const salida: FilaPlanilla[] = []
  for (const f of filas.slice(iEnc + 1)) {
    const crudo = String(f[cn] ?? '').trim()
    const nombre = normalizarNombre(crudo)
    if (!nombre || /^(TOTAL|SUBTOTAL)\b/.test(nombre)) continue
    const pago = aCentavos(f[cp])
    const hon = aCentavos(f[ch])
    if (pago === null || hon === null) continue
    salida.push({ nombre, dominio: extraerDominio(crudo), pago_cents: pago, honorarios_cents: hon })
  }
  return salida
}

function partirCsv(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = (lineas[0]?.split(';').length ?? 0) > (lineas[0]?.split(',').length ?? 0) ? ';' : ','
  return lineas.map((l) => {
    const celdas: string[] = []
    let actual = ''
    let comillas = false
    for (const c of l) {
      if (c === '"') comillas = !comillas
      else if (c === sep && !comillas) {
        celdas.push(actual)
        actual = ''
      } else actual += c
    }
    celdas.push(actual)
    return celdas.map((x) => x.trim())
  })
}

export async function importarPlanilla(datos: ArrayBuffer, nombre: string): Promise<FilaPlanilla[]> {
  if (/\.csv$/i.test(nombre)) return desdeTabla(partirCsv(new TextDecoder('utf-8').decode(datos)))
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(datos)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('El Excel no tiene hojas.')
  const filas: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[]
    filas.push(vals.slice(1))
  })
  return desdeTabla(filas)
}

export const esPlanillaArchivo = (nombre: string) => /\.(xlsx|csv)$/i.test(nombre)
