// Lectura de comprobantes y planillas a partir del texto (de PDF.js o del OCR).
// Funciones puras: nunca inventan un dato. Lo que no se encuentra queda en null y su nombre
// va a "dudosos" para que la persona lo complete en la revisión.
//
// Para sumar un tipo nuevo: agregar el valor a TipoComprobante, una regla en clasificar() y
// una función extraerX() que devuelva un Extraido; registrarla en extraer().

import { parsearMonto } from './montos'
import { extraerDominio, normalizarDocumento, normalizarNombre } from './normalizar'

export type TipoComprobante = 'recibo_dnrpa' | 'retencion_sellos' | 'factura_honorarios' | 'otro'

export interface Linea {
  concepto: string
  importe_cents: bigint
}

export interface Extraido {
  tipo: TipoComprobante
  numero: string | null
  emisor: string | null
  emisor_cuit: string | null
  fecha: string | null
  total_cents: bigint | null
  dominio: string | null
  documento: string | null
  nombre: string | null
  lineas: Linea[]
  dudosos: string[]
}

export interface FilaPlanilla {
  nombre: string
  dominio: string | null
  pago_cents: bigint
  honorarios_cents: bigint
}

// Importe con 2 decimales: "431539,69", "1.163.855,24", "508 614.29", "$ -5290,00".
const MONTO_RE = /(?<![\w.,])-?\s?\$?\s?-?\d{1,3}(?:[. ]?\d{3})*[.,]\d{2}(?!\d)/g

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const plano = (s: string) => sinTildes(s).toUpperCase()

/** Importes (en centavos) que aparecen en una línea, con su posición. */
function montosEn(linea: string): { cents: bigint; index: number }[] {
  const salida: { cents: bigint; index: number }[] = []
  for (const m of linea.matchAll(MONTO_RE)) {
    const cents = parsearMonto(m[0].replace(/^-\s*\$\s*/, '-').replace(/\$\s*-\s*/, '-'))
    if (cents !== null) salida.push({ cents, index: m.index ?? 0 })
  }
  return salida
}

const lineasDe = (texto: string) => texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

function fechaIso(s: string | undefined | null): string | null {
  const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})/.exec(s ?? '')
  if (!m) return null
  const d = Number(m[1])
  const mes = Number(m[2])
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null
  return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Valor que sigue a una etiqueta (comparación sin tildes ni mayúsculas) en la misma línea. */
function trasEtiqueta(texto: string, etiqueta: RegExp): string | null {
  for (const l of lineasDe(texto)) {
    const m = etiqueta.exec(sinTildes(l))
    if (m) return l.slice(m.index + m[0].length).trim()
  }
  return null
}

function primerMonto(s: string | null): bigint | null {
  if (!s) return null
  const ms = montosEn(s)
  if (ms.length) return ms[0].cents
  // Manuscritos: "$ 32.500" sin decimales.
  const m = /-?\$?\s?-?\d[\d.,]*/.exec(s)
  return m ? parsearMonto(m[0]) : null
}

function vacio(tipo: TipoComprobante): Extraido {
  return {
    tipo, numero: null, emisor: null, emisor_cuit: null, fecha: null, total_cents: null,
    dominio: null, documento: null, nombre: null, lineas: [], dudosos: [],
  }
}

function marcarFaltantes(e: Extraido, campos: (keyof Extraido)[]): Extraido {
  for (const c of campos) {
    const nombre = c === 'total_cents' ? 'total' : c
    if (e[c] === null && !e.dudosos.includes(nombre)) e.dudosos.push(nombre)
  }
  return e
}

export function clasificar(texto: string): TipoComprobante {
  const t = plano(texto)
  if ((t.includes('DNRPA') || t.includes('RECIBO')) && /CONTROL\s*WEB/.test(t)) return 'recibo_dnrpa'
  if (t.includes('COMPROBANTE DE RETENCI') && t.includes('SELLOS')) return 'retencion_sellos'
  if (t.includes('FACTURA') && t.includes('HONORARIO')) return 'factura_honorarios'
  return 'otro'
}

function cuitEn(texto: string): string | null {
  const m = /CUIT\s*:?\s*(\d{2}-?\d{8}-?\d)/i.exec(texto)
  return m ? normalizarDocumento(m[1]) : null
}

function extraerRecibo(texto: string): Extraido {
  const e = vacio('recibo_dnrpa')
  const ls = lineasDe(texto)
  e.numero = /N\W{0,3}\s*Control\s*Recibo\s*:?\s*(\d+)/i.exec(sinTildes(texto))?.[1] ?? null
  const registro = trasEtiqueta(texto, /Registro\s+Seccional\s*/i)
  e.emisor = registro ? `Registro ${registro}` : null
  e.fecha = fechaIso(trasEtiqueta(texto, /^Fecha\s*:?/i))
  const dominio = trasEtiqueta(texto, /Dominio\s*:?/i)
  e.dominio = dominio ? extraerDominio(dominio) : null

  const iTotal = ls.findIndex((l) => /^Total\s*:?/i.test(sinTildes(l)))
  e.total_cents = iTotal >= 0 ? primerMonto(ls[iTotal].replace(/^Total\s*:?/i, '')) : null
  const iConceptos = ls.findIndex((l) => /^Concepto/i.test(l))
  if (iConceptos >= 0) {
    for (const l of ls.slice(iConceptos + 1, iTotal >= 0 ? iTotal : undefined)) {
      const ms = montosEn(l)
      if (!ms.length) continue
      const concepto = l.slice(0, ms[0].index).trim()
      if (!concepto) continue
      e.lineas.push({ concepto, importe_cents: ms[ms.length - 1].cents })
    }
  }
  const suma = e.lineas.reduce((a, l) => a + l.importe_cents, 0n)
  if (!e.lineas.length || e.total_cents === null || suma !== e.total_cents) e.dudosos.push('lineas')
  return marcarFaltantes(e, ['numero', 'emisor', 'fecha', 'total_cents', 'dominio'])
}

function extraerSellos(texto: string): Extraido {
  const e = vacio('retencion_sellos')
  const ls = lineasDe(texto)
  e.numero = /Numero\s+de\s+Comprobante\s*:?\s*(\d+)/i.exec(sinTildes(texto))?.[1] ?? null
  e.emisor = 'DPIP San Luis'
  e.emisor_cuit = cuitEn(texto)
  const patente = /Chapa\s*Patente\s*:?\s*([A-Z0-9]{6,7})/i.exec(texto)?.[1]
  e.dominio = patente ? extraerDominio(patente) : null
  e.fecha = fechaIso(trasEtiqueta(texto, /Fecha\s+Operacion\s*:?/i))
  e.total_cents = primerMonto(trasEtiqueta(texto, /Total\s+Retenido\s*:?/i))
  if (e.total_cents !== null) e.lineas.push({ concepto: 'Impuesto de Sellos', importe_cents: e.total_cents })

  const iPartes = ls.findIndex((l) => /Partes\s+intervinientes/i.test(sinTildes(l)))
  for (const l of iPartes >= 0 ? ls.slice(iPartes + 1) : ls) {
    const m = /^(.*?)\s*D\.?N\.?I\.?\s*:?\s*([\d.]+)/i.exec(l)
    if (m && m[1].trim()) {
      e.nombre = normalizarNombre(m[1]) || null
      e.documento = normalizarDocumento(m[2])
      break
    }
  }
  return marcarFaltantes(e, ['numero', 'emisor_cuit', 'fecha', 'total_cents', 'dominio', 'nombre', 'documento'])
}

function extraerFactura(texto: string): Extraido {
  const e = vacio('factura_honorarios')
  e.numero = /(\d{4,5})\s*-\s*(\d{8})/.exec(texto)?.slice(1, 3).join('-') ?? null
  e.emisor = trasEtiqueta(texto, /Razon\s+Social\s*:?/i) || null
  e.emisor_cuit = cuitEn(texto)
  e.fecha = fechaIso(trasEtiqueta(texto, /^Fecha\s*:?/i))
  const senor = trasEtiqueta(texto, /SENOR\s*\(?\s*ES\s*\)?\s*:?/i)
  e.nombre = senor ? normalizarNombre(senor) || null : null
  const total = lineasDe(texto).reverse().find((l) => /^TOTAL/i.test(l))
  e.total_cents = total ? primerMonto(total.replace(/^TOTAL\s*:?/i, '')) : null
  if (e.total_cents !== null) e.lineas.push({ concepto: 'Honorarios', importe_cents: e.total_cents })
  return marcarFaltantes(e, ['numero', 'fecha', 'total_cents', 'nombre'])
}

function extraerOtro(texto: string): Extraido {
  const e = vacio('otro')
  e.fecha = fechaIso(texto)
  e.dominio = extraerDominio(trasEtiqueta(texto, /(Dominio|Patente)\s*:?/i) ?? '')
  const dni = /D\.?N\.?I\.?\s*:?\s*([\d.]+)/i.exec(texto)?.[1]
  e.documento = dni ? normalizarDocumento(dni) : null
  e.emisor_cuit = cuitEn(texto)
  const total = lineasDe(texto).reverse().find((l) => /^TOTAL/i.test(sinTildes(l)))
  e.total_cents = total ? primerMonto(total.replace(/^TOTAL\s*\w*\s*:?/i, '')) : null
  return marcarFaltantes(e, ['numero', 'emisor', 'fecha', 'total_cents'])
}

export function extraer(texto: string): Extraido {
  switch (clasificar(texto)) {
    case 'recibo_dnrpa':
      return extraerRecibo(texto)
    case 'retencion_sellos':
      return extraerSellos(texto)
    case 'factura_honorarios':
      return extraerFactura(texto)
    default:
      return extraerOtro(texto)
  }
}

/** Filas de la planilla: un nombre seguido de dos importes (PAGO y HONORARIOS). */
export function parsearPlanilla(texto: string): FilaPlanilla[] {
  const filas: FilaPlanilla[] = []
  for (const l of lineasDe(texto)) {
    const ms = montosEn(l)
    if (ms.length < 2) continue
    const crudo = l.slice(0, ms[0].index).replace(/^[\d\s.)-]+/, '').trim()
    const nombre = normalizarNombre(crudo)
    if (!nombre || /^(TOTAL|SUBTOTAL)\b/.test(nombre)) continue
    filas.push({
      nombre,
      dominio: extraerDominio(crudo),
      pago_cents: ms[ms.length - 2].cents,
      honorarios_cents: ms[ms.length - 1].cents,
    })
  }
  return filas
}
