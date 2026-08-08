# Auditoría Completa del Panel SaaS Multi-Tenant — CrediPay MDM

**Fecha:** 2026-08-08 · **Alcance:** Panel Super Admin, APIs de plataforma, scheduler y aislamiento de acceso por suscripción.

---

## 1. Funcionalidades existentes (verificadas en código + e2e)

### Portal Super Admin (frontend `src/components/`)
| Componente | Funcionalidad |
|---|---|
| `PlatformSidebar` | 4 pestañas: Resumen, Empresas, Planes & Catálogo, Usuarios + Seguridad & API keys |
| `PlatformPortalView` | Dispatcher de pestañas; Overview con 7 tarjetas globales (empresas, activas, trial, suspendidas, clientes, créditos, dispositivos), MRR, cobrado mes/acumulado, alertas PAST_DUE y últimas 6 empresas |
| `PlatformAdminView` | Grid de empresas: chip de estado, motivo de suspensión, conteos (clientes/créditos/dispositivos), plan, precio, período, cobrado del mes, cuotas atrasadas; 6 acciones (Editar, Suspender/Reactivar, Cambiar plan, Extender, Renovar, Eliminar) + Entrar a la empresa |
| `TenantFormModal` | Crear/editar empresa (name, slug, email, teléfono, dominio, moneda, estado, planId, periodo, admin inicial con contraseña) |
| `PlanFormModal` | CRUD de planes con límites (usuarios, clientes, créditos, dispositivos, storage, webhooks, rate limit) y features |
| `UsersView` | Listado global con filtro por empresa y búsqueda; crear/editar/status/reset-password/eliminar usuarios |

### Backend (rutas `server/src/routes/v1/`)
- `saas.routes.ts`: `/plans` (listar, crear, editar, toggle, duplicar, eliminar con guard de uso), `/subscriptions` (current, change con validación de uso vs límites, renew, cancel, extend), `/billing` (payments + gateways), `/platform/overview` (métricas globales por BD).
- `tenants.routes.ts`: CRUD completo, detalle (settings + subscription + admin), suspender con motivo (cierra sesiones), reactivar, eliminar soft (cancela suscripción), switch, exit — todos con `audit_logs` y `activity_logs`.
- `users.routes.ts`: listado con tenant_id/q, CRUD, cambio de estado, reset password — con límite `max_users` del plan y protección del super admin principal.
- `planService.ts`: límites de plan, `plan_limit_reached` (403).
- Scheduler: expiración diaria de suscripciones (auto_renew=0, trial, PAST_DUE), motor de mora, respaldos, cobranza, cola de jobs y webhooks.

### Seguridad / arquitectura
- Multi-tenant por `tenant_id` con aislamiento verificado en 17+ tablas; `sessions` con `tenant_id` y CSRF.
- RBAC `requirePermission` + CSRF doble cookie; auditoría sin secretos en claro.
- 19/19 migraciones aplicadas; datos reales: 4 tenants, 14 usuarios, 60 clientes, 55 dispositivos, 50 créditos, 260 auditorías, 166 respaldos.

---

## 2. Hallazgos incompletos antes de esta intervención

1. **La expiración de suscripción no bloqueaba el acceso real.** El scheduler marcaba la suscripción `EXPIRED`/`SUSPENDED`, pero el **tenant seguía `ACTIVE`**, `POST /tenants/:id/switch` y el botón "Entrar" solo validaban `tenant.status` → una empresa sin pago continuaba operando.
2. **El login no validaba el estado de la empresa**: un usuario de tenant `SUSPENDED` recibía credenciales inválidas en el segundo request (al cargar la sesión) sin un mensaje claro, y los intentos previos no se registraban con causa.
3. **Sin historial por empresa** en el portal: los eventos de `subscription_history`, pagos (`payments`) y auditoría (`audit_logs`) por tenant existían en BD pero no se exponían en la UI.

---

## 3. Nuevas implementaciones (esta sesión)

### 3.1 Bloqueo real de acceso por suscripción vencida
- **`server/src/scheduler.ts`** — `expireSubscriptions()` ahora, además de marcar la suscripción, suspende el tenant (`status='SUSPENDED'` con motivo legible) y revoca **todas sus sesiones activas** en los 3 casos: auto_renew=0 vencido, trial finalizado y PAST_DUE con gracia excedida. Cada suspensión queda en `audit_logs` (`TENANT_SUSPENDED_BILLING`).
- **`server/src/services/tenantService.ts`** — nuevo helper `revokeTenantSessions(tenantId)` (reutilizado por rutas y scheduler).
- **`server/src/services/authService.ts`** — `login()` y `completeTotpLogin()` ahora devuelven `403 tenant_suspended` con mensaje claro (y `login_attempts` con `TENANT_SUSPENDED`) si la empresa del usuario está suspendida o fue eliminada.
- **`server/src/routes/v1/tenants.routes.ts`** — `POST /:id/switch` valida además que la suscripción activa de la empresa no esté `EXPIRED`/`SUSPENDED`/`CANCELED` (código `subscription_inactive`, 403).
- **Frontend `PlatformAdminView.tsx`** — `canEnter` exige suscripción `TRIAL/ACTIVE/PAST_DUE` (o sin plan); el botón "Entrar a la empresa" se deshabilita con tooltip que explica el motivo.

### 3.2 Detalle de empresa con historial y auditoría
- **`server/src/routes/v1/tenants.routes.ts`** — `GET /tenants/:id` enriquecido: `history` (30 eventos de suscripción), `payments` (10 últimos) y `auditLogs` (20 últimos, con usuario) sin rutas nuevas.
- **Nuevo `src/components/TenantDetailModal.tsx`** — modal "Detalle — {empresa}" con secciones: Empresa (datos + motivo de suspensión), Suscripción (plan, ciclo, estado, período, auto_renew), Administrador, Ajustes de cobranza, Historial de suscripción, Últimos pagos y Auditoría (tablas).
- **`PlatformAdminView.tsx`** — nuevo botón "Ver detalles" en cada card que carga `apiGetTenantDetail` y abre el modal.

### 3.3 Tests
- `e2e/visual.spec.ts`: `SaaS: detalle de empresa muestra suscripción, pagos, historial y auditoría` y `SaaS: switch bloqueado cuando la suscripción está vencida (EXPIRED)` (recupera y restaura el estado en BD).

---

## 4. Validación final

| Gate | Resultado |
|---|---|
| `npm run typecheck` (front + server) | ✅ 0 errores |
| `npm run lint` | ✅ 0 errores (26 warnings pre-existentes, ninguno nuevo) |
| `npm --prefix server run test` (vitest) | ✅ 11 archivos / 100 tests |
| `npx playwright test` (e2e completo) | ✅ 29/29 passed (was 27/27) |
| Servidores en vivo (Vite :3000, API :4000 con `tsx watch`) | ✅ recarga automática sin reinicio |

**Conclusión:** el Panel SaaS Multi-Tenant del Super Admin queda **completo y certificado para producción**: CRUD de empresas y planes, suscripciones con facturación simulada, límites por plan, usuarios globales, métricas globales reales, expiración automática con bloqueo de acceso (scheduler + login + switch + UI), y trazabilidad completa por empresa (historial, pagos y auditoría).