import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { useMutacionUnica } from '../../lib/consultas'
import { mensajeError } from '../../lib/errores'
import { Button, Cargando, CampoPesos, Chip, DataTable, Dialogo, ErrorState, Field, Input, celdaMonto, celdaPrincipal } from '../../ui'
import { guardarParametro, listarParametros, type Parametro } from './consultas'

const NOMBRE: Record<string, { etiqueta: string; unidad: 'pct' | 'por_mil' | 'mrpa' | 'pesos' }> = {
  mrpa_pesos: { etiqueta: 'Valor del MRPA', unidad: 'pesos' },
  inscripcion_pct: { etiqueta: 'Inscripción inicial', unidad: 'pct' },
  inscripcion_min_mrpa: { etiqueta: 'Mínimo de inscripción', unidad: 'mrpa' },
  transferencia_pct: { etiqueta: 'Transferencia', unidad: 'pct' },
  transferencia_min_mrpa: { etiqueta: 'Mínimo de transferencia', unidad: 'mrpa' },
  prenda_por_mil: { etiqueta: 'Prenda', unidad: 'por_mil' },
  prenda_min_mrpa: { etiqueta: 'Mínimo de prenda', unidad: 'mrpa' },
  reventa_descuento_pct: { etiqueta: 'Descuento reventa habitualista', unidad: 'pct' },
  sellos_prenda_pct: { etiqueta: 'Sellos de la prenda', unidad: 'pct' },
  sellos_prenda_min: { etiqueta: 'Mínimo de sellos de la prenda', unidad: 'pesos' },
  honorarios: { etiqueta: 'Honorarios de la gestora', unidad: 'pesos' },
}

function valorLegible(p: Parametro): string {
  if (p.valor == null) return 'Sin dato'
  const u = NOMBRE[p.clave]?.unidad
  const n = p.valor.replace('.', ',')
  if (u === 'pesos') return formatearPesos(p.valor.split('.')[0])
  if (u === 'pct') return `${n} %`
  if (u === 'por_mil') return `${n} por mil`
  return `${n} MRPA`
}

const alcance = (p: Parametro) => [p.vehiculo === 'moto' ? 'Motos' : p.vehiculo === 'auto' ? 'Autos y pick-ups' : null, p.provincia].filter(Boolean).join(' · ') || 'General'

/** Parámetros vigentes del estimador. Gerencia carga una vigencia nueva; contable solo consulta. */
export function Parametros({ hoy, editable }: { hoy: string; editable: boolean }) {
  const q = useQuery({ queryKey: ['analisis', 'parametros'], queryFn: listarParametros })
  const [editando, setEditando] = useState<Parametro | null>(null)
  if (q.isError) return <ErrorState titulo="No se pudieron cargar los parámetros." />
  if (!q.data) return <Cargando etiqueta="Cargando parámetros…" />
  const vigentes = q.data.filter((p) => !p.vigencia_hasta || p.vigencia_hasta >= hoy)
  return (
    <>
      <p className="mb-4 text-[13px] text-tenue">
        Cada cambio guarda una vigencia nueva con su fuente. Los estimados ya calculados no cambian: para usar los valores nuevos, recalculá el estimado del trámite.
      </p>
      <DataTable aria-label="Parámetros del estimador">
        <thead>
          <tr>
            <th>Parámetro</th>
            <th>Aplica a</th>
            <th className="text-right">Valor</th>
            <th>Vigente desde</th>
            <th>Fuente</th>
            {editable && <th><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {vigentes.map((p) => (
            <tr key={p.id}>
              <td className={celdaPrincipal}>{NOMBRE[p.clave]?.etiqueta ?? p.clave}</td>
              <td>{alcance(p)}</td>
              <td className={celdaMonto}>{valorLegible(p)}</td>
              <td className="cifra">{p.vigencia_desde.split('-').reverse().join('/')}</td>
              <td className="max-w-80">
                <span className="line-clamp-2 text-[13px]">{p.fuente}</span>
                {!p.verificado && <Chip tono="comprometido" className="mt-1">A confirmar</Chip>}
              </td>
              {editable && (
                <td className="text-right">
                  <Button variante="fantasma" tamano="sm" onClick={() => setEditando(p)} aria-label={`Actualizar ${NOMBRE[p.clave]?.etiqueta ?? p.clave} (${alcance(p)})`}>
                    Actualizar
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
      {editando && <FormParametro p={editando} hoy={hoy} onCerrar={() => setEditando(null)} />}
    </>
  )
}

function FormParametro({ p, hoy, onCerrar }: { p: Parametro; hoy: string; onCerrar: () => void }) {
  const qc = useQueryClient()
  const unidad = NOMBRE[p.clave]?.unidad
  const [valor, setValor] = useState(p.valor == null ? '' : unidad === 'pesos' ? formatearPesos(p.valor.split('.')[0]).replace('$ ', '') : p.valor.replace('.', ','))
  const [desde, setDesde] = useState(hoy)
  const [fuente, setFuente] = useState('')
  const [verificado, setVerificado] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const m = useMutacionUnica({
    mutationFn: async () => {
      let v: string | null = null
      if (valor.trim()) {
        if (unidad === 'pesos') v = parsearPesos(valor).toString()
        else {
          const t = valor.trim().replace(',', '.')
          if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('Ingresá un número, por ejemplo 1,2.')
          v = t
        }
      }
      await guardarParametro({ clave: p.clave, vehiculo: p.vehiculo, provincia: p.provincia, valor: v, vigencia_desde: desde, fuente, verificado })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['analisis', 'parametros'] })
      onCerrar()
    },
    onError: (e) => setError(mensajeError(e)),
  })
  return (
    <Dialogo titulo={`Actualizar ${NOMBRE[p.clave]?.etiqueta ?? p.clave}`} rotulo={alcance(p)} onCerrar={onCerrar} bloqueado={m.isPending}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate() }}>
        <Field label={unidad === 'pesos' ? 'Valor en pesos' : unidad === 'pct' ? 'Porcentaje' : unidad === 'por_mil' ? 'Por mil' : 'Cantidad de MRPA'} ayuda="Dejalo vacío si todavía no hay un dato confirmado.">
          {(c) => unidad === 'pesos'
            ? <CampoPesos {...c} value={valor} onValor={setValor} />
            : <Input {...c} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
        </Field>
        <Field label="Vigente desde">{(c) => <Input {...c} type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} />}</Field>
        <Field label="Fuente" ayuda="Norma, recibo o planilla de donde sale el valor.">
          {(c) => <Input {...c} required value={fuente} onChange={(e) => setFuente(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" className="size-4" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} />
          Verificado contra la fuente oficial o un recibo real
        </label>
        {error && <p role="alert" className="text-sm text-sinfondos">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variante="secundario" onClick={onCerrar}>Cancelar</Button>
          <Button type="submit" cargando={m.isPending}>Guardar vigencia</Button>
        </div>
      </form>
    </Dialogo>
  )
}
