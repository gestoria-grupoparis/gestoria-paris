import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

const CLASE_INPUT =
  'mt-1 w-full border border-linea px-2 py-2 focus-visible:outline-2 focus-visible:outline-marca'

export function Login({ aviso }: { aviso?: string } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={ingresar} className="w-full max-w-sm border border-linea bg-white p-6">
        <h1 className="text-lg font-semibold">Gestoría Paris</h1>
        <p className="mb-5 text-sm text-tenue">Ingresá con tu usuario de la empresa.</p>
        <label className="block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} className={`mb-3 ${CLASE_INPUT}`} />
        <label className="block text-sm font-medium" htmlFor="password">
          Contraseña
        </label>
        <input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className={`mb-4 ${CLASE_INPUT}`} />
        {aviso && !error && (
          <p role="alert" className="mb-3 text-sm text-alerta">
            {aviso}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-alerta">
            {error}
          </p>
        )}
        <button type="submit" disabled={enviando}
          className="w-full bg-marca py-2 font-medium text-white disabled:opacity-60">
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="mt-4 text-xs text-tenue">Si no tenés usuario, pedíselo a gerencia.</p>
      </form>
    </div>
  )
}
