// Normalización para comparar nombres, dominios y documentos leídos (a veces por OCR).

const A_DIGITO: Record<string, string> = { O: '0', I: '1' }
const A_LETRA: Record<string, string> = { '0': 'O', '1': 'I' }

// Patrones de dominio: L = letra, D = dígito.
const FORMATOS = ['LLDDDLL', 'LLLDDD']

function ajustar(token: string, formato: string): string | null {
  if (token.length !== formato.length) return null
  let digitosReales = 0
  let salida = ''
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (formato[i] === 'D') {
      if (/\d/.test(c)) {
        digitosReales++
        salida += c
      } else if (A_DIGITO[c]) salida += A_DIGITO[c]
      else return null
    } else if (/[A-Z]/.test(c)) salida += c
    else if (A_LETRA[c]) salida += A_LETRA[c]
    else return null
  }
  // Sin ningún dígito real es una palabra (un nombre), no un dominio.
  return digitosReales > 0 ? salida : null
}

function dominioDeToken(token: string): string | null {
  for (const f of FORMATOS) {
    const d = ajustar(token, f)
    if (d) return d
  }
  return null
}

const tokens = (s: string) => (s ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)

/** Último token con forma de dominio (AA111AA o AAA111), corrigiendo O/0 e I/1 del OCR. */
export function extraerDominio(s: string): string | null {
  const ts = tokens(s)
  for (let i = ts.length - 1; i >= 0; i--) {
    const d = dominioDeToken(ts[i])
    if (d) return d
  }
  return null
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Mayúsculas, sin tildes ni signos, espacios simples y sin el dominio. */
export function normalizarNombre(s: string): string {
  return sinTildes(s ?? '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !dominioDeToken(t))
    .join(' ')
}

/** Solo dígitos, entre 7 y 11 (DNI o CUIT/CUIL). */
export function normalizarDocumento(s: string): string | null {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length >= 7 && d.length <= 11 ? d : null
}
