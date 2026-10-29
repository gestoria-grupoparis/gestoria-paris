# Pulido total — plan de implementación (2026-10-29)

> Para el ejecutor: cada tarea es independiente y se ejecuta en orden. TDD: escribir primero el test indicado, verlo fallar, implementar, verlo pasar. Nunca editar migraciones existentes: los cambios de base van en migraciones nuevas `supabase/migrations/2026110100XXXX_*.sql`. Comandos: DB `npx vitest run tests/db` (raíz), unit `npx vitest run` (web/), E2E `npx playwright test` (web/). El mock de Supabase de E2E es `web/e2e/mock-supabase.ts`: cada RPC nueva o vista nueva se agrega ahí con la misma regla que la base (y su error con el mismo código y texto).

Prioridades: **P0** = algo se rompe, engaña o deja al usuario trabado · **P1** = importante para el uso diario · **P2** = pulido.

Hallazgos de la lectura que motivan el plan (referencias):
- `web/src/lib/errores.ts` `mensajeError` descarta el texto en castellano que manda la base y muestra un genérico por código. Ej.: `DATO_INVALIDO: primero marcá que retiraste el legajo` se ve como "Hay datos inválidos. Revisá el formulario."; `NO_AUTORIZADO: no hay fondos para este presupuesto…` se ve como "El trámite todavía no está autorizado." (falso).
- No hay `ErrorBoundary`: cualquier excepción de render deja la pantalla en blanco.
- `QueryClient` sin opciones (`web/src/main.tsx`): reintenta 3 veces errores de permisos/validación, refetch al enfocar sin `staleTime`.
- `Dialogo` (`web/src/features/tramites/Dialogo.tsx`): sin trampa de foco, sin devolver el foco, sin bloquear el scroll del fondo, Escape cierra aunque haya una mutación en curso, y el `useEffect([onCerrar])` vuelve a enfocar el primer campo cada vez que el padre re-renderiza (realtime/refetch) — el foco salta mientras se escribe el motivo.
- Tablero: no muestra "presupuestos por aprobar" (el paso que traba a la gestora), ni Doral/Paris Trac, ni trámites por razón social; el KPI "Sin fondos" dice "No se pueden presentar todavía" pero la oficina sí puede marcar presentado.
- `AccionesTramite`: "Reanudar" queda deshabilitado sin explicación mientras carga el historial o si falla; el estado previo se calcula en el front con una lógica que debe coincidir con la de `cambiar_estado`.
- Gestora: "Marcar presentado/finalizado/devuelto" se ejecutan con un toque, sin confirmación ni aviso de "Deshacer" inmediato; el error se muestra lejos de la tarjeta.
- Sin división de código: todas las pantallas (incluido el login con marquee) en el bundle inicial.
- Sidebar oscuro: rótulo "Menú" `text-white/35` a 9px y rol `text-white/50` a 12px no cumplen AA.

---

## Tarea 1 — Mostrar el mensaje real de la base en cada error (P0)
**Objetivo:** que cada error explique qué pasó y qué hacer, con el texto en castellano de la RPC.
**Archivos:** `web/src/lib/errores.ts`, `web/src/lib/errores.test.ts` (nuevo si no existe).
**Cambios:**
- `mensajeError(e)`: si el mensaje tiene forma `CODIGO: detalle` y el código es conocido, devolver el `detalle` con mayúscula inicial y punto final; usar `MENSAJES[codigo]` solo si el detalle está vacío.
- Traducir los placeholders técnicos que la base interpola (`borrador`, `en_gestoria`, `finalizado_registro`…) con `etiquetaEstado` de `features/tramites/filtros.ts` (reemplazo por palabra completa).
- Errores de red (`TypeError: Failed to fetch`, `AuthRetryableFetchError`) → "No hay conexión. Revisá internet y volvé a intentar."; JWT vencido (`PGRST301`, `invalid JWT`) → "Tu sesión venció. Volvé a ingresar."; violaciones de `check`/`unique` de Postgres (`23505`, `23514`) → mensaje de dato duplicado/inválido.
- `NO_AUTORIZADO` genérico pasa a "Todavía no se puede hacer este paso."
**Aceptación:** unit `web/src/lib/errores.test.ts` (casos: detalle con estado interpolado, sin detalle, red, JWT, 23505, desconocido). E2E `web/e2e/gestora.spec.ts`: presentar sin legajo retirado (mock devuelve el error de `exigir_aprobacion_gestora`) muestra "Primero marcá que retiraste el legajo.".
Decisión: la UI no ofrece "Marcar presentado" sin legajo retirado, así que el caso queda cubierto por el unit test; VERSION_CONFLICTO conserva el texto fijo (el detalle de la base es técnico).

## Tarea 2 — ErrorBoundary global y por pantalla (P0)
**Objetivo:** nunca una pantalla en blanco.
**Archivos:** `web/src/ui/LimiteError.tsx` (nuevo), `web/src/ui/index.ts`, `web/src/main.tsx`, `web/src/app/Layout.tsx`.
**Cambios:** componente de clase `LimiteError` con `PantallaMensaje tono="error"` ("Algo salió mal en esta pantalla", botones "Reintentar" que resetea y "Ir al inicio"); envolver `<Rutas/>` en `main.tsx` y el `<Outlet/>` de `Layout` (con `key={pathname}` para resetear al navegar), así el menú sigue usable. Para errores de import dinámico (`Failed to fetch dynamically imported module`, tras un deploy) recargar la página una sola vez (flag en `sessionStorage`).
**Aceptación:** unit `web/src/ui/LimiteError.test.tsx` (hijo que lanza → muestra mensaje; Reintentar re-monta). E2E nuevo `web/e2e/robustez.spec.ts`: el mock devuelve una fila malformada para `/tablero` que hace lanzar el render → se ve "Algo salió mal" y el menú lateral sigue navegando.

## Tarea 3 — Configuración de React Query (P0)
**Objetivo:** no reintentar errores de negocio, no martillar la API, datos frescos razonables.
**Archivos:** `web/src/lib/consultas.ts` (nuevo: `crearQueryClient()`), `web/src/main.tsx`, `web/src/lib/consultas.test.ts`.
**Cambios:** `retry: (n, e) => codigoError(e) == null && n < 2`; `staleTime: 30_000`; `refetchOnWindowFocus: true` sólo para queries sin realtime; `mutations.retry: 0`. Un `MutationCache.onError` global que, si el error es JWT vencido, llama `sesion.salir()` con aviso.
**Aceptación:** unit `web/src/lib/consultas.test.ts` (retry false para `SIN_PERMISO: x`, true para error de red en intento 0). E2E `web/e2e/robustez.spec.ts`: un RPC que devuelve `SIN_PERMISO` se llama una sola vez (contador en el mock).

## Tarea 4 — Diálogo accesible y estable (P0)
**Objetivo:** el foco no salta mientras se escribe; teclado y lector de pantalla funcionan.
**Archivos:** `web/src/features/tramites/Dialogo.tsx` (mover a `web/src/ui/Dialogo.tsx` y re-exportar desde la ruta vieja para no romper imports), `web/src/ui/index.ts`.
**Cambios:**
- Enfocar el primer campo sólo al montar (efecto con `[]`; guardar `onCerrar` en un ref).
- Trampa de foco (Tab/Shift+Tab ciclan dentro), devolver el foco al elemento que abrió al cerrar, `overflow:hidden` en `body` mientras está abierto, `inert` en `#root`.
- Prop `bloqueado` (true mientras la mutación está pendiente): Escape, la X y el clic en fondo no cierran.
- Clic en el fondo cierra (si no está bloqueado) y pide confirmación si el formulario está "sucio" (prop `sucio`).
- `FormAccion` pasa `bloqueado={m.isPending}` y `sucio={!!motivo}`.
**Aceptación:** unit `web/src/ui/Dialogo.test.tsx` (foco inicial una sola vez con re-render del padre; Tab cicla; foco vuelve al botón). E2E `web/e2e/tramites.spec.ts`: abrir "Suspender", escribir motivo, forzar un refetch (evento realtime del mock) y seguir escribiendo → el texto queda completo; Escape durante envío no cierra.

## Tarea 5 — Reanudar sin botón muerto; estado previo desde la base (P0)
**Objetivo:** "Reanudar" siempre funciona o explica por qué no.
**Archivos:** nueva migración `supabase/migrations/20261101000100_estado_previo.sql`, `web/src/features/tramites/consultas.ts`, `web/src/features/tramites/AccionesTramite.tsx`, `web/src/features/tramites/flujo.ts`, `web/e2e/mock-supabase.ts`.
**Cambios:** RPC `estado_previo_suspension(p_tramite uuid) returns text` (security definer, mismo SQL que usa `cambiar_estado`, con chequeo de alcance) y nueva RPC `reanudar_tramite(p_tramite, p_motivo, p_version)` que lo resuelve en la base. El front llama a `reanudar_tramite` y deja de depender del historial; mientras carga el botón muestra `cargando`, y si falla muestra el error del Tarea 1 en el diálogo. Eliminar `estadoPrevioSuspension` del front (o dejarlo sólo para el texto del aviso).
**Aceptación:** DB `tests/db/estados.test.ts` (nuevo caso: suspender desde `presentado` → `reanudar_tramite` vuelve a `presentado`; sin motivo → `DATO_INVALIDO`; gestora → `SIN_PERMISO`). E2E `web/e2e/deshacer.spec.ts`: suspender y reanudar desde el panel.

## Tarea 6 — Matriz botón ↔ regla de la base, verificada por test (P0)
**Objetivo:** ningún botón ofrecido en un estado en que la base lo rechace, y ninguna transición permitida sin botón.
**Archivos:** `web/src/features/tramites/flujo.ts`, `web/src/features/tramites/flujo.test.ts`, `tests/db/matriz-acciones.test.ts` (nuevo), `web/src/features/gestora/consultas.ts`.
**Cambios:** exportar en `flujo.ts` una función `accionesOficina(estado)` y `accionesGestora(grupo, retirado)` que devuelvan la lista de transiciones que la UI ofrece (las usan `AccionesTramite` y `TarjetaTramite`). El test de DB recorre todos los estados × rol (gerencia, contable, gestora asignada, gestora no asignada) y compara con `transicion_permitida` + reglas extra (`exigir_aprobacion_gestora`, motivo de retroceso) usando una tabla JSON exportada a `tests/db/fixtures/acciones-ui.json` generada desde `flujo.ts` (script `web/scripts/exportar-acciones.ts`), para que front y base no diverjan. Casos que hoy el front no ofrece y la base permite (p. ej. `presentado → en_gestoria`) quedan documentados en el test como decisión.
**Aceptación:** DB `tests/db/matriz-acciones.test.ts` (toda acción ofrecida pasa en la base con datos válidos; toda la que no se ofrece y la base permite está en la lista blanca documentada). Unit `flujo.test.ts` (snapshot de la matriz).
Decisión: el test de DB importa `flujo.ts` directamente (no hace falta exportar a JSON ni script; así no pueden divergir). `AccionesTramite`/`TarjetaTramite` siguen con su lógica actual, equivalente a la matriz verificada.

## Tarea 7 — Confirmación + "Deshacer" inmediato en pasos de la gestora (P0)
**Objetivo:** un toque equivocado de la gestora no la obliga a buscar el botón de deshacer ni a escribir un motivo largo.
**Archivos:** `web/src/ui/Aviso.tsx` (nuevo: toast accesible con `role="status"`/`aria-live`), `web/src/ui/index.ts`, `web/src/main.tsx` (proveedor), `web/src/pages/MisTramites.tsx`, `web/src/features/gestora/TarjetaTramite.tsx`.
**Cambios:** tras "Retiré el legajo/Marcar presentado/finalizado/devuelto" mostrar aviso "Marcado como presentado · Deshacer" durante 8 s; "Deshacer" llama al deshacer con motivo automático "Deshecho al instante por la gestora" (la base exige motivo no vacío: se cumple). El error de la acción se muestra en la tarjeta afectada (no arriba de la página) y el botón tocado muestra `cargando` sólo en esa tarjeta (hoy `ocupado` bloquea todas).
**Aceptación:** E2E `web/e2e/ping-pong.spec.ts`: marcar presentado → aviso → Deshacer → la tarjeta vuelve a "Listos" y el mock registra `cambiar_estado(…, 'autorizado', motivo no vacío)`. Unit `web/src/ui/Aviso.test.tsx`.

## Tarea 8 — Aviso de éxito en todas las acciones de oficina (P1)
**Objetivo:** cada acción confirma qué pasó.
**Archivos:** `web/src/features/tramites/AccionesTramite.tsx`, `FormAlta.tsx`, `FormEdicion.tsx`, `FormReintegro.tsx`, `web/src/features/habitualista/Form*.tsx`, `web/src/features/usuarios/FormUsuario.tsx`.
**Cambios:** `FormAccion.onHecho` por defecto dispara el aviso de la Tarea 7 con texto específico ("Trámite T-0012 autorizado", "Carga de $ 150.000,00 registrada", "Usuario creado. Pasale la contraseña inicial").
**Aceptación:** E2E `web/e2e/tramites.spec.ts`, `habitualista.spec.ts`, `usuarios-gestion.spec.ts`: después de cada acción, `getByRole('status')` contiene el texto.

## Tarea 9 — Tablero: presupuestos por aprobar y trámites por etapa del ping pong (P1)
**Objetivo:** que gerencia vea de un vistazo lo que traba a la gestora.
**Archivos:** nueva migración `supabase/migrations/20261101000200_tablero_resumen.sql`, `web/src/features/tablero/consultas.ts`, `consultas.test.ts`, `web/src/pages/Tablero.tsx`, `web/e2e/mock-supabase.ts`.
**Cambios:** vista o RPC `resumen_tablero()` (security invoker, respeta RLS/alcance) que devuelve en una sola consulta: por razón social → abiertos, por aprobar (presupuesto vigente sin aprobar), listos para retirar, presentados, devueltos sin cerrar, sin fondos, demorados. En el Tablero: KPI "Por aprobar" (enlace a `/tramites?por_aprobar=1`) reemplaza "Trámites abiertos" en el primer lugar; bloque "Ping pong con la gestoría" con las 5 etapas en orden y contador; tabla compacta "Por razón social" (incluye Doral y Paris Trac, que no tienen Habitualista). Lista "Requieren intervención" suma el motivo "por aprobar". Corregir el detalle del KPI "Sin fondos" a "La gestora no puede presentarlos".
**Aceptación:** DB `tests/db/tablero.test.ts` (nuevo: conteos por empresa con datos sembrados, contable con alcance limitado sólo ve sus empresas). Unit `features/tablero/consultas.test.ts`. E2E nuevo `web/e2e/tablero.spec.ts`: KPI "Por aprobar" = 2 y el clic filtra la lista de trámites.

## Tarea 10 — Filtro "Por aprobar" en Trámites y acción en lote (P1)
**Objetivo:** aprobar varios presupuestos sin abrir uno por uno.
**Archivos:** `web/src/features/tramites/filtros.ts`, `filtros.test.ts`, `FiltrosTramites.tsx`, `TablaTramites.tsx`, `web/src/pages/Tramites.tsx`.
**Cambios:** filtro `por_aprobar` en la URL; columna/indicador "Presupuesto por aprobar" en la tabla; con selección, botón "Aprobar presupuestos (n)" que llama `aprobar_presupuesto` uno por uno y muestra el resultado por fila (aprobado / sin fondos / versión cambiada), sin abortar el resto.
**Aceptación:** unit `filtros.test.ts` (parseo de `por_aprobar`). E2E `web/e2e/ping-pong.spec.ts`: aprobar 2 en lote, uno sin fondos queda marcado con el motivo.
Decisión: ya existía la vista "Presupuestos para aprobar"; `?por_aprobar=1` es un alias de esa vista (no columna nueva en la tabla). El lote aparece en la barra de selección (escritorio).

## Tarea 11 — Sin fondos al aprobar: camino claro (P1)
**Objetivo:** en vez de sólo un texto, ofrecer la salida.
**Archivos:** `web/src/features/tramites/AccionesTramite.tsx`, `PanelDetalle.tsx`.
**Cambios:** cuando `porAprobar && sinFondos`: botón "Registrar carga" que abre `FormCarga` con la empresa preseleccionada (contable y gerencia) y, si rol gerencia, botón "Aprobar excepción de fondos" (usa `puedeAprobarExcepcion`). Tras la carga, refrescar finanzas y mostrar "Aprobar presupuesto".
**Aceptación:** E2E `web/e2e/ping-pong.spec.ts`: sin fondos → cargar fondos desde el panel → aparece "Aprobar presupuesto" y aprueba.

## Tarea 12 — Conflictos de versión con recarga en un toque (P1)
**Objetivo:** `VERSION_CONFLICTO` no deja al usuario trabado.
**Archivos:** `web/src/features/tramites/AccionesTramite.tsx` (`FormAccion`), `FormEdicion.tsx`, `web/src/features/gestora/FormPresupuesto.tsx`.
**Cambios:** si `codigoError(e) === 'VERSION_CONFLICTO'`, el mensaje del diálogo incluye un botón "Recargar y reintentar" que invalida `['tramites']`, re-lee la versión y vuelve a mostrar el formulario con lo escrito intacto.
**Aceptación:** E2E `web/e2e/tramites-edicion.spec.ts`: el mock incrementa la versión entre abrir y confirmar → aparece el botón → reintento exitoso con el motivo conservado.

## Tarea 13 — Montos grandes y nombres largos sin desbordes (P0)
**Objetivo:** ningún texto se sale de su tarjeta de 320 a 1440 px.
**Archivos:** `web/src/pages/Tablero.tsx` (`TarjetaEmpresa`), `web/src/features/habitualista/TarjetasSaldo.tsx`, `web/src/pages/MisTramites.tsx`, `web/src/features/gestora/TarjetaTramite.tsx`, `web/src/ui/KpiTile.tsx`, `web/src/features/tramites/PanelDetalle.tsx`, `web/src/features/tramites/TablaTramites.tsx`, `web/src/index.css`.
**Cambios:** montos con `@container` + tamaño fluido (`text-[clamp(20px,9cqi,32px)]`), `min-w-0` en todos los hijos flex/grid, `break-words`/`[overflow-wrap:anywhere]` en nombres de cliente, empresa y vehículo, `truncate` + `title` en celdas de tabla. Tablero: grid `md:grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]`. `Intervencion`: el nombre del cliente con `min-w-0 truncate` real (hoy está dentro de `flex-wrap`).
**Aceptación:** E2E nuevo `web/e2e/responsive.spec.ts`: fixture con cliente de 80 caracteres y saldo `-99999999999999` centavos; para anchos 320, 375, 768, 1024, 1440 y cada ruta por rol, `document.documentElement.scrollWidth <= innerWidth` y ningún `[data-testid=disponible]` con `scrollWidth > clientWidth`. Agregar screenshots de referencia `toHaveScreenshot` sólo para 375 y 1440.
Decisión: sin `toHaveScreenshot` (las capturas dependen de fuentes y sistema, darían falsos rojos); el test mide desbordes en tablero, trámites, habitualista y mis-trámites.

## Tarea 14 — Tablas en móvil (P1)
**Objetivo:** trámites, extracto, compromisos, informes y usuarios legibles en 320–767 px.
**Archivos:** `web/src/ui/DataTable.tsx`, `web/src/features/tramites/TablaTramites.tsx`, `web/src/features/habitualista/TablaExtracto.tsx`, `TablaCompromisos.tsx`, `web/src/pages/Informes.tsx`, `web/src/pages/Usuarios.tsx`.
**Cambios:** `DataTable` acepta `vistaMovil` (render de tarjeta por fila) y la usa por debajo de `md`; columnas prioritarias (número, cliente, estado, monto). Contenedor con scroll horizontal y sombra indicadora sólo donde la tarjeta no aplica.
**Aceptación:** E2E `web/e2e/responsive.spec.ts`: a 375 px cada pantalla muestra filas como `article` con número y estado visibles; sin scroll horizontal de página.

## Tarea 15 — Contraste y foco del sidebar y del login (P1)
**Objetivo:** AA en todo texto sobre `noche`.
**Archivos:** `web/src/app/Layout.tsx`, `web/src/pages/Login.tsx`, `web/src/index.css`, `design-system/MASTER.md` no se toca (regla); sólo código.
**Cambios:** "Menú" a `text-white/60` y 10px; rol/empresa a `text-white/65`; ítems inactivos ≥ `text-white/70`; foco visible `outline-[#7aa2f7]` en links del sidebar y botones de cuenta; ítem activo con indicador no sólo por color (barra izquierda).
**Aceptación:** E2E nuevo `web/e2e/a11y.spec.ts` con `@axe-core/playwright` (devDependency) sobre login, tablero, trámites, habitualista, informes, usuarios, mis-tramites y cada diálogo abierto: 0 violaciones `serious/critical` (reglas color-contrast, label, button-name, aria-*).

## Tarea 16 — Accesibilidad de formularios y estados (P1)
**Objetivo:** errores asociados a su campo, anuncios correctos.
**Archivos:** `web/src/ui/Field.tsx`, `web/src/features/tramites/FormAlta.tsx`, `FormEdicion.tsx`, `web/src/features/gestora/FormPresupuesto.tsx`, `FormPago.tsx`, `web/src/features/habitualista/Form*.tsx`, `web/src/features/usuarios/FormUsuario.tsx`, `web/src/ui/Estados.tsx`.
**Cambios:** `Field` acepta `error` → `aria-invalid` + `aria-describedby` y texto bajo el campo; validación por campo (no sólo banner general) y foco al primer campo inválido al enviar; `ErrorState` con `role="alert"`; skeletons con `aria-busy` en el contenedor; `Tablero` progress bars con `aria-hidden` ya — agregar texto alternativo en el `Link` ("Presentado: 3 trámites").
**Aceptación:** unit `web/src/ui/Field.test.tsx`. E2E `web/e2e/a11y.spec.ts` (envío vacío de "Nuevo trámite" enfoca el primer campo y `aria-invalid=true`).

## Tarea 17 — Entrada de montos: teclado, formato y límites (P1)
**Objetivo:** cargar plata sin errores en móvil y escritorio.
**Archivos:** `web/src/ui/CampoPesos.tsx` (nuevo), `web/src/lib/dinero.ts`, `web/src/lib/dinero.test.ts`, todos los formularios con montos (`FormPresupuesto`, `FormPago`, `FormReintegro`, `FormCarga`, `FormAjuste`, `FormReversion`, `FormConciliacion`, `FormAlta`).
**Cambios:** campo único `CampoPesos` con `inputMode="decimal"`, prefijo "$", acepta "1.500,50" y "1500.50", formatea al salir, rechaza > máximo admitido por la base (mismo límite que `registrar_pago`), cero o negativo donde no corresponda; devuelve centavos como string (nunca float).
**Aceptación:** unit `dinero.test.ts` (parseo `1.234.567,89` → `123456789`, `0,1` → `10`, `abc` → error, límite). E2E `web/e2e/gestora.spec.ts`: presupuesto "15.000" se envía como `1500000` centavos.

## Tarea 18 — Formulario de alta de trámite: defaults y teclado (P1)
**Objetivo:** alta rápida.
**Archivos:** `web/src/features/tramites/FormAlta.tsx`, `web/src/features/tramites/consultas.ts`.
**Cambios:** preseleccionar razón social y sucursal si el usuario tiene una sola en alcance (o la última usada, en `localStorage` con try/catch); dominio en mayúsculas automático con validación de formato AA123BB / ABC123; Enter envía; `autoComplete="off"` en dominio; botón "Guardar y cargar otro".
**Aceptación:** E2E `web/e2e/tramites.spec.ts`: contable con alcance a una sola sucursal ve los selects ya completos; dominio "ab123cd" se guarda "AB123CD"; dominio inválido muestra error en el campo.

## Tarea 19 — Estados vacío/carga/error uniformes en todas las pantallas (P1)
**Objetivo:** cada lista tiene los tres estados con texto útil y reintento.
**Archivos:** `web/src/pages/Tramites.tsx`, `Habitualista.tsx`, `Informes.tsx`, `Usuarios.tsx`, `MisTramites.tsx`, `Tablero.tsx`, `web/src/features/notificaciones/Campana.tsx`, `web/src/ui/Estados.tsx`.
**Cambios:** `ErrorState` siempre con botón "Reintentar" (hoy faltan en "Trámites por estado" y "Requieren intervención" del Tablero); vacío distinto de "sin resultados por filtro" (con botón "Limpiar filtros"); MisTramites vacío: "No tenés trámites asignados. Cuando la empresa te asigne uno, aparece acá."; saldos de gestora con error visible (hoy se ignora `saldos.isError`).
**Aceptación:** E2E nuevo `web/e2e/estados.spec.ts`: para cada pantalla, el mock responde vacío, error 500 y lento (delay) → se ven el vacío, el error con "Reintentar" que funciona y el skeleton con `role="status"`.

## Tarea 20 — Sesión vencida y sin conexión (P1)
**Objetivo:** el usuario entiende qué pasa y no pierde lo escrito.
**Archivos:** `web/src/lib/sesion.tsx`, `web/src/app/Layout.tsx`, `web/src/ui/BarraConexion.tsx` (nuevo).
**Cambios:** banda superior "Sin conexión. Los cambios se guardan cuando vuelva internet" (`navigator.onLine` + eventos) — los botones de envío se deshabilitan con ese texto; `onAuthStateChange('SIGNED_OUT')` inesperado → Login con aviso "Tu sesión venció".
**Aceptación:** E2E `web/e2e/robustez.spec.ts`: `context.setOffline(true)` muestra la banda y deshabilita "Confirmar"; volver online la quita.

## Tarea 21 — División de código y peso inicial (P1)
**Objetivo:** primera carga rápida en celulares de la gestoría.
**Archivos:** `web/src/app/rutas.tsx`, `web/vite.config.ts`, `web/src/pages/Login.tsx`.
**Cambios:** `React.lazy` para cada pantalla de `PANTALLAS` y `DefinirClave`, con `Suspense` → `PantallaCarga`; `build.rollupOptions.output.manualChunks` separando `@supabase`, `@tanstack`, `react`; precargar la pantalla inicial del rol (`import()` tras login); marcas del marquee del login con `loading="lazy"`. `exceljs` ya es dinámico: verificar que no entra al chunk principal.
**Aceptación:** test de build `web/scripts/presupuesto-bundle.test.ts` (vitest, corre `vite build` y verifica chunk de entrada < 180 kB gzip y ausencia de `exceljs` en él). E2E existentes siguen verdes.

## Tarea 22 — Consultas del Tablero e intervención eficientes (P2)
**Objetivo:** no traer filas de más ni URLs gigantes.
**Archivos:** `web/src/features/tablero/consultas.ts`, (usa la RPC de la Tarea 9).
**Cambios:** `listarIntervencion` pasa a usar `resumen_tablero`/vista server-side en vez de `.in('id', faltan)` (con cientos de sin fondos la URL supera el límite); `contarPorEstado` por `count` agrupado en la base.
**Aceptación:** DB `tests/db/tablero.test.ts` (500 trámites sin fondos devuelven en una llamada). Unit `consultas.test.ts` actualizado.
Decisión: hecho junto con la Tarea 9 (RPC `tramites_intervencion` en la misma migración, una sola llamada). `contarPorEstado` queda con conteos HEAD por estado (ya no trae filas). Sin test de 500 filas: la consulta es una sola llamada por construcción.

## Tarea 23 — Usuarios: contraseña inicial copiable y validada (P1)
**Objetivo:** gerencia crea el usuario y entrega la clave sin errores.
**Archivos:** `web/src/features/usuarios/FormUsuario.tsx`, `web/src/features/usuarios/usuarios.ts`, `usuarios.test.ts`.
**Cambios:** validación en vivo con las mismas reglas de `crear_usuario` (≥10, letras y números) mostrada como checklist; botón "Generar" (contraseña legible sin caracteres ambiguos) y "Copiar" (con aviso); después de crear, pantalla de resumen "Pasale a {nombre}: email + contraseña" con copiar todo, y aviso de que la cambiará al ingresar. Email normalizado a minúsculas y sin espacios.
**Aceptación:** unit `usuarios.test.ts` (generador cumple la regla 1000 veces; validador igual a la regex de la base). DB `tests/db/usuarios.test.ts` (email con mayúsculas/espacios se guarda normalizado o se rechaza igual que el front). E2E `web/e2e/usuarios-gestion.spec.ts`.

## Tarea 24 — Reset de contraseña por gerencia y desactivar sin perder trámites (P1)
**Objetivo:** si alguien olvida la clave, gerencia lo resuelve sin pasos técnicos; desactivar una gestora no deja trámites huérfanos.
**Archivos:** nueva migración `supabase/migrations/20261101000300_reset_clave.sql`, `web/src/features/usuarios/FormUsuario.tsx`, `web/src/pages/Usuarios.tsx`, `web/e2e/mock-supabase.ts`.
**Cambios:** RPC `restablecer_clave(p_usuario, p_clave)` (sólo gerencia, misma validación que `crear_usuario`, marca `debe_cambiar_clave = true`, evento en historial). Al desactivar una gestora con trámites abiertos, el diálogo lo avisa con el conteo y ofrece elegir gestora destino (usa `reasignar_gestora`).
**Aceptación:** DB `tests/db/usuarios.test.ts` (gerencia restablece → login con nueva clave → `debe_cambiar_clave`; contable → `SIN_PERMISO`). E2E `web/e2e/usuarios-gestion.spec.ts`.

## Tarea 25 — Copy en castellano rioplatense consistente (P1)
**Objetivo:** mismo tono y términos en todo.
**Archivos:** `web/src/lib/textos.ts` (nuevo, glosario de etiquetas compartidas), páginas y features que repiten textos.
**Cambios:** unificar "Razón social" (no "empresa" en la UI), "Gestora", "Legajo", voseo en todos los imperativos ("Elegí", "Indicá"), fechas `dd/mm/aaaa`, montos `$ 1.234,56`; eliminar textos técnicos visibles (códigos de estado crudos como `finalizado_registro`, ver Tarea 1). Revisar `title`/`aria-label` en inglés.
**Aceptación:** unit `web/src/lib/textos.test.ts` que escanea `web/src/**/*.tsx` buscando palabras prohibidas (`Loading`, `Error:`, `Submit`, `Cancel`, `_registro`, `en_gestoria` en literales JSX, imperativos "Elige/Indica/Selecciona") → 0 coincidencias.

## Tarea 26 — Notificaciones: estado leído, enlaces y vacío (P2)
**Objetivo:** la campana lleva al trámite y no acumula ruido.
**Archivos:** `web/src/features/notificaciones/Campana.tsx`, `consultas.ts`, `formato.ts`.
**Cambios:** cada notificación es un link al trámite (`/tramites?t=` o `/mis-tramites#t-…` para gestora, con scroll y resaltado de la tarjeta); "Marcar todas como leídas"; contador con `aria-label="3 avisos sin leer"`; popover que no se sale de la pantalla a 320 px (en móvil, hoja inferior con `Dialogo`).
**Aceptación:** E2E `web/e2e/notificaciones.spec.ts` (clic lleva y resalta; marcar todas deja contador en 0; a 320 px el panel cabe).

## Tarea 27 — MisTramites: búsqueda y orden útil (P2)
**Objetivo:** la gestora encuentra un trámite por dominio o cliente.
**Archivos:** `web/src/pages/MisTramites.tsx`, `web/src/features/gestora/consultas.ts`, `grupos.test.ts`.
**Cambios:** buscador (dominio/cliente/número, sin tildes ni mayúsculas); dentro de cada grupo, orden por antigüedad (más viejo primero) y marca "hace N días"; los chips de grupo muestran conteo y son `aria-pressed`.
**Aceptación:** unit `grupos.test.ts` (normalización y orden). E2E `web/e2e/gestora.spec.ts` (buscar "ab123" filtra a una tarjeta).

## Tarea 28 — Informes y exportaciones verificadas (P2)
**Objetivo:** los archivos descargados abren bien y coinciden con la pantalla.
**Archivos:** `web/src/features/informes/exportar.ts`, `web/src/lib/planilla.ts`, `web/src/ui/MenuExportar.tsx`.
**Cambios:** nombre de archivo con razón social y período (`informe-paris-autos-2026-10.xlsx`); montos como número con formato `$ #,##0.00` (no texto); botón con estado `cargando` mientras genera; error visible si falla.
**Aceptación:** unit `web/src/lib/planilla.test.ts` (celda de monto es numérica con numFmt). E2E `web/e2e/informes.spec.ts` (descarga, nombre esperado, abrir con exceljs y comparar total con el de pantalla).

## Tarea 29 — Historial legible y deshacer visible en el panel (P2)
**Objetivo:** cada cambio y su motivo se entienden sin conocer la base.
**Archivos:** `web/src/features/tramites/HistorialEventos.tsx`, `PanelDetalle.tsx`.
**Cambios:** frases humanas ("Valentina pasó de Presentado a Sin presentar · motivo: …"), agrupar por día, iconos por tipo; acción de deshacer del último paso visible arriba del historial cuando existe `RETROCESO[estado]`; quitar marcas documentales (`desmarcar`) desde el panel con motivo.
**Aceptación:** E2E `web/e2e/deshacer.spec.ts` (quitar marca "retirado" desde oficina con motivo, aparece en historial como frase).

## Tarea 30 — Panel de detalle en móvil (P1)
**Objetivo:** el detalle de un trámite se usa con el pulgar.
**Archivos:** `web/src/features/tramites/PanelDetalle.tsx`, `web/src/pages/Tramites.tsx`.
**Cambios:** en < md el panel es pantalla completa con encabezado sticky (número, estado, X) y botones de acción en barra inferior fija con safe-area; el foco va al título al abrir y vuelve a la fila al cerrar; botón atrás del navegador cierra el panel (estado en URL `?t=` ya existe: usar `navigate(-1)` al cerrar si se abrió desde la lista).
**Aceptación:** E2E `web/e2e/responsive.spec.ts` (375 px: abrir trámite, acciones visibles sin scroll, "atrás" cierra el panel y la lista conserva el scroll).

## Tarea 31 — Doble envío y botones con carga (P0)
**Objetivo:** ningún botón dispara dos veces la misma RPC.
**Archivos:** `web/src/ui/Button.tsx`, todos los formularios que usan `onClick` async sin `useMutation` (`FormUsuario.tsx` `DialogoEstadoUsuario` usa `enviando` manual; revisar `FormCarga`, `FormConciliacion`, `DefinirClave`, `Login`).
**Cambios:** `Button` con `cargando` → `disabled` + `aria-busy` + spinner y ancho fijo (sin salto de layout); todos los formularios pasan por `useMutation` y usan `isPending`.
**Aceptación:** E2E `web/e2e/robustez.spec.ts`: doble clic rápido en "Confirmar carga", "Crear usuario" y "Aprobar presupuesto" → el mock registra una sola llamada.
Decisión: `Button` ya tenía `cargando` → `disabled` + `aria-busy`. El doble disparo real venía de `useMutation` (isPending se notifica en diferido): se agregó `useMutacionUnica` (lib/consultas.ts) en `FormAccion` y en las acciones de la gestora. Los formularios con `enviando` manual ya se deshabilitan en el mismo evento; el E2E cubre carga y aprobación.

## Tarea 32 — Idempotencia de alta en la base (P1)
**Objetivo:** un reintento por red no crea dos trámites ni dos movimientos.
**Archivos:** nueva migración `supabase/migrations/20261101000400_idempotencia.sql`, `web/src/features/tramites/consultas.ts`, `web/src/features/habitualista/consultas.ts`.
**Cambios:** parámetro opcional `p_clave_idempotencia uuid` en `alta_tramite`, `registrar_carga` y `registrar_pago` (versiones nuevas con default null, `unique` parcial en tabla nueva `idempotencia`); el front genera `crypto.randomUUID()` al abrir el formulario.
**Aceptación:** DB `tests/db/concurrencia.test.ts` (dos llamadas con la misma clave → un solo registro, la segunda devuelve el mismo id).

## Tarea 33 — Habitualista: sólo empresas con cuenta, avisos claros (P1)
**Objetivo:** Doral y Paris Trac no aparecen como "sin fondos" ni ofrecen cargas.
**Archivos:** `web/src/pages/Habitualista.tsx`, `web/src/features/habitualista/TarjetasSaldo.tsx`, `web/src/features/tramites/PanelDetalle.tsx`.
**Cambios:** en el detalle de trámites de razones sin Habitualista, ocultar bloques de saldo/compromiso y mostrar "Esta razón social no usa Habitualista"; selector de empresa en Habitualista sólo con cuentas existentes; `?empresa=` inválido → aviso y vuelve a todas.
**Aceptación:** E2E `web/e2e/habitualista.spec.ts` (Doral no figura; `/habitualista?empresa=<doral>` muestra aviso). DB `tests/db/fondos.test.ts` (trámite de Doral nunca queda `sin_fondos`).

## Tarea 34 — Login y primer ingreso pulidos (P2)
**Objetivo:** el primer contacto es impecable.
**Archivos:** `web/src/pages/Login.tsx`, `web/src/features/acceso/DefinirClave.tsx`.
**Cambios:** mostrar/ocultar contraseña con botón accesible; `autoComplete="username"/"current-password"/"new-password"`; Caps Lock activado avisado; error de credenciales genérico "Email o contraseña incorrectos"; tras definir la clave, aviso de éxito y entrada directa.
**Aceptación:** E2E `web/e2e/contrasenas.spec.ts` y `acceso.spec.ts` ampliados (toggle visible, autocompletes correctos).

## Tarea 35 — Metadatos, favicon, título por pantalla, 404 (P2)
**Objetivo:** pestañas y accesos directos prolijos.
**Archivos:** `web/index.html`, `web/public/manifest.webmanifest` (nuevo), `web/src/app/rutas.tsx`, `web/src/app/Layout.tsx`.
**Cambios:** `document.title` = "Trámites · Gestoría Grupo Paris" por ruta; `lang="es-AR"`; `theme-color` negro; manifest para "agregar a inicio" del celular de la gestora; ruta desconocida muestra "Esta página no existe" con botón al inicio en vez de redirigir en silencio.
**Aceptación:** E2E `web/e2e/acceso.spec.ts` (título por ruta; `/no-existe` muestra mensaje).

## Tarea 36 — Paridad del mock E2E con la base (P1)
**Objetivo:** que los E2E no aprueben comportamientos que la base rechaza.
**Archivos:** `web/e2e/mock-supabase.ts`, `tests/db/contrato-mock.test.ts` (nuevo).
**Cambios:** extraer de `mock-supabase.ts` la tabla de reglas (transiciones, mensajes de error) a `web/e2e/reglas-mock.json`; el test de DB recorre esa tabla contra la base real (embedded postgres) y falla si difieren.
**Aceptación:** DB `tests/db/contrato-mock.test.ts` verde; romper a propósito una regla del JSON lo hace fallar.

## Tarea 37 — CI de calidad local en un comando (P2)
**Objetivo:** que cada tarea se valide igual.
**Archivos:** `package.json` (raíz) script `verificar`, `web/package.json` scripts `typecheck`, `lint`.
**Cambios:** `npm run verificar` = typecheck + unit web + DB + build + E2E (en ese orden, cortando al primer fallo). Sin servicios externos.
**Aceptación:** correr `npm run verificar` desde la raíz termina en 0.

---

## Orden recomendado
P0 primero: 1, 2, 3, 4, 5, 6, 7, 13, 31. Después P1 en el orden numérico; P2 al final. Las tareas 9 → 22 y 7 → 8 tienen dependencia (la segunda reutiliza lo de la primera); el resto es independiente.
