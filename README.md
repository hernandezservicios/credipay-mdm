# CrediPay MDM

Sistema integral de préstamos para celulares con **bloqueo MDM (InovaGuard)** en Pesos Dominicanos (RD$).
Créditos por cuotas, mora fija por atraso (+3 días), bloqueo/desbloqueo automático del equipo, pagos en cascada y consola de administración multi-rol.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS (sin librería UI; componentes propios) |
| Backend | Node.js + Express + TypeScript (`tsx`) |
| Base de datos | MySQL 8 (WAMP) con migraciones SQL versionadas |
| Autenticación | Sesiones httpOnly (`sid`) + CSRF token + RBAC por roles y permisos |
| Tests | Playwright (E2E visual) + scripts PowerShell smoke (API) |

## Requisitos

- Node.js 18+ (probado con Node 25)
- MySQL 8 (probado con WAMP `C:\wamp64\bin\mysql\mysql8.4.7`)
- Navegador Chromium para los tests E2E

## Configuración

1. **Base de datos**: crea la base `credipay_mdm` y un usuario con privilegios (o usa `root` local):
   ```sql
   CREATE DATABASE credipay_mdm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. **Variables de entorno** — copia `server/.env.example` a `server/.env` y ajusta:
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=credipay
   DB_PASS=cambiar-esta-password
   DB_NAME=credipay_mdm
   APP_PORT=4000
   APP_URL=http://localhost:4000
   WEB_ORIGIN=http://localhost:3000
   SESSION_SECRET=<cadena aleatoria >= 32 caracteres>
   COOKIE_SECURE=false
   ```

3. **Instalar dependencias**:
   ```bash
   npm install
   npm --prefix server install
   ```

4. **Migraciones + seed demo** (crea el esquema, datos de ejemplo y credenciales canónicas):
   ```bash
   npm run migrate
   ```

5. **Arrancar** (dos procesos; el frontend en :3000 y la API en :4000):
   ```bash
   npm run dev
   # o por separado:
   npm run dev:web      # Vite en :3000
   npm --prefix server run dev   # API en :4000
   ```

## Credenciales demo

| Cuenta | Contraseña | Cambio obligatorio | Rol |
|--------|-----------|--------------------|-----|
| `admin@credipay.local` | `7xs8G8GJrTze9S` | Sí (al primer ingreso) | SUPER_ADMIN (global) |
| `demo.admin@credipay.local` | `Fase2Test2026!` | No | ADMIN |
| `demo.operador@credipay.local` | `Fase2Test2026!` | No | OPERADOR (sin permisos de edición) |
| `demo.gestor@credipay.local` | `7xs8G8GJrTze9S` | No | GESTOR |
| `demo.consulta@credipay.local` | `NuevaClave2026!` | No | CONSULTA (solo lectura) |

> Estas credenciales se restablecen con `npm run migrate` (migración `0007_credenciales_demo.sql`),
> junto con la configuración MDM InovaGuard del tenant demo.

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Frontend + backend a la vez (concurrently) |
| `npm run dev:web` | Vite en :3000 |
| `npm --prefix server run dev` | API en :4000 (watch) |
| `npm run migrate` | Aplica migraciones SQL pendientes + seed de usuarios |
| `npm run typecheck` | Typecheck frontend + backend |
| `npm run build` | Build de producción del frontend (Vite) |
| `npm run test:server` | Tests unitarios del backend (vitest) |
| `npm run test:e2e` | Suite E2E visual (Playwright, `e2e/visual.spec.ts`) |

## Tests

### E2E visual (Playwright)
La suite `e2e/visual.spec.ts` valida los flujos reales en navegador contra la API viva:
login y RBAC, cambio de contraseña obligatorio, flujo MDM completo (bloquear → desbloquear →
código offline → auditoría), pago en cascada, alta de préstamo, config MDM y renderizado de vistas.
Fase 4: aislamiento de tenant (403 al cambiar de empresa sin ser Super Admin global), sync masivo
InovaGuard → dispositivos (SYSTEM_SYNC), búsqueda sin guiones y switch de empresa del Super Admin.
Fase 5: vista de suscripción con historial y cambio de plan, límite de plan alcanzado (403
`plan_limit_reached`) y Panel Comercial del Super Admin.

Requisitos: servidor API en :4000, Vite en :3000 y Chromium instalado (`npx playwright install chromium`).
La suite respalda la BD antes (`mysqldump`) y la restaura al final (estado semilla intacto).
Los tests corren secuencialmente (`workers=1`) porque algunos rotan la contraseña del Super Admin.

> Si el `loginLimiter` del servidor bloquea la suite (muchos logins en poco tiempo), reinicia el
> servidor con `LOGIN_RATE_LIMIT=100 node --import tsx server/src/server.ts` (o en Windows:
> `set LOGIN_RATE_LIMIT=200 && npm --prefix server start`). El contador se resetea al reiniciar.

### Smoke API (PowerShell)
- `test_fase2.ps1` — multitenant, pagos en cascada y proxy MDM simulado.
  Respalda y restaura `tenant_settings.mdm_config` completo (credenciales InovaGuard incluidas).
- `test_fase3.ps1` — reconexión frontend ↔ API: clientes, dispositivos, MDM, RBAC y CSRF (22/22 PASS).

## Arquitectura

```
src/                  Frontend React (Vite, :3000)
  components/         Vistas y modales (ClientList, FinanceView, MdmApiConfigModal,
                      TenantSwitcher, Navbar, InovaGuardDevicesView, ...)
  services/api.ts     Cliente HTTP con sesión + CSRF
  services/inovaGuardApi.ts   Proxy hacia /api/v1/mdm/* del servidor
server/               Backend Express (tsx, :4000)
  migraciones/        0001_schema → 0009_saas_comercial (0008: SYSTEM_SYNC, 0009: billing_config)
  src/routes/v1/      auth, tenants, saas, clients, credits, installments, payments, mdm, devices, logs, audit
  src/services/       authService, paymentService (cascada + desbloqueo automático),
                      inovaGuardService (modo simulado/real), inventorySyncService (SYSTEM_SYNC),
                      planService (planes, límites, uso), repoService, tenantService
  src/middleware/     auth (sesión + RBAC), csrf, rateLimits, tenant (multitenant)
e2e/                  Suite Playwright (visual.spec.ts)
```

### Multi-tenancy y empresa activa (Fase 4)
- Toda la consulta filtra por `tenant_id`. El Super Admin global (`user.tenant_id IS NULL`) usa un
  **selector de empresa** en la Navbar (`TenantSwitcher`): `POST /api/v1/tenants/:id/switch` guarda el
  `tenant_id` en la sesión (`sessions.tenant_id`); sin empresa activa `requireTenant` responde `tenant_required`.
- Los usuarios de empresa que llaman al switch reciben `403 tenant_switch_forbidden`.
- **Sync masivo** (`POST /api/v1/mdm/sync-all`, permiso `devices.edit`): `inventorySyncService` trae el
  inventario InovaGuard, hace upsert por `inovaguard_id`, vincula clientes normalizando cédula sin guiones y
  registra `device_events` con `trigger_source = SYSTEM_SYNC`.
- Búsquedas de cartera/teléfono/cédula ignoran guiones y símbolos (comparación solo dígitos).

### SaaS Comercial (Fase 5)
- `GET /api/v1/saas/plans` — catálogo de planes activos con features.
- `GET /api/v1/saas/subscriptions/current` — suscripción vigente del tenant + uso (clientes,
  créditos, dispositivos, usuarios) vs límites del plan.
- `POST /api/v1/saas/subscriptions/change` — cambia de plan; bloquea el *downgrade* si el uso actual
  supera los límites del nuevo plan (`403 plan_usage_exceeds_limits`).
- `POST /api/v1/saas/subscriptions/renew` — registra pago de renovación (simulado) y extiende el
  período según el ciclo del plan (MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL).
- `GET|POST /api/v1/saas/billing/payments` y `/gateways` — historial de pagos y pasarela preferida
  por tenant (`tenant_settings.billing_config`; sin secretos en el navegador).
- `GET /api/v1/saas/platform/overview` — solo Super Admin global: empresas con plan y suscripción.
- **Enforcement de límites**: crear clientes, créditos o dispositivos por encima del tope del plan
  devuelve `403 plan_limit_reached` (0 = ilimitado).
- UI: pestaña **Suscripción & Planes** (plan actual, medidores de uso, historial, cambio de plan,
  renovación y pasarela) y **Panel Comercial** del Super Admin (entrar a cada empresa).

### Flujo MDM (bloqueo por mora)
1. Cuota vence → `PENDIENTE` → `VENCIDO` (días 0-2) → `ATRASADO` (+3 días).
2. Al pasar 3 días de atraso se aplica mora fija RD$200 y el motor envía orden **LOCK** a InovaGuard.
3. El pago en cascada del total adeudado dispara el **UNLOCK** automático (`autoUnlockOnPaid`),
   registrando `device_events`, `device_locks`/`device_unlocks` y auditoría.

## Estado

- Fase 1 (núcleo + cartera + MDM simulado): completada
- Fase 2 (multitenant + pagos en cascada + proxy MDM): completada
- Fase 3 (backend real + reconexión frontend): completada — smoke 22/22 y E2E visual 8/8
- Fase 4 (empresa activa en sesión, sync masivo SYSTEM_SYNC, búsquedas sin guiones): completada el 03/08/2026
- Fase 5 (SaaS comercial: planes, suscripción, límites, facturación y pasarelas): completada el 03/08/2026 — E2E 15/15
