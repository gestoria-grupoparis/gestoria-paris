// Lectura de comprobantes en el navegador, sin servicios externos:
// - PDF con texto: PDF.js extrae el texto (sin OCR).
// - PDF escaneado o foto: OCR con Tesseract.js en español, con los modelos servidos desde /ocr/.
// PDF.js y Tesseract se cargan con import() dinámico: solo pesan cuando se usan.
//
// Antes del OCR la imagen pasa por prepararParaOcr() (imagen.ts): ampliación, blanco y negro
// adaptativo y borrado de la grilla. Las fotos reales se leen más de una vez con distinto
// preprocesado y los resultados se combinan (parsers.ts): un dato solo se acepta si las lecturas
// coinciden o si una sola lo encontró sin contradicciones.

import type { Worker as TesseractWorker } from 'tesseract.js'
import { prepararParaOcr } from './imagen'
import { combinarLecturas, extraer, necesitaOtraLectura, type LineaOcr } from './parsers'

export interface PaginaLeida {
  pagina: number
  texto: string
  origen: 'texto_pdf' | 'ocr'
  confianza: number | null
  imagen: Blob
  /** Comprobantes por OCR: texto de cada lectura (se combinan con combinarLecturas). */
  lecturas?: string[]
  /** Planilla por OCR: líneas con posiciones de cada lectura (se combinan con combinarPlanillas). */
  lineasOcr?: LineaOcr[][]
}

/** comprobante: hoja suelta. planilla: tabla NOMBRE | PAGO | HONORARIOS. */
export type ModoLectura = 'comprobante' | 'planilla'

export interface Progreso {
  pagina: number
  total: number
  etapa: 'texto' | 'ocr'
  porcentaje?: number
}

/** Huella SHA-256 (hex) del archivo, para detectar el mismo archivo subido dos veces. */
export async function hashArchivo(f: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** true si el texto extraído es tan pobre (menos de 40 letras o dígitos) que conviene el OCR. */
export function decidirOcr(texto: string): boolean {
  return (texto.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 40
}

// ---------------------------------------------------------------------------------------
// Tesseract: un solo worker, creado a demanda y reutilizado.
// ---------------------------------------------------------------------------------------

let worker: Promise<TesseractWorker> | null = null
let alProgresarOcr: ((p: number) => void) | null = null

function obtenerWorker(): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('spa', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      gzip: true,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') alProgresarOcr?.(Math.round(m.progress * 100))
      },
    }),
  )
  worker.catch(() => {
    worker = null
  })
  return worker
}

/** Libera el worker de OCR (al salir de la pantalla de rendiciones). */
export async function terminarOcr(): Promise<void> {
  const w = worker
  worker = null
  if (w) await (await w).terminate().catch(() => {})
}

interface Lectura {
  texto: string
  confianza: number
  lineas: LineaOcr[]
}

/** psm 3: página automática (comprobantes). psm 6: un solo bloque, renglón por renglón (tablas). */
async function reconocer(canvas: HTMLCanvasElement, psm: '3' | '6', onPct: (p: number) => void): Promise<Lectura> {
  const w = await obtenerWorker()
  alProgresarOcr = onPct
  try {
    await w.setParameters({ tessedit_pageseg_mode: psm as never, preserve_interword_spaces: '1' })
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: psm === '6' })
    const lineas: LineaOcr[] = []
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        for (const l of p.lines) {
          lineas.push({
            texto: l.text.trim(),
            ...l.bbox,
            palabras: l.words.map((x) => ({ texto: x.text, confianza: Math.round(x.confidence), ...x.bbox })),
          })
        }
      }
    }
    return { texto: data.text, confianza: data.confidence, lineas }
  } finally {
    alProgresarOcr = null
  }
}

// ---------------------------------------------------------------------------------------
// Imágenes: preparación, orientación y lecturas adicionales.
// ---------------------------------------------------------------------------------------

interface Variante {
  k?: number
  binarizar?: boolean
  psm: '3' | '6'
}

// Comprobantes: si la primera lectura deja datos sin leer, se repite con otro preprocesado.
const VARIANTES_COMPROBANTE: Variante[] = [{ k: 0.3, psm: '3' }, { binarizar: false, psm: '3' }, { k: 0.2, psm: '6' }]
// Planilla: cinco lecturas renglón por renglón con distinto umbral; un importe vale si dos coinciden.
const VARIANTES_PLANILLA: Variante[] = [0.2, 0.15, 0.3, 0.25, 0.1].map((k) => ({ k, psm: '6' as const }))

function preparado(origen: HTMLCanvasElement, v: Variante): HTMLCanvasElement {
  const ctx = origen.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, origen.width, origen.height)
  const p = prepararParaOcr({ data: img.data, width: img.width, height: img.height }, { k: v.k, binarizar: v.binarizar })
  const c = document.createElement('canvas')
  c.width = p.width
  c.height = p.height
  const salida = c.getContext('2d')!.createImageData(p.width, p.height)
  salida.data.set(p.data)
  c.getContext('2d')!.putImageData(salida, 0, 0)
  return c
}

function rotar(origen: HTMLCanvasElement, grados: number): HTMLCanvasElement {
  if (grados === 0) return origen
  const c = document.createElement('canvas')
  const vertical = grados % 180 !== 0
  c.width = vertical ? origen.height : origen.width
  c.height = vertical ? origen.width : origen.height
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((grados * Math.PI) / 180)
  ctx.drawImage(origen, -origen.width / 2, -origen.height / 2)
  return c
}

const aBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo generar la imagen'))), 'image/png'))

// Orientación: si la lectura derecha sale con poca confianza, se prueban 90, 180 y 270 grados
// y se queda la de mayor confianza. Después vienen las lecturas adicionales del modo.
async function ocrOrientado(original: HTMLCanvasElement, modo: ModoLectura, onPct: (p: number) => void) {
  const variantes = modo === 'planilla' ? VARIANTES_PLANILLA : VARIANTES_COMPROBANTE
  const pct = (i: number) => (p: number) => onPct(Math.round((i * 100 + p) / variantes.length))
  let base = original
  let primera = await reconocer(preparado(base, variantes[0]), variantes[0].psm, pct(0))
  if (primera.confianza < 60) {
    for (const g of [90, 180, 270]) {
      const c = rotar(original, g)
      const r = await reconocer(preparado(c, variantes[0]), variantes[0].psm, pct(0))
      if (r.confianza > primera.confianza) {
        primera = r
        base = c
      }
      if (primera.confianza >= 60) break
    }
  }
  const lecturas = [primera]
  for (let i = 1; i < variantes.length; i++) {
    if (modo === 'comprobante' && !necesitaOtraLectura(combinarLecturas(lecturas.map((l) => extraer(l.texto))))) break
    lecturas.push(await reconocer(preparado(base, variantes[i]), variantes[i].psm, pct(i)))
  }
  onPct(100)
  return {
    texto: primera.texto,
    confianza: primera.confianza,
    canvas: base,
    lecturas: lecturas.map((l) => l.texto),
    lineasOcr: modo === 'planilla' ? lecturas.map((l) => l.lineas) : undefined,
  }
}

// ---------------------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------------------

type Simulado = Record<string, string | string[]>
declare global {
  interface Window {
    /** Solo en desarrollo/E2E: texto por nombre de archivo, en lugar de PDF.js/Tesseract. */
    __ocrSimulado?: Simulado
  }
}

export const esPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function leerPdf(f: File, modo: ModoLectura, onProgreso?: (p: Progreso) => void): Promise<PaginaLeida[]> {
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) })
  const doc = await tarea.promise
  const salida: PaginaLeida[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgreso?.({ pagina: n, total: doc.numPages, etapa: 'texto' })
      const page = await doc.getPage(n)
      const contenido = await page.getTextContent()
      // Reconstruye las líneas agrupando por la coordenada vertical.
      const filas = new Map<number, { x: number; s: string }[]>()
      for (const it of contenido.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const y = Math.round(it.transform[5] / 3)
        const fila = filas.get(y) ?? []
        fila.push({ x: it.transform[4], s: it.str })
        filas.set(y, fila)
      }
      const texto = [...filas.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, f2]) => f2.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '))
        .join('\n')

      const ocr = decidirOcr(texto)
      const viewport = page.getViewport({ scale: ocr ? 2 : 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      if (!ocr) {
        salida.push({ pagina: n, texto, origen: 'texto_pdf', confianza: null, imagen: await aBlob(canvas) })
        continue
      }
      onProgreso?.({ pagina: n, total: doc.numPages, etapa: 'ocr', porcentaje: 0 })
      const r = await ocrOrientado(canvas, modo, (porcentaje) =>
        onProgreso?.({ pagina: n, total: doc.numPages, etapa: 'ocr', porcentaje }),
      )
      salida.push({
        pagina: n, texto: r.texto, origen: 'ocr', confianza: r.confianza, imagen: await aBlob(r.canvas),
        lecturas: r.lecturas, lineasOcr: r.lineasOcr,
      })
    }
  } finally {
    await tarea.destroy()
  }
  return salida
}

async function leerImagen(f: File, modo: ModoLectura, onProgreso?: (p: Progreso) => void): Promise<PaginaLeida[]> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(f)
  } catch {
    throw new Error('FORMATO_NO_SOPORTADO: este navegador no puede abrir esa imagen. Convertila a JPG o PDF.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  onProgreso?.({ pagina: 1, total: 1, etapa: 'ocr', porcentaje: 0 })
  const r = await ocrOrientado(canvas, modo, (porcentaje) => onProgreso?.({ pagina: 1, total: 1, etapa: 'ocr', porcentaje }))
  return [{
    pagina: 1, texto: r.texto, origen: 'ocr', confianza: r.confianza, imagen: await aBlob(r.canvas),
    lecturas: r.lecturas, lineasOcr: r.lineasOcr,
  }]
}

/** Lee un PDF o una imagen y devuelve el texto de cada página. */
export async function leerArchivo(
  f: File,
  onProgreso?: (p: Progreso) => void,
  modo: ModoLectura = 'comprobante',
): Promise<PaginaLeida[]> {
  const sim = (import.meta.env.DEV || import.meta.env.MODE === 'test') && typeof window !== 'undefined'
    ? window.__ocrSimulado?.[f.name]
    : undefined
  if (sim !== undefined) {
    const paginas = Array.isArray(sim) ? sim : [sim]
    return paginas.map((texto, i) => {
      onProgreso?.({ pagina: i + 1, total: paginas.length, etapa: 'ocr', porcentaje: 100 })
      return { pagina: i + 1, texto, origen: 'ocr' as const, confianza: 90, imagen: f }
    })
  }
  return esPdf(f) ? leerPdf(f, modo, onProgreso) : leerImagen(f, modo, onProgreso)
}
