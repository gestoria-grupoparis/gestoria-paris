// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Field } from './Field'

afterEach(cleanup)

describe('Field', () => {
  it('asocia el error al control', () => {
    render(<Field label="Dominio" error="Formato inválido">{(p) => <input {...p} />}</Field>)
    const input = screen.getByLabelText('Dominio')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Formato inválido')
  })
  it('sin error usa la ayuda', () => {
    render(<Field label="Chasis" ayuda="Opcional">{(p) => <input {...p} />}</Field>)
    const input = screen.getByLabelText('Chasis')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Opcional')
  })
})
