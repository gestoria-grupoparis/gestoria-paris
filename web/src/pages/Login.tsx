import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeErrorLogin, type MensajeLogin } from '../lib/erroresAuth'
import { Button, Field, Input, LogoGrupoParis, MarqueeMarcas, Monograma } from '../ui'

/**
 * Parallax sutil: capas que se desplazan con el puntero (y el scroll en móvil) a distinta velocidad.
 * Solo transform, agrupado en requestAnimationFrame; apagado con prefers-reduced-motion.
 */
function useParallax(capas: { ref: RefObject<HTMLElement | null>; factor: number }[]) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let x = 0, y = 0, raf = 0
    const pintar = () => {
      raf = 0
      const s = Math.min(window.scrollY, 200) / 200
      for (const c of capas) {
        if (c.ref.current) c.ref.current.style.transform = `translate3d(${(x * c.factor).toFixed(2)}px, ${(y * c.factor - s * c.factor * 4).toFixed(2)}px, 0)`
      }
    }
    const pedir = () => { if (!raf) raf = requestAnimationFrame(pintar) }
    const mover = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth - 0.5) * 2
      y = (e.clientY / window.innerHeight - 0.5) * 2
      pedir()
    }
    window.addEventListener('pointermove', mover, { passive: true })
    window.addEventListener('scroll', pedir, { passive: true })
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('scroll', pedir)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function Login({ aviso }: { aviso?: string } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<MensajeLogin | null>(null)
  const [enviando, setEnviando] = useState(false)
  const fondo = useRef<HTMLDivElement>(null)
  const frente = useRef<HTMLDivElement>(null)
  useParallax([{ ref: fondo, factor: 8 }, { ref: frente, factor: -3 }])

  async function ingresar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setError(mensajeErrorLogin(error))
    } catch (err) {
      setError(mensajeErrorLogin({ message: err instanceof Error ? err.message : 'network' }))
    } finally {
      setEnviando(false)
    }
  }

  const alerta = error ?? (aviso ? { titulo: aviso, detalle: '' } : null)

  return (
    <div className="tema-oscuro relative isolate flex min-h-dvh flex-col overflow-hidden bg-noche text-tinta">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgb(255_255_255/0.09),transparent_65%)]" />
      <div ref={fondo} aria-hidden className="pointer-events-none absolute -right-[22vh] top-1/2 -z-10 -translate-y-1/2 will-change-transform [mask-image:radial-gradient(closest-side,#000_55%,transparent)]">
        <Monograma titulo="" className="size-[92vh] max-w-none text-white/[0.035]" />
      </div>

      <header className="flex items-center justify-between px-5 pt-6 md:px-10 md:pt-8">
        <LogoGrupoParis className="h-20 md:h-24" />
        <span className="rotulo-marca hidden text-white/60 sm:inline">Gestoría interna</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <form onSubmit={ingresar} className="w-full max-w-[380px]">
          <p className="rotulo-marca mb-4 text-white/60">Acceso</p>
          <h1 className="font-marca text-[22px] leading-[1.25] font-normal tracking-[0.02em] text-white md:text-[26px]">Ingresá a tu cuenta</h1>
          <p className="mt-3 mb-9 text-[14px] leading-relaxed text-tenue">Usá el email y la contraseña que te dio gerencia.</p>

          <div className="flex flex-col gap-5">
            <Field label="Email" id="email" ayuda="El de tu trabajo, por ejemplo nombre@grupoparis.com.ar">
              {(a) => (
                <Input {...a} type="email" autoComplete="username" inputMode="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <Field
              label="Contraseña"
              id="password"
              extra={
                <button type="button" onClick={() => setVer((v) => !v)} aria-pressed={ver}
                  aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="-my-3 min-h-11 min-w-11 rounded px-2 py-3 text-[13px] font-medium text-tenue hover:text-tinta">
                  {ver ? 'Ocultar' : 'Mostrar'}
                </button>
              }
            >
              {(a) => (
                <Input {...a} type={ver ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
          </div>

          {alerta && (
            <div role="alert" className="mt-5 flex gap-3 rounded-md bg-sinfondos-suave px-4 py-3 text-sinfondos ring-1 ring-sinfondos/25">
              <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
              </svg>
              <div className="text-sm leading-snug">
                <p className="font-semibold">{alerta.titulo}</p>
                {alerta.detalle && <p className="mt-0.5 text-tinta/75">{alerta.detalle}</p>}
              </div>
            </div>
          )}

          <Button type="submit" tamano="lg" ancho cargando={enviando} className="mt-7">
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </Button>

          <div className="mt-8 border-t border-linea pt-6 text-[13px] leading-relaxed text-tenue">
            <p className="font-medium text-tinta">¿Olvidaste la contraseña o no tenés usuario?</p>
            <p>Pedíselo a gerencia: las cuentas se crean y se restablecen desde la administración de usuarios. No hay registro abierto.</p>
          </div>
        </form>
      </main>

      <footer className="pb-8 md:pb-10">
        <div ref={frente} className="will-change-transform">
          <MarqueeMarcas />
        </div>
        <p className="mt-7 text-center text-[12px] text-white/60">Uso interno · acceso solo con usuario asignado por gerencia</p>
      </footer>
    </div>
  )
}
