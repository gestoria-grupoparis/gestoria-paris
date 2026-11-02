# Auditoría de la interfaz — 2 de noviembre de 2026

Revisión de solo lectura (no se cambió código). Se capturaron todas las pantallas principales con datos simulados, en computadora (1440×900) y en celular (390×844), y se pasó el control automático de accesibilidad (axe, WCAG 2 A/AA + buenas prácticas). Capturas en `.local/auditoria/` (no se suben al repositorio; sufijo `-d` = computadora, `-m` = celular). Criterios: sistema de diseño (`design-system/MASTER.md`), guías de interfaz web de Vercel, checklist de ui-ux-pro-max y auditoría de impeccable.

## Resumen ejecutivo

La app está en buen estado: estética coherente con la marca (negro/blanco, un solo acento azul), textos claros en español, estados vacíos bien resueltos y **cero problemas de accesibilidad en computadora salvo uno menor**. Los problemas reales están en tres frentes:

1. **Celular**: la barra inferior tiene 6–7 accesos apretados, los filtros rápidos y el buscador quedan cortados, y la barra tapa contenido.
2. **Coherencia de números**: el Tablero dice "Sin fondos: 0" mientras la tarjeta de Paris Autos dice "Sin fondos" con −$1.400.000. Eso resta confianza.
3. **Peso de descarga**: Análisis pesa 412 kB y la librería de Excel 929 kB; conviene cargarlas solo cuando se usan.

Además, "Trámites por estado" del Tablero es en la práctica un **gráfico de barras** (barras horizontales de progreso), que va contra la preferencia del dueño.

## Top 10 mejoras (por impacto en el uso diario)

| # | Pantalla | Problema | Evidencia | Arreglo concreto | Esfuerzo |
|---|---|---|---|---|---|
| 1 | Tablero | La tarjeta "Sin fondos" muestra 0 y al mismo tiempo Paris Autos figura "Sin fondos" con disponible −$1.400.000. Dos conceptos distintos con el mismo nombre. | `tablero-d.png` | Renombrar la tarjeta a "Trámites sin fondos" y la etiqueta de la razón social a "Saldo negativo"; o unificar el criterio para que ambos cuenten lo mismo. | S |
| 2 | Tablero | "Trámites por estado" son barras horizontales (11 filas, la mayoría en 0). | `tablero-d.png`, `tablero-m.png` | Reemplazar por una dona con los estados que tienen trámites + leyenda con números; ocultar estados en 0 ("+6 sin trámites"). | M |
| 3 | Todas (celular) | La barra inferior tiene 6 accesos (gerencia 7): etiquetas de 10–11 px, "Usuarios" pegado al borde, objetivos táctiles < 44 px. | `tablero-m.png`, `tramites-lista-m.png` | Máximo 5: Tablero, Trámites, Habitualista, Rendiciones y "Más" (Informes, Análisis, Usuarios). | M |
| 4 | Trámites (celular) | Los filtros rápidos ("Para revisar", "Presupuestos…", "Auto…") se cortan sin indicar que hay más; el buscador corta el texto de ayuda. | `tramites-lista-m.png` | Degradé/flecha al borde de los chips, o convertirlos en un selector; placeholder corto "Buscar cliente, dominio…". | S |
| 5 | Rendiciones · Planilla | El importe del pago se ve cortado ("940.153,9") y el selector de trámite trunca el nombre. Riesgo de error al controlar montos. | `rendiciones-planilla-d.png` | Columna Pago más ancha (mín. 14 caracteres), selector de trámite mostrando solo el número + nombre corto con tooltip. | S |
| 6 | Celular (fijo) | La barra inferior se superpone a contenido: en el Tablero tapa la fila "3. Presentados / 4. Finalizados". | `tablero-m.png` | Agregar espacio inferior al contenido igual a la altura de la barra + zona segura (`env(safe-area-inset-bottom)`). | S |
| 7 | Menú lateral | El orden del menú cambia según el rol (gerencia: Tablero primero; contable: Tablero último). | `tablero-d.png` vs `tramites-detalle-d.png` | Mismo orden para todos; lo que cambia es solo qué ítems se ven. | S |
| 8 | Análisis | La pantalla carga 412 kB (gráficos) aunque se entre solo a Parámetros; Exportar trae ExcelJS (929 kB). | salida de `npm run build` | Cargar los gráficos y ExcelJS recién al usarlos (import dinámico al tocar "Exportar"). | M |
| 9 | Nuevo trámite | El orden de campos no sigue el flujo habitual (Razón social → Sucursal → Tipo vienen después del cliente) y en el celular el diálogo ocupa todo y "Guardar" queda abajo del pliegue. | `tramites-nuevo-d.png`, `tramites-nuevo-m.png` | Empezar por Razón social/Sucursal/Tipo (recordando la última elección), luego cliente; botones fijos al pie en celular. | M |
| 10 | Informes | Colores en importes en cero (cargas verdes, pagos ámbar) llaman la atención sin motivo. | `informes-d.png` | Usar color solo cuando el valor ≠ 0; ceros en gris tenue. | S |

## Coherencia con el sistema de diseño

- Bien: paleta monocromo, acento azul solo para selección y estado "Autorizado", bordes de 1 px, pesos ≤ 600, chips de estado con punto de color, patente estilo chapa.
- Desvíos: el KPI destacado en negro ("Por aprobar", "Gasto real") es correcto, pero en Tablero la tarjeta "Cuentas a recargar" usa borde rojo como decoración, y en Habitualista la tarjeta completa se pinta de rojo. Elegir una: borde **o** número en rojo.
- "Ir a Habitualista" (Tablero) y "‹ Rendiciones" (volver) son enlaces de estilos distintos; unificar con un componente de enlace secundario.
- Encabezados de sección: a veces rótulo en mayúsculas + título ("GESTORÍA / Ping pong…"), a veces solo título ("Gasto diario"). Elegir un patrón por tipo de tarjeta.

## Jerarquía y legibilidad

- Los títulos de página y KPI se leen bien. Los rótulos en mayúsculas de 11 px ("REGISTRADO", "CONCILIACIÓN") están al límite; subir a 12 px.
- "Ping pong con la gestoría" es un nombre interno; para un usuario nuevo, "Circuito con la gestoría" se entiende mejor.
- En el detalle del trámite la línea de pasos (Alta → Cerrado) usa etiquetas de 11 px muy juntas; con "Finalizado" se tocan. Abreviar o subir a dos líneas.

## Celular

- Barra inferior sobrecargada y superpuesta (ver #3 y #6).
- Tablas anchas (Tablero "Razón social × estados", Informes, Previsión) dependen de desplazamiento horizontal sin aviso visual; además axe marca que esas zonas no se pueden recorrer con teclado.
- Tarjetas de trámite en celular: muy buenas (número, cliente, patente, monto, estado). No se pudo abrir el detalle desde la lista porque no son filas de tabla; conviene que toda la tarjeta sea el enlace (ya tiene chevron).

## Accesibilidad (axe)

Resultados por pantalla (computadora y celular, 33 capturas):

| Hallazgo | Gravedad | Dónde | Arreglo |
|---|---|---|---|
| `scrollable-region-focusable`: zona con desplazamiento que no se puede alcanzar con teclado | Seria | Tablero (celular, tabla por razón social), Informes (celular), Análisis · Previsión (celular) | `tabIndex={0}`, `role="region"` y `aria-label` en el contenedor con scroll. |
| `heading-order`: salto de nivel de título (h1 → h3) | Moderada | Habitualista (ambas), Rendiciones · Comprobantes (ambas) | Usar h2 en las tarjetas o agregar un h2 de sección. |

Todo lo demás (Login, Trámites, diálogo Nuevo trámite, Usuarios, Mis trámites, Análisis, Parámetros, Rendiciones lista/planilla/controles): **sin violaciones**. Contraste de textos tenues OK. Pendiente de revisión manual: foco visible al recorrer con Tab dentro del panel lateral del trámite, y anuncio por lector de pantalla de los avisos ("Planilla guardada.").

## Estados de carga, vacío y error

- Vacíos: bien resueltos y consistentes en Análisis ("Sin pagos en el período.") con ícono y recuadro punteado.
- Rendiciones vacía: "Todavía no hay rendiciones." Sumar el botón "Nueva rendición" dentro del estado vacío.
- Informes con todo en $0: no distingue "no hubo movimientos" de "no se cargaron datos". Mostrar "Sin movimientos en octubre 2026" cuando todas las filas son 0.
- "Guardar planilla" deshabilitado en gris sin explicar por qué; agregar texto "No hay cambios para guardar".
- Carga: no se observaron saltos de diseño; verificar esqueletos en conexión lenta (no medido aquí).

## Formularios y velocidad de carga de datos

- Etiquetas visibles y textos de ayuda correctos ("Si todavía no tiene, dejalo vacío").
- Nuevo trámite: reordenar (ver #9); recordar razón social/sucursal/tipo del último alta; dominio en mayúsculas automáticas (ya lo hace).
- Planilla de rendición: campos de importe con `$` adentro, bien; agregar navegación con Enter para pasar a la siguiente fila y "Agregar fila" con atajo.
- Los selectores nativos ("Elegí") son rápidos con teclado; mantenerlos.

## Gráficos (solo líneas y donas)

- Análisis cumple: "Gasto diario" y "Trámites por semana" en líneas; "Gasto por tipo/razón social/concepto" en donas. No hay barras de Recharts.
- **Excepción**: Tablero · "Trámites por estado" son barras horizontales (#2).
- "Trámites por semana" usa línea curva suavizada: entre 12/10 y 19/10 sugiere valores intermedios que no existen. Usar línea recta por tramos (`type="linear"`) o escalonada.
- Eje Y con decimales implícitos para conteos (0–4): forzar enteros.

## Navegación y arquitectura de información

- Orden del menú distinto por rol (#7).
- Ícono de Informes es un gráfico de barras: cambiar por un documento/tabla para no asociar barras.
- Análisis tiene tres solapas (Gasto real / Previsión / Parámetros) y la URL las recuerda: bien.
- Rendiciones tiene "‹ Rendiciones" para volver; Trámites usa panel lateral con "X". Ambos sirven, pero conviene que el botón Atrás del navegador cierre el panel del trámite.
- La gestora ve solo "Mis trámites": correcto, no ve Rendiciones ni Análisis (módulos internos).

## Rendimiento (`npm run build`)

| Archivo | Tamaño | Comprimido | Comentario |
|---|---|---|---|
| exceljs | 929 kB | 256 kB | Solo para exportar/importar; cargar al tocar el botón. |
| pdf (+ worker 1,26 MB) | 430 kB | 129 kB | Solo Rendiciones · Comprobantes; ya separado, verificar que no se precargue. |
| Analisis | 412 kB | 118 kB | Incluye Recharts; separar los gráficos de Parámetros/Previsión. |
| react | 256 kB | 81 kB | Normal. |
| supabase | 214 kB | 55 kB | Normal. |
| index (núcleo) | 102 kB | 37 kB | Bien. |
| Rendiciones | 73 kB | 23 kB | Bien. |
| CSS | 64 kB | 12 kB | Bien. |

La carga inicial (núcleo + react + supabase + tanstack) ronda los **190 kB comprimidos**: aceptable. El aviso de "chunks > 500 kB" viene de exceljs y el worker de PDF.

## Quick wins (menos de una hora cada uno)

1. Renombrar "Sin fondos" del Tablero para que no contradiga la tarjeta de la razón social.
2. Espacio inferior en celular para que la barra no tape contenido.
3. `tabIndex`, `role="region"` y `aria-label` en las tablas con scroll horizontal (arregla las 3 violaciones serias).
4. Cambiar h3 por h2 en Habitualista y Comprobantes.
5. Ensanchar la columna Pago de la planilla.
6. Mismo orden de menú para todos los roles.
7. Línea `linear` y eje de enteros en "Trámites por semana".
8. Ceros en gris en Informes.
9. Placeholder corto del buscador en celular.
10. Botón "Nueva rendición" dentro del estado vacío.
