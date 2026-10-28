# Operación


## E2E del frontend (Playwright)

Los specs de `web/e2e/` corren contra el dev server de Vite (`webServer` en `web/playwright.config.ts`,
puerto 5179) con la API HTTP de Supabase simulada por `page.route` (`web/e2e/mock-supabase.ts` y los
fixtures de `web/e2e/fixtures/`, incluida la sesión). El config fija `VITE_SUPABASE_URL` a un host
ficticio, que tiene prioridad sobre `web/.env.local`, así que ningún spec toca staging.

```
npx --prefix web playwright install chromium   # una sola vez
cd web && npx playwright test
```

Corrida contra staging (pendiente): requiere usuarios de prueba que hoy no existen y no deben crearse
sin autorización. Cuando existan, agregar un proyecto de Playwright que no monte el mock, use las
variables de `web/.env.local`, y haga login con credenciales de prueba leídas de un `web/.env.test`
no versionado (`E2E_CONTABLE_EMAIL`, `E2E_CONTABLE_PASSWORD`). Los specs crean datos reales: usar una
razón social de prueba y no correrlos contra producción.
