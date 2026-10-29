// Lectura de comprobantes en el navegador, sin servicios externos:
// - PDF con texto: PDF.js extrae el texto (sin OCR).
// - PDF escaneado o foto: OCR con Tesseract.js en español, con los modelos servidos desde /ocr/.
// PDF.js y Tesseract se cargan con import() dinámico: solo pesan cuando se usan.

import type { Worker as TesseractWorker } from 'tesseract.js'

export interface PaginaLeida {
  pagina: number
  texto: string
  origen: 'texto_pdf' | 'ocr'
  confianza: number | null
  imagen: Blob
}

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

async function reconocer(canvas: HTMLCanvasElement, onPct: (p: number) => void) {
  const w = await obtenerWorker()
  alProgresarOcr = onPct
  try {
    const { data } = await w.recognize(canvas)
    return { texto: data.text, confianza: data.confidence }
  } finally {
    alProgresarOcr = null
  }
}

// ---------------------------------------------------------------------------------------
// Imágenes: escala de grises con estiramiento de contraste y orientación.
// ---------------------------------------------------------------------------------------

function preprocesar(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  let min = 255
  let max = 0
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const rango = Math.max(1, max - min)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(((d[i] - min) * 255) / rango)
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
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
// y se queda la de mayor confianza.
async function ocrOrientado(canvas: HTMLCanvasElement, onPct: (p: number) => void) {
  preprocesar(canvas)
  let mejor = { ...(await reconocer(canvas, onPct)), canvas }
  if (mejor.confianza >= 60) return mejor
  for (const g of [90, 180, 270]) {
    const c = rotar(canvas, g)
    const r = await reconocer(c, onPct)
    if (r.confianza > mejor.confianza) mejor = { ...r, canvas: c }
    if (mejor.confianza >= 60) break
  }
  return mejor
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

async function leerPdf(f: File, onProgreso?: (p: Progreso) => void): Promise<PaginaLeida[]> {
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
      const r = await ocrOrientado(canvas, (porcentaje) =>
        onProgreso?.({ pagina: n, total: doc.numPages, etapa: 'ocr', porcentaje }),
      )
      salida.push({ pagina: n, texto: r.texto, origen: 'ocr', confianza: r.confianza, imagen: await aBlob(r.canvas) })
    }
  } finally {
    await tarea.destroy()
  }
  return salida
}

async function leerImagen(f: File, onProgreso?: (p: Progreso) => void): Promise<PaginaLeida[]> {
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
  const r = await ocrOrientado(canvas, (porcentaje) => onProgreso?.({ pagina: 1, total: 1, etapa: 'ocr', porcentaje }))
  return [{ pagina: 1, texto: r.texto, origen: 'ocr', confianza: r.confianza, imagen: await aBlob(r.canvas) }]
}

/** Lee un PDF o una imagen y devuelve el texto de cada página. */
export async function leerArchivo(f: File, onProgreso?: (p: Progreso) => void): Promise<PaginaLeida[]> {
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
  return esPdf(f) ? leerPdf(f, onProgreso) : leerImagen(f, onProgreso)
}
