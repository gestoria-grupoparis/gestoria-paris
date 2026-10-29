# Rendiciones con lectura automática de comprobantes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The gestora uploads her monthly rendición (sheet + receipts + fee invoices). The system reads them, links each one to its trámite, and runs the three controls: amounts vs Habitualista, authorized trámites, and fees.

**Architecture:**
- Tables and RPCs in Postgres (Supabase), following the existing pattern: SECURITY DEFINER RPCs, RLS, the `auditar` trigger, amounts in bigint cents.
- Original files go in a private Storage bucket.
- Reading happens in the browser:
  - PDF.js extracts text from digital PDFs.
  - Tesseract.js (`spa`, self-hosted models) handles photos and scans.
  - Pure parsers per document type, tested with real anonymized fixtures.
- Controls are computed in the database (RPC `controles_rendicion`). The frontend only displays them.

**Tech Stack:** Supabase Postgres 17 and Storage, React 19 + Vite + TS + Tailwind v4 (web/), TanStack Query, `pdfjs-dist`, `tesseract.js`, `exceljs` (already installed), Vitest (DB + unit), Playwright (E2E against the mock).

**Spec:** `docs/superpowers/specs/2026-10-29-rendiciones-ocr-design.md`

## Global Constraints

- Never edit existing migrations. New ones go in `supabase/migrations/20261101xxxxxx_*.sql`, contain only WIN1252-compatible characters (no arrows), and can be applied idempotently with `npx vitest run tests/db`.
- Money is bigint cents in the database. The frontend parses amounts only in `features/rendiciones/montos.ts` and does not compute with floats.
- A rendición NEVER inserts into `movimientos` and never changes balances.
- No paid services or generative AI. Tesseract models are served from `web/public/ocr/` (no third-party CDN at runtime).
- Original documents stay private: bucket `comprobantes` with `public = false`. Access goes through Storage policies that mirror table permissions.
- Roles:
  - **Gestora:** creates and edits only her own rendiciones while they are in `borrador` or `observada`.
  - **Gerencia/contable:** read by scope, observe and approve.
  - **Comercial/admin:** no access.
- Spanish (Argentina) copy and the design system in `design-system/MASTER.md`. Every action shows explicit loading, error and empty states.
- Test fixtures are anonymized real documents in `web/src/features/rendiciones/__fixtures__/` (text transcribed from the sample photos, with fake DNI and names).

## Review Focus

1. **Amount format ambiguity:** "1.500" (thousands) vs "1,500" vs "508 614.29" vs "431539,69". The parser must give 150000 / 150000 / 50861429 / 43153969 cents, and must reject "1.50.0" as invalid rather than guessing. Test: `montos.test.ts`.
2. **The same receipt rescanned (different file hash):**
   - It must be flagged as a likely duplicate by tipo + número + emisor.
   - It must not block the save, but must show a warning.

   Test: DB `rendiciones.test.ts` "duplicado por número".
3. **Planilla row whose name matches two trámites (two clients with the same name):**
   - It must stay "ambiguous" with both candidates listed, never auto-linked.
   - The dominio wins when present.

   Test: `vincular.test.ts`.
4. **Bonuses as negative lines on the DNRPA receipt** (`$ -5290,00`): they must subtract, and the sum of the lines must equal Total. Test: `parsers.test.ts`.
5. **Habitualista debit in the same month that belongs to trámites NOT in the rendición:**
   - Control 1 must show the difference.
   - It must list which movements are left unexplained, not just a total.

   Test: DB "control habitualista".

---

### Task 1: Data model and permissions

**Files:**
- Create: `supabase/migrations/20261101000100_rendiciones.sql`
- Modify: `db/test-support/auth_stub.sql` (add a minimal `storage` schema: `storage.buckets(id text pk, name text, public boolean)` and `storage.objects(id uuid, bucket_id text, name text, owner uuid)` so the policies can be created in tests)
- Test: `tests/db/rendiciones.test.ts`

**Interfaces — Produces:**
- **Tables:**
  - `rendiciones(id uuid pk, empresa_id uuid, gestora_id uuid -> perfiles, periodo date (first day of the month), honorario_unitario_cents bigint default 3250000, estado text check in ('borrador','enviada','observada','aprobada'), motivo_observacion text, creado_por, created_at, version int)`, unique `(empresa_id, gestora_id, periodo)`.
  - `rendicion_filas(id uuid pk, rendicion_id, orden int, nombre text, dominio text null, pago_cents bigint, honorarios_cents bigint, tramite_id uuid null, vinculo text check in ('auto','manual','ambiguo','sin_vincular'), candidatos uuid[] default '{}')`.
  - `comprobantes(id uuid pk, rendicion_id, fila_id uuid null, tipo text check in ('recibo_dnrpa','retencion_sellos','factura_honorarios','factura_electronica','otro'), archivo_path text, archivo_sha256 text, pagina int default 1, numero text null, emisor text null, emisor_cuit text null, fecha date null, total_cents bigint null, dominio text null, documento text null, datos_extraidos jsonb, datos_confirmados jsonb null, revision text check in ('pendiente','confirmado'), cargado_por, revisado_por null, created_at)`.
  - `comprobante_lineas(id uuid pk, comprobante_id, concepto text, importe_cents bigint)`.
  - All of them get the `auditar` trigger.
- Index `comprobantes(archivo_sha256, pagina)`.
- **RLS select:**
  - Gestora: `gestora_id = auth.uid()`.
  - Gerencia/contable: `tiene_alcance(empresa_id, null)`.
- **Writes only through RPCs:**
  - `crear_rendicion(p_empresa uuid, p_periodo date, p_honorario bigint, p_gestora uuid default null) returns uuid`: gestora → herself (ignores `p_gestora`); gerencia/contable with scope → `p_gestora` required and must be an active gestora.
  - `guardar_filas(p_rendicion uuid, p_filas jsonb)`: replaces the rows; only in `borrador`/`observada` and by the owner or the company.
  - `guardar_comprobante(p_rendicion uuid, p_datos jsonb) returns uuid`: upsert by `id` inside the jsonb, including its lines. It does not check for duplicates (Task 6 does).
  - `cambiar_estado_rendicion(p_rendicion uuid, p_estado text, p_motivo text, p_version int)`:
    - gestora: borrador/observada → enviada.
    - gerencia/contable: enviada → observada (motivo required) or enviada → aprobada.
    - Wrong version gives VERSION_CONFLICTO.
- **Storage:** bucket `comprobantes` (private), created inside `do $$ ... if exists schema storage ... $$`. Its policies on `storage.objects`: insert/select when the first folder of the name is a `rendicion_id` the user can see (gestora owner or scope).

- [ ] **Step 1: Write failing tests** in `tests/db/rendiciones.test.ts`:
  - "gestora crea su rendición y otra gestora no la ve"
  - "contable sin alcance no ve la rendición de Paris Autos"
  - "una rendición aprobada no se edita (TRANSICION_INVALIDA)"
  - "observar exige motivo y devuelve a la gestora"
  - "versión vieja da VERSION_CONFLICTO"
  - "no se puede crear dos rendiciones del mismo mes para la misma gestora y empresa (DUPLICADO)"
- [ ] **Step 2:** `npx vitest run tests/db/rendiciones.test.ts` → FAIL (relation does not exist).
- [ ] **Step 3:** Write the migration and extend the stub.
- [ ] **Step 4:** Run the full DB suite → all green.
- [ ] **Step 5:** Commit `feat(db): rendiciones, comprobantes y permisos`.

Decisión: módulo interno (pedido del dueño). Solo gerencia/contable con alcance completo sobre la empresa ven y operan rendiciones (RLS, RPC y Storage vía `puede_ver_rendicion`); `crear_rendicion` exige `p_gestora` (la gestora es solo referencia). Transiciones: borrador/observada → enviada → observada (motivo) | aprobada; aprobada → borrador (reabrir, motivo). Se aplicó con la migración `20261101000400_rendiciones_internas.sql` (no se editó la 000100).

Decisión: `guardar_filas` hace upsert por `id` (actualiza, crea y borra las que faltan) para no perder la asignación de comprobantes a filas; guardar filas o comprobantes no incrementa `version` (solo los cambios de estado).

### Task 2: Argentine amounts and normalization (pure)

**Files:**
- Create: `web/src/features/rendiciones/montos.ts`
- Create: `web/src/features/rendiciones/normalizar.ts`
- Test: `web/src/features/rendiciones/montos.test.ts`
- Test: `web/src/features/rendiciones/normalizar.test.ts`

**Interfaces — Produces:**
- `parsearMonto(texto: string): bigint | null` (cents).
- `normalizarNombre(s: string): string`: uppercase, no accents, single spaces, no dominio.
- `extraerDominio(s: string): string | null`: formats `AA111AA` and `AAA111`; the OCR fix O↔0 and I↔1 applies only to the positions that must be digits or letters.
- `normalizarDocumento(s): string | null`: digits only, 7–11 characters.

- [ ] **Step 1: Tests:**
  - `parsearMonto('$ 431539,69') === 43153969n`
  - `'1.163.855,24'` → `116385524n`
  - `'$ 508 614.29'` → `50861429n`
  - `'$ -5290,00'` → `-529000n`
  - `'32.500,00'` → `3250000n`
  - `'1.500'` → `150000n`
  - `'1.50.0'` → `null`
  - `''` → `null`
  - `extraerDominio('JOFRE FABRICIO ALEJANDRO AF869NV') === 'AF869NV'`
  - `extraerDominio('HEBRAL JUAN KQC140') === 'KQC140'`
  - `extraerDominio('AE3IIFY') === 'AE311FY'`
  - `normalizarNombre('Pérez  Juan Manuel AE197DG') === 'PEREZ JUAN MANUEL'`
- [ ] **Step 2:** `npx vitest run src/features/rendiciones` (in web/) → FAIL.
- [ ] **Step 3:** Implement. Decimal rule: the last `,` or `.` followed by exactly 2 digits at the end is the decimal separator; any other `.`, space or `,` is a thousands separator, and only if it groups in threes.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): montos argentinos y normalización para rendiciones`.

### Task 3: Parsers by document type (pure)

**Files:**
- Create: `web/src/features/rendiciones/parsers.ts`
- Create: `web/src/features/rendiciones/__fixtures__/recibo-dnrpa.txt`, `retencion-sellos.txt`, `factura-c.txt`, `planilla.txt`. Content: the sample texts as OCR would return them (with line breaks, some noise, fake names and DNI).
- Test: `web/src/features/rendiciones/parsers.test.ts`

**Interfaces — Consumes:** Task 2.

**Interfaces — Produces:**
- `type TipoComprobante = 'recibo_dnrpa'|'retencion_sellos'|'factura_honorarios'|'otro'`
- `clasificar(texto: string): TipoComprobante`:
  - "DNRPA"/"RECIBO" + "Control Web" → recibo_dnrpa
  - "Comprobante de Retenci" + "Sellos" → retencion_sellos
  - "FACTURA" + "Honorario" → factura_honorarios
- `interface Extraido { tipo; numero: string|null; emisor: string|null; emisor_cuit: string|null; fecha: string|null (ISO); total_cents: bigint|null; dominio: string|null; documento: string|null; nombre: string|null; lineas: {concepto: string; importe_cents: bigint}[]; dudosos: string[] }`
- `extraer(texto: string): Extraido`. Dispatches by type:
  - **DNRPA:**
    - número = N°Control Recibo
    - emisor = "Registro <número y nombre>"
    - fecha from "Fecha:"
    - total from "Total:"
    - lines from the concepts table (last amount of the row)
  - **Sellos:**
    - número = Número de Comprobante
    - emisor = "DPIP San Luis"
    - emisor_cuit of the agent
    - fecha = Fecha Operación
    - total = Total Retenido
    - dominio = Chapa Patente
    - nombre and documento of the parties involved
    - one line "Impuesto de Sellos"
  - **Factura honorarios:** número `0001-00010391`, fecha, total; nombre of "SEÑOR(es)".
  - Any field not found → null and its name goes into `dudosos`.
  - For DNRPA, if the sum of the lines differs from the total → `dudosos.push('lineas')`.
- `parsearPlanilla(texto: string): { nombre: string; dominio: string|null; pago_cents: bigint; honorarios_cents: bigint }[]`. A row is a line with a name followed by two amounts; it ignores the header and rows without two amounts.

- [ ] **Step 1: Tests with fixtures:**
  - recibo: `total_cents === 43153969n`, 9 lines whose sum is 43153969n (includes the 3 negative bonuses), `numero === '171648'`, `fecha === '2026-07-01'`.
  - sellos: `total_cents === 50861429n`, `dominio === 'AA111AA'`, `numero === '0000115277'`, `fecha === '2026-06-30'`.
  - factura: `total_cents === 3250000n`.
  - planilla: the first 3 rows give exactly `{nombre:'GODOY MARIO ESTEBAN', dominio:null, pago_cents:116385524n, honorarios_cents:3250000n}`, then the rows with AF869NV and LZI780.
  - unreadable text (`'%%% ###'`): `tipo 'otro'`, `total_cents null`, `dudosos` includes `'total'`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): lectura de recibos DNRPA, retenciones de sellos, facturas y planillas`.

### Task 4: Browser reading (PDF.js + Tesseract.js) and file hash

**Files:**
- Create: `web/src/features/rendiciones/lectura.ts`
- Create: `web/scripts/copiar-ocr.mjs`, which copies `tesseract.js-core` (wasm), `worker.min.js` and `spa.traineddata.gz` into `web/public/ocr/`. It runs as `prebuild` and `predev` in `web/package.json`.
- Modify: `web/package.json` (deps `pdfjs-dist`, `tesseract.js`, `@tesseract.js-data/spa`)
- Test: `web/src/features/rendiciones/lectura.test.ts` (only the pure part: `decidirOcr`, `hashArchivo` with Web Crypto under jsdom)

**Interfaces — Produces:**
- `hashArchivo(f: Blob): Promise<string>` (hex sha256).
- `interface PaginaLeida { pagina: number; texto: string; origen: 'texto_pdf'|'ocr'; confianza: number|null; imagen: Blob }`
- `leerArchivo(f: File, onProgreso?: (p: {pagina: number; total: number; etapa: 'texto'|'ocr'}) => void): Promise<PaginaLeida[]>`
  - **PDF:** for each page, get the text with PDF.js. If `decidirOcr(texto)` is true, render the page to a canvas at 2x and run OCR.
  - **Image:** OCR directly. Before the OCR, the canvas is converted to grayscale with contrast stretching, and the image is rotated using Tesseract's `detect` (0/90/180/270).
- `decidirOcr(texto: string): boolean`: true if it has fewer than 40 alphanumeric characters.
- **Implementation notes:**
  - The Tesseract worker loads lazily (dynamic import) with `workerPath/corePath/langPath` pointing to `/ocr/`.
  - Only one worker is reused; it is terminated when the screen unmounts.
  - The `rendiciones` chunk is loaded only on its route.

- [ ] **Step 1:** Tests:
  - `decidirOcr('')` true
  - `decidirOcr(textoReciboFixture)` false
  - `hashArchivo(new Blob(['abc']))` === `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement and add the dependencies.
- [ ] **Step 4:** PASS. `npm run build` OK; check that `dist/ocr/spa.traineddata.gz` exists and that the main bundle did not grow by more than 5 kB gzip.
- [ ] **Step 5:** Commit `feat(web): lectura de PDF y fotos en el navegador (PDF.js + Tesseract)`.

### Task 5: Linking rows and receipts to trámites (pure + query)

**Files:**
- Create: `web/src/features/rendiciones/vincular.ts`
- Test: `web/src/features/rendiciones/vincular.test.ts`

**Interfaces — Consumes:** Task 2.

**Interfaces — Produces:**
- `interface Candidato { id: string; numero: string; cliente: string; dominio: string|null; autorizado: boolean }`
- `vincularFila(f: {nombre; dominio}, candidatos: Candidato[]): { vinculo: 'auto'|'ambiguo'|'sin_vincular'; tramite_id: string|null; candidatos: string[] }`
  1. Exact dominio → auto.
  2. Otherwise, normalized name: exactly 1 match → auto; 2 or more → ambiguous; 0 → sin_vincular.
- `asignarComprobante(c: Extraido, filas: {id; nombre; dominio}[]): string | null`. Order: dominio, then document vs. the trámite's name, then normalized name. Ambiguous → null.

- [ ] **Step 1:** Tests:
  - dominio wins over name
  - two "SUAREZ OSCAR" with different second names do not get mixed up
  - exact duplicate name → 'ambiguo' with 2 candidates
  - a retención with dominio AA111AA is assigned to the row of that dominio
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(web): vinculación de filas y comprobantes con trámites`.

### Task 6: Duplicates and the three controls in the database

**Files:**
- Create: `supabase/migrations/20261101000200_controles_rendicion.sql`
- Test: add to `tests/db/rendiciones.test.ts`

**Interfaces — Produces:**
- `comprobantes_duplicados(p_rendicion uuid) returns table (comprobante_id uuid, motivo text, otro_id uuid, otra_rendicion uuid)`. The motivo is:
  - `'mismo_archivo'`: same sha256+pagina in another comprobante, in any rendición the user can see.
  - `'mismo_numero'`: same tipo+número+emisor/cuit, with número not null.
- `controles_rendicion(p_rendicion uuid) returns jsonb`. Fields:
  - **`importes`:**
    - `filas`: [{fila_id, nombre, pago_cents, comprobantes_cents, diferencia_cents, ok}]
    - `total_planilla_cents`
    - `debitado_habitualista_cents` = −sum of `movimientos.importe_cents` with tipo 'pago_tramite', not reverted, from the company's account, with `fecha_operacion` inside the month of `periodo`
    - `diferencia_cents`
    - `movimientos_sin_rendir`: [{movimiento_id, fecha, importe_cents, tramite_numero}] for the month's movements whose `tramite_id` is not linked to any row
    - `ok`
  - **`autorizados`:** `filas_no_autorizadas`: [{fila_id, nombre, motivo: 'sin_vincular'|'ambiguo'|'no_autorizado'}], `ok`.
  - **`honorarios`:** `cantidad_tramites`, `honorario_unitario_cents`, `esperado_cents` = cantidad × unitario, `facturado_cents` = sum of confirmed `factura_honorarios`/`factura_electronica`, `diferencia_cents`, `ok`.
- `ok` is true only if the difference is 0.
- The function does not modify anything.

- [ ] **Step 1:** Tests, with a carga, 2 trámites with final payment and a rendición of 2 rows:
  - everything matches → three `ok` true
  - one more peso on a receipt → `importes.ok` false with the exact difference
  - a payment in the month for a trámite outside the rendición → it shows up in `movimientos_sin_rendir`
  - a row without a trámite → `autorizados.ok` false
  - a missing invoice → `honorarios.diferencia_cents === -3250000`
  - the same file loaded twice → 'mismo_archivo'
  - the same número with a different file → 'mismo_numero'
- [ ] **Step 2–4:** FAIL → implement → full DB suite green.
- [ ] **Step 5:** Commit `feat(db): controles de rendición y detección de duplicados`.

### Task 7: Queries and mock

**Files:**
- Create: `web/src/features/rendiciones/consultas.ts`
- Modify: `web/e2e/mock-supabase.ts`
  - tables `rendiciones`, `rendicion_filas`, `comprobantes`, `comprobante_lineas`
  - RPCs from Tasks 1 and 6, with the same rules and the same messages
  - Storage `POST /storage/v1/object/comprobantes/*` stores the file in memory; `GET` returns it

**Interfaces — Produces:**
- `listarRendiciones(f: {empresa?: string; periodo?: string}): Promise<RendicionFila[]>`
- `obtenerRendicion(id): Promise<RendicionDetalle>` (rows, comprobantes with lines, signed URLs from `createSignedUrl` lasting 10 minutes)
- `crearRendicion(...)`, `guardarFilas(...)`, `subirComprobante(rendicion: string, f: File, hash: string): Promise<string /* path */>`. The path is `${rendicion}/${hash}.${ext}`, with upsert false; if the file already exists, the existing path is reused.
- `guardarComprobante(...)`, `controles(id): Promise<Controles>`, `duplicados(id)`, `cambiarEstadoRendicion(...)`
- Amounts travel as `::text`.

- [ ] Steps:
  - unit test of the response mapping (`consultas.test.ts`: bigint as text → string, never number)
  - implement
  - commit `feat(web): consultas de rendiciones`

### Task 8: Rendiciones screen (list and creation)

**Files:**
- Create: `web/src/pages/Rendiciones.tsx`
- Modify: navigation and routes in `web/src/app/` (entry "Rendiciones" for gestora, gerencia and contable; for the gestora, also a tab next to Mis trámites)
- Test: `web/e2e/rendiciones.spec.ts`

**Behavior:**
- **Table:** company, month, gestora, status (chip), rows, total and a control traffic light (3 dots).
- **Filters:** company and month.
- **"Nueva rendición"** opens a dialog with company, month (input `month`) and fee (defaults to 32.500,00). Gerencia/contable also choose the gestora.
- **Empty state:** "Todavía no hay rendiciones. Creá la del mes para empezar."

- [ ] **E2E:**
  - "gestora crea la rendición de julio 2026 de Paris Autos y la ve en la lista"
  - "no deja crear dos veces el mismo mes" (shows the DUPLICADO message)
- [ ] Commit `feat(web): pantalla de rendiciones`.

### Task 9: Load the planilla (Excel/CSV or photo/PDF)

**Files:**
- Create: `web/src/features/rendiciones/CargaPlanilla.tsx`
- Create: `web/src/features/rendiciones/importarExcel.ts` (exceljs). It detects the columns NOMBRE/PAGO/HONORARIOS case-insensitively and with or without accents.
- Test: `importarExcel.test.ts` (generates an xlsx in memory with exceljs)
- Test: E2E in `rendiciones.spec.ts`

**Behavior:**
- Drag-and-drop area or button. It accepts `.xlsx`, `.csv`, `.pdf`, `.jpg`, `.png`, and HEIC if the browser supports it; otherwise it shows a clear message.
- **Excel/CSV:** read directly.
- **Photo/PDF:** `leerArchivo` + `parsearPlanilla`.
- **Preview table:**
  - Editable rows: name, dominio, pago, honorarios.
  - A link column with a chip: Vinculado / Ambiguo (select among the candidates) / Sin vincular (search for a trámite by number or client).
  - Totals at the bottom.
- "Guardar planilla" → `guardarFilas`.

- [ ] **E2E:** "importa la planilla desde Excel: 3 filas, vincula 2 por dominio y marca 1 sin vincular; el total suma $ 1.864.715,82". The fixture xlsx is generated in the test.
- [ ] Commit `feat(web): carga de la planilla mensual`.

### Task 10: Batch receipt upload and split-screen review

**Files:**
- Create: `web/src/features/rendiciones/CargaComprobantes.tsx`
- Create: `web/src/features/rendiciones/RevisionComprobante.tsx`
- Test: E2E in `rendiciones.spec.ts`. In E2E, `leerArchivo` is replaced by the fixture text through `window.__ocrSimulado`, exposed only when `import.meta.env.MODE === 'test'`.

**Behavior:**
- **Multiple upload:** a queue with a progress bar per file (reading page X of Y, OCR %).
- **For each page:** hash → upload to Storage → read → classify → extract → assign to a row → `guardarComprobante` with `revision 'pendiente'`.
- **Duplicates:** shown with a warning and a link to the other comprobante. They are not blocked.
- **Review:**
  - **Left:** the image or PDF (signed URL) with zoom.
  - **Right:** type, número, fecha, issuer, total, dominio, row (select), and editable lines.
  - Every field listed in `dudosos` or empty is highlighted with an amber border and "Revisar".
  - **"Confirmar"** stores the confirmed data and `revision 'confirmado'`.
  - **Keyboard:** Enter confirms and moves to the next pending one.
- **Large files:** a file over 15 MB is rejected with a message. An unreadable one stays as `tipo 'otro'`, with everything to be filled in by hand.

- [ ] **E2E:**
  - "sube un recibo y una retención, los asigna a GODOY por nombre y dominio, y al confirmar quedan vinculados"
  - "el mismo archivo dos veces avisa duplicado"
  - "un archivo ilegible queda pendiente con todos los campos para completar"
- [ ] Commit `feat(web): carga de comprobantes con lectura automática y revisión`.

### Task 11: Controls panel and approval

**Files:**
- Create: `web/src/features/rendiciones/PanelControles.tsx`
- Modify: `web/src/pages/Rendiciones.tsx` (detail with tabs Planilla / Comprobantes / Controles)
- Test: E2E

**Behavior:** three cards with a traffic light. Each one shows the key figure and its difference, and expands into an actionable list:
- **Rows with a difference:** link that opens the row's comprobantes.
- **Movements without a rendición:** link to the trámite.
- **Unauthorized rows:** link to link them.
- **Honorarios:** "N trámites × $ 32.500,00 = $ X — facturado $ Y". The text "Monto a pagar de honorarios: $ esperado" appears only if the difference is 0.

Actions:
- **Gestora:** "Enviar a control".
- **Gerencia/contable:**
  - "Observar" (with motivo) and "Aprobar".
  - Approving with any control in red asks for confirmation with the text "Hay diferencias sin resolver. ¿Aprobar igual?".
  - Approving does not create any financial movement.

- [ ] **E2E:**
  - "contable ve los tres controles en verde y aprueba"
  - "con un peso de diferencia el control de importes queda en rojo y muestra la fila"
  - "aprobar con diferencias pide confirmación"
  - "la gestora no ve los botones de aprobar"
- [ ] Commit `feat(web): controles de la rendición y aprobación`.

### Task 12: Final review and documentation

**Files:**
- Create: `docs/OPERACION-rendiciones.md` (how to use it, limitations, which receipt types are recognized, and how to add a new type in `parsers.ts`)

- [ ] Full suites: DB, unit, E2E and `npm run build`.
- [ ] Mobile check with Playwright at 375 px on the list and the review.
- [ ] Commit `docs: guía de rendiciones`.
