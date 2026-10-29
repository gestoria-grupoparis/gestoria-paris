# Rendiciones: guía de uso y mantenimiento

Módulo interno de gerencia y contable para controlar la rendición mensual de cada gestora por razón social. La gestora no ve el módulo: figura solo como dato de referencia. **Una rendición nunca mueve dinero**: no crea movimientos ni cambia saldos, solo compara.

## Cómo se usa

1. **Rendiciones → Nueva rendición.** Elegí la razón social, el mes, la gestora y el honorario por trámite (por defecto $ 32.500,00). No se puede repetir el mismo mes para la misma gestora y razón social.
2. **Planilla.** Subí el Excel/CSV (columnas NOMBRE, PAGO, HONORARIOS, con o sin tildes) o una foto/PDF de la planilla impresa (se lee con OCR: revisá las filas). Cada fila se vincula sola con un trámite por dominio y, si no hay dominio, por nombre. Si dos trámites tienen el mismo nombre queda **Ambiguo** y hay que elegir; si no aparece, **Sin vincular** y se busca a mano. Guardá la planilla.
3. **Comprobantes.** Subí todos los PDF y fotos juntos (máx. 15 MB por archivo). Cada página se lee en el navegador, se clasifica, se extraen sus datos y se asigna a una fila por dominio, DNI o nombre. El original queda guardado en el bucket privado `comprobantes`.
4. **Revisión.** Documento a la izquierda, datos a la derecha. Lo dudoso o vacío aparece con borde ámbar y "Revisar". **Confirmar** (o Enter) guarda y pasa al siguiente pendiente. Un archivo repetido o un comprobante con el mismo tipo, número y emisor muestra "Posible duplicado" (no bloquea).
5. **Controles.** Tres tarjetas con semáforo:
   - **Importes:** por fila, la suma de sus comprobantes (sin facturas de honorarios) contra PAGO, al centavo; y el total de la planilla contra lo debitado de la Habitualista en el mes por pagos de trámites (sin los revertidos). Lista los pagos del mes que no están en la planilla.
   - **Autorizados:** cada fila tiene que estar vinculada a un trámite autorizado, no cancelado ni rechazado.
   - **Honorarios:** cantidad de filas × honorario contra la suma de facturas de honorarios **confirmadas**. Si coincide, muestra el monto a pagar.
6. **Estados:** borrador → *Enviar a control* → enviada → *Observar* (con motivo, vuelve a edición) o *Aprobar*. Aprobar con diferencias pide confirmación. Una aprobada se puede *Reabrir* con motivo. Todo queda auditado.

## Comprobantes que se reconocen

| Tipo | Se detecta por | Campos |
|---|---|---|
| Recibo DNRPA | "DNRPA" o "RECIBO" + "Control Web" | N° Control Recibo, Registro Seccional, Fecha, Dominio, Total, líneas de conceptos (bonificaciones en negativo; si no suman el total se marca "lineas") |
| Retención de Sellos (DPIP San Luis) | "Comprobante de Retenci…" + "Sellos" | Número de Comprobante, CUIT del agente, Chapa Patente, Fecha Operación, Total Retenido, nombre y DNI de la primera parte |
| Factura de honorarios | "FACTURA" + "Honorario" | Número 0001-00000000, Razón Social, CUIT, Fecha, SEÑOR(es), TOTAL |
| Otro | lo demás | fecha, dominio, DNI, CUIT y TOTAL si aparecen; el resto a mano |

Montos aceptados: `431539,69`, `1.163.855,24`, `508 614.29`, `$ -5290,00`, `32.500`. Ante un formato ambiguo (`1.50.0`) el campo queda vacío para completar: nunca se adivina.

## Limitaciones

- El OCR (Tesseract.js, español, modelo `best_int`) corre en el navegador: la primera lectura descarga ~10 MB de `/ocr/` y en celulares viejos es lenta. Las facturas manuscritas suelen requerir completar a mano.
- La orientación de las fotos se elige por confianza del OCR (0/90/180/270 grados), no con detección de orientación de Tesseract.
- HEIC solo se lee si el navegador lo abre (Safari); en otros se pide convertir a JPG o PDF.
- Un PDF con varios comprobantes se separa por página; dos comprobantes en la misma página se ven como uno.
- La factura electrónica está prevista en el modelo (`factura_electronica`) pero no tiene lector propio.

## Cómo agregar un tipo nuevo

En `web/src/features/rendiciones/parsers.ts`:

1. Sumá el valor a `TipoComprobante` (y al check de `comprobantes.tipo` con una migración nueva si es un tipo nuevo en la base).
2. Agregá la regla en `clasificar()` (texto normalizado sin tildes, en mayúsculas).
3. Escribí `extraerX(texto)` que devuelva un `Extraido` y llame a `marcarFaltantes` con los campos obligatorios; registrala en `extraer()`.
4. Agregá un fixture anonimizado en `__fixtures__/` y su test en `parsers.test.ts`.
5. Sumá la etiqueta en `ETIQUETA_TIPO` (`RevisionComprobante.tsx`).

Los recursos del OCR se copian a `web/public/ocr/` con `web/scripts/copiar-ocr.mjs` (antes de `dev` y `build`); no se versionan.
