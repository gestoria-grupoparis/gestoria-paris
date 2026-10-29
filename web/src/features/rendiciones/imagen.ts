// Preparación de la imagen antes del OCR, como función pura sobre los píxeles (RGBA) para
// poder usarla igual en el navegador (canvas) y en pruebas.
//
// 1. Gris por el canal más claro (max(R,G,B)): la tinta negra queda negra y la birome azul o
//    el sello violeta se aclaran, así no tapan los números impresos.
// 2. Ampliación (hasta x2, lado mayor ~3000 px) si la imagen es chica (Tesseract lee mejor letras de más de ~25 px).
// 3. Umbral adaptativo (Sauvola simplificado con imagen integral): blanco y negro parejo aunque
//    la foto tenga sombras o el fondo gris de las tablas.

export interface Pixeles {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Lado mayor buscado al ampliar (más grande pesa demasiado en la memoria del navegador). */
const LADO_OBJETIVO = 3000

function aGris(p: Pixeles): Uint8ClampedArray {
  const n = p.width * p.height
  const g = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const r = p.data[i * 4]
    const v = p.data[i * 4 + 1]
    const a = p.data[i * 4 + 2]
    g[i] = r > v ? (r > a ? r : a) : v > a ? v : a
  }
  return g
}

function escalar(g: Uint8ClampedArray, w: number, h: number, f: number) {
  const W = Math.round(w * f)
  const H = Math.round(h * f)
  const s = new Uint8ClampedArray(W * H)
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(h - 1, y0 + 1)
    const dy = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(w - 1, x0 + 1)
      const dx = fx - x0
      const a = g[y0 * w + x0] * (1 - dx) + g[y0 * w + x1] * dx
      const b = g[y1 * w + x0] * (1 - dx) + g[y1 * w + x1] * dx
      s[y * W + x] = a * (1 - dy) + b * dy
    }
  }
  return { g: s, w: W, h: H }
}

function umbralAdaptativo(g: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  // Imagen integral de la suma y de la suma de cuadrados.
  const W = w + 1
  const suma = new Float64Array(W * (h + 1))
  const cuad = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let fila = 0
    let filaC = 0
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]
      fila += v
      filaC += v * v
      suma[(y + 1) * W + x + 1] = suma[y * W + x + 1] + fila
      cuad[(y + 1) * W + x + 1] = cuad[y * W + x + 1] + filaC
    }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 80))
  const salida = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const n = (y1 - y0) * (x1 - x0)
      const s = suma[y1 * W + x1] - suma[y0 * W + x1] - suma[y1 * W + x0] + suma[y0 * W + x0]
      const c = cuad[y1 * W + x1] - cuad[y0 * W + x1] - cuad[y1 * W + x0] + cuad[y0 * W + x0]
      const media = s / n
      const desvio = Math.sqrt(Math.max(0, c / n - media * media))
      const umbral = media * (1 + k * (desvio / 128 - 1))
      salida[y * w + x] = g[y * w + x] > umbral ? 255 : 0
    }
  }
  return salida
}

/** Borra (pone en blanco) las líneas largas de la grilla: corridas negras horizontales más
 *  largas que 1/15 del ancho y verticales más largas que 1/25 del alto. Las letras nunca son tan
 *  largas, y sin la grilla Tesseract no pierde los importes que la tocan. */
function borrarGrilla(bn: Uint8ClampedArray, w: number, h: number): void {
  const marca = new Uint8Array(w * h)
  const minH = Math.round(w / 15)
  const minV = Math.round(h / 25)
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (bn[y * w + x] !== 0) { x++; continue }
      const ini = x
      while (x < w && bn[y * w + x] === 0) x++
      if (x - ini >= minH) for (let i = ini; i < x; i++) marca[y * w + i] = 1
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0
    while (y < h) {
      if (bn[y * w + x] !== 0) { y++; continue }
      const ini = y
      while (y < h && bn[y * w + x] === 0) y++
      if (y - ini >= minV) for (let i = ini; i < y; i++) marca[i * w + x] = 1
    }
  }
  for (let i = 0; i < w * h; i++) if (marca[i]) bn[i] = 255
}

/** Devuelve una imagen nueva (RGBA, blanco y negro) lista para el OCR. */
export function prepararParaOcr(p: Pixeles, op: { k?: number; binarizar?: boolean } = {}): Pixeles {
  let g = aGris(p)
  let w = p.width
  let h = p.height
  const f = Math.min(2, LADO_OBJETIVO / Math.max(w, h))
  if (f > 1.1) ({ g, w, h } = escalar(g, w, h, f))
  let bn = g
  if (op.binarizar !== false) {
    bn = umbralAdaptativo(g, w, h, op.k ?? 0.2)
    borrarGrilla(bn, w, h)
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = bn[i]
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}
