// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Dialogo } from './Dialogo'

afterEach(cleanup)

function Prueba({ onCerrar = () => {} }: { onCerrar?: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [, setN] = useState(0)
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      <button onClick={() => setN((n) => n + 1)}>Rerender</button>
      {abierto && (
        <Dialogo titulo="Prueba" onCerrar={() => { onCerrar(); setAbierto(false) }}>
          <input aria-label="Uno" />
          <input aria-label="Dos" />
        </Dialogo>
      )}
    </>
  )
}

describe('Dialogo', () => {
  it('enfoca el primer campo sólo al montar', () => {
    render(<Prueba />)
    fireEvent.click(screen.getByText('Abrir'))
    expect(document.activeElement).toBe(screen.getByLabelText('Uno'))
    screen.getByLabelText('Dos').focus()
    act(() => screen.getByText('Rerender', { selector: 'button' }).click())
    expect(document.activeElement).toBe(screen.getByLabelText('Dos'))
  })
  it('Tab cicla dentro y el foco vuelve al botón al cerrar', () => {
    const cerrado = vi.fn()
    render(<Prueba onCerrar={cerrado} />)
    const abrir = screen.getByText('Abrir')
    abrir.focus()
    fireEvent.click(abrir)
    screen.getByLabelText('Dos').focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByLabelText('Cerrar'))
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByLabelText('Dos'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(cerrado).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(abrir)
  })
})
