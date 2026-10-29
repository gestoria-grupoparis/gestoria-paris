import { useMemo, useState, type FormEvent } from 'react'
import type { Rol } from '../../lib/sesion'
import { mensajeError } from '../../lib/errores'
import { Button, claseControl, cx, Field } from '../../ui'
import { IconoAlerta, IconoCheck } from '../../ui/Iconos'
import { Dialogo } from '../tramites/Dialogo'
import {
  editarUsuario,
  invitarUsuario,
  ROLES_CON_ALCANCE,
  rolesAsignables,
  seleccionDesdeAlcances,
  validarUsuario,
  type Alcance,
  type CatalogoAlcance,
  type Seleccion,
  type Usuario,
} from './usuarios'

interface OpcionEmpresa {
  id: string
  nombre: string
  permiteTodas: boolean
  sucursales: { id: string; nombre: string }[]
}

/** Admin otorga cualquier alcance; gerencia solo dentro de los suyos. */
function opcionesDeAlcance(miRol: Rol | null, misAlcances: Alcance[], cat: CatalogoAlcance): OpcionEmpresa[] {
  return cat.empresas
    .map((e) => {
      if (miRol === 'admin') return { ...e, permiteTodas: true, sucursales: cat.sucursales }
      const mios = misAlcances.filter((a) => a.empresa_id === e.id)
      if (mios.some((a) => a.sucursal_id == null)) return { ...e, permiteTodas: true, sucursales: cat.sucursales }
      return { ...e, permiteTodas: false, sucursales: cat.sucursales.filter((s) => mios.some((a) => a.sucursal_id === s.id)) }
    })
    .filter((o) => o.permiteTodas || o.sucursales.length > 0)
}

export function FormUsuario({
  usuario,
  miRol,
  misAlcances,
  catalogo,
  onCerrar,
  onGuardado,
}: {
  /** null = alta por invitación. */
  usuario: Usuario | null
  miRol: Rol | null
  misAlcances: Alcance[]
  catalogo: CatalogoAlcance
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}) {
  const alta = usuario == null
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? 'contable')
  const [seleccion, setSeleccion] = useState<Seleccion>(() => seleccionDesdeAlcances(usuario?.alcancesCrudos ?? []))
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const roles = rolesAsignables(miRol)
  const opciones = useMemo(() => opcionesDeAlcance(miRol, misAlcances, catalogo), [miRol, misAlcances, catalogo])
  const usaAlcance = ROLES_CON_ALCANCE.includes(rol)

  function alternarEmpresa(o: OpcionEmpresa) {
    setSeleccion((s) => {
      const n = { ...s }
      if (n[o.id]) delete n[o.id]
      else n[o.id] = { todas: o.permiteTodas, sucursales: [] }
      return n
    })
  }
  function modoEmpresa(id: string, todas: boolean) {
    setSeleccion((s) => ({ ...s, [id]: { todas, sucursales: todas ? [] : (s[id]?.sucursales ?? []) } }))
  }
  function alternarSucursal(empresa: string, suc: string) {
    setSeleccion((s) => {
      const g = s[empresa] ?? { todas: false, sucursales: [] }
      const sucursales = g.sucursales.includes(suc) ? g.sucursales.filter((x) => x !== suc) : [...g.sucursales, suc]
      return { ...s, [empresa]: { todas: false, sucursales } }
    })
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const datos = { email, nombre, rol, seleccion: usaAlcance ? seleccion : {} }
    const invalido = validarUsuario(datos, alta ? 'alta' : 'edicion') ?? (!alta && !motivo.trim() ? 'Contá brevemente el motivo del cambio.' : null)
    if (invalido) return setError(invalido)
    setError(null)
    setEnviando(true)
    try {
      if (alta) {
        await invitarUsuario(datos)
        onGuardado(`Invitación enviada a ${email.trim().toLowerCase()}.`)
      } else {
        await editarUsuario(usuario.id, datos, motivo)
        onGuardado(`Cambios guardados para ${nombre.trim()}.`)
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      setError(
        /^DUPLICADO/.test(msg) && alta
          ? 'Ya existe un usuario con ese email.'
          : /^EMPRESA_DISTINTA/.test(msg)
            ? 'Hay razones sociales o sucursales fuera de tu alcance.'
            : mensajeError(err),
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo={alta ? 'Invitar usuario' : `Editar a ${usuario.nombre}`} rotulo="Usuarios y permisos" onCerrar={onCerrar} ancho="md:max-w-2xl">
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        {alta && (
          <Field label="Email" ayuda="Le llega un mail para definir su contraseña y entrar.">
            {(p) => (
              <input
                {...p}
                type="email"
                autoComplete="off"
                placeholder="nombre@grupoparis.com.ar"
                className={claseControl}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Nombre y apellido">
          {(p) => <input {...p} className={claseControl} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Field>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-tinta">Rol</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label
                key={r.id}
                className={cx(
                  'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 transition-colors',
                  rol === r.id ? 'bg-marca-suave ring-marca' : 'bg-superficie ring-linea hover:ring-linea-fuerte',
                )}
              >
                <input type="radio" name="rol" value={r.id} checked={rol === r.id} onChange={() => setRol(r.id)} className="mt-1 accent-marca" />
                <span className="leading-snug">
                  <span className="block text-[14px] font-semibold text-tinta">{r.etiqueta}</span>
                  <span className="block text-[12px] text-tenue">{r.descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-tinta">Alcance</legend>
          {!usaAlcance ? (
            <p className="rounded-lg bg-hundido p-3 text-[13px] text-tenue">
              {rol === 'gestora' ? 'La gestora ve solo los trámites que tiene asignados: no necesita razones sociales.' : 'Administración no opera trámites: no necesita razones sociales.'}
            </p>
          ) : opciones.length === 0 ? (
            <p className="rounded-lg bg-hundido p-3 text-[13px] text-tenue">No tenés razones sociales para otorgar.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {opciones.map((o) => {
                const g = seleccion[o.id]
                return (
                  <li key={o.id} className={cx('rounded-lg ring-1', g ? 'bg-superficie ring-linea-fuerte' : 'bg-superficie ring-linea')}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input type="checkbox" checked={!!g} onChange={() => alternarEmpresa(o)} className="size-4 accent-marca" />
                      <span className="text-[14px] font-semibold text-tinta">{o.nombre}</span>
                      {g && (
                        <span className="ml-auto text-[12px] text-tenue">
                          {g.todas ? 'Todas las sucursales' : `${g.sucursales.length} sucursal${g.sucursales.length === 1 ? '' : 'es'}`}
                        </span>
                      )}
                    </label>
                    {g && (
                      <div className="border-t border-linea px-3 pt-2.5 pb-3">
                        {o.permiteTodas && (
                          <div role="radiogroup" aria-label={`Sucursales de ${o.nombre}`} className="mb-2 inline-flex rounded-md bg-hundido p-0.5">
                            {[true, false].map((todas) => (
                              <button
                                key={String(todas)}
                                type="button"
                                role="radio"
                                aria-checked={g.todas === todas}
                                onClick={() => modoEmpresa(o.id, todas)}
                                className={cx(
                                  'h-9 rounded-[5px] px-3 text-[13px] font-medium transition-colors',
                                  g.todas === todas ? 'bg-superficie text-tinta shadow-tarjeta' : 'text-tenue hover:text-tinta',
                                )}
                              >
                                {todas ? 'Todas las sucursales' : 'Elegir sucursales'}
                              </button>
                            ))}
                          </div>
                        )}
                        {!g.todas && (
                          <div className="flex flex-wrap gap-2">
                            {o.sucursales.map((s) => {
                              const on = g.sucursales.includes(s.id)
                              return (
                                <label
                                  key={s.id}
                                  className={cx(
                                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-[13px] ring-1 transition-colors',
                                    on ? 'bg-marca-suave font-semibold text-tinta ring-marca' : 'text-tenue ring-linea hover:ring-linea-fuerte',
                                  )}
                                >
                                  <input type="checkbox" className="sr-only" checked={on} onChange={() => alternarSucursal(o.id, s.id)} />
                                  {on && <IconoCheck className="size-3.5 text-marca" />}
                                  {s.nombre}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>

        {!alta && (
          <Field label="Motivo del cambio" ayuda="Queda en el historial de auditoría.">
            {(p) => (
              <input {...p} className={claseControl} placeholder="Ej.: pasa a trabajar en Paris Cars" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            )}
          </Field>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-sinfondos-suave p-3 text-[13px] font-medium text-sinfondos">
            <IconoAlerta className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-linea pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : alta ? 'Enviar invitación' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

export function DialogoEstadoUsuario({
  usuario,
  onCerrar,
  onConfirmar,
}: {
  usuario: Usuario
  onCerrar: () => void
  onConfirmar: (motivo: string) => Promise<void>
}) {
  const desactivar = usuario.activo
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!motivo.trim()) return setError('Contá brevemente el motivo.')
    setEnviando(true)
    setError(null)
    try {
      await onConfirmar(motivo)
    } catch (err) {
      setError(mensajeError(err))
      setEnviando(false)
    }
  }
  return (
    <Dialogo titulo={desactivar ? `Desactivar a ${usuario.nombre}` : `Reactivar a ${usuario.nombre}`} rotulo="Usuarios y permisos" onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <p className="text-[14px] leading-relaxed text-tenue">
          {desactivar
            ? 'Deja de poder entrar a la app en su próximo acceso. Sus trámites, pagos e historial se conservan.'
            : 'Vuelve a entrar con su email y contraseña, con el rol y el alcance que tenía.'}
        </p>
        <Field label="Motivo" ayuda="Queda en el historial de auditoría.">
          {(p) => <input {...p} className={claseControl} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-sinfondos">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-linea pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" variante={desactivar ? 'peligro' : 'primario'} disabled={enviando}>
            {desactivar ? 'Desactivar' : 'Reactivar'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
