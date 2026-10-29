// Montos argentinos leídos de comprobantes y planillas, a centavos (bigint). Es el único lugar
// del módulo de rendiciones que interpreta texto de importes; no se usa punto flotante.
//
// Regla: el último "," o "." seguido de exactamente 2 dígitos al final es el separador decimal.
// Cualquier otro ".", "," o espacio es separador de miles, y solo si agrupa de a tres.
// Ante la duda ("1.50.0") devuelve null: nunca se adivina.

export function parsearMonto(texto: string): bigint | null {
  let t = (texto ?? '').replace(/\$/g, '').replace(/ /g, ' ').trim()
  if (!t) return null
  let negativo = false
  if (t.startsWith('-')) {
    negativo = true
    t = t.slice(1).trim()
  }
  if (!/^[\d., ]+$/.test(t) || !/^\d/.test(t) || !/\d$/.test(t)) return null

  let entero = t
  let decimales = '00'
  const dec = /^(.*\d)[.,](\d{2})$/.exec(t)
  if (dec) {
    entero = dec[1]
    decimales = dec[2]
  }

  const grupos = entero.split(/[., ]/)
  if (grupos.length > 1) {
    if (!/^\d{1,3}$/.test(grupos[0]) || grupos.slice(1).some((g) => !/^\d{3}$/.test(g))) return null
  } else if (!/^\d+$/.test(entero)) {
    return null
  }
  const cents = BigInt(grupos.join('') + decimales)
  return negativo ? -cents : cents
}
