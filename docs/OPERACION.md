# Operación

Guía para el dueño del sistema. No hace falta saber programar: alcanza con copiar y pegar los comandos
en una terminal (en Windows, "Terminal" o "PowerShell") abierta en la carpeta del proyecto.

## 1. Publicar cambios en la base de datos (migraciones)

Las reglas del negocio viven en archivos dentro de `supabase/migrations/`. Cuando hay archivos nuevos,
hay que subirlos a Supabase una sola vez:

```
npx.cmd supabase login        # solo la primera vez; abre el navegador para entrar a Supabase
npx.cmd supabase link --project-ref <referencia-del-proyecto>   # solo la primera vez
npx.cmd supabase db push
```

- `db push` muestra qué migraciones va a aplicar y pide confirmación. Solo aplica las que faltan.
- Nunca se borran ni se editan migraciones ya publicadas: los cambios van siempre en un archivo nuevo.
- Hacerlo primero en el proyecto de prueba (staging) y, si todo anda, en el de producción.
- El archivo `supabase/config.toml` deja desactivado el alta libre de usuarios (`enable_signup = false`).
  Esa configuración no se sube con `db push`; en el panel de Supabase verificar en
  Authentication → Sign In / Providers que "Allow new users to sign up" esté apagado.

## 2. Invitar usuarios (lo hace el administrador)

Nadie puede registrarse solo. Para dar acceso a una persona:

1. Entrar a https://supabase.com, abrir el proyecto y ir a **Authentication → Users**.
2. Botón **Add user → Send invitation**, escribir el mail de la persona y enviar.
3. La persona recibe un mail, define su contraseña y ya puede entrar.
4. Asignarle rol y alcance (gerencia, contable, gestora; razón social y sucursal) desde una pantalla de
   administración que se suma en una etapa posterior; mientras tanto, pedírselo a quien mantiene el
   sistema. Sin rol asignado no ve nada.

Para quitar el acceso: en la misma pantalla, desactivar el perfil (no borrar el usuario, así queda el
historial de quién hizo cada cosa).

## 3. Pruebas automáticas

En cada `push` a GitHub corre el workflow `.github/workflows/ci.yml`: pruebas de base de datos (con un
PostgreSQL temporal, sin tocar Supabase), pruebas del frontend y armado de la web. Si algo falla,
GitHub muestra una cruz roja en el commit.

## 4. E2E del frontend (Playwright)

Los specs de `web/e2e/` corren contra el dev server de Vite (`webServer` en `web/playwright.config.ts`,
puerto 5179) con la API HTTP de Supabase simulada por `page.route` (`web/e2e/mock-supabase.ts` y los
fixtures de `web/e2e/fixtures/`, incluida la sesión). El config fija `VITE_SUPABASE_URL` a un host
ficticio, que tiene prioridad sobre `web/.env.local`, así que ningún spec toca staging.

```
npx --prefix web playwright install chromium   # una sola vez
cd web && npx playwright test
```

`web/e2e/escenario-integral.spec.ts` reproduce el escenario integral del spec (contable de San Luis,
gerencia de San Juan y gestora sobre Paris Autos) y verifica en pantalla los cuatro tríos de saldos.

Corrida contra staging (pendiente): requiere usuarios de prueba que hoy no existen y no deben crearse
sin autorización. Cuando existan, agregar un proyecto de Playwright que no monte el mock, use las
variables de `web/.env.local`, y haga login con credenciales de prueba leídas de un `web/.env.test`
no versionado (`E2E_CONTABLE_EMAIL`, `E2E_CONTABLE_PASSWORD`, y lo mismo para gerencia y gestora). Los
specs crean datos reales: usar una razón social de prueba y no correrlos contra producción.

## 5. Publicar la web en Cloudflare Pages (pendiente)

Lo tiene que hacer el dueño, porque requiere crear una cuenta propia:

1. Crear una cuenta gratuita en https://dash.cloudflare.com.
2. Ir a **Workers & Pages → Create → Pages → Connect to Git** y autorizar el repositorio de GitHub.
3. Configurar el build:
   - Comando de build: `npm --prefix web run build`
   - Carpeta de salida: `web/dist`
   - Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (se copian del panel de
     Supabase, en Project Settings → API). La "anon key" es pública por diseño; nunca cargar la
     "service_role key".
4. Guardar. Cada push a la rama principal publica una versión nueva.
5. En Supabase, Authentication → URL Configuration, cargar la dirección publicada como "Site URL"
   para que los mails de invitación lleven a la web correcta.

Pendiente también: probar la dirección publicada con un usuario gestora desde un celular real
(pantalla "Mis trámites").
