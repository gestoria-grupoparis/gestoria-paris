# Análisis y estimador de costos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimador de costos por trámite (parámetros versionados, cálculo en SQL), pantalla Análisis (gasto real, líneas y donas) y previsión semanal de fondos, solo para gerencia y contable.

**Architecture:** Tres migraciones nuevas: tablas + función pura `calcular_estimado` + RPC con permisos; catálogo de parámetros con fuente y vigencia; RPC de análisis y previsión que devuelven jsonb. El front agrega la ruta `/analisis` (lazy, con Recharts dentro del mismo chunk), una sección "Costo estimado" en el panel del trámite y la pestaña Parámetros. El mock E2E replica cada RPC/tabla nueva.

**Tech Stack:** Postgres (Supabase), Vitest + embedded-postgres, React 19 + React Query, Recharts 3 (lazy), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-analisis-estimador-design.md` · Investigación: `docs/gestoria/01-investigacion-estimador.md`

## Global Constraints

- Módulo interno: solo `mi_rol() in ('gerencia','contable')` y `tiene_alcance(empresa, null)`. La gestora no ve menú, rutas, filas (RLS) ni ejecuta RPC.
- No editar migraciones existentes; nuevas con timestamp > 20261101000400; solo caracteres WIN1252 (sin flechas ni emoji).
- Parámetros solo con valores de la investigación; lo no verificado no se carga (la línea dice "sin dato"). MRPA en pesos: fila con `valor` null, fuente "A CONFIRMAR ..." y `verificado=false`.
- Montos en centavos bigint; redondeo `round()` numérico (mitad hacia arriba). El front solo formatea.
- No se crean movimientos ni se tocan saldos.
- Gráficos: solo líneas (curva `monotone` con puntos) y donas. Nunca barras.
- Recharts solo en el chunk de `/analisis`; bundle principal <= +5 kB gzip.
- Copy en español rioplatense; componentes de `web/src/ui`.
- Previsión: < 4 semanas de historia => "historia insuficiente"; el pipeline no se suma dos veces.
- Commits por tarea: `git add <rutas>`, mensaje convencional en español + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisiones

- Decisión: `parametros_estimador(clave, vehiculo, provincia, valor numeric null, unidad, vigencia_desde, vigencia_hasta, fuente, verificado)` en una sola tabla (en vez de tres tablas `mrpa`/`sellos`/`parametros_arancel`): una sola pantalla de edición y una sola regla de vigencia.
- Decisión: si `mrpa_pesos` no tiene valor, la línea usa solo el porcentaje y queda marcada "mínimo sin dato (MRPA a confirmar)"; confianza `parcial`.
- Decisión: los sellos del acto (inscripción/transferencia) no tienen regla verificada en ninguna provincia: siempre línea "sin dato". Por eso hoy toda estimación con valor es `parcial`.
- Decisión: tipo de trámite -> fórmula: `patentamiento_0km` = inscripción; `transferencia_usado` y `transferencia_parte_pago` = transferencia. Destino: `cliente` | `habitualista_08` (arancel 0) | `reventa_90` (-10 %).
- Decisión: el estimado se calcula desde el panel del trámite (no en el alta, para no tocar el formulario que usan otros roles); cada cálculo guarda una versión nueva en `estimados` (inmutable).
- Decisión: gasto real = pagos netos imputados a trámites (`-sum(importe)` de movimientos con trámite) por fecha de operación, igual que `informe_costos_tramites`. Concepto = desglose de los movimientos (arancel, prenda, sellado, otros) + honorarios de las filas de rendiciones del período (por mes de la rendición). Los comprobantes de Rendiciones no se usan en esta versión (limitación).
- Decisión: semana probable de pago del pipeline = semana actual si el trámite tiene presupuesto, la siguiente si solo tiene estimado; sin presupuesto ni estimado no suma (se cuenta aparte como "sin monto").
- Decisión: previsto de cada semana = `greatest(pipeline, proyección)`: la proyección por historial ya incluye lo que está en el pipeline, así que no se suman.
- Decisión: la alerta compara el saldo **registrado** con el previsto acumulado (el disponible ya descuenta los comprometidos, que están en el pipeline). Se muestran ambos.
- Decisión: Parámetros: gerencia edita, contable solo ve.
- Decisión: XLSX con `exportarPlanilla` existente; PDF por impresión del navegador (`window.print()` con estilos de impresión).

## Review Focus

1. Gestora o comercial llamando las RPC directo -> `SIN_PERMISO`; leyendo tablas -> 0 filas. (Tarea 1, 3)
2. Valor de referencia vacío o 0 -> confianza `sin_valor`, sin excepción. (Tarea 1)
3. Provincia sin regla de sellos de prenda (San Juan) -> línea "sin dato", nunca 0 inventado. (Tarea 1)
4. Cambiar un parámetro no altera estimados guardados. (Tarea 2)
5. Período sin datos -> KPIs en 0 y gráficos con estado vacío, sin división por cero en la variación. (Tarea 3, 5)

---

### Task 1: Esquema del estimador y cálculo puro

**Files:** Create `supabase/migrations/20261102000100_estimador.sql`, `supabase/migrations/20261102000200_estimador_catalogos.sql`; Test `tests/db/estimador.test.ts`

**Interfaces — Produces:**
- `public.calcular_estimado(p_tipo text, p_vehiculo text, p_provincia text, p_valor bigint, p_prenda bigint, p_destino text, p_fecha date) returns jsonb` -> `{lineas:[{concepto, base_cents, regla, importe_cents|null, fuente, verificado}], total_cents, confianza: 'completo'|'parcial'|'sin_valor'}`. Sin grant a authenticated.
- `public.estimar_tramite(p_tramite uuid, p_valor bigint, p_prenda bigint, p_vehiculo text, p_destino text, p_provincia text) returns uuid` (gerencia/contable con alcance; guarda versión en `estimados`).
- Tablas `parametros_estimador`, `estimados(id, tramite_id, version, entrada jsonb, lineas jsonb, total_cents, confianza, creado_por, created_at)`, RLS select interno.

- [ ] Step 1: tests: recibo real `calcular_estimado('patentamiento_0km','auto','San Luis',3881451657,4238452391,'cliente','2026-10-29')` -> líneas arancel 38814517, prenda 4238452, sellos prenda 50861429, honorarios 3250000, sellos del acto `importe_cents` null, confianza `parcial`; `habitualista_08` -> arancel 0; `reventa_90` -> 90 % del arancel; valor null -> `sin_valor`; San Juan prenda -> sellos prenda null; mínimo San Luis 78000 con prenda chica (100000 cents -> 78000); gestora -> `estimar_tramite` SIN_PERMISO y `select` de `estimados`/`parametros_estimador` vacío; contable con alcance guarda versiones 1 y 2.
- [ ] Step 2: `npx vitest run tests/db/estimador.test.ts` -> FAIL (función inexistente).
- [ ] Step 3: migraciones (catálogo: mrpa_pesos null "A CONFIRMAR", inscripcion 1 %/52/21, transferencia 1 %/32/15, prenda 1 por mil/12/5, reventa -10 %, sellos prenda San Luis 1,2 %/78000, honorarios 3250000, vigencia 2026-09-01 y fuentes de la investigación).
- [ ] Step 4: test -> PASS. Step 5: commit `feat(db): estimador de costos por trámite`.

### Task 2: Parámetros editables

**Files:** Create `supabase/migrations/20261102000300_analisis.sql` (sección 1); Test `tests/db/estimador.test.ts`

**Produces:** `public.guardar_parametro_estimador(p_clave text, p_vehiculo text, p_provincia text, p_valor numeric, p_vigencia_desde date, p_fuente text, p_verificado boolean) returns uuid` — solo gerencia; cierra la vigencia anterior (`vigencia_hasta = desde - 1`).

- [ ] tests: gerencia carga MRPA -> nuevo cálculo usa el mínimo y el estimado viejo no cambia; contable -> SIN_PERMISO; fuente vacía -> DATO_INVALIDO. Rojo -> código -> verde -> commit.

### Task 3: RPC de análisis y previsión

**Files:** `supabase/migrations/20261102000300_analisis.sql`; Test `tests/db/analisis.test.ts`

**Produces:**
- `public.analisis_gastos(p_desde date, p_hasta date, p_empresa uuid, p_sucursal uuid, p_tipo text) returns jsonb` -> `{kpis:{gasto_cents, gasto_anterior_cents, variacion_pct|null, estimado_pendiente_cents, honorarios_cents, tramites:{patentamiento_0km, transferencia_usado, transferencia_parte_pago}}, serie:[{fecha, gasto_cents}], semanas:[{semana, tramites}], por_tipo:[{etiqueta, cents}], por_empresa:[...], por_concepto:[...]}` (montos como texto).
- `public.prevision_fondos(p_hoy date, p_empresa uuid) returns jsonb` -> `{semanas_historia, suficiente, semanas:[{semana, pipeline_cents, base_cents, alto_cents, previsto_cents}], sin_monto, saldos:[{empresa_id, empresa, registrado_cents, disponible_cents, previsto_1, previsto_2, previsto_4, alerta}]}`.
- tests: pagos reales suman, reversión resta; variación null si anterior 0; gestora SIN_PERMISO; < 4 semanas -> `suficiente=false` y base null; con 6 semanas base = promedio de las últimas 4; un trámite con presupuesto en el pipeline aparece en `pipeline_cents` y `previsto = greatest(...)`; alerta cuando registrado < previsto_4.

### Task 4: Web — consultas, navegación y mock

**Files:** `web/src/features/analisis/{consultas.ts,formato.ts,formato.test.ts}`, `web/src/app/navegacion.ts`, `web/src/app/rutas.tsx`, `web/e2e/mock-supabase.ts`
- Menú "Análisis" (`/analisis`) para gerencia y contable; mock: `analisis_gastos`, `prevision_fondos`, `estimar_tramite`, `guardar_parametro_estimador`, tablas `parametros_estimador`, `estimados` con la regla interna.
- test unitario: `rangoPeriodo('mes', hoy)`, `etiquetaVariacion(null)` = "sin período anterior".

### Task 5: Pantalla Análisis

**Files:** `web/src/pages/Analisis.tsx`, `web/src/features/analisis/{Graficos.tsx,Prevision.tsx,Parametros.tsx}`; `npm i recharts` (web).
- Pestañas Gasto / Previsión / Parámetros; filtros período, razón social, sucursal, tipo; KPIs; `LineChart` (`type="monotone"`, `dot`) y `PieChart` con `innerRadius`; exportar XLSX e Imprimir.

### Task 6: Estimado en el panel del trámite

**Files:** `web/src/features/analisis/EstimadoTramite.tsx`, `web/src/features/tramites/PanelDetalle.tsx`
- Sección "Costo estimado" solo si rol gerencia/contable: formulario, líneas con "sin dato", chip de confianza, comparación estimado / real / diferencia.

### Task 7: E2E y verificación

**Files:** `web/e2e/analisis.spec.ts`
- gerencia ve menú, líneas (`.recharts-line`) y donas, ninguna `.recharts-bar`; "historia insuficiente"; calcula estimado en el panel; gestora no ve el menú y `/analisis` la devuelve a su inicio. Suites completas, `npm run build` y medición del chunk principal; `graphify update .`.

## Notas de ejecución

- Decisión: `guardar_parametro_estimador` quedó en su propia migración (`20261102000300_parametros_estimador.sql`) y el análisis en `20261102000400_analisis.sql`.
- Decisión: la diferencia estimado/real la calcula la base (`comparar_estimado(p_tramite)`, migración `20261102000500_comparar_estimado.sql`) para que el front solo formatee.
- Bundle principal: 37,10 kB -> 37,24 kB gzip (+0,14 kB). Recharts vive en el chunk `Analisis` (115,6 kB gzip).
- Limitaciones: el concepto sale del desglose de los movimientos (no de los comprobantes de Rendiciones); la vista de impresión usa el estilo de pantalla (oculta filtros y botones, no el menú lateral).
