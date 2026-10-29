import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface DatosAviso {
  texto: string
  accion?: { etiqueta: string; onClick: () => void }
  duracion?: number
}

const Contexto = createContext<(a: DatosAviso) => void>(() => {})

/** Dispara un aviso breve (toast) accesible, con una acción opcional como "Deshacer". */
export const useAviso = () => useContext(Contexto)

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<(DatosAviso & { id: number }) | null>(null)
  const n = useRef(0)
  const avisar = useCallback((a: DatosAviso) => setAviso({ ...a, id: ++n.current }), [])
  useEffect(() => {
    if (!aviso) return
    const t = window.setTimeout(() => setAviso(null), aviso.duracion ?? 8000)
    return () => window.clearTimeout(t)
  }, [aviso])
  return (
    <Contexto.Provider value={avisar}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(4.25rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4 md:top-auto md:bottom-6"
      >
        {aviso && (
          <div key={aviso.id} role="status" className="pointer-events-auto flex max-w-md min-w-0 items-center gap-3 rounded-lg bg-noche px-4 py-3 text-[14px] text-white shadow-flotante">
            <span className="min-w-0 [overflow-wrap:anywhere]">{aviso.texto}</span>
            {aviso.accion && (
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 font-semibold text-[#9ab8ff] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#7aa2f7]"
                onClick={() => {
                  aviso.accion!.onClick()
                  setAviso(null)
                }}
              >
                {aviso.accion.etiqueta}
              </button>
            )}
          </div>
        )}
      </div>
    </Contexto.Provider>
  )
}
