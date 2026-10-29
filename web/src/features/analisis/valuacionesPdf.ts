/**
 * Lectura de la tabla de valuaciones de la DNRPA (PDF oficial, p. ej. Disp. 160/2026).
 * Módulo puro: recibe los textos posicionados de cada página (como los da PDF.js) y
 * devuelve filas listas para importar. No adivina: lo que no entiende va a `errores`.
 *
 * Formato: encabezado con `MTM/FMM`, `T`, `Desc. marca`, `Desc. Modelo`, `Desc. Tipo`,
 * `0Km` y los años; cada fila trae el código MTM y los valores en pesos enteros,
 * alineados a la derecha bajo la columna del año. Si la descripción viene en blanco
 * se hereda de la fila anterior.
 */

export type Texto = { x: number; y: number; w: number; s: string }
export type FilaValuacion = {
  tipo_vehiculo: 'auto' | 'moto'
  mtm: string
  marca: string
  modelo: string
  version: string
  /** 0 = 0 km. */
  anio: number
  valor_cents: string
}
export type ResultadoValuaciones = { filas: FilaValuacion[]; errores: string[]; vigencia: string | null }

type Columna = { anio: number; derecha: number }
type Encabezado = { mtm: number; t: number; marca: number; modelo: number; tipo: number; columnas: Columna[] }

const renglones = (textos: Texto[]) => {
  const m = new Map<number, Texto[]>()
  for (const t of textos) {
    if (!t.s.trim()) continue
    const y = Math.round(t.y)
    const clave = [...m.keys()].find((k) => Math.abs(k - y) <= 1) ?? y
    m.set(clave, [...(m.get(clave) ?? []), t])
  }
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x))
}

/**
 * A veces PDF.js junta varios valores en un solo texto ("270270000 243100000") o pega el primero
 * a la descripción ("PICK-UP CABINA DOBLE 85785700"): los números que caen en la zona de valores
 * se separan, ubicándolos por ancho de carácter.
 */
function separar(t: Texto, desdeValores: number): Texto[] {
  const ancho = t.w / Math.max(t.s.length, 1)
  // Solo números de 5 cifras o más, como palabra suelta, desde la zona de valores hasta el final.
  const numeros = [...t.s.matchAll(/(?<=^|\s)\d{5,}(?=\s|$)/g)].filter(
    (m) => t.x + m.index * ancho >= desdeValores && /^[\s\d]*$/.test(t.s.slice(m.index)))
  if (!numeros.length) return [t]
  const resto = t.s.slice(0, numeros[0].index).trim()
  return [
    ...(resto ? [{ ...t, w: resto.length * ancho, s: resto }] : []),
    ...numeros.map((m) => ({ x: t.x + m.index * ancho, y: t.y, w: m[0].length * ancho, s: m[0] })),
  ]
}

function leerEncabezado(r: Texto[]): Encabezado | null {
  const x = (s: string) => r.find((t) => t.s.trim() === s)?.x
  const mtm = x('MTM/FMM'), t = x('T'), marca = x('Desc. marca'), modelo = x('Desc. Modelo'), tipo = x('Desc. Tipo')
  if (mtm == null || t == null || marca == null || modelo == null || tipo == null) return null
  const columnas = r
    .filter((c) => /^(0Km|\d{4})$/i.test(c.s.trim()))
    .map((c) => ({ anio: /km/i.test(c.s) ? 0 : Number(c.s.trim()), derecha: c.x + c.w }))
  return columnas.length ? { mtm, t, marca, modelo, tipo, columnas } : null
}

export function extraerVigencia(textos: Texto[]): string | null {
  for (const t of textos) {
    const m = /Vigencia\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(t.s)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
  }
  return null
}

/** Convierte todas las páginas; el encabezado y la última descripción se arrastran entre páginas. */
export function parsearValuaciones(paginas: Texto[][]): ResultadoValuaciones {
  const filas: FilaValuacion[] = []
  const errores: string[] = []
  let enc: Encabezado | null = null
  let vigencia: string | null = null
  let previa = { marca: '', modelo: '', version: '' }
  paginas.forEach((textos, i) => {
    vigencia ??= extraerVigencia(textos)
    for (let r of renglones(textos)) {
      const e = leerEncabezado(r)
      if (e) { enc = e; continue }
      if (!enc) continue
      const h: Encabezado = enc
      r = r.flatMap((c) => separar(c, h.tipo + 30))
      const en = (desde: number, hasta: number) => r.filter((c) => c.x >= desde - 4 && c.x < hasta - 4).map((c) => c.s.trim()).join(' ').trim()
      const mtm = en(h.mtm, h.t)
      if (!/^[0-9A-Z]{6,10}$/i.test(mtm)) continue // título, pie o renglón ajeno
      const t = en(h.t, h.t + 6)
      const tipoVehiculo = t === 'M' ? 'moto' : t === 'A' ? 'auto' : null
      if (!tipoVehiculo) { errores.push(`Página ${i + 1}: ${mtm} tiene tipo «${t}» desconocido`); continue }
      const desc = {
        marca: en(h.marca, h.modelo) || previa.marca,
        modelo: en(h.modelo, h.tipo) || previa.modelo,
        version: en(h.tipo, h.columnas[0].derecha - 22) || previa.version,
      }
      previa = desc
      const valores = r.filter((c) => c.x >= h.tipo + 30 && /^\d+$/.test(c.s.trim()))
      if (!valores.length) { errores.push(`Página ${i + 1}: ${mtm} no tiene valores legibles`); continue }
      for (const v of valores) {
        const derecha = v.x + v.w
        const col = h.columnas.reduce((a, b) => (Math.abs(b.derecha - derecha) < Math.abs(a.derecha - derecha) ? b : a))
        if (Math.abs(col.derecha - derecha) > 8) { errores.push(`Página ${i + 1}: ${mtm} tiene un valor fuera de columna`); continue }
        filas.push({ tipo_vehiculo: tipoVehiculo, mtm, ...desc, anio: col.anio, valor_cents: `${BigInt(v.s.trim()) * 100n}` })
      }
    }
  })
  if (!filas.length) errores.push('No se encontraron filas: ¿es la tabla de valuaciones de la DNRPA?')
  return { filas, errores, vigencia }
}

/** Parte la lista en tandas para subirla de a poco. */
export const enTandas = <T,>(xs: T[], n = 2000): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))
