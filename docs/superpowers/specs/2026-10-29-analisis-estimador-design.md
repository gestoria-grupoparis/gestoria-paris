# Análisis y estimador de costos de gestoría

## Por qué

Hoy se cargan fondos en la Habitualista "a ojo", sin saber cuánto se gasta de verdad cada mes ni cuánto se va a necesitar. Hasta que la gestora manda su presupuesto no hay ningún número. Este módulo da dos cosas:

1. **Análisis** del gasto real: cuánto, en qué, cuándo y a quién.
2. **Estimación** por adelantado: por trámite, al cargarlo, y por semana, según el historial.

Así gerencia y contable pueden prever los fondos sin perseguir a la gestora.

## Quién lo usa

Es un módulo interno, solo para gerencia y contable con alcance sobre la razón social. La gestora no lo ve (menú, rutas, RLS, RPC). Es la misma regla que en Rendiciones.

## Parte A — Estimador por trámite

- **Cuándo se calcula:** al dar de alta un trámite, o desde su panel, se calcula un **costo estimado**. No reemplaza al presupuesto de la gestora, que sigue siendo el monto real contra el que se controla.
- **Qué datos se piden:**
  - Lo que ya está en el trámite: tipo y sucursal, y de ahí la provincia de radicación.
  - **Valor de referencia**: el precio de factura del 0 km o el valor declarado del usado.
  - Si lleva **prenda** y por cuánto.
  - Tipo de vehículo: auto/pick-up o moto.
  - Si el destinatario es la concesionaria como habitualista (Solicitud Tipo 08), o si es una reventa dentro de los 90 días.
  - Provincia si es distinta a la de la sucursal: San Luis, San Juan, Mendoza o Córdoba.
- **Fórmulas** (fuente: `docs/gestoria/01-investigacion-estimador.md`, verificadas contra un recibo real al centavo):
  - **Inscripción inicial:** 1 % del valor. Mínimo 52 MRPA para autos y 21 MRPA para motos. Cédula, título y placas ya incluidos.
  - **Transferencia:** 1 % del valor. Mínimo 32 MRPA para autos y 15 MRPA para motos.
    - A favor de la concesionaria habitualista (Tipo 08): arancel 0.
    - Reventa de la concesionaria dentro de los 90 días: 10 % de descuento.
  - **Prenda:** 1 ‰ del monto. Mínimo 12 MRPA para autos y 5 MRPA para motos.
  - **Sellos provinciales:** solo con regla verificada. San Luis, prenda: 1,2 %, mínimo $780. Las provincias o conceptos sin regla verificada quedan como **"sin dato: se completa con lo que informe la gestora"** y nunca se inventan.
  - **Honorarios de la gestora:** parámetro ($32.500 por trámite).
- **Parámetros versionados en la base**, con fecha desde/hasta y la fuente: MRPA, alícuotas, mínimos y honorarios. Gerencia los actualiza desde una pantalla de parámetros. Un estimado guardado nunca cambia solo: si cambian los parámetros, se recalcula y se guarda una versión nueva.
- **Detalle del estimado:** cada estimado muestra cada línea (concepto, base, alícuota o mínimo, importe, fuente) y un nivel de confianza:
  - completo: todas las reglas verificadas;
  - parcial: hay líneas sin dato;
  - sin valor: falta el valor de referencia.
- **Tabla de valuación DNRPA:** es un PDF (Disposición 160/2026). La primera versión usa el valor de factura o el declarado. La importación de la tabla queda como mejora posterior; no bloquea el módulo.
- **Comparación con el real:** una vez que llega el presupuesto real de la gestora, el trámite muestra el estimado, el real y la diferencia. Esa diferencia sirve para calibrar.

## Parte B — Análisis (para gerencia)

Es una pantalla nueva, **Análisis**, con filtros por período, razón social, sucursal y tipo de trámite.

- **Indicadores principales:**
  - gasto real del período: presupuestos pagados y movimientos `pago_tramite`;
  - estimado pendiente: trámites en curso todavía sin presupuesto real;
  - cantidad de trámites: patentamientos 0 km, transferencias y usados tomados en parte de pago;
  - honorarios;
  - variación contra el período anterior.
- **Gráficos de líneas, sin barras** (el dueño las detesta):
  - gasto diario o semanal del período, con curva suave y puntos;
  - cantidad de trámites por semana.
- **Gráficos de torta (dona):**
  - gasto por tipo de trámite;
  - gasto por razón social;
  - gasto por concepto: arancel, sellos, prenda, honorarios, otros, sacado de los comprobantes confirmados de Rendiciones cuando existen.
- **Reporte para gerencia:** la misma información en una vista para imprimir o exportar a PDF desde el navegador, y en XLSX.

## Parte C — Previsión semanal de fondos

- **Pipeline confirmado:** trámites ya cargados que todavía no se pagaron, con su estimado o su presupuesto real, agrupados por semana probable de pago.
- **Proyección por historial**, en dos métodos:
  - promedio de las últimas 4 semanas;
  - la "misma semana del mes" (1.ª, 2.ª, 3.ª…) de los últimos 3 meses.

  Se muestran como escenario base y escenario alto (el máximo histórico de ese tipo de semana). Siempre se aclara que es orientativo y cuántas semanas de historia hay. Si hay menos de 4 semanas de datos, dice "historia insuficiente" y no inventa.
- **Lo pendiente no se cuenta dos veces:** lo que ya está en el pipeline confirmado no se vuelve a sumar en la proyección.
- **Saldo de la Habitualista:** para cada razón social con Habitualista se muestra el saldo disponible actual contra lo previsto para las próximas 1, 2 y 4 semanas, con una alerta si no alcanza.

## Reglas

- **Montos:** en centavos (bigint). El frontend solo formatea, no calcula. Los estimados se calculan en la base de datos (función SQL pura y testeada).
- **Datos:** no se crean movimientos ni se tocan saldos. No se inventan alícuotas. Toda regla tiene su fuente.
- **Diseño:** se mantiene el sistema de diseño existente. Los gráficos usan una librería liviana (Recharts u otra), cargada solo en esa pantalla.

## Fuera de alcance

- Importar automáticamente el PDF de valuaciones.
- Consultar el estimador oficial de la DNRPA, que tiene captcha.
- Deudas de patentes y multas.
- Pronósticos con modelos estadísticos avanzados.
