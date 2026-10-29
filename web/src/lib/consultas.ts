import { MutationCache, QueryCache, QueryClient, useMutation, type UseMutationOptions } from '@tanstack/react-query'
import { useRef } from 'react'
import { codigoError, esSesionVencida } from './errores'

export const AVISO_SESION_VENCIDA = 'aviso-sesion-vencida'

/** Sólo se reintentan errores transitorios (red, 5xx); nunca reglas de negocio ni permisos. */
export function debeReintentar(intentos: number, e: unknown): boolean {
  if (codigoError(e) != null || esSesionVencida(e)) return false
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (/^(23|42|PGRST)/.test(code)) return false
  return intentos < 2
}

export function crearQueryClient(alVencerSesion: () => void = () => {}): QueryClient {
  const alError = (e: unknown) => {
    if (esSesionVencida(e)) alVencerSesion()
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: alError }),
    mutationCache: new MutationCache({ onError: alError }),
    defaultOptions: {
      queries: { retry: debeReintentar, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  })
}

/**
 * useMutation que ignora un segundo disparo mientras el primero sigue en curso (doble clic):
 * isPending de React Query se notifica en diferido, así que el botón no llega a deshabilitarse a tiempo.
 */
export function useMutacionUnica<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  opciones: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  const m = useMutation(opciones)
  const enCurso = useRef(false)
  const mutate = (vars: TVariables) => {
    if (enCurso.current) return
    enCurso.current = true
    m.mutate(vars, { onSettled: () => void (enCurso.current = false) })
  }
  return { ...m, mutate }
}
