import { useState, type FormEvent } from 'react'
import { codigoError, mensajeError } from '../../lib/errores'
import { nuevaIdem } from '../../lib/supabase'
import { buscarDuplicados, crearTramite, type Catalogos } from './consultas'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from './Dialogo'
import { etiquetaEstado } from './filtros'

interface Props {
  catalogos: Catalogos
  onCerrar: () => void
  onCreado: (id: string) => void
}

type Duplicado = { id: string; numero: string; estado: string }

const VACIO = { empresa: '', sucursal: '', tipo: '', cliente: '', cuentaPersonal: '', oferta: '', vehiculo: '', dominio: '', chasis: '' }

export function FormAlta({ catalogos, onCerrar, onCreado }: Props) {
  const [idem] = useState(nuevaIdem) // se genera al abrir el formulario, no al enviarlo
  const [d, setD] = useState(VACIO)
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const campo = (k: keyof typeof VACIO) => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => {
      setD({ ...d, [k]: e.target.value })
      if (k === 'empresa' || k === 'oferta' || k === 'dominio') setDuplicados(null)
    },
  })

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      // Primer intento: si hay posibles duplicados se avisa y hace falta confirmar.
      if (duplicados === null) {
        const encontrados = await buscarDuplicados(d.empresa, d.oferta.trim(), d.dominio.trim())
        if (encontrados.length) {
          setDuplicados(encontrados)
          return
        }
      }
      onCreado(await crearTramite({ idem, ...d }))
    } catch (err) {
      const detalle = err && typeof err === 'object' && 'message' in err ? String(err.message) : ''
      setError(codigoError(err) === 'DUPLICADO' ? `No se creó: ${detalle.replace(/^DUPLICADO:\s*/, '')}.` : mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Nuevo trámite" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="grid grid-cols-2 gap-x-3 gap-y-2">
        <label className="col-span-2 sm:col-span-1">
          <span className={CLASE_ETIQUETA}>Cliente</span>
          <input required className={CLASE_CAMPO} {...campo('cliente')} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className={CLASE_ETIQUETA}>Cuenta personal</span>
          <input required className={CLASE_CAMPO} {...campo('cuentaPersonal')} />
        </label>
        <label>
          <span className={CLASE_ETIQUETA}>Oferta</span>
          <input required className={CLASE_CAMPO} {...campo('oferta')} />
        </label>
        <label>
          <span className={CLASE_ETIQUETA}>Dominio</span>
          <input className={`${CLASE_CAMPO} uppercase`} {...campo('dominio')} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className={CLASE_ETIQUETA}>Vehículo</span>
          <input required className={CLASE_CAMPO} {...campo('vehiculo')} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className={CLASE_ETIQUETA}>Chasis</span>
          <input className={`${CLASE_CAMPO} uppercase`} {...campo('chasis')} />
        </label>
        <label className="col-span-2">
          <span className={CLASE_ETIQUETA}>Tipo</span>
          <select required className={CLASE_CAMPO} {...campo('tipo')}>
            <option value="">Elegí el tipo</option>
            {catalogos.tipos.map((t) => (
              <option key={t.id} value={t.codigo}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={CLASE_ETIQUETA}>Razón social</span>
          <select required className={CLASE_CAMPO} {...campo('empresa')}>
            <option value="">Elegí</option>
            {catalogos.empresas.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={CLASE_ETIQUETA}>Sucursal</span>
          <select required className={CLASE_CAMPO} {...campo('sucursal')}>
            <option value="">Elegí</option>
            {catalogos.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre} ({s.provincia})
              </option>
            ))}
          </select>
        </label>

        {duplicados && (
          <div role="alert" className="col-span-2 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm">
            <p className="font-semibold">Posible duplicado en la misma razón social:</p>
            <ul className="mt-1 list-inside list-disc">
              {duplicados.map((x) => (
                <li key={x.id}>
                  {x.numero} ({etiquetaEstado(x.estado)})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-tenue">Revisá antes de crear otro. Si es un trámite distinto, guardalo de todos modos.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="col-span-2 text-sm text-alerta">
            {error}
          </p>
        )}
        <div className="col-span-2 mt-2 flex justify-end gap-2">
          <button type="button" className={CLASE_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={CLASE_PRIMARIO} disabled={enviando}>
            {duplicados?.length ? 'Guardar de todos modos' : 'Guardar trámite'}
          </button>
        </div>
      </form>
    </Dialogo>
  )
}
