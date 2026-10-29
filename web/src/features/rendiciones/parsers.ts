// Lectura de comprobantes y planillas a partir del texto (de PDF.js o del OCR).
// Funciones puras: nunca inventan un dato. Lo que no se encuentra queda en null y su nombre
// va a "dudosos" para que la persona lo complete en la revisión.
//
// El OCR de fotos reales trae ruido: espacios dentro de los números, "S" o "5" en lugar de "$",
// O/0 e I/1 confundidos, renglones partidos y basura de la grilla. Todo pasa primero por
// limpiarLinea() y los importes se validan con parsearMonto(), que ante la duda devuelve null.
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
  /** null: no se pudo leer con seguridad; la persona lo completa. */
  pago_cents: bigint | null
  honorarios_cents: bigint | null
  /** true si algún dato de la fila quedó sin leer o con dudas. */
  dudoso: boolean
}

/** Palabra leída por el OCR con su caja (píxeles) y confianza (0-100). */
export interface PalabraOcr {
  texto: string
  x0: number
  y0: number
  x1: number
  y1: number
  confianza?: number
}

/** Línea del OCR (Tesseract la arma siguiendo la base del texto, aunque la hoja esté inclinada). */
export interface LineaOcr {
  texto: string
  x0: number
  y0: number
  x1: number
  y1: number
  palabras?: PalabraOcr[]
}

export interface ResultadoPlanilla {
  filas: FilaPlanilla[]
  /** Total que figura en la hoja (fila TOTAL), si se leyó. */
  total: { pago_cents: bigint | null; honorarios_cents: bigint | null } | null
  /** true/false si hay total en la hoja y todas las filas tienen importe; null si no se puede controlar. */
  cuadra: boolean | null
}

// Importe con 2 decimales: "431539,69", "1.163.855,24", "508 614.29", "$ -5290,00".
const MONTO_RE = /(?<![\w.,])-?\s?\$?\s?-?\d{1,3}(?:[. ]?\d{3})*[.,]\d{2}(?![\d.,]?\d)/g

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const plano = (s: string) => sinTildes(s).toUpperCase()

/**
 * Corrige confusiones típicas del OCR dentro de los números: O/o/Q/D -> 0, l/I/| -> 1 entre
 * dígitos, "S" o "s" pegada antes de un importe -> "$", y "$" repetido o separado del signo.
 */
export function limpiarLinea(l: string): string {
  // Secuencias "numéricas" (al menos dos dígitos reales) con letras parecidas a dígitos. En los
  // bordes solo O/Q: un "|" pegado al final es la grilla de la tabla, no un 1.
  const s = l.replace(/[“”"]/g, '').replace(/[\dOoQ][\dOoQlI|.,]*[\dOoQ]/g, (tok) =>
    (tok.match(/\d/g) ?? []).length >= 2
      ? tok.replace(/[OoQ]/g, '0').replace(/[lI|]/g, '1')
      : tok)
  return s
    .replace(/(^|[\s|(\[_—-])[Ss]\s?(?=-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d))/g, '$1$$ ')
    .replace(/\$\s*\$/g, '$')
}

/** Importes (en centavos) que aparecen en una línea, con su posición. */
function montosEn(linea: string): { cents: bigint; index: number; fin: number }[] {
  const salida: { cents: bigint; index: number; fin: number }[] = []
  for (const m of linea.matchAll(MONTO_RE)) {
    const cents = parsearMonto(m[0].replace(/^-\s*\$\s*/, '-').replace(/\$\s*-\s*/, '-'))
    if (cents !== null) salida.push({ cents, index: m.index ?? 0, fin: (m.index ?? 0) + m[0].length })
  }
  return salida
}

const lineasDe = (texto: string) => texto.split(/\r?\n/).map((l) => limpiarLinea(l.trim())).filter(Boolean)

function fechaIso(s: string | undefined | null): string | null {
  const m = /(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?!\d)/.exec(s ?? '')
  if (!m) return null
  const d = Number(m[1])
  const mes = Number(m[2])
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || anio < 2000 || anio > 2099) return null
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
  const m = /-?\$\s?-?\d[\d.,]*/.exec(s) ?? /^\s*:?\s*(-?\d[\d.,]*)/.exec(s)
  return m ? parsearMonto(m[m.length - 1]) : null
}

function vacio(tipo: TipoComprobante): Extraido {
  return {
    tipo, numero: null, emisor: null, emisor_cuit: null, fecha: null, total_cents: null,
    dominio: null, documento: null, nombre: null, lineas: [], dudosos: [],
  }
}

const CAMPO_DUDOSO: Partial<Record<keyof Extraido, string>> = { total_cents: 'total' }

function marcarFaltantes(e: Extraido, campos: (keyof Extraido)[]): Extraido {
  for (const c of campos) {
    const nombre = CAMPO_DUDOSO[c] ?? c
    if (e[c] === null && !e.dudosos.includes(nombre)) e.dudosos.push(nombre)
  }
  return e
}

export function clasificar(texto: string): TipoComprobante {
  const t = plano(texto)
  if ((t.includes('DNRPA') || t.includes('RECIBO')) && /CONTROL\s*WEB/.test(t)) return 'recibo_dnrpa'
  if (/COMPROBANTE\s+DE\s+RETENCI/.test(t) && t.includes('SELLOS')) return 'retencion_sellos'
  const factura = /F\s?A\s?C\s?T\s?U\s?R\s?A/.test(t)
  if (/DESDE\s*:?\s*\d{4}\s*-\s*\d{8}\s*HASTA/.test(t) && /ORIGINAL/.test(t)) return 'factura_honorarios'
  if (factura && (t.includes('HONORARIO') || /\bCAI\b|C\.?A\.?I\.?\s*:/.test(t) || /RESPONSABLE\s+MONOTRIBUTO/.test(t))) return 'factura_honorarios'
  return 'otro'
}

const CUIT_RE = /C\.?\s?U\.?\s?[I1L]{1,2}\.?\s?[-.]?\s?[TL]\.?\s*:?\s*(\d{2}\s?-?\s?\d{8}\s?-?\s?\d)(?!\d)/i

/** Primer CUIT del texto (el del emisor, que va arriba). Ignora el de la imprenta (línea con CAI o "Fecha de Impresión"). */
function cuitEn(texto: string, op: { soloArriba?: boolean } = {}): string | null {
  const ls = lineasDe(texto)
  for (const l of op.soloArriba ? ls.slice(0, Math.ceil(ls.length * 0.7)) : ls) {
    if (/\bCAI\b|IMPRESI|IMPRENTA/i.test(sinTildes(l))) continue
    const m = CUIT_RE.exec(l)
    if (m) return normalizarDocumento(m[1])
  }
  return null
}

// ---------------------------------------------------------------------------------------
// Recibo DNRPA
// ---------------------------------------------------------------------------------------

function extraerRecibo(texto: string): Extraido {
  const e = vacio('recibo_dnrpa')
  const ls = lineasDe(texto)
  const t = sinTildes(texto)
  e.numero = /N\W{0,3}\s*Control\s*Recibo\s*:?\s*(\d{4,})/i.exec(t)?.[1] ?? null
  const seccional = trasEtiqueta(texto, /Registro\s+Seccional\s*/i)
  // "Registro: 19008 SAN LUIS N° 3" (la etiqueta suele perderse en el OCR): código de 5 dígitos,
  // localidad y número de registro.
  const reg = /(?:^|\s)(\d{5})\s+([A-Z][A-Z ]+?)\s+N\s?[°º*'"]?\s?(\d{1,3})\b/.exec(plano(seccional ? `${seccional}` : ls.slice(0, 15).join('\n')))
  e.emisor = reg ? `Registro ${reg[1]} ${reg[2].trim()} N° ${reg[3]}` : seccional ? `Registro ${seccional}` : null
  e.fecha = fechaIso(trasEtiqueta(texto, /(?:^|\s)Fecha\s*:?/i))
  const dominio = trasEtiqueta(texto, /Dominio\s*:?(?!\s*$)/i)
  e.dominio = dominio ? extraerDominio(dominio) : null

  const iTotal = ls.findIndex((l) => /^\W*T[o0]ta[l1I]?\s*:?\s*\$?/i.test(sinTildes(l)) || /(?<!Sub)T[o0]tal\s*:\s*\$/i.test(l))
  if (iTotal >= 0) {
    const ms = montosEn(ls[iTotal])
    // Si figura dos veces ("Total: $ x  Total: $ x"), se toma el valor repetido o, si difieren, ninguno.
    const valores = [...new Set(ms.map((m) => m.cents))]
    e.total_cents = valores.length === 1 ? valores[0] : null
    if (valores.length > 1) {
      const sub = ls.find((l) => /Subtota/i.test(l))
      const subs = sub ? montosEn(sub).map((m) => m.cents) : []
      e.total_cents = valores.find((v) => subs.includes(v)) ?? null
    }
  }
  const iConceptos = ls.findIndex((l) => /Concepto/i.test(l))
  const fin = ls.findIndex((l, i) => i > iConceptos && /Subtota|T[o0]tal\s*:|^\W*T[o0]ta[l1]?\s*:/i.test(l))
  if (iConceptos >= 0) {
    for (const l of ls.slice(iConceptos + 1, fin >= 0 ? fin : iTotal >= 0 ? iTotal : undefined)) {
      const ms = montosEn(l)
      if (!ms.length) continue
      // El concepto termina donde empieza el primer importe (aunque sea ilegible): "$" o 4+ dígitos.
      const letra = Math.max(0, l.search(/\p{L}{3}/u))
      const rel = l.slice(letra).search(/\$|\d[\d.,]{3,}/)
      const corte = rel >= 0 ? letra + rel : -1
      const concepto = l.slice(0, corte >= 0 ? Math.min(corte, ms[0].index) : ms[0].index).replace(/[^\p{L}\d.\- ]+/gu, ' ').replace(/(\s+\S{1,2})+\s*$/u, '').replace(/^(\S{1,2}\s+)+/u, '').replace(/[\s-]+$/, '').replace(/\s+/g, ' ').trim()
      if (!/\p{L}{3}/u.test(concepto)) continue
      let importe = ms[ms.length - 1].cents
      // Las bonificaciones siempre restan; el OCR a veces pierde el signo.
      if (/^[BS8]ONIFICACI/i.test(sinTildes(concepto)) && importe > 0n) importe = -importe
      e.lineas.push({ concepto: concepto.replace(/^Sonificaci/i, 'Bonificaci'), importe_cents: importe })
    }
  }
  const suma = e.lineas.reduce((a, l) => a + l.importe_cents, 0n)
  if (!e.lineas.length || e.total_cents === null || suma !== e.total_cents) e.dudosos.push('lineas')
  return marcarFaltantes(e, ['numero', 'emisor', 'fecha', 'total_cents', 'dominio'])
}

// ---------------------------------------------------------------------------------------
// Retención de sellos (DPIP San Luis)
// ---------------------------------------------------------------------------------------

function extraerSellos(texto: string): Extraido {
  const e = vacio('retencion_sellos')
  const ls = lineasDe(texto)
  const t = sinTildes(texto)
  e.numero = /N[u]mero\s+de\s+Comprobante\s*:?\s*(\d{6,})/i.exec(t)?.[1]
    ?? /Comprobante\s+de\s+Retenci\S*\s+(\d{6,})/i.exec(t)?.[1]
    ?? /(?<!\d)(0\d{9})(?!\d)/.exec(t)?.[1]
    ?? null
  e.emisor = 'DPIP San Luis'
  e.emisor_cuit = cuitEn(texto)
  const patente = /Chapa\s*Patente\s*:?\s*([A-Za-z0-9]{6,7})/i.exec(texto)?.[1]
  e.dominio = patente ? extraerDominio(patente) : null
  e.fecha = fechaIso(trasEtiqueta(texto, /Fecha\s+Operaci\w*\s*:?/i))
  e.total_cents = primerMonto(trasEtiqueta(texto, /Total\s+Retenido\s*[:.]?\s*\.?/i))
  if (e.total_cents !== null) e.lineas.push({ concepto: 'Impuesto de Sellos', importe_cents: e.total_cents })

  const iPartes = ls.findIndex((l) => /Partes\s+intervinientes/i.test(sinTildes(l)))
  for (const l of iPartes >= 0 ? ls.slice(iPartes + 1) : ls) {
    if (/Raz[oó]n\s+Social|Tipo\s+Documento|Total\s+Retenido/i.test(l)) continue
    // "APELLIDO NOMBRE ... D | 20111222" o "APELLIDO NOMBRE DNI 20.111.222"
    const m = /^[^A-ZÁÉÍÓÚÑ]*([A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,})+)\b.*?(\d{1,2}\.?\d{3}\.?\d{3}|\d{2}-?\d{8}-?\d)\D*$/.exec(l)
    if (m) {
      e.nombre = normalizarNombre(m[1].replace(/\s+(DNI|D\.N\.I|CUIT|CUIL|D)$/i, '')) || null
      e.documento = normalizarDocumento(m[2])
      break
    }
  }
  return marcarFaltantes(e, ['numero', 'emisor_cuit', 'fecha', 'total_cents', 'dominio', 'nombre', 'documento'])
}

// ---------------------------------------------------------------------------------------
// Factura de honorarios (a veces manuscrita: lo ilegible queda vacío y pendiente)
// ---------------------------------------------------------------------------------------

function extraerFactura(texto: string): Extraido {
  const e = vacio('factura_honorarios')
  // Sin las líneas de la imprenta ("DESDE: 0001 - 00010251 HASTA: ..."), que tienen otro número.
  const propio = lineasDe(texto).filter((l) => !/DESDE|HASTA|\bCAI\b/i.test(l)).join('\n')
  const pv = /N\s?[°º*o]?\s*(\d{4,5})\s*-/.exec(propio)?.[1]
  e.numero = /(?<!\d)(\d{4,5})\s*-\s*(\d{8})(?!\d)/.exec(propio)?.slice(1, 3).join('-')
    ?? (pv ? /ORIGINAL\s*\W?\s*(\d{8})(?!\d)/i.exec(propio)?.[1]?.replace(/^/, `${pv}-`) : undefined)
    ?? null
  e.emisor = trasEtiqueta(texto, /Razon\s+Social\s*:?/i) || null
  e.emisor_cuit = cuitEn(texto, { soloArriba: true })
  e.fecha = fechaIso(trasEtiqueta(texto, /^Fecha\s*:?/i))
  const senor = trasEtiqueta(texto, /SENOR\s*\(?\s*ES\s*\)?\s*:?/i)
  const nombre = senor ? normalizarNombre(senor) : ''
  // Solo si parece un nombre impreso (dos palabras de 3+ letras); los garabatos del OCR no.
  // Mayúsculas y minúsculas mezcladas dentro de una palabra ("GoDy ManO") delatan letra manuscrita mal leída.
  const mezclado = /[a-z][A-Z]|[A-Z][a-z]+[A-Z]/.test(senor ?? '')
  e.nombre = !mezclado && /^[A-Z]{3,}( [A-Z]{3,})+$/.test(nombre) ? nombre : null
  const total = lineasDe(texto).reverse().find((l) => /^TOTAL\b/i.test(l))
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

// ---------------------------------------------------------------------------------------
// Varias lecturas del mismo comprobante (el OCR se repite con otro preprocesado cuando la
// primera deja dudas). Se combinan campo por campo: si coinciden, el valor; si una sola lo
// leyó, ese; si difieren, gana la mayoría estricta y, si no la hay, queda vacío y dudoso.
// ---------------------------------------------------------------------------------------

const CAMPOS: (keyof Extraido)[] = ['numero', 'emisor', 'emisor_cuit', 'fecha', 'total_cents', 'dominio', 'documento', 'nombre']

function votar<T>(valores: (T | null)[]): { valor: T | null; conflicto: boolean } {
  const cuenta = new Map<string, { v: T; n: number }>()
  for (const v of valores) {
    if (v === null) continue
    const k = String(v)
    cuenta.set(k, { v, n: (cuenta.get(k)?.n ?? 0) + 1 })
  }
  const orden = [...cuenta.values()].sort((a, b) => b.n - a.n)
  if (!orden.length) return { valor: null, conflicto: false }
  if (orden.length === 1) return { valor: orden[0].v, conflicto: false }
  if (orden[0].n > orden[1].n) return { valor: orden[0].v, conflicto: false }
  return { valor: null, conflicto: true }
}

const claveConcepto = (c: string) => plano(c).replace(/[^A-Z]/g, '').replace(/^SONIF/, 'BONIF')

function similares(a: string, b: string): boolean {
  if (a === b) return true
  const bi = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)))
  const A = bi(a)
  const B = bi(b)
  let comun = 0
  for (const x of A) if (B.has(x)) comun++
  // Además deben terminar igual ("...Exp. cédula" no es "...Exp. título").
  return (2 * comun) / Math.max(1, A.size + B.size) >= 0.8 && a.slice(-3) === b.slice(-3)
}

/** Líneas combinadas: cada concepto con el importe más votado; se aceptan solo si suman el total. */
function combinarLineas(lecturas: Extraido[], total: bigint | null): Linea[] | null {
  const grupos: { clave: string; concepto: string; importes: bigint[] }[] = []
  for (const e of lecturas) {
    let ultimo = -1
    for (const l of e.lineas) {
      const k = claveConcepto(l.concepto)
      const i = grupos.findIndex((x) => similares(x.clave, k))
      if (i >= 0) {
        grupos[i].importes.push(l.importe_cents)
        ultimo = i
      } else {
        // Concepto que otra lectura no vio: va después del último coincidente, para respetar el orden.
        grupos.splice(ultimo + 1, 0, { clave: k, concepto: l.concepto, importes: [l.importe_cents] })
        ultimo++
      }
    }
  }
  if (!grupos.length || total === null) return null
  // Opciones por concepto (más votada primero); se busca la combinación que suma el total.
  const opciones = grupos.map((g) => {
    const n = new Map<bigint, number>()
    for (const i of g.importes) n.set(i, (n.get(i) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
  })
  const combinaciones = opciones.reduce((a, o) => a * o.length, 1)
  if (combinaciones > 4096) return null
  let encontrada: bigint[] | null = null
  const buscar = (i: number, elegidos: bigint[], suma: bigint) => {
    if (encontrada) return
    if (i === opciones.length) {
      if (suma === total) encontrada = [...elegidos]
      return
    }
    for (const v of opciones[i]) buscar(i + 1, [...elegidos, v], suma + v)
  }
  buscar(0, [], 0n)
  const elegidos: bigint[] | null = encontrada
  return elegidos ? grupos.map((g, i) => ({ concepto: g.concepto, importe_cents: elegidos[i] })) : null
}

export function combinarLecturas(lecturas: Extraido[]): Extraido {
  if (lecturas.length === 1) return lecturas[0]
  const tipo = votar(lecturas.map((e) => e.tipo)).valor ?? 'otro'
  const mismas = lecturas.filter((e) => e.tipo === tipo)
  const e = vacio(tipo)
  const conflictos: string[] = []
  for (const c of CAMPOS) {
    const v = votar(mismas.map((x) => x[c] as string | bigint | null))
    ;(e as unknown as Record<string, unknown>)[c] = v.valor
    if (v.conflicto) conflictos.push(CAMPO_DUDOSO[c] ?? c)
  }
  // El total que cierra con las líneas tiene prioridad sobre la votación.
  const totales = [...new Set(mismas.map((x) => x.total_cents).filter((x): x is bigint => x !== null))]
  let lineas: Linea[] | null = null
  if (tipo === 'recibo_dnrpa') {
    for (const t of e.total_cents !== null ? [e.total_cents, ...totales] : totales) {
      lineas = combinarLineas(mismas, t)
      if (lineas) {
        e.total_cents = t
        if (conflictos.includes('total')) conflictos.splice(conflictos.indexOf('total'), 1)
        break
      }
    }
    e.lineas = lineas ?? (mismas.find((x) => !x.dudosos.includes('lineas'))?.lineas ?? [])
    if (!lineas && !mismas.some((x) => !x.dudosos.includes('lineas'))) e.dudosos.push('lineas')
  } else {
    e.lineas = e.total_cents !== null ? (mismas.find((x) => x.total_cents === e.total_cents)?.lineas ?? []) : []
  }
  for (const c of conflictos) if (!e.dudosos.includes(c)) e.dudosos.push(c)
  const requeridos: Record<TipoComprobante, (keyof Extraido)[]> = {
    recibo_dnrpa: ['numero', 'emisor', 'fecha', 'total_cents', 'dominio'],
    retencion_sellos: ['numero', 'emisor_cuit', 'fecha', 'total_cents', 'dominio', 'nombre', 'documento'],
    factura_honorarios: ['numero', 'fecha', 'total_cents', 'nombre'],
    otro: ['numero', 'emisor', 'fecha', 'total_cents'],
  }
  return marcarFaltantes(e, requeridos[tipo])
}

/** true si conviene otra lectura (algún dato importante quedó vacío o las líneas no cierran). */
export const necesitaOtraLectura = (e: Extraido) =>
  e.tipo === 'otro' || e.dudosos.some((d) => d !== 'dominio' && d !== 'emisor')

// ---------------------------------------------------------------------------------------
// Planilla mensual: NOMBRE | PAGO | HONORARIOS
//
// Regla de seguridad: un importe solo se asigna a un nombre si está en el MISMO renglón físico
// (misma línea del OCR y, con posiciones, a la altura que corresponde según la inclinación de la
// hoja). Si un importe no se puede leer o ubicar con seguridad, la fila sale con ese importe en
// null y marcada dudosa: nunca se corre un importe a la fila de al lado.
// ---------------------------------------------------------------------------------------

const ES_TOTAL = /^\W*(SUB)?T[O0]TAL(ES)?\b/

/** Nombre "creíble": al menos dos palabras de 2+ letras y mayoría de letras. */
function nombreCreible(crudo: string): string | null {
  const limpio = crudo.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+$/, '')
  const nombre = normalizarNombre(limpio)
  const palabras = nombre.split(' ').filter((p) => /^[A-Z]{2,}$/.test(p))
  if (palabras.length < 2) return null
  const letras = (limpio.match(/\p{L}/gu) ?? []).length
  if (letras < limpio.replace(/\s/g, '').length * 0.7) return null
  return nombre
}

/** Honorarios casi iguales al valor habitual (difieren en un solo dígito): casi seguro un error del OCR. */
function sospechosoFrenteAModa(v: bigint, moda: bigint | null): boolean {
  if (moda === null || v === moda) return false
  const a = v.toString()
  const b = moda.toString()
  if (a.length !== b.length) return a.length === b.length + 1 || a.length + 1 === b.length
  let dif = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif++
  return dif === 1
}

function moda(vs: bigint[]): bigint | null {
  const n = new Map<bigint, number>()
  for (const v of vs) n.set(v, (n.get(v) ?? 0) + 1)
  const orden = [...n.entries()].sort((a, b) => b[1] - a[1])
  return orden.length && orden[0][1] >= 3 && orden[0][1] > vs.length / 2 ? orden[0][0] : null
}

function cerrar(filas: FilaPlanilla[], total: ResultadoPlanilla['total']): ResultadoPlanilla {
  const m = moda(filas.map((f) => f.honorarios_cents).filter((x): x is bigint => x !== null))
  for (const f of filas) {
    if (f.honorarios_cents !== null && sospechosoFrenteAModa(f.honorarios_cents, m)) {
      f.honorarios_cents = null
      f.dudoso = true
    }
  }
  let cuadra: boolean | null = null
  if (total && filas.length) {
    const sumar = (k: 'pago_cents' | 'honorarios_cents') =>
      filas.some((f) => f[k] === null) ? null : filas.reduce((a, f) => a + (f[k] as bigint), 0n)
    const controles: boolean[] = []
    const sp = sumar('pago_cents')
    const sh = sumar('honorarios_cents')
    if (total.pago_cents !== null && sp !== null) controles.push(sp === total.pago_cents)
    if (total.honorarios_cents !== null && sh !== null) controles.push(sh === total.honorarios_cents)
    cuadra = controles.length ? controles.every(Boolean) : null
  }
  return { filas, total, cuadra }
}

/** Planilla desde texto plano (PDF con texto, o OCR sin posiciones). */
export function parsearPlanilla(texto: string): ResultadoPlanilla {
  const filas: FilaPlanilla[] = []
  let total: ResultadoPlanilla['total'] = null
  for (const l of lineasDe(texto)) {
    const ms = montosEn(l)
    const crudo = (ms.length ? l.slice(0, ms[0].index) : l).replace(/^[\d\s.)-]+/, '').trim()
    if (ES_TOTAL.test(plano(crudo))) {
      if (ms.length >= 2) total = { pago_cents: ms[ms.length - 2].cents, honorarios_cents: ms[ms.length - 1].cents }
      continue
    }
    if (ms.length === 0) continue
    const nombre = nombreCreible(crudo)
    if (!nombre || /^(NOMBRE|PAGO)\b/.test(nombre)) continue
    // Con dos importes en la línea, son PAGO y HONORARIOS. Con uno solo no se sabe de qué
    // columna es: la fila sale sin importes para completar.
    const dos = ms.length >= 2
    filas.push({
      nombre,
      dominio: extraerDominio(crudo),
      pago_cents: dos ? ms[ms.length - 2].cents : null,
      honorarios_cents: dos ? ms[ms.length - 1].cents : null,
      dudoso: !dos || ms.length > 2,
    })
  }
  return cerrar(filas, total)
}

// --- Planilla con posiciones (OCR con cajas de palabras) ---------------------------------

interface Ficha {
  texto: string
  x0: number
  y0: number
  x1: number
  y1: number
  confianza: number
}

/** Palabras de la línea; si el OCR no dio palabras, la línea entera como una sola. */
const fichasDe = (l: LineaOcr): Ficha[] =>
  (l.palabras?.length ? l.palabras : [l]).map((p) => ({
    texto: p.texto, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1,
    confianza: 'confianza' in p ? (p.confianza ?? 100) : 100,
  }))

const centroY = (f: { y0: number; y1: number }) => (f.y0 + f.y1) / 2

interface Celda {
  cents: bigint | null
  x0: number
  x1: number
  y: number
  alto: number
}

/** Agrupa las palabras de una línea en celdas de importe ("$" + número, o número suelto). */
function celdasDe(fs: Ficha[], confianzaMin: number): { celdas: Celda[]; primera: number } {
  const celdas: Celda[] = []
  let primera = -1
  for (let i = 0; i < fs.length; i++) {
    const w = fs[i]
    const t = limpiarLinea(w.texto).replace(/^[[(|!¡:;_—-]+(?=[$\dS])/, '').replace(/[|)\]!:;'"”.\-—_/A-Za-z]+$/, '')
    const cuerpo = t.replace(/^[$S]/, '')
    // "Parece un importe": 4+ dígitos con separador. Si no es válido, la celda existe pero es ilegible.
    const pareceImporte = /\d/.test(cuerpo) && (cuerpo.match(/\d/g) ?? []).length >= 4 && /[.,]/.test(cuerpo)
    if (!pareceImporte) continue
    const previo = i > 0 && /^[$S5[(|]*\$?$/.test(fs[i - 1].texto.replace(/[[(|]/g, '')) && /[$S5]/.test(fs[i - 1].texto) ? fs[i - 1] : null
    const valido = /^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/.test(cuerpo) || /^-?\d+[.,]\d{2}$/.test(cuerpo)
    const cents = valido && w.confianza >= confianzaMin ? parsearMonto(cuerpo) : null
    const x0 = previo ? previo.x0 : w.x0
    if (primera < 0) primera = previo ? i - 1 : i
    celdas.push({ cents, x0, x1: w.x1, y: centroY(w), alto: w.y1 - w.y0 })
  }
  return { celdas, primera }
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const o = [...xs].sort((a, b) => a - b)
  return o[Math.floor(o.length / 2)]
}

/**
 * Planilla desde líneas del OCR con cajas de palabras. Cada línea del OCR es un renglón físico;
 * además se controla que cada importe esté a la altura del nombre según la inclinación de la hoja.
 */
export function parsearPlanillaOcr(lineas: LineaOcr[], op: { confianzaMin?: number } = {}): ResultadoPlanilla {
  // Sin umbral por defecto: Tesseract da confianzas muy bajas a importes bien leídos; la
  // seguridad la da combinarPlanillas() exigiendo dos lecturas iguales.
  const confianzaMin = op.confianzaMin ?? 0
  const enc = lineas.findIndex((l) => /H[O0]N[O0]R[A4]R|\bP[A4][GC][O0]\b.*N[O0]R/.test(plano(l.texto)) || /^\W*N[O0]MBRE\b/.test(plano(l.texto)))
  const cuerpo = enc >= 0 ? lineas.slice(enc + 1) : lineas

  const analizadas = cuerpo.map((l) => {
    const fs = fichasDe(l)
    const { celdas, primera } = celdasDe(fs, confianzaMin)
    const fnombre = primera >= 0 ? fs.slice(0, primera) : fs
    return { l, fs, celdas, fnombre }
  })

  // Columnas: inicio (x0) de las celdas de importe, separadas en dos grupos por el mayor salto.
  const xs = analizadas.flatMap((a) => a.celdas.map((c) => (c.x0 + c.x1) / 2)).sort((a, b) => a - b)
  let corte: number | null = null
  if (xs.length >= 4) {
    let mejor = 0
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > mejor) {
        mejor = xs[i] - xs[i - 1]
        corte = (xs[i] + xs[i - 1]) / 2
      }
    }
    const ancho = xs[xs.length - 1] - xs[0]
    if (mejor < ancho * 0.25) corte = null
  }
  const izq = corte === null ? [] : xs.filter((x) => x < corte!)
  const der = corte === null ? [] : xs.filter((x) => x >= corte!)
  const cPago = mediana(izq)
  const cHon = mediana(der)
  const toleranciaX = cPago !== null && cHon !== null ? (cHon - cPago) * 0.45 : 0

  // Inclinación de la hoja: mediana de la pendiente de las líneas largas (centro de las palabras).
  const pendientes: number[] = []
  for (const a of analizadas) {
    const fs = a.fs.filter((f) => /\p{L}{2}|\d{3}/u.test(f.texto))
    if (fs.length < 2) continue
    const p = fs[0]
    const u = fs[fs.length - 1]
    if (u.x0 - p.x0 > 300) pendientes.push((centroY(u) - centroY(p)) / ((u.x0 + u.x1) / 2 - (p.x0 + p.x1) / 2))
  }
  const pendiente = mediana(pendientes) ?? 0

  const filas: FilaPlanilla[] = []
  let total: ResultadoPlanilla['total'] = null
  for (const a of analizadas) {
    const crudo = a.fnombre.map((f) => f.texto).join(' ')
    const columna = (c: Celda): 'pago' | 'honorarios' | null => {
      if (cPago === null || cHon === null) return null
      const x = (c.x0 + c.x1) / 2
      if (Math.abs(x - cPago) <= toleranciaX) return 'pago'
      if (Math.abs(x - cHon) <= toleranciaX) return 'honorarios'
      return null
    }
    if (ES_TOTAL.test(plano(crudo.trim()))) {
      const p = a.celdas.find((c) => columna(c) === 'pago')
      const h = a.celdas.find((c) => columna(c) === 'honorarios')
      total = { pago_cents: p?.cents ?? null, honorarios_cents: h?.cents ?? null }
      continue
    }
    const nombre = nombreCreible(crudo)
    if (!nombre || /^(NOMBRE|PAGO)\b/.test(nombre)) continue
    // Si el nombre está a la derecha de donde empiezan los importes, no es la columna NOMBRE.
    if (cPago !== null && a.fnombre.length && a.fnombre[0].x0 > cPago - toleranciaX) continue

    // Altura esperada de cada importe según la altura del nombre y la inclinación.
    const ancla = a.fnombre.filter((f) => /\p{L}{2}/u.test(f.texto))
    const ref = ancla.length ? ancla[ancla.length - 1] : a.fnombre[a.fnombre.length - 1]
    const alto = mediana(ancla.map((f) => f.y1 - f.y0)) ?? 30
    const enRenglon = (c: Celda) => {
      if (!ref) return false
      const esperado = centroY(ref) + pendiente * ((c.x0 + c.x1) / 2 - (ref.x0 + ref.x1) / 2)
      return Math.abs(c.y - esperado) <= alto * 0.6
    }

    let pago: bigint | null = null
    let hon: bigint | null = null
    let dudoso = false
    const vistas = { pago: 0, honorarios: 0 }
    for (const c of a.celdas) {
      let col = columna(c)
      if (col === null && cPago === null && a.celdas.length === 2) col = c === a.celdas[0] ? 'pago' : 'honorarios'
      if (col === null) {
        dudoso = true
        continue
      }
      vistas[col]++
      if (!enRenglon(c) || c.cents === null) {
        dudoso = true
        continue
      }
      if (col === 'pago') pago = c.cents
      else hon = c.cents
    }
    // Dos importes en la misma columna del mismo renglón: no se sabe cuál es.
    if (vistas.pago > 1) pago = null
    if (vistas.honorarios > 1) hon = null
    if (pago === null || hon === null) dudoso = true
    filas.push({ nombre, dominio: extraerDominio(crudo), pago_cents: pago, honorarios_cents: hon, dudoso })
  }
  return cerrar(filas, total)
}

// --- Varias lecturas de la misma planilla ------------------------------------------------

function parecido(a: string, b: string): number {
  const bi = (s: string) => {
    const r = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2))
    return r
  }
  const A = bi(a.replace(/ /g, ''))
  const B = bi(b.replace(/ /g, ''))
  let comun = 0
  for (const x of A) if (B.has(x)) comun++
  return (2 * comun) / Math.max(1, A.size + B.size)
}

/**
 * Combina lecturas independientes de la misma planilla (el OCR repetido con otro umbral).
 * Un importe se acepta solo si al menos dos lecturas lo leyeron igual en la fila del mismo
 * nombre (y ninguna otra cifra tiene tantos votos); si no, queda en null y la fila dudosa.
 */
export function combinarPlanillas(lecturas: ResultadoPlanilla[]): ResultadoPlanilla {
  if (lecturas.length <= 1) return lecturas[0] ?? { filas: [], total: null, cuadra: null }
  const base = [...lecturas].sort((a, b) => b.filas.length - a.filas.length)[0]
  // Para cada otra lectura, fila correspondiente a cada fila de la base: por nombre parecido y
  // respetando el orden (nunca se cruzan filas).
  const pares = lecturas.filter((l) => l !== base).map((otra) => {
    const asignada: (FilaPlanilla | null)[] = base.filas.map(() => null)
    let desde = 0
    base.filas.forEach((f, i) => {
      let mejor = -1
      let puntaje = 0.55
      for (let j = desde; j < Math.min(otra.filas.length, desde + 4); j++) {
        const p = parecido(f.nombre, otra.filas[j].nombre)
        if (p > puntaje) {
          puntaje = p
          mejor = j
        }
      }
      if (mejor >= 0) {
        asignada[i] = otra.filas[mejor]
        desde = mejor + 1
      }
    })
    return asignada
  })
  const filas = base.filas.map((f, i) => {
    const todas = [f, ...pares.map((p) => p[i]).filter((x): x is FilaPlanilla => x !== null)]
    const elegir = (k: 'pago_cents' | 'honorarios_cents') => {
      const v = votar(todas.map((x) => x[k]))
      const votos = todas.filter((x) => x[k] !== null && x[k] === v.valor).length
      return votos >= 2 ? v.valor : null
    }
    const pago = elegir('pago_cents')
    const hon = elegir('honorarios_cents')
    return { ...f, pago_cents: pago, honorarios_cents: hon, dudoso: pago === null || hon === null }
  })
  const totales = lecturas.map((l) => l.total).filter((t): t is NonNullable<ResultadoPlanilla['total']> => t !== null)
  const total = totales.length
    ? { pago_cents: votar(totales.map((t) => t.pago_cents)).valor, honorarios_cents: votar(totales.map((t) => t.honorarios_cents)).valor }
    : null
  return cerrar(filas, total)
}
