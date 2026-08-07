# INFORME — FASE 8 (Limpieza Total del Repositorio)

> Estado: **CERRADA** — gate F8 completo en verde (typecheck + lint + build + vitest + auditoría 0 hallazgos).
> Plan Maestro Consolidado v2.9 · Fases 1–7 ya cerradas (Moneda única, Config dinámica,
> Mora desde Backend, SaaS, IA de Cobranza, Seguridad AES-256-GCM, Rotación de Credenciales).

---

## 1. Resumen técnico

Eliminadas **todas las credenciales, IMEI, seriales y tokens reales del repositorio**.
Se sustituyeron por placeholders explícitos `TEST_*` / `DEMO-*` o redacción genérica,
en **todos** los archivos trackeados por git: migraciones SQL, scripts seed, datos demo
del frontend, componente de configuración MDM, tipos, tests, integración demo InovaGuard,
tests e2e y documentación interna de opencode.

Credenciales reales retiradas:
- `appClient` `d13cb763-1998-4cf8-9bb4-c6dbc8b513cb` → `TEST_APP_CLIENT`
- `secret` `kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm` → `TEST_SECRET`
- `bearerToken` `9164|Z6Qg7uS91iRNt4jVrwFAZx4MkyJivl1IOTp97mjE9540f41b` → `TEST_BEARER` (y formato genérico `<bearer-token>`)
- Password MySQL local `nf9sGFI1l4xJAhVu3mSHrLPD` (plan de opencode) → `<DB_PASSWORD>`
- IMEI/seriales de 4-5 dispositivos → `DEMO-IMEI-00000X` / `DEMO-SERIAL-00000X`
- IDs de dispositivo del panel InovaGuard (`3168`, `4177`, `5102`, `2891`, `6019`) → `DEMO-DEVICE-00000X`
- Resto de credenciales ya cubiertas en FASE 6 (cifrado AES) y FASE 7 (rotación).

## 2. Archivos modificados

| Archivo | Cambio FASE 8 |
|---|---|
| `server/migraciones/0003_seed_demo.sql` | MDM config → `TEST_*`; dispositivos → `DEMO-DEVICE/IMEI/SERIAL`; `device_events.imei` → `DEMO-IMEI-*`. |
| `server/migraciones/0007_credenciales_demo.sql` | (ya editada en sesión previa) MDM config del tenant 1 → `TEST_APP_CLIENT`/`TEST_SECRET`/`TEST_BEARER`. |
| `server/migraciones/0018_limpieza_credenciales.sql` | **NUEVA** migración idempotente que, para tenants DEMO (slug `%demo%` o email `%@%.local`), sustituye cualquier credencial residual en `mdm_config` por `TEST_*`. No toca tenants reales. |
| `server/scripts/seed-multitenant-test.ts` | MDM config → `TEST_*`; prefijos `IMEI_PREFIX`/`SERIAL_PREFIX` → `DEMO-IMEI`/`DEMO-SERIAL` (quedan IDs ficticios por tenant). |
| `server/src/integrations/inovaGuard/demo.ts` | `fallbackDevices` IDs → `DEMO-DEVICE-*`, IMEI → `DEMO-IMEI-*`; `FALLBACK_QR` (`D13CB763`→ `TEST-APP-CLIENT`, token de enrolamiento genérico); IMEI suelto de `fallbackDeviceItem` → `DEMO-IMEI-000006`. |
| `src/data/initialData.ts` | `INITIAL_MDM_CONFIG` → `TEST_*`; 4 dispositivos → `DEMO-DEVICE/IMEI/SERIAL`; `INITIAL_LOGS.imei` → `DEMO-IMEI-*`. |
| `src/types.ts` | Comentarios con credenciales reales eliminados (solo descripción genérica). |
| `src/components/MdmApiConfigModal.tsx` | Placeholders de inputs → `TYP-*`; resumen de credenciales → `TYP-...`/`••••`; comentario cURL del token → `<bearer-token>`. |
| `server/src/__tests__/crypto.test.ts` | Constante `SECRET` → valor TEST_ aleatorio; caso legado `9164|abc` → `legacy-plain-token`. |
| `server/src/__tests__/tenantService.test.ts` | JSON de prueba con credenciales reales → `TEST_APP_CLIENT`/`TEST_SECRET`/`TEST_BEARER`. |
| `e2e/visual.spec.ts` | API key inválida de prueba `cpk_ffff…` → `cpk_TEST_INVALID_KEY_…` (evita falso positivo hex). |
| `.opencode/plans/fase-a-b-entrada-build.md` | Password MySQL real en mysqldump → `<DB_PASSWORD>`. |

## 3. Riesgos encontrados y decisiones

1. **Backups locales con datos reales** (`server/backups/*.FULL.sql`, `pre_0015`, `pre-seed-*`):
   están **ignorados por git** (`.gitignore` ya cubre `server/backups/`, `*.sql.gz`, `*.dump`),
   no son trackeados y NO se modifican (son restaurables de la BD dev). El script de auditoría
   ahora los **excluye explícitamente** para reflejar únicamente el contenido versionado.
2. **Falsos positivos de auditoría**: el patrón `DOP.*america.*Santo` (moneda DOP + timezone)
   coincide con el seed demo y el script multitenant; está documentado en el script como
   **"irrelevante, no borrar"** (son datos demo legítimos, no secretos).
3. **Passwords demo de usuarios** (`7xs8G8GJrTze9S`, `Fase2Test2026!`, `NuevaClave2026!`):
   son contraseñas ficticias de cuentas `@credipay.local` (dominio inexistente), usadas por
   e2e/tests. Se **conservan** tal cual en 0007 y README: no son credenciales del negocio.
4. **No se modificó la lógica funcional** de las migraciones históricas: solo se sustituyeron
   valores sensibles. `0018` es idempotente (re-ejecutable) vía `DROP TEMPORARY TABLE IF EXISTS`.

## 4. Evidencias / Validaciones

| Gate | Comando | Resultado |
|---|---|---|
| Auditoría de secretos | `audit-secrets.ps1` (patrones: `9164\|`, `[a-f0-9]{40,}`, secret, appClient, `DOP.*america.*Santo`) | **0 hallazgos** en archivos trackeados (solo 2 falsos positivos `DOP.*america.*Santo` marcados como irrelevantes) |
| Typecheck | `npm run typecheck` (raíz: frontend + server) | **0 errores** |
| ESLint | `npm run lint` | **0 errors** · 26 warnings preexistentes (aceptados) |
| Build | `npm run build` | **PASS** 7.98s · warning chunk >500 kB no bloqueante (preexistente) |
| Vitest (server) | `npm --prefix server test` | **11 files / 100 tests passed** |
| Git | `git status --porcelain` | Solo los archivos listados en §2 modificados; `server/backups/` sin trackear |

## 5. Cierre

FASE 8 **cerrada y estable**: el repositorio versionado ya no contiene credenciales,
IMEI, seriales ni tokens reales; todo dato sensible se reemplazó por placeholders
`TEST_*`/`DEMO-*`/`<...>`, con la migración 0018 como red de seguridad idempotente para
entornos existentes. Pendiente a decisión del usuario: siguiente fase del Plan Maestro v2.9.

Fecha del cierre: 2026-08-07.
