// Importes en centavos (bigint). Nunca se usa aritmética de punto flotante:
// el formateo opera sobre el string de dígitos.

function agruparMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function formatearPesos(cents: bigint | number | string): string {
  const texto = typeof cents === 'number' ? BigInt(Math.trunc(cents)).toString() : String(cents).trim()
  if (!/^-?\d+$/.test(texto)) throw new Error(`Importe en centavos inválido: ${texto}`)
  const negativo = texto.startsWith('-')
  const digitos = (negativo ? texto.slice(1) : texto).replace(/^0+(?=\d)/, '').padStart(3, '0')
  const enteros = digitos.slice(0, -2)
  const decimales = digitos.slice(-2)
  const cero = /^0+$/.test(digitos)
  return `${negativo && !cero ? '-' : ''}$ ${agruparMiles(enteros)},${decimales}`
}

const PATRON = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/
/** "1500.50" o "1500.5": punto decimal (teclado numérico del celular), sin separador de miles. */
const PATRON_PUNTO = /^-?\d+\.\d{1,2}$/

/** Máximo admitido por importe: $ 999.999.999.999,99 (14 dígitos en centavos). */
export const MAXIMO_CENTAVOS = 99999999999999n

export function parsearPesos(texto: string): bigint {
  let limpio = texto.replace(/\$/g, '').replace(/\s/g, '')
  if (PATRON_PUNTO.test(limpio) && !/^-?\d{1,3}\.\d{3}$/.test(limpio)) limpio = limpio.replace('.', ',')
  if (!PATRON.test(limpio)) {
    throw new Error(`"${texto}" no es un importe válido. Usá el formato 650.000,50.`)
  }
  const negativo = limpio.startsWith('-')
  const [entero, decimal = ''] = (negativo ? limpio.slice(1) : limpio).split(',')
  const cents = BigInt(entero.replace(/\./g, '') + decimal.padEnd(2, '0'))
  if (cents > MAXIMO_CENTAVOS) throw new Error('El importe supera el máximo admitido ($ 999.999.999.999,99).')
  return negativo ? -cents : cents
}

/** Al salir del campo: deja el importe con formato argentino si es válido; si no, lo deja como está. */
export function normalizarPesos(texto: string): string {
  if (!texto.trim()) return texto
  try {
    return formatearPesos(parsearPesos(texto)).replace(/^\$ /, '').replace(/^-\$ /, '-')
  } catch {
    return texto
  }
}
