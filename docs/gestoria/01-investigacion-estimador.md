# Investigación: estimador de costos de trámites registrales (DNRPA + Sellos)

Fecha de la investigación: 29/10/2026. Uso: módulo interno (gerencia y contable) para **pronosticar** fondos Habitualista. Los montos son aproximados; el valor exacto sale después del presupuesto o recibo de la gestora.

Estado de verificación: **[V]** verificado contra fuente oficial o recibo real · **[S]** fuente secundaria · **[NV]** sin verificar (no usar sin confirmar).

---

## 1. Cómo calcula el estimador público de la DNRPA

- Ubicación: portal DNRPA → "Estimá los costos de tu trámite" → `https://www2.jus.gov.ar/site/#!/estimador` (app AngularJS 1.x, versión 3.0.6).
- Código fuente revisado (descargado tal cual lo sirve el sitio público):
  - `app/modules/estimador/estimadorController.js`, `presupuestoController.js`, `estimador.html`
  - `app/services/estimadorService.js` → endpoint `POST api/estimador/estimar` (relativo a `https://www2.jus.gov.ar/site/`)
  - `app/modules/viewmodel/solicitud.js` → trámites del estimador: `01xxxx` "INSCRIPCION INICIAL DE 0KM" y `08xxxx` "TRANSFERENCIA" (no hay opción de prenda).
- Cuerpo del pedido (JSON):
  `RecaptchaResponse, CodigoTramite, CertificadoInscripcionNumero (0 km), NumeroChasis (últimos 7), ValorDeclarado, CodigoProvincia, CodigoVehiculo, Dominio (usado), IncluirImpuestos (sellos provinciales sí/no), Es08D (08 digital)`.
- Respuesta: `CodigoTramite, NombreTramite, Vehiculo, Presupuesto.DetallePrecioPrecargaViewModel[] {PrecioUnitario, Cantidad, …}`, más `Certificado` o `Transferencia` con `Marca, Modelo, Tipo, Anio, Origen, ValorTabla`. El total lo suma el navegador: `Σ PrecioUnitario × Cantidad`.
- **El cálculo no está en el JavaScript**: el navegador solo arma el pedido y muestra la respuesta. Las fórmulas viven en el servidor. El servidor necesita datos reales del vehículo (número de certificado de fabricación + chasis, o dominio) para buscar el valor de tabla.
- Protección: **reCAPTCHA invisible** (`grecaptcha.execute()`) en cada pedido, además de un interceptor CSRF.
- Corridas de ejemplo: **no se hicieron**. Para usarlo hacen falta un certificado o dominio real y pasar el reCAPTCHA, y no corresponde automatizar eso. Queda como tarea manual: que gerencia cargue 3 o 4 casos reales a mano y los anotemos en la tabla de validación (§5).

**Conclusión de uso:** no se puede (ni se debe) llamar a `api/estimador/estimar` desde nuestra app. Tiene captcha, pide datos de vehículos reales, no tiene CORS declarado para terceros y no hay API pública documentada. **Hay que replicar las fórmulas.**

## 2. Normativa de aranceles (nacional, DNRPA)

| Dato | Valor | Fuente | Estado |
|---|---|---|---|
| Unidad MRPA | 0,5 UVA (BCRA), se actualiza cada 4 meses con la UVA del día hábil anterior al inicio del período; se redondea al múltiplo de $10 inferior | Res. MJ 308/2026, art. 1 (BO 07/07/2026) https://www.colegio-escribanos.org.ar/noticias/2026_07_07-Min-Jus-Res-308-26.pdf | [V] |
| Valor MRPA en pesos vigente | **no encontrado publicado**; se calcula como `floor(0,5 × UVA / 10) × 10` | — | [NV] |
| Anexo de aranceles vigente | anexo 01/09/2026 (Res. MJ 412/2026, BO 31/08/2026) | https://www.dnrpa.gov.ar/portal_dnrpa/guia_tramites/anexo_aranceles20260901_automotores.pdf y `…_motovehiculos.pdf`; https://www.colegio-escribanos.org.ar/noticias/2026_08_31_Min-Jus-Res-412-26.pdf | [V] |
| Tabla de valuación | Disp. DN 160/2026, vigencia 01/10/2026; modelo no tabulado: año anterior + 8 % | https://www.dnrpa.gov.ar/valuacion/informacion/01-10-2026.pdf ; https://www.cira.org.ar/es/servicios/normativas-servicios/disposicion/disposicion-160-2026/ | [V] |

### Anexo I (automotores), vigente desde 01/09/2026 [V]
- **1A Inscripción inicial**: 1 % de max(precio de venta según factura con gastos e impuestos, valor de tabla). **Mínimo 52 MRPA**. Ya **incluye** 2 certificaciones de firma, cédula, título, **placas metálicas**, alta impositiva y oblea RTO. (1B 90 MRPA y 1C 202 MRPA son clásicos, armados y transporte.)
- **2A Transferencia**: 1 % de max(valor de tabla, valor declarado en la 08). **Mínimo 32 MRPA**. Incluye firmas, envío de legajo, cédula, título y alta/baja impositiva. (2B 169 MRPA transporte; 2C 70 MRPA armados, subastados y clásicos.)
  - **Beneficio habitualista**: si el transmitente es un comerciante habitualista que inscribió a su nombre (art. 9 RJA, Solicitud Tipo 08 o 17) y la venta se pide **dentro de los 90 días**, se paga **−10 %**.
  - **Transferencia a favor del habitualista** con Solicitud Tipo 08: **arancel 0** (Anexo I, cat. 7, nota del recargo por mora). Si se presenta tarde, el recargo (20 % por año, hasta 5) se calcula sobre el arancel que habría correspondido sin el beneficio.
- **3A Prenda/leasing**: "1 del monto del contrato" (el símbolo ‰ se pierde al extraer el texto del PDF; el recibo real confirma **1 por mil**). **Mínimo 12 MRPA**. 3B 8 MRPA.
- 8 Adicionales: A 3, B 8, C 22, D 4, E 2, F 11 MRPA (certificación de firma, placa provisoria, cédula, placas, título, rentas). Hace falta revisar a qué letra corresponde cada ítem antes de usarlos. [S]

### Anexo II (motovehículos) [V]
- 1A Inscripción inicial: 1 % del valor, **mínimo 21 MRPA** (1B 26 MRPA clásicas y armadas).
- 2A Transferencia: 1 %, **mínimo 15 MRPA** (2B 24 MRPA). Tiene el mismo −10 % para habitualista.
- 3A Prenda: 1 ‰, **mínimo 5 MRPA**.

## 3. Impuesto de Sellos provincial

| Provincia | Hecho | Alícuota / base / mínimo | Fuente | Estado |
|---|---|---|---|---|
| San Luis | Prenda de automotor (actividad 0000040) | **1,20 %** sobre el monto de la prenda; mínimo legal **$780** | Retención DPIP real (prenda $42.384.523,91 → $508.614,29); Ley VIII-254/2025 (Impositiva 2026) | [V] por recibo |
| San Luis | Transferencia / inscripción automotor | alícuotas 12‰ / 7,2‰ / 5‰ según el acto; mínimo para automóviles **$7.540** | https://siap.blogdelcontador.com.ar/novedades/san-luis-aprueba-la-ley-impositiva-2026-con-ajustes-en-ingresos-brutos-y-sellos/ | [S]: falta saber qué alícuota aplica a 0 km y a usado |
| San Juan | Transferencia de vehículos nuevos/usados | ítem específico en Ley 2803-I (2026); alícuota general 1,6 % | https://siap.blogdelcontador.com.ar/?p=78574 | [NV] |
| Mendoza | Sellos (Ley 9680, baja progresiva a 0 en 2030; general 1 % en 2026); desde 2025 los registros **ya no cobran** sellos de transferencia (ATM) | https://blogdelcontador.com.ar/news-46423-mendoza-avanza-hacia-la-eliminacion-del-impuesto-de-sellos-reduccion-progresiva-hasta-llegar-a-0-en-2030 ; https://www.diariouno.com.ar/economia/atm-decidio-que-los-registros-dejen-cobrar-sellos-transferencia-autos-2025-n1366415 | [NV]; prenda 2 % es dato 2024 desactualizado |
| Córdoba | Ley Impositiva 2026 = Ley 11090; régimen de liquidación única de sellos en transferencias (DGR, 2025) | https://siap.blogdelcontador.com.ar/categoria_normativa/sellos-cordoba/ | [NV] |

No se inventaron alícuotas: lo marcado [NV] tiene que confirmarlo contable o la gestora antes de cargarlo como vigente.

## 4. Matriz de fórmulas propuesta

Notación: `V` = max(valor de factura o declarado, valor de tabla), `P` = monto de la prenda, `M` = valor MRPA vigente, `S(prov, hecho)` = sellos.

| Trámite | Arancel DNRPA | + Prenda | + Sellos | + Honorarios |
|---|---|---|---|---|
| 0 km auto / pick-up | max(1 % V, 52 M) | max(1 ‰ P, 12 M) | S(prov, inscripción) + S(prov, prenda) | $32.500 (planilla) |
| 0 km moto | max(1 % V, 21 M) | max(1 ‰ P, 5 M) | ídem | ídem |
| Usado: particular → cliente | max(1 % V, 32 M) (moto: 15 M) | ídem auto/moto | S(prov, transferencia) | ídem |
| Usado: → concesionario (habitualista, ST 08) | **0** | — | S(prov, transf.) [NV si hay exención] | ídem |
| Usado: concesionario → cliente, ≤90 días | 0,9 × max(1 % V, 32 M) | ídem | S(prov, transf.) | ídem |
| Usado: concesionario → cliente, >90 días | max(1 % V, 32 M) | ídem | ídem | ídem |

Sobre la planilla del concesionario: el rango de PAGO por trámite (~$140k a $1,5M) cuadra con arancel 1 % más sellos de prenda de 1,2 %. Con prenda, los sellos suelen superar al arancel.

## 5. Validación

| Caso | Concepto | Recibo real | Fórmula | Diferencia |
|---|---|---|---|---|
| 0 km auto con prenda, Reg. 19008 San Luis N°3, 01/07/2026 | Inscripción inicial (1 % × 38.814.516,57) | 388.145,17 | 388.145,17 | 0 |
| | Prenda (1 ‰ × 42.384.523,91) | 42.384,52 | 42.384,52 | 0 |
| | Cédula 5.290 + título 2.580 + placas (bonificadas) + condicionamiento 1.010 | 8.880 | 0 en el esquema nuevo (incluidos en 1A) | Ver nota |
| | Total recibo | 431.539,69 | 430.529,69 + condicionamiento | −1.010 |
| | Sellos DPIP prenda (1,2 % × 42.384.523,91) | 508.614,29 | 508.614,29 | 0 |
| DNRPA estimador (0 km, pick-up, moto, usados, SL/SJ/MZA) | — | pendiente | — | No se corrió (captcha + datos reales) |

Nota: el recibo es del 01/07/2026, **anterior** a la Res. 412/2026 (01/09/2026), cuando cédula, título y condicionamiento se cobraban aparte. Para recibos posteriores al 01/09 hay que revalidar si el "condicionamiento" ($1.010) sigue apareciendo. Con el recibo, el núcleo de la fórmula (1 %, 1 ‰ y 1,2 %) queda **verificado al centavo**.

## 6. Tabla de valuación: formato y búsqueda

- Se publica **solo como PDF** (~3,3 MB): `https://www.dnrpa.gov.ar/valuacion/informacion/01-10-2026.pdf` (las tablas históricas siguen el patrón `…/informacion/DD-MM-AAAA.pdf`). No se encontró CSV ni XLS.
- Columnas: `I/N` (importado/nacional), `MTM/FMM` (código), `T` (tipo), `Fab`, `Marca`, `Tipo`, `Mod`, descripción de marca, modelo y tipo, y valores en **pesos** por año (0 km, 2025 … 2002). `pdftotext -layout` lo extrae bien, pero las filas de variantes repiten la descripción en blanco (hay que heredarla de la fila anterior).
- La búsqueda en `valuacion/valuaciones.php` es una página de portada; no se encontró un endpoint de consulta abierto.
- El estimador oficial busca el valor por certificado de fabricación o por dominio, no por marca y modelo.
- Propuesta: un script importa el PDF de cada vigencia a la tabla `valuaciones(vigencia, codigo_mtm, marca, modelo, tipo, anio, valor)`. En la app se elige marca → modelo → año y, si no figura, año anterior + 8 %.

## 7. Riesgos y huecos

1. El **valor MRPA en pesos** no aparece publicado. Se calcula con la UVA del BCRA y hay que confirmarlo con un recibo posterior al 01/09/2026. Solo afecta a los mínimos.
2. **Sellos de transferencia y 0 km** en las 4 provincias: [NV]. Es la mayor fuente de error porque las alícuotas son de 1 % o más.
3. Exenciones de sellos para habitualistas: no investigadas a fondo [NV].
4. La regla V = max(factura, tabla) en 0 km: la factura incluye gastos e impuestos, así que el valor declarado del recibo (38,8 M) probablemente sea el de factura.
5. La tabla cambia casi todos los meses (dispos 2026 con vigencias 04/05, 01/06, 01/07, 01/08, 04/09 y 01/10).
6. No hay *prior art* confiable de calculadoras de gestores con fórmulas 2026; las notas de prensa no dan alícuotas.
7. Se usó la descarga de JS estático en lugar de captura de red con REA: alcanzó para ver que la lógica está en el servidor.

## 8. Arquitectura recomendada

**Replicar las fórmulas como datos versionados en Postgres (Supabase). No hacer de proxy del estimador oficial.**

- `parametros_arancel(vigencia_desde, concepto, tipo_vehiculo, porcentaje, minimo_mrpa, fuente_url, verificado)`
- `mrpa(vigencia_desde, valor_pesos, fuente)` y `sellos(provincia, hecho, alicuota, base, minimo, vigencia_desde, fuente_url, verificado)`
- `valuaciones(...)` importada del PDF.
- Función `estimar_tramite(tipo, vehiculo, provincia, valor, prenda, es_habitualista, dias_desde_inscripcion)` que devuelve el desglose y marca cada línea [V] o [NV].
- **Calibración**: comparar cada recibo real de la gestora con la estimación y mostrar la desviación para ajustar los parámetros. Solo acceso de gerencia y contable.
