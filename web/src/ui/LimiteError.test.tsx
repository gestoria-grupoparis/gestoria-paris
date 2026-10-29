// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LimiteError } from './LimiteError'

afterEach(cleanup)

describe('LimiteError', () => {
  it('muestra el mensaje y Reintentar vuelve a montar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let romper = true
    function Hijo() {
      if (romper) throw new Error('boom')
      return <p>contenido</p>
    }
    render(<LimiteError compacto><Hijo /></LimiteError>)
    expect(screen.getByText('Algo salió mal en esta pantalla')).toBeTruthy()
    romper = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('contenido')).toBeTruthy()
  })
})
