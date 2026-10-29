import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Button, Chip, Dialogo, Field, Input } from '../../ui'
import { importarValuaciones, listarTablasValuaciones } from './consultas'
import { enTandas, parsearValuaciones, type ResultadoValuaciones, type Texto } from './valuacionesPdf'

declare global {
  interface Window {
    /** Solo en desarrollo/E2E: textos posicionados por nombre de archivo, en lugar de PDF.js. */
    __valuacionesSimuladas?: Record<string, Texto[][]>
  }
}

async function leerTextos(f: File, onPagina: (n: number, total: number) => void): Promise<Texto[][]> {
  const sim = (import.meta.env.DEV || import.meta.env.MODE === 'test') ? window.__valuacionesSimuladas?.[f.name] : undefined
  if (sim) return sim
  const [pdfjs, { default: workerSrc }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) })
  const doc = await tarea.promise
  const paginas: Texto[][] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onPagina(n, doc.numPages)
      const c = await (await doc.getPage(n)).getTextContent()
      paginas.push(c.items.flatMap((it) => ('str' in it ? [{ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }] : [])))
    }
  } finally {
    void tarea.destroy()
  }
  return paginas
}

const fecha = (iso: string) => iso.split('-').reverse().join('/')

/** Tablas importadas y botón para importar una nueva (solo gerencia). */
export function TablasValuaciones({ editable }: { editable: boolean }) {
  const q = useQuery({ queryKey: ['analisis', 'valuaciones'], queryFn: listarTablasValuaciones })
  const [abierto, setAbierto] = useState(false)
  return (
    <section aria-labelledby="titulo-valuaciones" className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-valuaciones" className="text-[16px] font-semibold">Tabla de valuaciones DNRPA</h2>
        {editable && <Button variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>Importar tabla de valuaciones</Button>}
      </div>
      {q.isError && <p role="alert" className="text-sm text-sinfondos">No se pudieron cargar las tablas.</p>}
      {q.data && (q.data.length === 0
        ? <p className="text-[13px] text-tenue">Todavía no se importó ninguna tabla. Sin tabla, el estimado usa solo el valor declarado.</p>
        : (
          <ul className="space-y-1 text-[14px]">
            {q.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.disposicion}</span>
                <span className="text-tenue">vigente desde {fecha(t.vigente_desde)} · {t.filas.toLocaleString('es-AR')} valores</span>
                {!t.completa && <Chip tono="comprometido">Importación incompleta</Chip>}
              </li>
            ))}
          </ul>
        ))}
      {abierto && <DialogoImportar onCerrar={() => setAbierto(false)} />}
    </section>
  )
}

function DialogoImportar({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient()
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [r, setR] = useState<ResultadoValuaciones | null>(null)
  const [disposicion, setDisposicion] = useState('')
  const [desde, setDesde] = useState('')
  const [fuente, setFuente] = useState('')
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<number | null>(null)
  const subiendo = progreso != null && listo == null

  async function elegir(f: File | undefined) {
    if (!f) return
    setError(null); setR(null); setListo(null); setLeyendo('Leyendo el PDF…')
    try {
      const res = parsearValuaciones(await leerTextos(f, (n, t) => setLeyendo(`Leyendo página ${n} de ${t}…`)))
      setR(res)
      if (res.vigencia) {
        setDesde(res.vigencia)
        const [a, m, d] = res.vigencia.split('-')
        setFuente(`https://www.dnrpa.gov.ar/valuacion/informacion/${d}-${m}-${a}.pdf`)
      }
    } catch (e) {
      setError(`No se pudo leer el PDF: ${mensajeError(e)}`)
    } finally {
      setLeyendo(null)
    }
  }

  async function subir() {
    if (!r) return
    setError(null)
    const tandas = enTandas(r.filas)
    setProgreso({ hecho: 0, total: r.filas.length })
    try {
      let hecho = 0
      for (const [i, t] of tandas.entries()) {
        const res = await importarValuaciones({ disposicion, vigente_desde: desde, fuente_url: fuente || null, filas: t, final: i === tandas.length - 1 })
        hecho += t.length
        setProgreso({ hecho, total: r.filas.length })
        if (i === tandas.length - 1) setListo(res.filas)
      }
      void qc.invalidateQueries({ queryKey: ['analisis', 'valuaciones'] })
    } catch (e) {
      setError(mensajeError(e))
      setProgreso(null)
    }
  }

  const muestra = r?.filas.filter((f, i, xs) => i === 0 || xs[i - 1].mtm !== f.mtm).slice(0, 3) ?? []
  return (
    <Dialogo titulo="Importar tabla de valuaciones" rotulo="PDF oficial de la DNRPA" onCerrar={onCerrar} bloqueado={subiendo}>
      <div className="space-y-4">
        <Field label="Archivo PDF" ayuda="Descargalo de dnrpa.gov.ar → Valuaciones. Se lee en esta computadora.">
          {(c) => <Input {...c} type="file" accept="application/pdf,.pdf" disabled={!!leyendo || subiendo} onChange={(e) => void elegir(e.target.files?.[0])} />}
        </Field>
        {leyendo && <p role="status" className="text-[13px] text-tenue">{leyendo}</p>}
        {r && (
          <div className="space-y-2 rounded-md bg-hundido px-3 py-2 text-[13px]" data-testid="vista-previa-valuaciones">
            <p><strong className="cifra">{r.filas.length.toLocaleString('es-AR')}</strong> valores de <strong className="cifra">{new Set(r.filas.map((f) => f.mtm)).size.toLocaleString('es-AR')}</strong> modelos.</p>
            {muestra.length > 0 && (
              <ul className="text-tenue">
                {muestra.map((f) => <li key={f.mtm}>{f.marca} {f.modelo} {f.version} · {f.anio === 0 ? '0 km' : f.anio}: {formatearPesos(f.valor_cents)}</li>)}
              </ul>
            )}
            {r.errores.length > 0 && (
              <details>
                <summary className="cursor-pointer text-comprometido">{r.errores.length} renglones no se pudieron leer y no se importan</summary>
                <ul className="mt-1 max-h-32 overflow-auto">{r.errores.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {r && r.filas.length > 0 && listo == null && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void subir() }}>
            <Field label="Disposición" ayuda="Por ejemplo: Disp. 160/2026">
              {(c) => <Input {...c} required value={disposicion} onChange={(e) => setDisposicion(e.target.value)} disabled={subiendo} />}
            </Field>
            <Field label="Vigente desde">{(c) => <Input {...c} type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} disabled={subiendo} />}</Field>
            <Field label="Enlace de la fuente">{(c) => <Input {...c} value={fuente} onChange={(e) => setFuente(e.target.value)} disabled={subiendo} />}</Field>
            {progreso && (
              <div>
                <progress className="h-2 w-full accent-marca" max={progreso.total} value={progreso.hecho} aria-label="Avance de la importación" />
                <p className="cifra text-[12px] text-tenue">{progreso.hecho.toLocaleString('es-AR')} de {progreso.total.toLocaleString('es-AR')}</p>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-sinfondos">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variante="secundario" onClick={onCerrar} disabled={subiendo}>Cancelar</Button>
              <Button type="submit" cargando={subiendo}>Importar {r.filas.length.toLocaleString('es-AR')} valores</Button>
            </div>
          </form>
        )}
        {!r && error && <p role="alert" className="text-sm text-sinfondos">{error}</p>}
        {listo != null && (
          <div className="space-y-3">
            <p role="status" className="text-[14px]">Listo: se importaron {listo.toLocaleString('es-AR')} valores. Las tablas anteriores quedan guardadas.</p>
            <div className="flex justify-end"><Button onClick={onCerrar}>Listo</Button></div>
          </div>
        )}
      </div>
    </Dialogo>
  )
}
