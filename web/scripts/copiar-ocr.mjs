// Copia los recursos de Tesseract.js (worker, núcleo wasm y modelo español) a public/ocr/,
// para servirlos desde la propia web: en tiempo de ejecución no se usa ningún CDN de terceros.
// Corre antes de `dev` y de `build` (predev / prebuild).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(raiz, 'node_modules')
const destino = join(raiz, 'public', 'ocr')
mkdirSync(destino, { recursive: true })

const copiar = (origen, nombre) => {
  const fin = join(destino, nombre)
  if (existsSync(fin) && statSync(fin).size === statSync(origen).size) return
  copyFileSync(origen, fin)
}

copiar(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js')
const core = join(nm, 'tesseract.js-core')
for (const f of readdirSync(core)) {
  // Solo LSTM (el motor por defecto); el .wasm.js ya trae el wasm embebido.
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f)) copiar(join(core, f), f)
}
// Modelo LSTM "best_int" (el que usa Tesseract.js por defecto), más liviano que el completo.
copiar(join(nm, '@tesseract.js-data', 'spa', '4.0.0_best_int', 'spa.traineddata.gz'), 'spa.traineddata.gz')
console.log('OCR: recursos copiados a public/ocr')
