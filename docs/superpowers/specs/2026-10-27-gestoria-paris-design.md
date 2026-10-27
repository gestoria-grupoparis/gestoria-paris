# Plataforma de Gestoría — Grupo Paris · Análisis y diseño

**Fecha:** 27/10/2026 · **Estado:** borrador para revisión · **Fuente:** "Prompt maestro" provisto por el usuario.

Convención usada en todo el documento:

- **[C]** requisito confirmado por la descripción.
- **[S]** supuesto razonable de diseño (decisión mía, revisable).
- **[R]** recomendación opcional.
- **[P]** decisión de negocio pendiente de validar con la empresa.

---

## A. Análisis funcional

### El problema en una frase

El grupo administra dinero real (las Tarjetas Habitualistas de tres razones sociales) y trámites con responsables distribuidos en dos provincias, pero la información vive en mails, una planilla, WhatsApp y fotos de cuadernos. Nadie ve al mismo tiempo **qué está autorizado, cuánto va a costar y cuánta plata queda de verdad**.

### Lo que el sistema tiene que hacer bien (en orden de importancia)

1. **Que nadie comprometa fondos a ciegas.** Contable (San Luis) y gerencia (San Juan) tienen que ver al instante lo que el otro comprometió sobre la misma razón social [C].
2. **Que la autorización sea un acto identificable**, no un nombre tipeado en Excel [C].
3. **Que el presupuesto de la gestora llegue como dato**, no como foto, y alimente sin copias el cálculo de comprometido [C].
4. **Que cada peso pagado quede registrado una vez**, contra la cuenta correcta, sin descontarse dos veces [C].
5. **Que la historia de un trámite se pueda reconstruir** sin abrir mails ni chats [C].
6. Recién después: informes, cobros a clientes, proyecciones e indicadores [C, Etapa 2].

### Cómo opera el nuevo sistema (vista de un día)

- **Contable** abre la bandeja "Para revisar": son los trámites cargados desde el mail (o, más adelante, por administración comercial). Controla la oferta y los saldos y los **autoriza** o los deja **observados** con un motivo.
- Al autorizarlos, el trámite aparece en el celular de la **gestora** asignada.
- La gestora carga el **presupuesto** (arancel, prenda, sellados, otros). El sistema suma solo, y el importe pasa automáticamente a **Comprometido** en la Habitualista de esa razón social.
- Si el disponible proyectado no alcanza, el trámite queda marcado **"Sin fondos"**: la gestora ve que no debe presentarlo y gerencia y contabilidad reciben aviso.
- La gestora presenta, paga y carga el **pago real** con su desglose. El sistema registra el egreso en la cuenta, libera el compromiso y calcula el desvío contra el presupuesto.
- Al finalizar, la gestora marca **documentación retirada** y administración marca **documentación recibida**. Contable cierra.
- **Gerencia** ve en el tablero, por razón social: saldo registrado, comprometido, disponible proyectado, trámites trabados y la última conciliación.

---

## B. Rediseño de procesos

| Etapa actual | Qué pasa hoy | En la plataforma | Decisión |
|---|---|---|---|
| 1. Legajo físico + mail con asunto | Mail como "índice" de la operación | Alta del trámite con los mismos 4 datos del asunto (cliente, cuenta, vehículo, oferta). El legajo físico sigue existiendo y se marca "legajo recibido". | **Se conserva el legajo** (es documentación legal). **El mail se elimina** cuando comercial cargue el alta directamente [R, Etapa 2]. En Etapa 1 contable carga el alta pegando los datos. |
| 2. Control contable | Verificación manual | Sigue siendo manual. El sistema registra quién controló, cuándo y con qué observación. | **Se conserva** (control con valor real). |
| 3. Copiar a la planilla de autorizados | Copiar y pegar en Excel = autorización | El botón **Autorizar** (solo perfiles habilitados) reemplaza la planilla. El "listado autorizado" es un filtro. | **Se elimina la planilla**; **se conserva el criterio** (sin autorización no se presenta). |
| 4. Firma de gerencia y entrega | Física | Dos marcas con fecha: "firmado" y "entregado a gestoría". No son estados que bloqueen el flujo. | **Se conservan como registro**, no como pantallas [S]. |
| 5. Presupuesto por WhatsApp / foto | Imagen de cuaderno | Formulario móvil de 4 importes. Total automático. Historial de versiones. | **Se elimina WhatsApp/foto.** |
| 6. Verificar fondos | Mirar la plataforma externa y "hacer la cuenta" | Automático: disponible proyectado = registrado − comprometido, por razón social, compartido en tiempo real. | **Se automatiza.** |
| 7. Presentación y pago | Gestora en el registro | Igual. La gestora marca "presentado" y carga el pago. | **Se conserva**; se agrega el registro. |
| 8. Costos definitivos | Se reconstruyen después | El pago lleva su desglose. El costo real es la suma de pagos (fuente única). | **Se automatiza.** |
| 9. Retiro y devolución | Física, sin registro | Dos marcas: "retirado del registro" (gestora) y "recibido por administración" (admin). | **Se conserva + trazabilidad.** |

**Controles que propongo agregar:** conciliación periódica contra el saldo real de la Habitualista (hoy no existe formalmente), detección de trámites duplicados al dar de alta y bloqueo de pagos contra una razón social distinta a la del trámite.

**Control que cuestiono:** que la firma de gerencia sea un *paso previo obligatorio* dentro del sistema. Es un acto físico sobre el legajo y la autorización digital ya prueba la decisión. Propongo registrarla sin bloquear [P: confirmar si gerencia quiere que bloquee].

---

## C. Arquitectura funcional

Un solo sistema con cinco módulos sobre una sola base de datos:

```text
            ┌──────────────── Auditoría (eventos, todo módulo escribe aquí) ─────────────┐
            │                                                                            │
 Operación ─┤ Trámites ──(presupuesto vigente)──> Compromisos (CALCULADOS, no guardados) │
 comercial  │    │                                        │                            │
            │    └──(pago con desglose)──> Movimientos de la Habitualista (libro mayor)   │
            │                                        │                                   │
            │                         Saldos = vista calculada ── Tablero / Informes     │
            │                         Conciliaciones (saldo externo vs. interno)         │
            └────────────────────────────────────────────────────────────────────────────┘
```

**Regla de oro de datos:** cada importe tiene **un solo lugar** donde se escribe.

- Presupuesto → `presupuestos` (versión vigente).
- Pago / costo real → `movimientos` de tipo `pago_tramite`, con su desglose.
- Comprometido → **se calcula** (presupuesto vigente − pagos), nunca se guarda.
- Saldo registrado → **se calcula** (saldo inicial + movimientos).
- Cobrado al cliente → `cobros_cliente` (tabla aparte por seguridad, Etapa 2).

Por eso el descuento doble es imposible por construcción: el compromiso se libera solo cuando existe el pago.

---

## D. Flujos operativos

### Estados: tres dimensiones separadas

El prompt lista 14 estados más los excepcionales. Mezclarlos en una sola lista genera ambigüedad (¿un trámite "firmado" está autorizado? ¿"pendiente de presentación" depende de la plata?). Propongo **separarlos en tres dimensiones** [S]:

**1. Estado del trámite (uno solo, es lo que se ve en la tabla):**

```text
borrador ─┬─> observado ──> borrador (corregido)
          ├─> autorizado ──> en_gestoria ──> presentado ──> finalizado_registro ──> devuelto ──> cerrado
          └─> rechazado
Desde cualquier estado previo a "cerrado": suspendido (reversible) · cancelado (final)
```

| Estado | Equivale a (del prompt) | Quién lo mueve |
|---|---|---|
| borrador | 1. Pendiente de revisión | contable, comercial (Etapa 2) |
| observado | 2. Observado | contable, gerencia |
| autorizado | 3. Autorizado, 4. Pendiente de firma | contable/gerencia habilitados |
| en_gestoria | 5. Firmado, 6. Entregado, 7. Presupuestado, 8. Pendiente de presentación | contable (al entregar) |
| presentado | 9. Presentado, 10. Pendiente de resolución | gestora |
| finalizado_registro | 11. Finalizado, 12. Retirado | gestora |
| devuelto | 13. Devuelto a administración | contable / admin |
| cerrado | 14. Cerrado | contable |

**2. Marcas documentales (fecha + usuario, no bloquean):** legajo recibido, firmado por gerencia, entregado a gestoría, documentación retirada, documentación recibida por administración.

**3. Situación financiera (calculada, nunca se carga a mano):** sin presupuesto · comprometido · sin fondos · pagado parcial · pagado.

### Flujos

1. **Alta y autorización:** contable crea el trámite (borrador) → el sistema advierte si ya existe uno con la misma oferta, tipo y dominio → controla → **Autorizar** (exige gestora asignada) o **Observar** (exige motivo).
2. **Asignación:** al autorizar se elige la gestora. La reasignación (caso K) es una acción con motivo que queda en el historial.
3. **Presupuestación:** la gestora carga los importes y se crea la versión 1. Una modificación crea la versión N+1 con motivo obligatorio. Si el trámite ya estaba comprometido, el cambio genera aviso a contable (caso D).
4. **Compromiso:** automático mientras el trámite está autorizado y sin pago final.
5. **Pago:** la gestora registra el pago: cuenta (fija, la de la razón social del trámite), fecha, desglose y "¿es el pago final?". Hay pagos múltiples (caso L).
6. **Finalización:** la gestora marca finalizado y retirado. Administración marca recibido → devuelto. Contable cierra.
7. **Conciliación:** contable carga el saldo que muestra la plataforma Habitualista a una fecha. El sistema muestra la diferencia y los movimientos no conciliados. Las diferencias se resuelven con movimientos de ajuste (gerencia) o con cargas faltantes (caso H).
8. **Cierre mensual (Etapa 2):** el informe se genera por reglas de fecha (sección H) y se congela en una "foto" del mes.

---

## E. Diseño de base de datos (PostgreSQL)

**Convenciones:**

- Importes en **`bigint` en centavos** (`importe_cents`): exacto en la base y en JavaScript (hasta ±9×10¹³ pesos). Nunca se usa `float` [S].
- Instantes en `timestamptz`. Fechas operativas en `date` interpretadas en `America/Argentina/Buenos_Aires`.
- IDs `uuid`. Número visible correlativo por año para trámites (`T-2026-00123`).

### Tablas

| Tabla | Campos clave | Restricciones / índices |
|---|---|---|
| `empresas` | id, nombre, cuit | nombre único |
| `sucursales` | id, nombre, provincia (`'San Luis'`, `'San Juan'`, …) | — |
| `tipos_tramite` | id, codigo (`patentamiento_0km`, `transferencia_usado`, `transferencia_parte_pago`), nombre, activo | codigo único. Ampliable sin migración de código [C]. |
| `perfiles` | id = auth.users.id, nombre, rol (`gerencia`, `contable`, `gestora`, `comercial`, `admin`), activo | — |
| `alcances` | perfil_id, empresa_id, sucursal_id (null = todas) | PK compuesta. Define qué ve cada usuario. |
| `operaciones` | id, empresa_id, sucursal_id, cliente_nombre, cuenta_personal, oferta_ref, referencia_mail | único (empresa_id, oferta_ref). Agrupa trámites de la misma venta (caso M). |
| `tramites` | id, numero, operacion_id, tipo_id, empresa_id, sucursal_id, estado, vehiculo_desc, dominio, chasis, gestora_id, responsable_id, creado_por, autorizado_por, autorizado_at, pago_final_at, version (bloqueo optimista), idem_key | único idem_key. Único parcial (operacion_id, tipo_id, coalesce(dominio, chasis, '')) where estado not in (cancelado, rechazado) → caso J. Índices: (empresa_id, estado), (gestora_id, estado), trigram sobre cliente/dominio. |
| `tramite_marcas` | tramite_id, marca (`legajo_recibido`, `firmado`, `entregado`, `retirado`, `recibido_admin`), at, por | PK (tramite_id, marca) |
| `presupuestos` | id, tramite_id, version, arancel_cents, prenda_cents, sellado_cents, otros_cents, total_cents (generado), motivo, creado_por, created_at | único (tramite_id, version). Solo INSERT. Vigente = versión máxima. |
| `cuentas` | id, empresa_id, nombre, saldo_inicial_cents, saldo_inicial_fecha | **único empresa_id** (una Habitualista por razón social [C]; si hubiera más, se quita) |
| `movimientos` | id, cuenta_id, tipo (`carga`, `pago_tramite`, `ajuste`, `reintegro`, `reversion`), importe_cents (con signo), fecha_operacion, tramite_id, revierte_id, arancel/prenda/sellado/otros_cents (solo pagos), es_pago_final, motivo, creado_por, created_at, idem_key, conciliacion_id | único idem_key. Único revierte_id. CHECK por tipo (carga > 0, pago < 0, pago exige tramite_id y suma del desglose = −importe). Trigger: la empresa del trámite = la empresa de la cuenta (regla 11). **Sin UPDATE ni DELETE** (trigger + permisos). |
| `conciliaciones` | id, cuenta_id, fecha_corte, saldo_externo_cents, saldo_interno_cents (foto), diferencia_cents, nota, creado_por | — |
| `excepciones_fondos` | tramite_id, aprobado_por, motivo, at | Gerencia libera un trámite "sin fondos" (regla 17) |
| `eventos` | id, at, actor_id, entidad, entidad_id, accion, antes jsonb, despues jsonb, motivo | Solo INSERT, mediante triggers. Índice (entidad, entidad_id, at). |
| `cobros_cliente` (Etapa 2) | tramite_id, importe_cents, fecha, comprobante | RLS: solo gerencia/contable [C] |
| `objetivos` (Etapa 3) | empresa_id, sucursal_id, tipo_id, periodo, cantidad, costo_unitario_cents | — |
| `notificaciones` (Etapa 2) | perfil_id, tipo, tramite_id, leida_at | — |

### Calculado (vistas, no tablas)

- `v_tramite_finanzas`: presupuesto vigente, pagado (Σ pagos − reversiones), **comprometido = si estado ∈ {autorizado, en_gestoria, presentado, finalizado_registro} y sin pago final ⇒ max(presupuesto − pagado, 0); si no, 0**, desvío absoluto y %.
- `v_saldos`: por cuenta → saldo registrado = saldo inicial + Σ movimientos; comprometido = Σ comprometido de sus trámites; **disponible proyectado = registrado − comprometido**; última conciliación y última actualización.

### Concurrencia

Toda operación que cambie la plata o el compromiso de una cuenta (presupuesto, autorización, pago, carga, ajuste, reversión) corre en **una función de base de datos que primero bloquea la fila de la cuenta** (`SELECT … FOR UPDATE`). Dos operaciones sobre la misma Habitualista quedan en fila y la segunda ya ve lo que hizo la primera (casos A y B). Cuentas distintas no se bloquean entre sí.

**Ediciones simultáneas del mismo trámite (caso O):** columna `version`. Si alguien guarda sobre una versión vieja, recibe "Otro usuario modificó este trámite; recargá".

**Pérdida de conexión (caso N):** cada acción crítica viaja con un `idem_key` (uuid) generado en el navegador. Si se reintenta, la base devuelve el resultado original en vez de duplicar.

---

## F. Matriz de permisos

✔ permitido · ◐ solo dentro de su alcance o asignación · ✖ prohibido (aplicado en la base con RLS y funciones, no solo en pantalla).

| Acción | Gerencia | Contable | Gestora | Comercial [R] |
|---|:-:|:-:|:-:|:-:|
| Ver trámites | ◐ | ◐ | ◐ asignados y autorizados | ◐ los que cargó |
| Crear trámite (borrador) | ✔ | ✔ | ✖ | ✔ (Etapa 2) |
| Observar / rechazar | ✔ | ✔ | ✖ | ✖ |
| **Autorizar** | ✔ | ✔ [P: ¿todos los contables o solo algunos?] | ✖ | ✖ |
| Asignar / reasignar gestora | ✔ | ✔ | ✖ | ✖ |
| Cargar / modificar presupuesto | ✔ | ✔ | ◐ | ✖ |
| Marcar presentado / finalizado / retirado | ✔ | ✔ | ◐ | ✖ |
| **Registrar pago real** | ✔ | ✔ | ◐ (solo trámites propios autorizados) | ✖ |
| Registrar carga de fondos | ✔ | ✔ | ✖ | ✖ |
| **Ajuste de saldo / saldo inicial** | ✔ | ✖ [P] | ✖ | ✖ |
| Revertir movimiento | ✔ | ✔ (con motivo) | ✖ (pide a contable) | ✖ |
| Liberar excepción "sin fondos" | ✔ | ✖ | ✖ | ✖ |
| Conciliar | ✔ | ✔ | ✖ | ✖ |
| Ver saldos de la Habitualista | ✔ | ✔ | ◐ solo "hay fondos / sin fondos" de sus trámites [S] | ✖ |
| Ver / cargar cobrado al cliente | ✔ | ✔ | ✖ | ✖ |
| Ver historial | ✔ | ✔ | ◐ de sus trámites | ✖ |
| Exportar | ✔ | ✔ | ✖ | ✖ |
| Gestionar usuarios | admin | ✖ | ✖ | ✖ |

**Implementación:** el rol `authenticated` **no tiene INSERT/UPDATE/DELETE directo** sobre `movimientos`, `presupuestos`, `tramites.estado` ni `eventos`. Todas las escrituras pasan por funciones `SECURITY DEFINER` que validan rol, alcance y asignación. Las lecturas se filtran con políticas RLS. Exportaciones y la API directa usan las mismas políticas.

---

## G. Diseño UX/UI

Productividad de escritorio primero, celular cómodo para gestoras. Sin animaciones decorativas.

1. **Trámites (pantalla principal de contable y gerencia).** Tabla densa estilo planilla. Columnas: N°, ingreso, tipo, razón social, sucursal, cliente, oferta, dominio, gestora, estado (chip de color), presupuesto, pagado, situación financiera. Una búsqueda única (cliente, cuenta, oferta, dominio). Filtros combinables arriba (razón social, sucursal, provincia, gestora, tipo, estado, rango de fechas). Vistas guardadas: "Para revisar", "Autorizados sin presentar", "Sin fondos", "Demorados". Clic en una fila → panel lateral con el detalle (no se cambia de página): datos, marcas documentales, presupuesto y versiones, pagos, historial. Acciones rápidas en el panel: Autorizar, Observar, Asignar, Marcar entregado.
2. **Habitualista (extracto).** Selector de razón social. Cuatro tarjetas: Saldo registrado · Comprometido · Disponible proyectado · Última conciliación (fecha y diferencia; "sin verificar" en ámbar si es vieja). Debajo, tabla de movimientos: fecha, tipo, trámite, cliente, responsable, ingreso (verde), egreso, saldo resultante, conciliado (✓/pendiente). Botones: Registrar carga, Ajuste (solo gerencia), Conciliar. Pestaña "Compromisos": trámites que componen el comprometido.
3. **Mis trámites (gestora, móvil).** Lista de tarjetas agrupadas: "Presupuestar", "Listos para presentar", "Presentados", "Para retirar". Cada tarjeta muestra cliente, vehículo, dominio, registro y un aviso rojo "No presentar: sin fondos" si corresponde. Acciones grandes: Cargar presupuesto, Marcar presentado, Registrar pago, Finalizado/retirado.
4. **Tablero (gerencia).** Una fila de tarjetas por razón social (registrado / comprometido / disponible / necesidad de recarga). Contadores por estado que filtran la tabla al hacer clic. Lista "Requieren intervención": observados, sin fondos, demorados.
5. **Alta de trámite.** Formulario compacto con los 4 datos del mail arriba (se puede pegar el asunto completo y el sistema intenta separarlo [R]), tipo, razón social y sucursal. Al guardar avisa si hay un posible duplicado.

Confirmación explícita solo para acciones críticas: autorizar, pago, ajuste, reversión, cancelación.

---

## H. Arquitectura técnica

| Pieza | Elección | Por qué | Límites / costo |
|---|---|---|---|
| Base, auth, tiempo real | **Supabase** (PostgreSQL 17 + Auth + RLS + Realtime) | Las reglas críticas (RLS, transacciones, bloqueo por cuenta, auditoría por triggers) viven en la base, donde no se pueden saltear. Auth y tiempo real ya vienen incluidos, sin servidor propio. | El plan gratuito se pausa por inactividad y no tiene backups → para producción, **plan Pro** (verificar tarifa vigente; históricamente USD 25/mes). Dependencia de proveedor mitigada: es Postgres estándar y exportable. |
| Lógica de negocio | **Funciones SQL/PLpgSQL** (RPC) | Atómicas y transaccionales, cerca de los datos. Una sola implementación de cada regla. | Requiere tests de base (incluidos). |
| Frontend | **React + TypeScript + Vite**, TanStack Query/Table, Tailwind + shadcn/ui, react-hook-form + zod | Aplicación interna sin SEO: una SPA alcanza y es más simple que Next.js. Tablas productivas. | — |
| Hosting web | **Cloudflare Pages** (o Vercel) | Sitio estático, gratis a este volumen, HTTPS. | 500 builds/mes en el plan Free. |
| Exportación (Etapa 2) | ExcelJS en el navegador | XLSX con fechas e importes numéricos reales. | — |
| Tests | Vitest + `pg` contra **PostgreSQL 17 local nativo** (sin Docker) con un esquema `auth` simulado; Playwright para E2E | Esta PC no tiene Docker. Postgres nativo permite probar concurrencia real. | Pequeña diferencia con Supabase real → smoke test en el proyecto de staging. |

**Descartado:** microservicios, servidor Node propio y colas, porque no aportan nada a este volumen. Next.js con server actions no se descarta para siempre, pero no hace falta.

**Integraciones:**

- **Tarjeta Habitualista:** no encontré API pública documentada. Diseño con conciliación manual. La arquitectura deja un punto de entrada (`importar_movimientos_externos`) para un archivo exportado de la plataforma, si existiera [P: ¿la plataforma permite descargar movimientos en Excel/CSV?].
- **Sistema de gestión interno:** sin integración. Se cargan los 4 datos clave a mano. Más adelante se evalúa importar desde un export [P].

---

## I. Reglas de negocio

Las 20 reglas del prompt se adoptan tal cual. Implementación de cada una:

| # | Regla | Cómo se garantiza |
|---|---|---|
| 1 | Sin autorización válida no hay trámite autorizado | Solo `autorizar_tramite()` pasa a `autorizado`; valida rol y alcance; guarda autorizado_por/at |
| 2 | Razón social y sucursal obligatorias | NOT NULL + FK |
| 3, 11, 12 | Cada pago pertenece a una cuenta; no se cruza de razón social | La cuenta del pago se **deriva** de la empresa del trámite (el usuario no la elige) + trigger de verificación |
| 4, 5 | Compromiso ≠ pago; sin descuento doble | El compromiso es calculado; desaparece con el pago final |
| 6 | Desvío registrado | Vista con desvío absoluto y %; presupuesto y pagos inmutables |
| 7, 8 | Gestora sin ajustes; recargas auditadas | Permisos en funciones + `eventos` |
| 9 | Cancelación libera compromisos | Estado cancelado ⇒ comprometido 0 (calculado) |
| 10, 19 | Correcciones trazables, sin borrar autoría | Movimientos inmutables; corrección = reversión + nuevo movimiento |
| 13 | Información consistente | Lecturas desde vistas; Realtime para refrescar |
| 14 | Cobros restringidos | Tabla separada + RLS |
| 15 | Reportes reproducibles | Ledger inmutable + reglas de fecha fijas + foto mensual (Etapa 2) |
| 16 | Sin duplicados por doble clic | `idem_key` único |
| 17 | Saldo insuficiente | Ver política abajo |
| 18 | Conciliación | Tabla `conciliaciones` + marca de conciliado por movimiento |
| 20 | Carga práctica | Campos obligatorios mínimos por etapa |

**Reglas que agrego:**

- **R21. Registrar la realidad nunca se bloquea.** Un pago que ya ocurrió en el registro se registra aunque deje saldo negativo. Se advierte y se notifica, porque bloquearlo solo empuja la información fuera del sistema (casos C y H).
- **R22. Lo que se bloquea es la decisión de gastar.** Si al cargar un presupuesto el disponible proyectado de la cuenta queda negativo, el trámite se marca "Sin fondos" y la gestora ve "No presentar". Se destraba con una carga de fondos (automático) o con una excepción de gerencia con motivo.
- **R23. La cuenta del pago no se elige, se deriva.** Así se evita el error humano de la regla 11.
- **R24. Pagos solo sobre trámites autorizados.** Si en la realidad se pagó uno no autorizado, lo registra contable o gerencia con motivo de excepción.
- **R25. Cambiar el presupuesto exige motivo** desde la versión 2, y avisa si el trámite ya estaba comprometido.
- **R26. Un saldo inicial por cuenta.** Los cambios posteriores se hacen solo como "ajuste" de gerencia.

### Casos especiales A–O

| Caso | Respuesta |
|---|---|
| A, B | Bloqueo por cuenta: se serializan y ambos ven el compromiso del otro al instante |
| C | Pago mayor al presupuesto: se registra y queda con desvío positivo. El compromiso ya era 0. |
| D | Nueva versión de presupuesto con motivo; el compromiso se recalcula y se avisa |
| E | Cancelar ⇒ compromiso 0, sin movimientos |
| F | Cancelar con pagos: los pagos quedan (ocurrieron). Si hay reintegro, se registra un movimiento `reintegro`. |
| G | `revertir_movimiento(id, motivo)` crea el movimiento inverso, ligado; el original no se toca |
| H | Contable registra la carga con su fecha real; aparece como no conciliada |
| I | Conciliación: muestra diferencia y movimientos no conciliados; se resuelve con carga o ajuste |
| J | Índice único parcial + aviso al dar de alta |
| K | `reasignar_gestora(tramites[], nueva, motivo)` en lote |
| L | Varios pagos; el último marca `es_pago_final` |
| M | Una operación con N trámites; cada uno con su presupuesto, pagos y estado |
| N | `idem_key` |
| O | `version` (bloqueo optimista) |

---

## J. Plan de implementación por etapas

**Etapa 1 — Núcleo operativo y financiero (usable en producción).** Usuarios, roles y alcances. Razones sociales, sucursales y tipos. Operaciones y trámites con estados y marcas. Autorización y asignación. Presupuestos versionados. Cuentas, movimientos (carga, pago, ajuste, reversión), saldos y compromisos calculados, política de fondos. Auditoría. Pantallas: Trámites, Detalle, Alta, Habitualista, Mis trámites (móvil) y Tablero básico. Conciliación simple (cargar saldo externo y ver diferencia). La conciliación se adelanta desde la Etapa 2: sin ella, el saldo interno no tiene contra qué validarse desde el día uno.

**Etapa 2 — Control y análisis.** Cobros a clientes, informes (cierre mensual, financiero, costos, eficiencia), exportación XLSX/CSV, notificaciones configurables, proyección por compromisos, perfil comercial y foto de cierre mensual.

**Etapa 3 — Optimización.** Objetivos y proyección por metas (sin duplicar los compromisos existentes: necesidad = max(objetivo − trámites ya registrados del período, 0) × costo promedio histórico), importación de extractos de la Habitualista, predicción por históricos.

El detalle de tareas de la Etapa 1 está en `docs/superpowers/plans/2026-10-27-gestoria-etapa1-nucleo.md`.

### Reglas de fecha para informes (Etapa 2, fijadas desde ahora)

- **Iniciados:** fecha de alta.
- **Autorizados:** autorizado_at.
- **Realizados** (p. ej. "patentamientos del mes"): fecha de la marca `finalizado_registro`.
- **Costos:** fecha_operacion del pago.
- **Cobros:** fecha del cobro.
- **Pendientes:** foto al último día del período.

Todas en hora de Argentina.

---

## K. Pruebas y criterios de aceptación

La Etapa 1 se considera terminada cuando, con datos persistentes y usuarios reales en staging:

1. **Escenario integral (sección 14 del prompt)** automatizado en la base y en E2E, con estos resultados exactos para Paris Autos:
   - Inicial 3.000.000 → presupuesto 700.000: registrado 3.000.000 / comprometido 700.000 / disponible 2.300.000.
   - Segundo trámite (San Juan) 900.000: 3.000.000 / 1.600.000 / 1.400.000.
   - Pago final 650.000 del primero: 2.350.000 / 900.000 / 1.450.000.
   - Carga 2.000.000: 4.350.000 / 900.000 / 3.450.000.
2. **Concurrencia:** dos sesiones simultáneas presupuestan sobre una cuenta con fondos para una sola → exactamente un trámite queda "Sin fondos".
3. **Idempotencia:** el mismo `idem_key` enviado dos veces (incluso en paralelo) crea un solo movimiento.
4. **Permisos:** la gestora no puede leer trámites ajenos, insertar movimientos directamente, hacer ajustes, autorizar ni modificar eventos. Cada caso tiene un test que intenta hacerlo y falla.
5. **Inmutabilidad:** UPDATE y DELETE sobre `movimientos`, `presupuestos` y `eventos` fallan incluso para contable y gerencia.
6. **Razón social:** un pago sobre un trámite de Paris Cars nunca afecta la cuenta de Paris Autos.
7. **Casos A–O:** cada uno con al menos un test.
8. **UX:** una persona de contabilidad, sin explicación previa, da de alta, autoriza y encuentra un trámite por dominio. Una gestora carga un presupuesto y un pago desde el celular.

---

## L. Análisis de beneficios para gerencia

### Beneficios esperados (cualitativos; sin porcentajes inventados)

- **Control financiero:** se ve antes de presentar si la plata alcanza, por razón social, con lo que comprometieron San Luis y San Juan juntos.
- **Menos doble carga:** desaparecen la planilla de autorizados, la transcripción de presupuestos desde fotos y la reconstrucción de costos.
- **Trazabilidad:** quién autorizó, cuándo, cuánto se estimó, cuánto se pagó y quién lo registró, en un solo historial.
- **Continuidad:** la información deja de depender de que una persona esté presente o tenga su cuaderno.
- **Costos:** el desvío entre presupuesto y costo real por gestora, tipo y razón social pasa a ser visible.

### Inconvenientes y riesgos

- **Disciplina de carga:** si las gestoras no cargan presupuesto y pago, el comprometido miente. Mitigación: carga móvil mínima (4 importes) y "sin presupuesto" visible como pendiente.
- **Capacitación** de unas pocas personas y **resistencia al cambio:** conviene convivir 2–4 semanas con el Excel en paralelo en una sola razón social.
- **Saldo interno ≠ saldo real** si se olvidan cargas. Mitigación: conciliación semanal visible en el tablero.
- **Costo:** Supabase Pro + dominio (verificar tarifas vigentes). Hosting web gratis.
- **Dependencia del sistema:** backups diarios del plan Pro + export periódico.

### Indicadores antes/después (medir 2 semanas antes del lanzamiento)

1. Tiempo de armado del informe mensual (horas).
2. Trámites detenidos en el registro por falta de fondos (cantidad por mes).
3. Tiempo desde la autorización hasta la presentación (días, mediana).
4. Diferencia entre saldo interno y saldo de la Habitualista en cada conciliación.
5. Trámites cuyo historial no se puede reconstruir (muestreo de 10 por mes).
6. Mensajes de WhatsApp operativos por trámite (estimación por muestreo).

---

## Decisiones pendientes de validar con la empresa [P]

1. ¿Todos los contables pueden autorizar o solo algunos? (impacta permisos)
2. ¿La firma de gerencia debe bloquear la entrega a gestoría?
3. ¿Hay una sola Habitualista por razón social o puede haber varias?
4. ¿Las gestoras deben ver el saldo de la cuenta o solo "hay / no hay fondos"?
5. ¿Una sucursal opera para más de una razón social? (el diseño lo permite)
6. ¿La plataforma Habitualista permite exportar movimientos?
7. ¿Contable puede hacer ajustes de saldo o solo gerencia?
8. ¿Qué se considera "demorado"? Propuesta: más de 5 días hábiles autorizado sin presentar, o más de 15 presentado sin finalizar.
