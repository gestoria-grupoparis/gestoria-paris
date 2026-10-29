import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { ErrorState } from './Estados'
import { PantallaMensaje } from './Pantallas'

const FLAG_RECARGA = 'recarga-por-modulo'

function esErrorDeModulo(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg)
}

interface Props {
  children: ReactNode
  /** Dentro del shell: bloque compacto para que el menú siga usable. */
  compacto?: boolean
}

export class LimiteError extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('error') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (esErrorDeModulo(error)) {
      try {
        if (!sessionStorage.getItem(FLAG_RECARGA)) {
          sessionStorage.setItem(FLAG_RECARGA, '1')
          window.location.reload()
          return
        }
      } catch {
        /* sin storage: no recargamos en bucle */
      }
    }
    console.error(error, info.componentStack)
  }

  reintentar = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    const acciones = (
      <>
        <Button onClick={this.reintentar}>Reintentar</Button>
        <Button variante="secundario" onClick={() => window.location.assign('/')}>Ir al inicio</Button>
      </>
    )
    const descripcion = 'Probá de nuevo. Si vuelve a pasar, avisale a la oficina.'
    if (this.props.compacto)
      return (
        <div className="p-4 md:p-8">
          <ErrorState titulo="Algo salió mal en esta pantalla" descripcion={descripcion} accion={<div className="flex gap-2">{acciones}</div>} />
        </div>
      )
    return <PantallaMensaje tono="error" titulo="Algo salió mal en esta pantalla" descripcion={descripcion} acciones={acciones} />
  }
}
