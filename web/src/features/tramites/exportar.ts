import type { TramiteFila } from './consultas'
import { etiquetaEstado, SITUACIONES } from './filtros'

/**
 * Centavos (texto) a decimal con coma, para que Excel en es-AR lo lea como número.
 * Es manipulación de texto: nunca se hace aritmética sobre el importe.
 */
export function centavosADecimal(cents: string | null | undefined): string {
  if (cents == null || cents === '') return ''
  const texto = String(cents).trim()
  if (!/^-?\d+$/.test(texto)) throw new Error(`Importe en centavos inválido: ${texto}`)
  const negativo = texto.startsWith('-')
  const digitos = (negativo ? texto.slice(1) : texto).replace(/^0+(?=\d)/, '').padStart(3, '0')
  const cero = /^0+$/.test(digitos)
  return `${negativo && !cero ? '-' : ''}${digitos.slice(0, -2)},${digitos.slice(-2)}`
}

function celda(valor: string): string {
  // Evita inyección de fórmulas al abrir en Excel y escapa separadores y comillas.
  const seguro = /^[=+\-@\t\r]/.test(valor) && !/^-?\d+(,\d+)?$/.test(valor) ? `'${valor}` : valor
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

export const COLUMNAS_CSV = [
  'Número', 'Fecha de alta', 'Estado', 'Tipo', 'Cliente', 'Cuenta personal', 'Oferta', 'Vehículo', 'Dominio',
  'Razón social', 'Sucursal', 'Provincia', 'Gestora', 'Autorizado', 'Presupuesto', 'Pagado', 'Situación de fondos',
]

/** CSV con `;` (lo que Excel espera en configuración regional argentina), BOM UTF-8 y fin de línea CRLF. */
export function tramitesACsv(filas: TramiteFila[], nombreGestora: (id: string | null) => string): string {
  const lineas = [COLUMNAS_CSV.map(celda).join(';')]
  for (const t of filas) {
    const sit = t.finanzas?.situacion
    lineas.push(
      [
        t.numero, fecha(t.created_at), etiquetaEstado(t.estado), t.tipo.nombre, t.operacion.cliente_nombre,
        t.operacion.cuenta_personal, t.operacion.oferta_ref, t.vehiculo_desc, t.dominio ?? '',
        t.operacion.empresa.nombre, t.operacion.sucursal.nombre, t.operacion.sucursal.provincia,
        t.gestora_id ? nombreGestora(t.gestora_id) : '', fecha(t.autorizado_at),
        centavosADecimal(t.finanzas?.presupuesto), centavosADecimal(t.finanzas?.pagado),
        sit && sit !== 'no_aplica' ? (SITUACIONES[sit] ?? sit) : '',
      ].map(celda).join(';'),
    )
  }
  return '\uFEFF' + lineas.join('\r\n') + '\r\n'
}

export function nombreArchivo(hoy: string): string {
  return `tramites-${hoy}.csv`
}

export function descargarTexto(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
