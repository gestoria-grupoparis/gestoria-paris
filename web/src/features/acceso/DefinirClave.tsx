import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { evaluarClave, mensajeErrorClave, type MensajeClave } from '../../lib/clave'
import { Button, Field, Input, cx } from '../../ui'
import { AlertaAcceso, BotonVer, MarcoAcceso } from './MarcoAcceso'

const TONO_NIVEL = ['', 'bg-sinfondos', 'bg-comprometido', 'bg-disponible']

function Check({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={cx('grid size-4 shrink-0 place-items-center rounded-full ring-1 transition-colors', ok ? 'bg-disponible text-noche ring-disponible' : 'text-transparent ring-white/25')}>
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 8.5 2.5 2.5L12 5.5" /></svg>
    </span>
  )
}

/**
 * Definir contraseña (link de invitación o recuperación, ya con sesión) o cambiarla desde el menú
 * (pide la actual y la verifica antes de guardar).
 */
export function DefinirClave({ modo, alTerminar }: { modo: 'definir' | 'cambiar'; alTerminar: () => void }) {
  const [email, setEmail] = useState<string | undefined>()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<MensajeClave | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? undefined))
  }, [])

  const ev = evaluarClave(nueva, repetida, email)
  const cambiar = modo === 'cambiar'
  const noCoincide = repetida.length > 0 && !ev.coincide && repetida.length >= nueva.length

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (cambiar && !actual) return setError({ titulo: 'Escribí tu contraseña actual.', detalle: '' })
    if (ev.nivel < 2) return setError({ titulo: 'Todavía no cumple con los requisitos.', detalle: 'Revisá la lista debajo de la contraseña nueva.' })
    if (!ev.coincide) return setError({ titulo: 'Las contraseñas no coinciden.', detalle: 'Escribí la misma contraseña en los dos campos.' })
    setEnviando(true)
    try {
      if (cambiar) {
        const r = await supabase.auth.signInWithPassword({ email: email ?? '', password: actual })
        if (r.error) {
          const credenciales = r.error.code === 'invalid_credentials' || /invalid login/i.test(r.error.message)
          return setError(credenciales
            ? { titulo: 'La contraseña actual no es correcta.', detalle: 'Revisá que no tengas las mayúsculas activadas.' }
            : mensajeErrorClave(r.error))
        }
      }
      const { error } = await supabase.auth.updateUser({ password: nueva })
      if (error) return setError(mensajeErrorClave(error))
      setHecho(true)
    } catch (err) {
      setError(mensajeErrorClave({ message: err instanceof Error ? err.message : 'network' }))
    } finally {
      setEnviando(false)
    }
  }

  if (hecho)
    return (
      <MarcoAcceso>
        <span aria-hidden className="mb-6 grid size-12 place-items-center rounded-full bg-disponible/15 text-disponible ring-1 ring-disponible/30">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <h1 className="font-marca text-[22px] leading-[1.25] font-normal tracking-[0.02em] text-white md:text-[26px]">Contraseña guardada</h1>
        <p role="status" className="mt-3 text-[14px] leading-relaxed text-tenue">
          {cambiar ? 'La próxima vez que ingreses, usá la contraseña nueva.' : 'Listo. Desde ahora ingresás con tu email y esta contraseña.'}
        </p>
        <Button tamano="lg" ancho className="mt-8" onClick={alTerminar} autoFocus>
          {cambiar ? 'Volver' : 'Ir al sistema'}
        </Button>
      </MarcoAcceso>
    )

  return (
    <MarcoAcceso>
      <form onSubmit={guardar} noValidate>
        <p className="rotulo-marca mb-4 text-white/60">{cambiar ? 'Tu cuenta' : 'Acceso'}</p>
        <h1 className="font-marca text-[22px] leading-[1.25] font-normal tracking-[0.02em] text-white md:text-[26px]">
          {cambiar ? 'Cambiar contraseña' : 'Definí tu contraseña'}
        </h1>
        <p className="mt-3 mb-9 text-[14px] leading-relaxed text-tenue">
          {cambiar ? 'Confirmá la actual y elegí una nueva.' : 'Elegí la contraseña con la que vas a ingresar de ahora en más.'}
          {email && <span className="mt-1 block truncate text-tinta/80">{email}</span>}
        </p>

        <div className="flex flex-col gap-5">
          {cambiar && (
            <Field label="Contraseña actual" id="clave-actual">
              {(a) => <Input {...a} type={ver ? 'text' : 'password'} autoComplete="current-password" value={actual} onChange={(e) => { setActual(e.target.value); setError(null) }} />}
            </Field>
          )}
          <div>
            <Field label="Contraseña nueva" id="clave-nueva" extra={<BotonVer ver={ver} onClick={() => setVer((v) => !v)} />}>
              {(a) => (
                <Input {...a} aria-describedby="clave-requisitos" type={ver ? 'text' : 'password'} autoComplete="new-password"
                  value={nueva} onChange={(e) => { setNueva(e.target.value); setError(null) }} />
              )}
            </Field>
            <div id="clave-requisitos" className="mt-3">
              <div className="flex items-center gap-3">
                <div aria-hidden className="grid flex-1 grid-cols-3 gap-1.5">
                  {[1, 2, 3].map((n) => (
                    <span key={n} className={cx('h-1 rounded-full transition-colors duration-200', ev.nivel >= n ? TONO_NIVEL[ev.nivel] : 'bg-white/10')} />
                  ))}
                </div>
                <span aria-live="polite" className="w-20 text-right text-[12px] font-medium text-tenue">{ev.etiqueta}</span>
              </div>
              <ul className="mt-3 grid gap-1.5 text-[13px] text-tenue">
                {ev.requisitos.map((r) => (
                  <li key={r.id} className={cx('flex items-center gap-2 transition-colors', r.ok && 'text-tinta/85')}>
                    <Check ok={r.ok} />
                    {r.texto}
                    <span className="sr-only">{r.ok ? '(cumple)' : '(falta)'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Field label="Repetí la contraseña" id="clave-repetida"
            error={noCoincide ? 'No coinciden' : null}
            ayuda={repetida && ev.coincide ? 'Coinciden' : undefined}>
            {(a) => <Input {...a} type={ver ? 'text' : 'password'} autoComplete="new-password" value={repetida} onChange={(e) => { setRepetida(e.target.value); setError(null) }} />}
          </Field>
        </div>

        {error && <AlertaAcceso titulo={error.titulo} detalle={error.detalle} />}

        <Button type="submit" tamano="lg" ancho cargando={enviando} className="mt-7">
          {enviando ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
        {cambiar && (
          <Button type="button" variante="fantasma" tamano="lg" ancho className="mt-2.5" onClick={alTerminar}>
            Cancelar
          </Button>
        )}
      </form>
    </MarcoAcceso>
  )
}
