import { cloneElement, useState, type FormEvent, type ReactElement } from 'react'
import { codigoError, mensajeError } from '../../lib/errores'
import { nuevaIdem } from '../../lib/supabase'
import { buscarDuplicados, crearTramite, type Catalogos } from './consultas'
import { Button, claseControl, Field } from '../../ui'
import { Dialogo } from './Dialogo'
import { etiquetaEstado } from './filtros'

interface Props {
  catalogos: Catalogos
  onCerrar: () => void
  onCreado: (id: string) => void
}

type Duplicado = { id: string; numero: string; estado: string }

const VACIO = { empresa: '', sucursal: '', tipo: '', cliente: '', cuentaPersonal: '', oferta: '', vehiculo: '', dominio: '', chasis: '' }
type Clave = keyof typeof VACIO

const ULTIMA = 'alta-ultima-empresa-sucursal'
/** Formatos de patente: AA123BB (Mercosur) o ABC123 (anterior). */
export const DOMINIO_VALIDO = /^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$/

const OBLIGATORIOS: [Clave, string][] = [
  ['cliente', 'Indicá el cliente.'],
  ['cuentaPersonal', 'Indicá la cuenta personal.'],
  ['empresa', 'Elegí la razón social.'],
  ['sucursal', 'Elegí la sucursal.'],
  ['oferta', 'Indicá la oferta.'],
  ['tipo', 'Elegí el tipo.'],
  ['vehiculo', 'Indicá el vehículo.'],
]

export function validarAlta(d: typeof VACIO): Partial<Record<Clave, string>> {
  const e: Partial<Record<Clave, string>> = {}
  for (const [k, msg] of OBLIGATORIOS) if (!d[k].trim()) e[k] = msg
  if (d.dominio.trim() && !DOMINIO_VALIDO.test(d.dominio.trim())) e.dominio = 'El dominio tiene que ser AA123BB o ABC123.'
  return e
}

function inicial(catalogos: Props['catalogos']): typeof VACIO {
  let ultima: { empresa?: string; sucursal?: string } = {}
  try {
    ultima = JSON.parse(localStorage.getItem(ULTIMA) ?? '{}')
  } catch {
    /* sin storage */
  }
  const unica = <T extends { id: string }>(xs: T[], previa?: string) =>
    xs.length === 1 ? xs[0].id : xs.some((x) => x.id === previa) ? previa! : ''
  return { ...VACIO, empresa: unica(catalogos.empresas, ultima.empresa), sucursal: unica(catalogos.sucursales, ultima.sucursal) }
}

export function FormAlta({ catalogos, onCerrar, onCreado }: Props) {
  const [idem] = useState(nuevaIdem) // se genera al abrir el formulario, no al enviarlo
  const [d, setD] = useState(() => inicial(catalogos))
  const [errores, setErrores] = useState<Partial<Record<Clave, string>>>({})
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const campo = (k: keyof typeof VACIO) => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => {
      setD({ ...d, [k]: k === 'dominio' ? e.target.value.toUpperCase().replace(/\s/g, '') : e.target.value })
      if (errores[k]) setErrores({ ...errores, [k]: undefined })
      if (k === 'empresa' || k === 'oferta' || k === 'dominio') setDuplicados(null)
    },
  })

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget as HTMLFormElement
    const errs = validarAlta(d)
    setErrores(errs)
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid=true]')?.focus())
      return
    }
    try {
      localStorage.setItem(ULTIMA, JSON.stringify({ empresa: d.empresa, sucursal: d.sucursal }))
    } catch {
      /* sin storage */
    }
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

  const sel = claseControl
  return (
    <Dialogo titulo="Nuevo trámite" rotulo="Alta" onCerrar={onCerrar} ancho="md:max-w-2xl">
      <form noValidate onSubmit={guardar} className="space-y-6">
        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-4">
          <legend className="rotulo col-span-2 mb-3">Cliente y operación</legend>
          <Campo label="Cliente" error={errores.cliente} className="col-span-2 sm:col-span-1">
            <input required className={sel} placeholder="Nombre y apellido" {...campo('cliente')} />
          </Campo>
          <Campo label="Cuenta personal" error={errores.cuentaPersonal} className="col-span-2 sm:col-span-1">
            <input required className={sel} placeholder="CP-0000" {...campo('cuentaPersonal')} />
          </Campo>
          <Campo label="Razón social" error={errores.empresa}>
            <select required className={sel} {...campo('empresa')}>
              <option value="">Elegí</option>
              {catalogos.empresas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Sucursal" error={errores.sucursal}>
            <select required className={sel} {...campo('sucursal')}>
              <option value="">Elegí</option>
              {catalogos.sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.provincia})
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Oferta" error={errores.oferta}>
            <input required className={sel} placeholder="OF-0000" {...campo('oferta')} />
          </Campo>
          <Campo label="Tipo" error={errores.tipo}>
            <select required className={sel} {...campo('tipo')}>
              <option value="">Elegí el tipo</option>
              {catalogos.tipos.map((t) => (
                <option key={t.id} value={t.codigo}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-4">
          <legend className="rotulo col-span-2 mb-3">Vehículo</legend>
          <Campo label="Vehículo" error={errores.vehiculo} className="col-span-2">
            <input required className={sel} placeholder="Marca, modelo y versión" {...campo('vehiculo')} />
          </Campo>
          <Campo label="Dominio" error={errores.dominio} ayuda="Si todavía no tiene, dejalo vacío.">
            <input className={`${sel} font-mono tracking-widest uppercase`} placeholder="AA000AA" autoComplete="off" {...campo('dominio')} />
          </Campo>
          <Campo label="Chasis">
            <input className={`${sel} font-mono uppercase`} {...campo('chasis')} />
          </Campo>
        </fieldset>

        {duplicados && (
          <div role="alert" className="rounded-md bg-comprometido-suave px-4 py-3 text-[14px] text-tinta ring-1 ring-comprometido/30">
            <p className="font-semibold text-comprometido">Posible duplicado en la misma razón social:</p>
            <ul className="mt-1.5 space-y-0.5">
              {duplicados.map((x) => (
                <li key={x.id} className="cifra font-medium">
                  {x.numero} <span className="font-normal text-tenue">({etiquetaEstado(x.estado)})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-tenue">Revisá antes de crear otro. Si es un trámite distinto, guardalo de todos modos.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-linea pt-4 sm:flex-row sm:justify-end">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" cargando={enviando}>
            {duplicados?.length ? 'Guardar de todos modos' : 'Guardar trámite'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

/** Campo del alta: rótulo asociado al control por id (Field del kit). */
function Campo({ label, className, ayuda, error, children }: { label: string; className?: string; ayuda?: string; error?: string; children: ReactElement<Record<string, unknown>> }) {
  return (
    <Field label={label} ayuda={ayuda} error={error} className={className ?? 'col-span-2 sm:col-span-1'}>
      {(p) => cloneElement(children, p as unknown as Record<string, unknown>)}
    </Field>
  )
}
