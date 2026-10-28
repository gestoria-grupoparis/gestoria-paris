import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, Input, Wordmark } from '../ui'

export function Login({ aviso }: { aviso?: string } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function ingresar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setEnviando(false)
    if (error) setError('Email o contraseña incorrectos.')
  }

  return (
    <div className="grid min-h-dvh bg-noche text-superficie lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <Wordmark tono="claro" />
        <div className="max-w-md">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-laton">Gestoría interna</p>
          <h2 className="font-display text-[52px] font-extrabold leading-[1.02] tracking-tight">
            Cada trámite,
            <br />
            cada peso,
            <br />
            <span className="text-laton">en su lugar.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-relaxed text-superficie/70">
            Patentamientos, transferencias y la cuenta del habitualista de las cuatro razones sociales, en un solo tablero.
          </p>
        </div>
        <p className="text-[12px] text-superficie/45">Grupo Paris · uso interno</p>
        <span aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border-[40px] border-marca/60" />
      </section>

      <main className="flex items-center justify-center px-4 py-10 lg:bg-fondo lg:text-tinta">
        <form
          onSubmit={ingresar}
          className="w-full max-w-[400px] rounded-xl bg-superficie p-7 text-tinta shadow-flotante ring-1 ring-linea sm:p-9 lg:shadow-none lg:ring-0 lg:bg-transparent"
        >
          <Wordmark className="mb-8 lg:hidden" />
          <h1 className="text-[30px] font-extrabold leading-tight">Ingresá a tu cuenta</h1>
          <p className="mt-1 mb-7 text-[15px] text-tenue">Usá el email y la contraseña que te dio gerencia.</p>

          <div className="flex flex-col gap-4">
            <Field label="Email" id="email">
              {(a) => (
                <Input {...a} type="email" autoComplete="username" required value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <Field
              label="Contraseña"
              id="password"
              extra={
                <button type="button" onClick={() => setVer((v) => !v)} aria-pressed={ver}
                  className="rounded px-1 text-[13px] font-semibold text-marca hover:underline">
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

          {(error || aviso) && (
            <p role="alert" className="mt-4 rounded-md bg-sinfondos-suave px-3 py-2.5 text-sm font-medium text-sinfondos">
              {error ?? aviso}
            </p>
          )}

          <Button type="submit" tamano="lg" ancho cargando={enviando} className="mt-6">
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </Button>

          <div className="mt-6 border-t border-linea pt-5 text-[13px] leading-relaxed text-tenue">
            ¿Olvidaste la contraseña o no tenés usuario? Pedíselo a gerencia: te la restablecen desde la administración de usuarios.
          </div>
        </form>
      </main>
    </div>
  )
}
