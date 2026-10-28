import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeErrorLogin, type MensajeLogin } from '../lib/erroresAuth'
import { Button, Field, Input, Wordmark } from '../ui'

const PUNTOS = [
  ['Trámites', 'Del alta al cierre, con quién lo tiene y qué falta.'],
  ['Habitualista', 'Saldo disponible, comprometido y conciliado por razón social.'],
  ['Gestoras', 'Lo de hoy en el celular: presentar, pagar, retirar.'],
] as const

export function Login({ aviso }: { aviso?: string } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<MensajeLogin | null>(null)
  const [enviando, setEnviando] = useState(false)

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
    <div className="grid min-h-dvh bg-noche text-superficie lg:grid-cols-[1.15fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden px-14 py-12 lg:flex">
        <Wordmark tono="claro" />
        <div className="relative z-10 max-w-lg">
          <p className="rotulo mb-5 !text-laton">Gestoría interna · Grupo Paris</p>
          <h2 className="font-display text-[56px] font-extrabold leading-[0.98] tracking-[-0.02em]">
            Cada trámite,
            <br />
            cada peso,
            <br />
            <span className="text-laton">en su lugar.</span>
          </h2>
          <ul className="mt-10 flex flex-col gap-4 border-t border-superficie/10 pt-8">
            {PUNTOS.map(([t, d]) => (
              <li key={t} className="flex gap-4">
                <span aria-hidden className="mt-2 h-px w-6 shrink-0 bg-laton" />
                <p className="text-[15px] leading-relaxed text-superficie/70">
                  <strong className="font-semibold text-superficie">{t}.</strong> {d}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-[12px] text-superficie/70">Uso interno · acceso solo con usuario asignado por gerencia</p>
        <span aria-hidden className="pointer-events-none absolute -right-32 -bottom-32 size-[28rem] rounded-full border-[48px] border-marca/50" />
        <span aria-hidden className="pointer-events-none absolute right-24 bottom-40 size-24 rounded-full border-[14px] border-laton/25" />
      </section>

      <main className="flex items-center justify-center px-4 py-10 lg:bg-fondo lg:text-tinta">
        <form
          onSubmit={ingresar}
          className="w-full max-w-[400px] rounded-2xl bg-superficie p-7 text-tinta shadow-flotante ring-1 ring-linea sm:p-9 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0"
        >
          <Wordmark className="mb-8 lg:hidden" />
          <p className="rotulo mb-2">Acceso</p>
          <h1 className="font-display text-[34px] font-extrabold leading-[1.05] tracking-tight">Ingresá a tu cuenta</h1>
          <p className="mt-2 mb-8 text-[15px] leading-relaxed text-tenue">Usá el email y la contraseña que te dio gerencia.</p>

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
                  className="-my-3 min-h-11 min-w-11 rounded px-2 py-3 text-[13px] font-semibold text-marca hover:underline">
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
            <div role="alert" className="mt-5 flex gap-3 rounded-lg bg-sinfondos-suave px-4 py-3 text-sinfondos ring-1 ring-sinfondos/20">
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

          <div className="mt-7 rounded-lg bg-hundido px-4 py-3.5 text-[13px] leading-relaxed text-tenue">
            <p className="font-semibold text-tinta">¿Olvidaste la contraseña o no tenés usuario?</p>
            <p>Pedíselo a gerencia: las cuentas se crean y se restablecen desde la administración de usuarios. No hay registro abierto.</p>
          </div>
        </form>
      </main>
    </div>
  )
}
