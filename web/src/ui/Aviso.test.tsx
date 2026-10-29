// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProveedorAvisos, useAviso } from './Aviso'

afterEach(cleanup)

function Disparador({ onDeshacer }: { onDeshacer: () => void }) {
  const avisar = useAviso()
  return <button onClick={() => avisar({ texto: 'Marcado como presentado', accion: { etiqueta: 'Deshacer', onClick: onDeshacer } })}>Ir</button>
}

describe('Aviso', () => {
  it('anuncia en role=status, ejecuta la acción y se va solo', () => {
    vi.useFakeTimers()
    const deshacer = vi.fn()
    render(<ProveedorAvisos><Disparador onDeshacer={deshacer} /></ProveedorAvisos>)
    fireEvent.click(screen.getByText('Ir'))
    expect(screen.getByRole('status').textContent).toContain('Marcado como presentado')
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(deshacer).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByText('Ir'))
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()
  })
})
