import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../ui'

/**
 * Error de un formulario de trámite. Si otro usuario lo modificó (VERSION_CONFLICTO), ofrece
 * recargar en un toque: re-lee la versión y deja lo escrito intacto para volver a confirmar.
 */
export function ErrorAccion({ error, conflicto, onRecargado }: { error: string | null; conflicto: boolean; onRecargado: () => void }) {
  const qc = useQueryClient()
  const [recargando, setRecargando] = useState(false)
  if (!error) return null
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">
      <p>{error}</p>
      {conflicto && (
        <Button
          variante="secundario"
          tamano="sm"
          className="self-start"
          cargando={recargando}
          onClick={async () => {
            setRecargando(true)
            await qc.invalidateQueries({ queryKey: ['tramites'] })
            setRecargando(false)
            onRecargado()
          }}
        >
          Recargar y reintentar
        </Button>
      )}
    </div>
  )
}
