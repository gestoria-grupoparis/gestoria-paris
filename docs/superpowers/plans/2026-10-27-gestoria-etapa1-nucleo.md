# Gestoría Grupo Paris — Etapa 1 (núcleo operativo y financiero) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo usable en producción: trámites con autorización y asignación, presupuestos versionados, libro de movimientos por Habitualista, compromisos y disponible calculados, auditoría, permisos en la base y las cinco pantallas principales.

**Architecture:** Toda regla de negocio y de permisos vive en PostgreSQL (Supabase): tablas, triggers, funciones RPC `SECURITY DEFINER` que bloquean la cuenta con `FOR UPDATE`, vistas calculadas y RLS. El frontend es una SPA React que solo lee vistas y llama RPCs, sin cálculos de dinero propios. Los tests de base corren contra un Postgres 17 real embebido en Node (esta PC no tiene Docker).

**Tech Stack:** PostgreSQL 17 / Supabase (Auth, RLS, Realtime) · Node 24 · TypeScript · Vitest · `pg` · `embedded-postgres` · React 18 + Vite · TanStack Query + Table · Tailwind + shadcn/ui · react-hook-form + zod · Playwright · Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-10-27-gestoria-paris-design.md` (leerlo antes de cada tarea; las letras A–L remiten a sus secciones).

## Global Constraints

- Importes: siempre `bigint` en **centavos**, en columnas con sufijo `_cents`. Prohibido `float`, `real`, `double precision` y `numeric` sin escala para dinero. El frontend nunca suma ni resta importes: solo los formatea.
- Instantes `timestamptz`; fechas operativas `date`; zona de negocio `America/Argentina/Buenos_Aires` (`SET timezone` en cada función que calcule fechas).
- Movimientos, presupuestos, eventos y conciliaciones son **solo INSERT**. UPDATE y DELETE deben fallar incluso para el dueño de la tabla, salvo en migraciones.
- El rol `authenticated` no tiene INSERT/UPDATE/DELETE sobre ninguna tabla de negocio: toda escritura pasa por RPC.
- Errores de negocio: `RAISE EXCEPTION '<CODIGO>: <detalle>'` con estos códigos exactos: `SIN_PERMISO`, `VERSION_CONFLICTO`, `TRANSICION_INVALIDA`, `DUPLICADO`, `EMPRESA_DISTINTA`, `NO_AUTORIZADO`, `DATO_INVALIDO`, `NO_ENCONTRADO`.
- Cada RPC que escribe guarda el motivo con `set_config('app.motivo', p_motivo, true)` antes de escribir, para que el trigger de auditoría lo capture.
- Estados del trámite (texto, CHECK): `borrador`, `observado`, `autorizado`, `en_gestoria`, `presentado`, `finalizado_registro`, `devuelto`, `cerrado`, `suspendido`, `cancelado`, `rechazado`.
- Roles (texto, CHECK): `gerencia`, `contable`, `gestora`, `comercial`, `admin`.
- Tipos de trámite iniciales (`codigo`): `patentamiento_0km`, `transferencia_usado`, `transferencia_parte_pago`.
- Razones sociales iniciales: `Paris Autos`, `Paris Cars`, `Paris Motor`. Provincias iniciales: `San Luis`, `San Juan`.
- Idioma de la interfaz y de los mensajes: español rioplatense. Formato de moneda `es-AR` (`$ 2.350.000,00`).
- Migraciones en `supabase/migrations/` con nombre `YYYYMMDDHHMMSS_nombre.sql`, aplicables tal cual con `supabase db push`.
- Nunca se usan credenciales reales en tests ni en el repo. Las contraseñas de prueba se generan y viven en `.env.test` (en `.gitignore`).

## Review Focus

1. **Pago sobre un trámite de otra razón social.** Se espera rechazo con `EMPRESA_DISTINTA` aunque se llame a la RPC directamente con IDs manipulados. Test en la Tarea 7.
2. **Doble envío del mismo pago con conexión inestable** (mismo `idem_key`, en paralelo). Se espera un solo movimiento y que ambas llamadas devuelvan el mismo id. Test en la Tarea 10.
3. **Gestora que intenta leer o escribir fuera de su alcance mediante la API directa** (`select` sobre `tramites` ajenos, `insert` en `movimientos`). Se espera 0 filas o error de permiso. Test en la Tarea 9.
4. **Presupuesto en 0 o negativo, o pago con desglose que no suma el importe.** Se espera `DATO_INVALIDO`. Tests en las Tareas 6 y 7.
5. **Reversión de una reversión, o revertir dos veces el mismo movimiento.** Se espera `DUPLICADO` / `DATO_INVALIDO` y el saldo intacto. Test en la Tarea 7.

---

## Estructura de archivos

```text
package.json                     scripts: test:db, db:reset, dev, build, e2e
supabase/migrations/
  20261027000100_base.sql        catálogos, perfiles, alcances, helpers de permiso
  20261027000200_auditoria.sql   eventos, auditar(), impedir_modificacion()
  20261027000300_tramites.sql    operaciones, tramites, marcas, RPCs de alta/estado
  20261027000400_presupuestos.sql
  20261027000500_finanzas.sql    cuentas, movimientos, RPCs financieras
  20261027000600_vistas.sql      v_tramite_finanzas, v_saldos
  20261027000700_rls.sql         grants, políticas
  20261027000800_conciliacion.sql
supabase/seed.sql                datos de demo (empresas, sucursales, tipos, cuentas)
db/test-support/auth_stub.sql    esquema auth + roles anon/authenticated/service_role (solo tests)
scripts/test-db.mjs              arranca embedded-postgres, aplica stub + migraciones + seed
tests/db/helpers.ts              conexión, resetDb(), crearUsuario(), comoUsuario()
tests/db/*.test.ts               un archivo por tarea
web/                             SPA (Tareas 13–17)
```

---

### Task 1: Repositorio y arnés de pruebas de base de datos

**Files:**
- Create: `package.json`, `.gitignore`, `vitest.config.ts`, `scripts/test-db.mjs`, `db/test-support/auth_stub.sql`, `tests/db/helpers.ts`, `tests/db/smoke.test.ts`

**Interfaces:**
- Produces:
  - `startDb(): Promise<{ url: string; stop(): Promise<void> }>` en `scripts/test-db.mjs`: inicia `embedded-postgres` (PG 17, puerto 54329, datos en `.pgtest/`), crea la base `gestoria_test` y aplica en orden `auth_stub.sql`, todas las migraciones y `supabase/seed.sql`.
  - `resetDb(): Promise<void>`: `TRUNCATE ... RESTART IDENTITY CASCADE` de todas las tablas de negocio y de `auth.users`, como superusuario (TRUNCATE no dispara los triggers de UPDATE/DELETE), y vuelve a aplicar el seed y a reiniciar las secuencias `seq_tramite` y `seq_compromiso`.
  - `crearUsuario(rol: Rol, alcances: {empresa: string; sucursal?: string}[]): Promise<string>`: inserta en `auth.users` y `perfiles` y devuelve el uuid.
  - `comoUsuario<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T>`: abre una transacción, `SET LOCAL ROLE authenticated`, `SET LOCAL request.jwt.claims = '{"sub":"<id>","role":"authenticated"}'`, ejecuta fn y hace COMMIT (ROLLBACK si falla).
  - `rpc(userId, nombre, args: Record<string, unknown>)`: atajo para `select * from public.<nombre>(<named args>)` dentro de `comoUsuario`.
  - `auth.uid()` en el stub, idéntico al de Supabase: `nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid`.

- [ ] **Step 1:** `git init`, `npm init -y`, instalar `-D vitest typescript @types/node @types/pg pg embedded-postgres tsx`. `.gitignore` con `node_modules`, `.pgtest`, `.env*`, `web/dist`.
- [ ] **Step 2: Write the failing test** `tests/db/smoke.test.ts`:

```ts
test('la base arranca y auth.uid() devuelve el usuario simulado', async () => {
  const id = await crearUsuario('contable', [])
  const uid = await comoUsuario(id, c => c.query('select auth.uid() as u').then(r => r.rows[0].u))
  expect(uid).toBe(id)
})
```

- [ ] **Step 3:** Run `npx vitest run tests/db/smoke.test.ts`. Expected: FAIL (no existe `crearUsuario`).
- [ ] **Step 4:** Implementar el stub, el script y los helpers. Vitest `globalSetup` llama a `startDb()` una vez; `beforeEach` en cada archivo llama a `resetDb()`. `crearUsuario` depende de `perfiles` (Tarea 2): en esta tarea inserta solo en `auth.users` y el test usa ese camino. La Tarea 2 la extiende.
- [ ] **Step 5:** Run `npx vitest run tests/db/smoke.test.ts`. Expected: PASS.
- [ ] **Step 6:** Commit: `chore: arnés de pruebas con Postgres embebido y stub de auth`.

---

### Task 2: Catálogos, perfiles, alcances y funciones de permiso

**Files:**
- Create: `supabase/migrations/20261027000100_base.sql`, `supabase/seed.sql`, `tests/db/permisos-base.test.ts`
- Modify: `tests/db/helpers.ts` (`crearUsuario` inserta perfil y alcances)

**Interfaces:**
- Produces (tablas): `empresas(id, nombre unique, cuit)`, `sucursales(id, nombre, provincia)`, `tipos_tramite(id, codigo unique, nombre, activo)`, `perfiles(id → auth.users, nombre, rol, activo)`, `alcances(perfil_id, empresa_id, sucursal_id null)`.
- Produces (funciones `STABLE SECURITY DEFINER`, `search_path = public`):
  - `mi_rol() returns text`: rol del perfil activo de `auth.uid()`, o null.
  - `tiene_alcance(p_empresa uuid, p_sucursal uuid) returns boolean`: true si existe un alcance con esa empresa y (`sucursal_id` null o igual).
- Seed: las 3 empresas, sucursales `San Luis` (provincia San Luis) y `San Juan` (provincia San Juan), los 3 tipos.

- [ ] **Step 1: Write the failing tests:**
  - `mi_rol devuelve el rol del usuario y null si está inactivo`
  - `tiene_alcance con sucursal null habilita todas las sucursales de esa empresa`
  - `tiene_alcance es false para otra empresa`
  - `el seed crea Paris Autos, Paris Cars y Paris Motor`
- [ ] **Step 2:** Run `npx vitest run tests/db/permisos-base.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Escribir la migración y el seed.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): catálogos, perfiles y alcances`.

---

### Task 3: Auditoría e inmutabilidad

**Files:**
- Create: `supabase/migrations/20261027000200_auditoria.sql`, `tests/db/auditoria.test.ts`

**Interfaces:**
- Produces:
  - Tabla `eventos(id bigserial, at timestamptz default now(), actor_id uuid, entidad text, entidad_id uuid, accion text check in ('insert','update','delete'), antes jsonb, despues jsonb, motivo text)`, con índice `(entidad, entidad_id, at)`.
  - `auditar() returns trigger`: inserta un evento con `actor_id = auth.uid()`, `entidad = TG_TABLE_NAME`, `motivo = nullif(current_setting('app.motivo', true), '')`. Las tareas siguientes lo adjuntan con `create trigger trg_auditar after insert or update or delete on <tabla> for each row execute function auditar();`.
  - `impedir_modificacion() returns trigger`: `RAISE EXCEPTION 'DATO_INVALIDO: registro inmutable (%)', TG_TABLE_NAME`. Se adjunta `before update or delete`.
- Aplicar ambos a `eventos` (inmutable) y `auditar` a `perfiles` y `alcances`.

- [ ] **Step 1: Write the failing tests:**
  - `cambiar el rol de un perfil genera un evento con antes/después y actor`
  - `update y delete sobre eventos fallan incluso como superusuario` (espera `/registro inmutable/`)
- [ ] **Step 2:** Run `npx vitest run tests/db/auditoria.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): auditoría por triggers e inmutabilidad`.

---

### Task 4: Operaciones y trámites: alta idempotente y anti-duplicado

**Files:**
- Create: `supabase/migrations/20261027000300_tramites.sql` (primera parte), `tests/db/alta-tramite.test.ts`

**Interfaces:**
- Consumes: `mi_rol()`, `tiene_alcance()`, `auditar()`.
- Produces (tablas):
  - `operaciones(id, empresa_id, sucursal_id, cliente_nombre, cuenta_personal, oferta_ref, referencia_mail, created_at)`, único `(empresa_id, oferta_ref)`.
  - `tramites(id, numero text unique, operacion_id, tipo_id, empresa_id, sucursal_id, estado default 'borrador', vehiculo_desc, dominio, chasis, gestora_id null, responsable_id, creado_por, autorizado_por, autorizado_at, orden_compromiso bigint null, pago_final_at null, version int default 1, idem_key uuid unique, created_at)`.
  - Índice único parcial `ux_tramite_dup on tramites(operacion_id, tipo_id, coalesce(upper(dominio), upper(chasis), '')) where estado not in ('cancelado','rechazado')`.
  - `numero`: `'T-' || año AR || '-' || lpad(nextval('seq_tramite')::text, 5, '0')`.
  - `tramite_marcas(tramite_id, marca check in ('legajo_recibido','firmado','entregado','retirado','recibido_admin'), at, por)`, PK `(tramite_id, marca)`.
- Produces (RPC):
  - `crear_tramite(p_idem uuid, p_empresa uuid, p_sucursal uuid, p_tipo text, p_cliente text, p_cuenta_personal text, p_oferta text, p_vehiculo text, p_dominio text default null, p_chasis text default null, p_ref_mail text default null) returns uuid`
    - Solo `gerencia`/`contable` con `tiene_alcance(p_empresa, p_sucursal)`; si no, `SIN_PERMISO`.
    - Si existe un trámite con `idem_key = p_idem`, devuelve su id sin crear nada.
    - Reutiliza la operación existente por `(empresa, oferta)` (caso M).
    - Si viola `ux_tramite_dup`, `DUPLICADO: ya existe <numero>`.
  - `buscar_duplicados(p_empresa uuid, p_oferta text, p_dominio text) returns table(id uuid, numero text, estado text)`: para el aviso previo en la UI.

- [ ] **Step 1: Write the failing tests:**
  - `contable crea un trámite en borrador con número T-2026-00001`
  - `mismo idem_key devuelve el mismo id y no crea otro`
  - `misma operación + tipo + dominio da DUPLICADO; con otro tipo crea un segundo trámite en la misma operación`
  - `gestora no puede crear trámites (SIN_PERMISO)`
  - `contable sin alcance en Paris Cars no puede crear en Paris Cars`
  - `trámite cancelado no bloquea un nuevo alta igual`
- [ ] **Step 2:** Run `npx vitest run tests/db/alta-tramite.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): alta de trámites idempotente con control de duplicados`.

---

### Task 5: Estados, autorización, marcas y reasignación

**Files:**
- Modify: `supabase/migrations/20261027000300_tramites.sql` (segunda parte)
- Create: `tests/db/estados.test.ts`

**Interfaces:**
- Produces (RPC; todas reciben `p_version int` cuando modifican un trámite: si `version <> p_version` → `VERSION_CONFLICTO`, y en caso de éxito incrementan `version`):
  - `autorizar_tramite(p_tramite uuid, p_gestora uuid, p_version int) returns void`: solo desde `borrador`; rol `gerencia`/`contable` con alcance; `p_gestora` debe ser un perfil activo con rol `gestora`; setea `autorizado_por`, `autorizado_at`, `gestora_id`, estado `autorizado`.
  - `cambiar_estado(p_tramite uuid, p_estado text, p_motivo text, p_version int) returns void` con esta tabla de transiciones exacta:

| Desde | Hacia | Roles | Motivo obligatorio |
|---|---|---|---|
| borrador | observado, rechazado | gerencia, contable | sí |
| observado | borrador | gerencia, contable | no |
| autorizado | en_gestoria | gerencia, contable | no |
| autorizado, en_gestoria | presentado | gestora asignada, gerencia, contable | no |
| presentado | finalizado_registro | gestora asignada, gerencia, contable | no |
| finalizado_registro | devuelto | gerencia, contable | no |
| devuelto | cerrado | gerencia, contable | no |
| cualquiera ≠ cerrado/cancelado/rechazado | suspendido, cancelado | gerencia, contable | sí |
| suspendido | estado previo (el último evento antes de suspender) | gerencia, contable | sí |

    Cualquier otra combinación → `TRANSICION_INVALIDA`. Pasar a `autorizado` solo por `autorizar_tramite`.
  - `marcar(p_tramite uuid, p_marca text) returns void`: `retirado` lo puede marcar la gestora asignada; el resto, gerencia/contable. Si la marca ya existe, no hace nada (idempotente).
  - `reasignar_gestora(p_tramites uuid[], p_gestora uuid, p_motivo text) returns int` (cantidad reasignada): gerencia/contable; motivo obligatorio.

- [ ] **Step 1: Write the failing tests:**
  - `autorizar exige rol habilitado y deja autorizado_por y autorizado_at`
  - `no se puede pasar de borrador a presentado (TRANSICION_INVALIDA)`
  - `observar sin motivo da DATO_INVALIDO`
  - `gestora asignada marca presentado; otra gestora recibe SIN_PERMISO`
  - `dos ediciones con la misma version: la segunda recibe VERSION_CONFLICTO`
  - `suspender y reanudar vuelve al estado previo`
  - `reasignar en lote cambia la gestora y registra el motivo en eventos`
  - `el historial de eventos de un trámite reconstruye alta → autorización → presentado con actores`
- [ ] **Step 2:** Run `npx vitest run tests/db/estados.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar. La tabla de transiciones va en una función `transicion_permitida(p_desde text, p_hacia text, p_rol text, p_es_gestora_asignada boolean) returns boolean` para poder testearla aparte.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): máquina de estados, autorización y reasignación`.

---

### Task 6: Presupuestos versionados

**Files:**
- Create: `supabase/migrations/20261027000400_presupuestos.sql`, `tests/db/presupuestos.test.ts`

**Interfaces:**
- Consumes: `tramites`. La tabla `cuentas` se crea **en esta migración (0400)** porque el presupuesto necesita bloquearla; la Tarea 7 solo agrega `movimientos`.
- Produces:
  - `cuentas(id, empresa_id unique, nombre, saldo_inicial_cents bigint not null default 0, saldo_inicial_fecha date not null)`, más las tres cuentas en el seed.
  - `presupuestos(id, tramite_id, version int, arancel_cents, prenda_cents, sellado_cents, otros_cents bigint not null default 0 check (>= 0), total_cents bigint generated always as (arancel+prenda+sellado+otros) stored, motivo, creado_por, created_at)`, único `(tramite_id, version)`, inmutable, auditado.
  - `registrar_presupuesto(p_tramite uuid, p_arancel bigint, p_prenda bigint, p_sellado bigint, p_otros bigint, p_motivo text default null) returns int` (versión creada):
    - Estado debe ser `autorizado`, `en_gestoria` o `presentado`; si no, `NO_AUTORIZADO`.
    - Rol: gestora asignada, gerencia o contable con alcance.
    - Total ≤ 0 → `DATO_INVALIDO`. Versión ≥ 2 sin motivo → `DATO_INVALIDO`.
    - Primero `select … from cuentas where empresa_id = t.empresa_id for update`.
    - En la versión 1 asigna `tramites.orden_compromiso = nextval('seq_compromiso')` (define la prioridad de fondos).

- [ ] **Step 1: Write the failing tests:**
  - `gestora asignada carga presupuesto; total = suma de conceptos`
  - `segunda versión sin motivo falla; con motivo crea version 2 y la 1 queda intacta`
  - `presupuesto en borrador da NO_AUTORIZADO`
  - `total 0 o concepto negativo da DATO_INVALIDO` (Review Focus 4)
  - `update sobre presupuestos falla (inmutable)`
- [ ] **Step 2:** Run `npx vitest run tests/db/presupuestos.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): presupuestos versionados con orden de compromiso`.

---

### Task 7: Movimientos: carga, pago, ajuste, reintegro y reversión

**Files:**
- Create: `supabase/migrations/20261027000500_finanzas.sql`, `tests/db/movimientos.test.ts`

**Interfaces:**
- Produces:
  - `movimientos(id, cuenta_id, tipo check in ('carga','pago_tramite','ajuste','reintegro','reversion'), importe_cents bigint not null check (<> 0), fecha_operacion date not null, tramite_id null, revierte_id uuid unique null references movimientos, arancel_cents, prenda_cents, sellado_cents, otros_cents bigint null, es_pago_final boolean not null default false, motivo text, creado_por uuid not null, created_at timestamptz default now(), idem_key uuid unique not null)`.
  - CHECKs: `carga` y `reintegro` > 0; `pago_tramite` < 0 con `tramite_id` no nulo y `arancel+prenda+sellado+otros = -importe_cents`; `reversion` con `revierte_id` no nulo; `ajuste` con motivo no vacío.
  - Trigger `verificar_empresa_movimiento`: si `tramite_id` no es nulo, la empresa del trámite debe ser igual a la de la cuenta; si no, `EMPRESA_DISTINTA`.
  - Inmutable y auditado.
  - RPCs. Todas: idempotentes por `p_idem` (si existe, devuelven el id existente sin validar nada más), `for update` sobre la cuenta y devuelven el `uuid` del movimiento:
    - `registrar_carga(p_idem uuid, p_empresa uuid, p_importe bigint, p_fecha date, p_motivo text default null)`: gerencia, contable.
    - `registrar_pago(p_idem uuid, p_tramite uuid, p_fecha date, p_arancel bigint, p_prenda bigint, p_sellado bigint, p_otros bigint, p_es_final boolean, p_motivo text default null)`: la cuenta **se deriva** del trámite. Gestora asignada solo si el estado ∈ (`autorizado`, `en_gestoria`, `presentado`, `finalizado_registro`); gerencia y contable también en otros estados, con motivo obligatorio (R24). Si `p_es_final`, setea `tramites.pago_final_at`. Nunca rechaza por saldo (R21).
    - `registrar_ajuste(p_idem uuid, p_empresa uuid, p_importe bigint, p_fecha date, p_motivo text)`: solo gerencia.
    - `registrar_reintegro(p_idem uuid, p_tramite uuid, p_importe bigint, p_fecha date, p_motivo text)`: gerencia, contable.
    - `revertir_movimiento(p_idem uuid, p_movimiento uuid, p_motivo text)`: gerencia, contable; crea una `reversion` con el mismo `tramite_id`, `-importe` y el desglose con signo invertido. Si el original era un pago final, limpia `pago_final_at`. No se puede revertir una `reversion` → `DATO_INVALIDO`; una segunda reversión choca con el `unique(revierte_id)` → `DUPLICADO`.

- [ ] **Step 1: Write the failing tests:**
  - `carga suma, pago resta, ajuste de gerencia con signo`
  - `pago con desglose que no suma el importe da DATO_INVALIDO` (Review Focus 4)
  - `pago sobre trámite de Paris Cars nunca toca la cuenta de Paris Autos; forzar tramite ajeno da EMPRESA_DISTINTA` (Review Focus 1: insertar con superusuario un movimiento con cuenta de Autos y trámite de Cars para probar el trigger)
  - `gestora no puede registrar_ajuste ni registrar_carga (SIN_PERMISO)`
  - `pago que deja saldo negativo se registra igual`
  - `revertir un pago crea movimiento inverso; revertir de nuevo da DUPLICADO; revertir una reversión da DATO_INVALIDO; saldo final intacto` (Review Focus 5)
  - `mismo idem_key en registrar_pago devuelve el mismo id`
  - `delete sobre movimientos falla`
- [ ] **Step 2:** Run `npx vitest run tests/db/movimientos.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): libro de movimientos de Habitualista`.

---

### Task 8: Vistas de finanzas, política de fondos y escenario integral

**Files:**
- Create: `supabase/migrations/20261027000600_vistas.sql`, `tests/db/escenario-integral.test.ts`, `tests/db/fondos.test.ts`
- Add to the 0600 migration: `excepciones_fondos(tramite_id pk, aprobado_por, motivo, at)` and the RPC `aprobar_excepcion_fondos(p_tramite uuid, p_motivo text) returns void` (solo gerencia).

**Interfaces:**
- Produces:
  - `v_tramite_finanzas(tramite_id, empresa_id, presupuesto_cents, pagado_cents, comprometido_cents, desvio_cents, desvio_pct numeric(7,2), situacion text)`, con estas definiciones exactas:
    - `presupuesto_cents` = total de la versión máxima (null si no hay).
    - `pagado_cents` = −Σ importe de todos los movimientos con ese `tramite_id` (pagos, reintegros y reversiones); queda positivo.
    - `comprometido_cents` = si estado ∈ (`autorizado`,`en_gestoria`,`presentado`,`finalizado_registro`) y `pago_final_at` es null y hay presupuesto: `greatest(presupuesto − pagado, 0)`; si no, 0.
    - `desvio_cents` = `pagado − presupuesto` solo si `pago_final_at` no es null; `desvio_pct` = `desvio / presupuesto × 100`, redondeado a 2.
    - `situacion` ∈ `sin_presupuesto`, `comprometido`, `sin_fondos`, `pagado_parcial`, `pagado`, `no_aplica`. Es `sin_fondos` cuando el trámite tiene comprometido > 0, no tiene excepción y la suma acumulada de comprometido de su cuenta, ordenada por `orden_compromiso`, hasta él inclusive, supera el saldo registrado de la cuenta.
  - `v_saldos(cuenta_id, empresa_id, empresa, registrado_cents, comprometido_cents, disponible_cents, ultimo_movimiento_at, ultimo_movimiento_por, ultima_conciliacion_fecha, ultima_diferencia_cents)`, con `registrado = saldo_inicial + Σ importe` y `disponible = registrado − comprometido`. Las columnas de conciliación quedan null hasta la Tarea 11.
  - Ambas vistas con `security_invoker = false` (dueño `postgres`) y filtradas internamente: `v_saldos` solo filas con `mi_rol() in ('gerencia','contable') and tiene_alcance(empresa_id, null)`; `v_tramite_finanzas` solo trámites que el usuario puede ver (misma regla que la política RLS de la Tarea 9, con la función `puede_ver_tramite(p_tramite uuid) returns boolean`, que se define acá y la Tarea 9 reutiliza).

- [ ] **Step 1: Write the failing test** del escenario integral (sección 14 del prompt; sección K del spec), en un único `test` secuencial. Sin saldo inicial cargado: el escenario arranca con una carga de 3.000.000 y luego el usuario contable de San Luis y el usuario gerencia de San Juan operan sobre Paris Autos.

```ts
const S = (r: Saldo) => [r.registrado_cents, r.comprometido_cents, r.disponible_cents]
// tras carga 3.000.000 y presupuesto T1 700.000
expect(S(await saldo('Paris Autos'))).toEqual([300000000n, 70000000n, 230000000n])
// presupuesto T2 (San Juan, autorizado por gerencia) 900.000
expect(S(await saldo('Paris Autos'))).toEqual([300000000n, 160000000n, 140000000n])
// pago final T1 650.000
expect(S(await saldo('Paris Autos'))).toEqual([235000000n, 90000000n, 145000000n])
// carga 2.000.000
expect(S(await saldo('Paris Autos'))).toEqual([435000000n, 90000000n, 345000000n])
// desvío de T1
expect((await finanzas(t1)).desvio_cents).toBe(-5000000n)
```

  (Los bigint se leen con `pg.types.setTypeParser(20, BigInt)` en los helpers.)
- [ ] **Step 2: Write the failing tests** en `fondos.test.ts`:
  - `cancelar un trámite comprometido libera el comprometido` (caso E)
  - `cancelar con pagos conserva los pagos y comprometido 0` (caso F)
  - `pago mayor al presupuesto: desvío positivo, comprometido 0` (caso C)
  - `pagos parciales: comprometido baja con cada pago y es 0 con el final` (caso L)
  - `nueva versión de presupuesto recalcula comprometido` (caso D)
  - `segundo trámite que excede el saldo queda sin_fondos; una carga lo destraba sin intervención` (R22)
  - `aprobar_excepcion_fondos de gerencia quita sin_fondos; contable recibe SIN_PERMISO`
- [ ] **Step 3:** Run `npx vitest run tests/db/escenario-integral.test.ts tests/db/fondos.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implementar las vistas con CTE y una ventana `sum(...) over (partition by cuenta order by orden_compromiso)`.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(db): saldos, compromisos calculados y política de fondos`.

---

### Task 9: Permisos: grants, RLS y matriz negativa

**Files:**
- Create: `supabase/migrations/20261027000700_rls.sql`, `tests/db/rls.test.ts`

**Interfaces:**
- Consumes: `mi_rol()`, `tiene_alcance()`, `puede_ver_tramite()`.
- Produces:
  - `revoke all on all tables in schema public from anon, authenticated`; `grant select` sobre las tablas legibles y las vistas `v_*`; `grant execute` sobre las RPC solo a `authenticated`; `revoke execute ... from public, anon`.
  - RLS habilitado en todas las tablas de negocio. Políticas SELECT:
    - `tramites`, `operaciones`, `tramite_marcas`, `presupuestos`: gerencia y contable por alcance; gestora solo donde `gestora_id = auth.uid()` y estado no está en (`borrador`, `observado`, `rechazado`).
    - `cuentas`, `movimientos`, `excepciones_fondos`: gerencia y contable por alcance; gestora solo sus propios pagos (`creado_por = auth.uid()`).
    - `eventos`: gerencia y contable; gestora solo los eventos de los trámites que puede ver.
    - `perfiles`: cada uno ve el suyo; gerencia, contable y admin ven todos.
  - Sin políticas INSERT/UPDATE/DELETE para `authenticated` (todo pasa por RPC).

- [ ] **Step 1: Write the failing tests** (un `test.each` sobre la matriz F del spec, cada fila intenta la operación y espera error o 0 filas):
  - `gestora: select de tramites ajenos devuelve 0 filas` (Review Focus 3)
  - `gestora: insert directo en movimientos falla con permission denied` (Review Focus 3)
  - `gestora: autorizar, registrar_ajuste, registrar_carga, aprobar_excepcion_fondos dan SIN_PERMISO`
  - `gestora: v_saldos devuelve 0 filas; v_tramite_finanzas solo sus trámites con situacion visible`
  - `contable con alcance San Luis/Paris Autos no ve trámites de Paris Cars`
  - `anon no puede ejecutar ninguna RPC`
  - `nadie puede update en eventos`
- [ ] **Step 2:** Run `npx vitest run tests/db/rls.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run `npx vitest run tests/db`, toda la suite, para detectar regresiones por los grants. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): RLS y matriz de permisos`.

---

### Task 10: Concurrencia e idempotencia con conexiones paralelas

**Files:**
- Create: `tests/db/concurrencia.test.ts`

**Interfaces:**
- Consumes: las RPC de las Tareas 6–8; `comoUsuario` con dos `Pool` clients distintos.

- [ ] **Step 1: Write the tests:**
  - `dos presupuestos simultáneos sobre una cuenta con fondos para uno: exactamente un trámite queda sin_fondos` (casos A/B). Saldo 1.000.000; dos trámites autorizados; `Promise.all` de dos `registrar_presupuesto` de 800.000 desde dos clientes. Se espera `situacion` = {`comprometido`, `sin_fondos`} en algún orden.
  - `mismo idem_key de pago enviado en paralelo por dos conexiones crea un solo movimiento y ambas devuelven el mismo id` (caso N; Review Focus 2). El `insert` de la RPC usa `on conflict (idem_key) do nothing` y luego `select`.
  - `carga y pago simultáneos sobre la misma cuenta dejan el saldo exacto`
  - `edición concurrente del mismo trámite: una gana y la otra recibe VERSION_CONFLICTO` (caso O)
- [ ] **Step 2:** Run `npx vitest run tests/db/concurrencia.test.ts`. Expected: PASS si las Tareas 6–8 respetaron el `FOR UPDATE` y el `idem_key`. Si falla, corregir la RPC correspondiente (no el test).
- [ ] **Step 3:** Repetir 20 veces para descartar falsos verdes: `1..20 | ForEach-Object { npx vitest run tests/db/concurrencia.test.ts }` (PowerShell). Expected: 20/20 PASS.
- [ ] **Step 4:** Commit: `test(db): concurrencia e idempotencia`.

---

### Task 11: Conciliación simple

**Files:**
- Create: `supabase/migrations/20261027000800_conciliacion.sql`, `tests/db/conciliacion.test.ts`
- Modify: `v_saldos`, para completar las columnas de conciliación (`create or replace view` en la misma migración).

**Interfaces:**
- Produces:
  - `conciliaciones(id, cuenta_id, fecha_corte date, saldo_externo_cents, saldo_interno_cents, diferencia_cents, nota, creado_por, created_at)`, inmutable.
  - `movimientos_conciliados(movimiento_id pk, conciliacion_id)`.
  - `registrar_conciliacion(p_empresa uuid, p_fecha_corte date, p_saldo_externo bigint, p_nota text, p_movimientos uuid[]) returns uuid`: gerencia y contable. Calcula `saldo_interno` = saldo inicial + Σ movimientos con `fecha_operacion <= p_fecha_corte`; guarda la diferencia (externo − interno) y marca los movimientos indicados como conciliados (que deben pertenecer a esa cuenta; si no, `EMPRESA_DISTINTA`).
  - `v_movimientos_extracto(movimiento_id, cuenta_id, fecha_operacion, tipo, tramite_numero, cliente, responsable, ingreso_cents, egreso_cents, saldo_resultante_cents, conciliado boolean)`, con saldo acumulado por `fecha_operacion, created_at` (para la pantalla de la Tarea 16).

- [ ] **Step 1: Write the failing tests:**
  - `carga no registrada en el sistema aparece como diferencia positiva` (casos H/I)
  - `registrar la carga faltante y reconciliar da diferencia 0`
  - `extracto con saldo resultante correcto fila por fila`
- [ ] **Step 2:** Run `npx vitest run tests/db/conciliacion.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run `npx vitest run tests/db`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): conciliación y extracto`.

---

### Task 12: Proyecto Supabase de staging ⚠️ requiere acción del usuario

Claude no crea cuentas ni inicia sesión con contraseñas. **El usuario** crea la cuenta de Supabase y el proyecto `gestoria-staging` (región São Paulo, `sa-east-1`) y luego ejecuta `npx supabase login` en su terminal.

**Files:**
- Create: `supabase/config.toml` (`npx supabase init`), `docs/OPERACION.md` (cómo desplegar migraciones y crear usuarios)

- [ ] **Step 1:** El usuario crea el proyecto y ejecuta `npx supabase login` + `npx supabase link --project-ref <ref>`.
- [ ] **Step 2:** Run `npx supabase db push`. Expected: las 8 migraciones aplicadas sin error.
- [ ] **Step 3:** Desde el panel de Supabase, el usuario crea los usuarios de prueba (uno por rol). Claude inserta sus `perfiles` y `alcances` mediante el SQL editor o `execute_sql`.
- [ ] **Step 4:** Smoke: como contable, llamar `crear_tramite` vía `supabase-js` desde un script `scripts/smoke-staging.mjs`. Expected: devuelve uuid; como gestora, `select` sobre `movimientos` devuelve solo sus pagos.
- [ ] **Step 5:** En el panel, desactivar el registro público de usuarios (*Auth → Sign-ups off*); los usuarios los da de alta solo el admin.
- [ ] **Step 6:** Commit: `chore: configuración de Supabase staging`.

---

### Task 13: Frontend base

**Files:**
- Create: `web/` (Vite React TS), `web/src/lib/supabase.ts`, `web/src/lib/dinero.ts`, `web/src/lib/errores.ts`, `web/src/lib/sesion.tsx`, `web/src/app/Layout.tsx`, `web/src/app/rutas.tsx`, `web/src/pages/Login.tsx`, `web/src/lib/dinero.test.ts`, `web/src/lib/errores.test.ts`

**Interfaces:**
- Produces:
  - `formatearPesos(cents: bigint | number | string): string` → `"$ 2.350.000,00"`, sin aritmética de punto flotante (operación sobre string).
  - `parsearPesos(texto: string): bigint`: centavos; acepta `"650.000"`, `"650000"`, `"650.000,50"`; lanza un error con mensaje en español si el texto es inválido.
  - `mensajeError(e: unknown): string`: mapea los 8 códigos de error a textos de usuario; p. ej. `VERSION_CONFLICTO` → `"Otro usuario modificó este trámite. Recargá para ver los cambios."`.
  - `useSesion(): { perfil: Perfil | null; rol: Rol | null; cargando: boolean }`.
  - Navegación por rol: gerencia → Tablero, Trámites, Habitualista; contable → Trámites, Habitualista, Tablero; gestora → Mis trámites.
  - Todas las llamadas que escriben generan `crypto.randomUUID()` como `p_idem` **al abrir el formulario** (no al enviarlo), así un reintento reutiliza el mismo valor.
- Los importes `bigint` se piden como texto (`select=registrado_cents::text`) para no perder precisión.

- [ ] **Step 1: Write the failing tests:**
  - `formatearPesos(235000000n) === "$ 2.350.000,00"`
  - `formatearPesos(-5000000n) === "-$ 50.000,00"`
  - `parsearPesos("650.000") === 65000000n`
  - `parsearPesos("650.000,50") === 65000050n`
  - `parsearPesos("abc")` lanza un error
  - `mensajeError` cubre los 8 códigos
- [ ] **Step 2:** Run `npm --prefix web test`. Expected: FAIL.
- [ ] **Step 3:** Implementar, junto con el login por email y contraseña de Supabase Auth y el layout con barra lateral (desktop) o barra inferior (móvil).
- [ ] **Step 4:** Run. Expected: PASS. `npm --prefix web run build` sin errores de tipos.
- [ ] **Step 5:** Commit: `feat(web): base, sesión y formato de dinero`.

---

### Task 14: Pantalla Trámites: tabla, detalle, alta y acciones

**Files:**
- Create: `web/src/pages/Tramites.tsx`, `web/src/features/tramites/{TablaTramites,FiltrosTramites,PanelDetalle,FormAlta,AccionesTramite,HistorialEventos}.tsx`, `web/src/features/tramites/consultas.ts`, `web/e2e/tramites.spec.ts`

**Interfaces:**
- Consumes: `tramites` + `operaciones` + `v_tramite_finanzas` + `eventos`; RPC `crear_tramite`, `buscar_duplicados`, `autorizar_tramite`, `cambiar_estado`, `marcar`, `reasignar_gestora`.
- Produces: `consultas.ts` con `listarTramites(f: FiltrosTramites)`, `obtenerTramite(id)` y `historial(id)`. Los filtros se guardan en la URL (querystring) para poder compartir y recargar la vista.
- Realtime: suscripción a `postgres_changes` sobre `tramites`, `presupuestos` y `movimientos` → `queryClient.invalidateQueries(['tramites'])`.
- Columnas y vistas guardadas: exactamente las de la sección G.1 del spec.

- [ ] **Step 1: Write the failing E2E** (Playwright contra `npm run dev` + staging, con un usuario de prueba contable de `.env.test`):
  - `contable da de alta, ve el aviso de duplicado al repetir, autoriza asignando gestora y lo encuentra buscando por dominio`
  - `observar exige motivo y el historial muestra autor y fecha`
- [ ] **Step 2:** Run `npx playwright test web/e2e/tramites.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar. Antes de escribir los componentes visuales, cargar la skill `frontend-design` para las decisiones estéticas. Tabla densa, sin animaciones.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): pantalla de trámites`.

---

### Task 15: Mis trámites (gestora, móvil)

**Files:**
- Create: `web/src/pages/MisTramites.tsx`, `web/src/features/gestora/{TarjetaTramite,FormPresupuesto,FormPago}.tsx`, `web/e2e/gestora.spec.ts`

**Interfaces:**
- Consumes: `v_tramite_finanzas` (situación), RPC `registrar_presupuesto`, `registrar_pago`, `cambiar_estado`, `marcar`.
- Produces: grupos "Presupuestar" (`sin_presupuesto`), "Listos para presentar" (`autorizado`/`en_gestoria` con presupuesto), "Presentados", "Para retirar" (`finalizado_registro` sin la marca `retirado`). Aviso rojo fijo `"No presentar: sin fondos"` cuando `situacion = 'sin_fondos'`. El pago muestra el presupuesto como referencia y el campo "¿Es el pago final?" (sí por defecto).

- [ ] **Step 1: Write the failing E2E** con viewport 375×812 y usuario gestora:
  - `gestora carga presupuesto 700.000 y lo ve en Listos para presentar`
  - `gestora registra pago final 650.000 y el trámite muestra pagado`
  - `gestora no ve el menú Habitualista ni importes de saldo`
- [ ] **Step 2:** Run `npx playwright test web/e2e/gestora.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): vista móvil de gestoras`.

---

### Task 16: Habitualista (extracto) y Tablero

**Files:**
- Create: `web/src/pages/Habitualista.tsx`, `web/src/pages/Tablero.tsx`, `web/src/features/habitualista/{TarjetasSaldo,TablaExtracto,FormCarga,FormAjuste,FormConciliacion,FormReversion,TablaCompromisos}.tsx`, `web/e2e/habitualista.spec.ts`

**Interfaces:**
- Consumes: `v_saldos`, `v_movimientos_extracto`, `v_tramite_finanzas`; RPC `registrar_carga`, `registrar_ajuste`, `revertir_movimiento`, `registrar_conciliacion`, `aprobar_excepcion_fondos`.
- Produces:
  - Habitualista: cuatro tarjetas (sección G.2 del spec). La tarjeta de conciliación aparece en ámbar si la última tiene más de 7 días o la diferencia es ≠ 0. El botón "Ajuste" solo se muestra a gerencia (la base igual lo rechaza para otros roles).
  - Tablero: una fila por razón social con registrado, comprometido, disponible y necesidad de recarga = `max(−disponible, 0)`, más contadores por estado que navegan a Trámites con el filtro aplicado y la lista "Requieren intervención" (observados, `sin_fondos`, y autorizados con más de 5 días sin presentar [P8 del spec, valor provisorio]).

- [ ] **Step 1: Write the failing E2E:**
  - `contable registra carga y las tarjetas se actualizan; el movimiento aparece no conciliado`
  - `revertir un pago pide motivo y muestra ambas filas ligadas`
  - `dos navegadores (contable y gerencia) ven el comprometido del otro sin recargar` (Realtime)
- [ ] **Step 2:** Run `npx playwright test web/e2e/habitualista.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): Habitualista y tablero`.

---

### Task 17: E2E del escenario integral y publicación

**Files:**
- Create: `web/e2e/escenario-integral.spec.ts`, `.github/workflows/ci.yml`, `docs/OPERACION.md` (completar)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Write the E2E** que reproduce la sección 14 del prompt con tres usuarios (contable San Luis, gerencia San Juan, gestora) y verifica en pantalla los cuatro tríos de saldos de la Tarea 8 (formateados: `$ 3.000.000,00`, etc.). Al final, como gestora, verifica que el importe cobrado al cliente no existe en ninguna pantalla (Etapa 2: aún no se muestra).
- [ ] **Step 2:** Run `npx playwright test web/e2e/escenario-integral.spec.ts`. Expected: PASS.
- [ ] **Step 3:** CI en GitHub Actions: `npm ci`, `npx vitest run tests/db`, `npm --prefix web test` y `npm --prefix web run build` en cada push. Los E2E quedan manuales contra staging.
- [ ] **Step 4:** ⚠️ Requiere al usuario: crear la cuenta de Cloudflare y conectar el repo a Cloudflare Pages (build `npm --prefix web run build`, salida `web/dist`, variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`).
- [ ] **Step 5:** Verificar la URL publicada con el usuario gestora desde un celular real.
- [ ] **Step 6:** Commit: `ci: pipeline y documentación de operación`.

---

## Fuera de esta etapa (planes separados)

- **Etapa 2:** cobros a clientes (con RLS propia), informes con las reglas de fecha del spec (sección J), exportación XLSX/CSV, notificaciones, perfil comercial, foto de cierre mensual.
- **Etapa 3:** objetivos y proyecciones, importación de extractos de la Habitualista, predicciones.
