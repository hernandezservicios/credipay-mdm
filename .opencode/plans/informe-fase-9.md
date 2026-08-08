# INFORME — FASE 9 (E2E sobre UI Real, Tenant 5 "Financiera Alpha")

> Estado: **CERRADA** — gates completos en verde: typecheck + lint (0 errores) + build + vitest 100/100
> + Playwright 27/27 (21 visual + 6 faseF/debug/ui-audit).
> Plan Maestro Consolidado v2.9 · Fases 1–8 ya cerradas (Moneda única, Config dinámica, Mora desde
> Backend, SaaS, IA de Cobranza, Seguridad AES-256-GCM, Rotación de Credenciales, Limpieza repo).

---

## 1. Resumen técnico

La suite `e2e/visual.spec.ts` se reescribió/escaló para operar **sobre la base de datos real del
tenant 5 "Financiera Alpha"** (no los tenants demo 1-4), y se ajustó a la **UI real** renderizada por
los componentes de producción (textos, botones y diálogos verificados contra `src/` y contra el
backend vía MySQL), eliminando toda dependencia de la UI antigua o de datos inventados.

Datos reales de tenant 5: **5 empresas demo** (5 Financiera Alpha, 6 Credit Plus,
7 Prueba Live Panel, 8 Expira Test), **30 dispositivos**, 30 créditos, cuotas con estados reales
(81 PENDIENTE / 122 PAGADO / 3 VENCIDO / 24 ATRASADO / 16 CANCELADO). Clientes de aserción:
Carmen Valenzuela (cédula `001-11001781-5`, dispositivo 66 **LOCKED**, unlock_code 46328, crédito
`CR-ALPHA-0014` ACTIVE 20,100.00 con 6 cuotas), Carlos Mendoza (device UNLOCKED), Mariana Santana,
Julio Espinal — verificados vía SQL directo antes de codificar las aserciones.

## 2. Correcciones aplicadas al stack (lo que no era "test", era el bug)

| Origen | Corrección/Decisión |
|---|---|
| Toast de cambio de plan (SaaS) | El texto real en `App.tsx` es `✅ Plan actualizado: <plan>.` — se alineó el matcher del test a `/Plan actualizado: Profesional/`. |
| Vista de planes SaaS | En la UI real la vista muestra `Cambiar de Plan`, botones `Cambiar a <plan>` y confirmación `Sí, Cambiar Plan` — el test se reescribió contra esos textos. |
| Super Admin: panel por defecto | Es `Resumen de Plataforma` (no `Panel Comercial — Empresas & Suscripciones`): `loginGlobal()` se ajustó a la landing real, y los tests ingresan a las empresas desde la lista `Empresas` → botón `Entrar a la empresa`. |
| Tenant switch (Super Admin global) | Navegación real: tab `Empresas` → tarjeta de `Financiera Alpha` → `Entrar a la empresa` → dashboard del tenant. Aserción corregida al heading real `Motor de Bloqueo MDM Automático y Control de Mora (Server-Side)` (DashboardStats.tsx). |
| Diálogo de éxito de cobro | El diálogo tiene 2 botones `Cerrar` (X del ModalShell con `aria-label="Cerrar"` y botón footer de texto `Cerrar`) — se cierra con `getByText('Cerrar', { exact: true })`. |
| Historial de cuotas | Ventana real se titula `Historial de Cuotas y Cobranza` y cierra con `Cerrar Ventana`. |
| Wizard de préstamo | Cliente de ejemplo real: `Mariana Santana` (dialog de búsqueda `Buscar por nombre…`). |
| SQL de seeding directo en tests | Los 3 tests que plantan datos vía `execSync` mysql ahora apuntan a `tenant_id = 5` y a columnas reales (`clients.full_name`, `devices.serial_number` , `devices.mdm_status`…). |
| 401 fantasma del arranque | El app llama `GET /auth/me` al boot sin sesión (401 esperado que Chrome registra como console.error). `ui-audit.spec.ts` ignora ese `status of 401`, conservando captura de errores reales. |
| `debug-401.spec.ts` | Corregido `const outDir = 'test-results'` (eliminado `__dirname` — ESM); 1/1 verde. |

## 3. Investigación con traces (trazado)

El último fallo persistente ("Tenant switch") se investigó con `--trace on`: se extrajo
`0-trace.network` y se confirmó que **el login del Super Admin global funciona** (`POST /api/v1/auth/login
→ 200`, cookie `sid` + `csrf` presentes, `GET /api/v1/tenants → 200`) y que el único problema era la
aserción de heading textual (`/Dashboard/` no existe en la vista destino;
el real es `Motor de Bloqueo MDM …`). Esa aserción se reemplazó en ambos tests (Tenant switch y
Panel Comercial) y la suite completa quedó verde.

## 4. Evidencias / Validaciones

| Gate | Comando | Resultado |
|---|---|---|
| TypeScript (front + server) | `npm run typecheck` | ✅ 0 errores |
| Lint | `npm run lint` | ✅ 0 errores (26 warnings pre-existentes) |
| Build | `npm run build` | ✅ built in 22.41s (warn chunk >500 kB) |
| Server unit/integration | `npm --prefix server test` | ✅ 11 files / 100 tests |
| E2E visual | `npx playwright test e2e/visual.spec.ts` | ✅ **21/21** (1.9m) |
| E2E Fase F | `npx playwright test e2e/faseF.spec.ts` | ✅ 4/4 |
| E2E debug-401 | `npx playwright test e2e/debug-401.spec.ts` | ✅ 1/1 |
| E2E ui-audit | `npx playwright test e2e/ui-audit.spec.ts` | ✅ 1/1 (matriz 375/768/1440 × claro/oscuro) |

## 5. Decisión de orden de tests (registro)

Los tests corren con `workers=1` en orden de declaración: el test "Super Admin: cambio de
contraseña obligatorio (mustChangePassword)" es el primero, rota la contraseña a
`NuevaClaveE2E2026!` y todos los tests posteriores de Super Admin la usan explícitamente (se deja
documentado en el código). El dump/restore de BD (`mysqldump` en `beforeAll`, restore en `afterAll`)
garantiza el estado inicial por corrida.

## 6. Herramientas de continuidad

Las correcciones NO tocaron lógica del backend ni del frontend: **únicamente los specs e2e y
`ui-audit.spec.ts`**. El stack activo (Vite :3000, API :4000, MySQL `credipay_mdm`) quedó operativo
para FASE 10 (auditoría UI/UX extendida y capturas de pantalla ya generadas en `e2e/screenshots/`).