// Exportación de tablas a CSV y XLSX, generadas en el navegador.
// Los importes llegan como texto de centavos: se convierten partiendo el string, sin aritmética.

export interface Columna<T> {
  titulo: string
  valor: (fila: T) => string | null | undefined
  /** El valor es un importe en centavos (texto). */
  moneda?: boolean
  ancho?: number
}

function partirCentavos(cents: string): { negativo: boolean; enteros: string; decimales: string } {
  const texto = cents.trim()
  if (!/^-?\d+$/.test(texto)) throw new Error(`Importe en centavos inválido: ${texto}`)
  const negativo = texto.startsWith('-')
  const digitos = (negativo ? texto.slice(1) : texto).replace(/^0+(?=\d)/, '').padStart(3, '0')
  const cero = /^0+$/.test(digitos)
  return { negativo: negativo && !cero, enteros: digitos.slice(0, -2), decimales: digitos.slice(-2) }
}

/** Centavos a decimal con coma ("650000,50"), para CSV en configuración regional argentina. */
export function centavosADecimal(cents: string | null | undefined): string {
  if (cents == null || cents === '') return ''
  const { negativo, enteros, decimales } = partirCentavos(String(cents))
  return `${negativo ? '-' : ''}${enteros},${decimales}`
}

/**
 * Centavos a número de planilla. La división por 100 se hace insertando el punto decimal en el
 * texto; el número resultante es el que Excel guardaría al tipearlo. Hasta 15 dígitos es exacto.
 */
export function centavosANumero(cents: string | null | undefined): number | null {
  if (cents == null || cents === '') return null
  const { negativo, enteros, decimales } = partirCentavos(String(cents))
  if (enteros.length + 2 > 15) throw new Error(`Importe demasiado grande para la planilla: ${cents}`)
  const n = Number(`${negativo ? '-' : ''}${enteros}.${decimales}`)
  return Object.is(n, -0) ? 0 : n
}

function celdaCsv(valor: string): string {
  // Evita inyección de fórmulas al abrir en Excel y escapa separadores y comillas.
  const seguro = /^[=+\-@\t\r]/.test(valor) && !/^-?\d+(,\d+)?$/.test(valor) ? `'${valor}` : valor
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/** CSV con `;` (lo que Excel espera en es-AR), BOM UTF-8 y CRLF. */
export function planillaACsv<T>(columnas: Columna<T>[], filas: T[]): string {
  const lineas = [columnas.map((c) => celdaCsv(c.titulo)).join(';')]
  for (const f of filas) {
    lineas.push(columnas.map((c) => celdaCsv(c.moneda ? centavosADecimal(c.valor(f)) : (c.valor(f) ?? ''))).join(';'))
  }
  return '﻿' + lineas.join('\r\n') + '\r\n'
}

const FORMATO_MONEDA = '"$" #,##0.00;-"$" #,##0.00'

/** Libro XLSX de una hoja: encabezado en negrita y fijo, autofiltro y montos numéricos con formato de pesos. */
export async function planillaAXlsx<T>(columnas: Columna<T>[], filas: T[], nombreHoja: string): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Gestoría Grupo Paris'
  const hoja = libro.addWorksheet(nombreHoja.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = columnas.map((c) => ({
    header: c.titulo,
    width: c.ancho ?? Math.max(12, c.titulo.length + 4),
    style: c.moneda ? { numFmt: FORMATO_MONEDA } : {},
  }))
  for (const f of filas) {
    // En XLSX el texto nunca se evalúa como fórmula: se guarda como cadena literal.
    hoja.addRow(columnas.map((c) => (c.moneda ? centavosANumero(c.valor(f)) : (c.valor(f) ?? ''))))
  }
  hoja.getRow(1).font = { bold: true }
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } }
  return (await libro.xlsx.writeBuffer()) as ArrayBuffer
}

export function nombreConFecha(prefijo: string, hoy: string, extension: 'csv' | 'xlsx'): string {
  const base = prefijo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base}-${hoy}.${extension}`
}

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function descargarArchivo(nombre: string, contenido: BlobPart, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Descarga la tabla en el formato pedido. */
export async function exportarPlanilla<T>(
  formato: 'csv' | 'xlsx', columnas: Columna<T>[], filas: T[], opciones: { prefijo: string; hoy: string; hoja: string },
) {
  const nombre = nombreConFecha(opciones.prefijo, opciones.hoy, formato)
  if (formato === 'csv') descargarArchivo(nombre, planillaACsv(columnas, filas), 'text/csv;charset=utf-8')
  else descargarArchivo(nombre, await planillaAXlsx(columnas, filas, opciones.hoja), TIPO_XLSX)
}
