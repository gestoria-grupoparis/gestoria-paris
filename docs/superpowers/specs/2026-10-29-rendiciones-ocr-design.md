# Rendiciones mensuales de la gestora con lectura automática de comprobantes

## Por qué

Contabilidad tiene meses de rendiciones atrasadas en todas las razones sociales. Hoy cada rendición se controla a mano: se transcriben los importes de cada comprobante y se tildan los nombres contra la planilla interna. El objetivo es que el sistema lea los comprobantes, arme la rendición y haga los tres controles. A la persona le queda solo revisar las diferencias.

Es un módulo aparte del circuito de trámites (ping pong). Es el último paso: se usa cuando el mes ya está gestionado.

## Qué trae hoy una rendición (muestra real: Paris Autos, julio 2026)

1. **Planilla mensual** por razón social. Tiene una fila por trámite con:
   - NOMBRE: el cliente, a veces seguido del dominio, por ejemplo "JOFRE FABRICIO ALEJANDRO AF869NV".
   - PAGO: el total pagado por ese trámite.
   - HONORARIOS: 32.500,00 por trámite.

   Es una impresión de Excel; a veces podría llegar como archivo.
2. **Comprobantes de cada trámite**, que suman su PAGO:
   - **Recibo DNRPA** del Registro Seccional, por ejemplo "19008 SAN LUIS N° 3". Trae:
     - Fecha, Referencia, N°Control Recibo, N°Trámites y Control Web.
     - Valor Declarado y Valor C.Prenda.
     - La tabla de conceptos (concepto, valor unitario, cantidad, importe; las bonificaciones van en negativo).
     - El Total, por ejemplo $ 431539,69. El formato es decimal con coma y sin separador de miles.
   - **Comprobante de Retención de Sellos** de la DPIP San Luis. Trae:
     - Número de Comprobante, Chapa Patente, Fecha Operación.
     - Importe de Operación, Alícuota, Impuesto Sellos y Total Retenido, por ejemplo $ 508 614.29. El formato es punto decimal con espacio como separador de miles.
     - Partes intervinientes: nombre y DNI del cliente.
   - Puede haber otros comprobantes (patentes, verificación, etc.) con formatos desconocidos.
3. **Factura C manual** de la gestora (Carla Debora Saez) por los honorarios. Es manuscrita: número, fecha, cliente y total ($32.500). A futuro será factura electrónica.

## Los tres controles (en este orden)

1. **Importes:**
   - Por trámite, la suma de sus comprobantes tiene que dar exactamente su PAGO.
   - El total de PAGO del mes tiene que dar exactamente lo que se debitó de la Habitualista de esa razón social en el período. Se compara contra los movimientos `pago_tramite` existentes.
   - "Exactamente" quiere decir al centavo, sin tolerancia.
2. **Autorizados:** cada nombre o dominio de la planilla tiene que corresponder a un trámite de esa razón social que la empresa haya autorizado en el sistema (`autorizado_at` no nulo, no cancelado ni rechazado).
3. **Honorarios:** la cantidad de trámites rendidos por el honorario unitario tiene que ser igual a la suma de las facturas de honorarios. Con ese número se pagan los honorarios.

## Reglas

- **Nada se contabiliza solo.** La rendición no crea movimientos de dinero ni toca saldos; solo compara. Comprobante, rendición y movimiento son cosas distintas.
- **Nunca se inventa un dato.** Lo que no se pudo leer queda "pendiente de revisión" y se completa a mano.
- **El archivo original se conserva**, en un almacenamiento privado (Supabase Storage, bucket privado con RLS) y vinculado a su trámite.
- **Duplicados:**
  - Del mismo archivo: se detectan por su huella SHA-256.
  - Del mismo comprobante escaneado otra vez: se detectan por la misma combinación de tipo + número + emisor.
- **Montos argentinos:** se aceptan "431539,69", "1.163.855,24" y "508 614.29", y siempre se guardan en centavos (bigint).
- **Sin servicios pagos ni IA generativa.** El OCR corre en el navegador con Tesseract.js (español), con los modelos alojados en la propia web. Los PDF con texto se leen con PDF.js, sin OCR.
- **Permisos:** módulo interno (pedido del dueño). Solo gerencia y contable con alcance sobre la razón social crean, cargan, controlan y aprueban rendiciones; la gestora es solo un dato de referencia de cada rendición y no ve el módulo (ni menú, ni tablas, ni RPC, ni archivos). Estados: borrador/observada → enviada a control → observada o aprobada; una aprobada se reabre a borrador con motivo. Todo queda auditado con el trigger `auditar` existente.
- **Uso:** pensado para escritorio, porque se cargan pilas de papeles escaneados, pero también funciona en celular.

## Flujo

1. Se crea la rendición: razón social, mes, gestora y honorario unitario (por defecto 32.500).
2. Se carga la planilla:
   - Si es Excel o CSV, se importa tal cual.
   - Si es foto o PDF, se pasa por OCR y se revisan las filas.

   Cada fila se vincula sola con un trámite (por dominio y nombre) o queda "sin vincular".
3. Se suben los comprobantes, en lote, como PDF o fotos:
   - Cada uno se lee y se clasifica (recibo DNRPA, retención de sellos, factura de honorarios u otro).
   - Se extraen sus campos y se asigna a una fila por dominio, nombre o DNI.
   - Todo lo dudoso se marca.
4. Se revisa en una pantalla dividida: el documento a la izquierda y los datos a la derecha, editables.
5. Panel de controles: los tres controles con semáforo y la lista accionable de diferencias.
6. Contable o gerencia aprueba la rendición, que queda cerrada. También puede observarla y devolverla a la gestora.

## Fuera de alcance (por ahora)

- El motor de costos registrales y la normativa: es otro proyecto, con su propia investigación.
- La factura electrónica: el modelo queda preparado (tipo "factura_electronica").
- El pago de los honorarios en sí: solo se informa el monto a pagar.

## Decisiones del implementador

- **Agrupación en el PDF:** un archivo con varios comprobantes se separa por página, y cada página se lee y se asigna por separado.
- **Comprobante sin trámite:** si no se encuentra el trámite, queda "sin asignar" y se asigna a mano.
- **Nombres:** se normalizan para comparar (mayúsculas, sin tildes ni espacios dobles).
