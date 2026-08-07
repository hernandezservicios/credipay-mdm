# INFORME — FASE 4 (SaaS Comercial): Enforcement de límites por plan

> Estado: **CERRADA** — gate F4 completo en verde (typecheck + lint + vitest + build).
> Plan Maestro Consolidado v2.9 · Fases 1–3 ya cerradas (Moneda única, Configuración dinámica, Mora desde Backend).

---

## 1. Alcance

Asegurar que los límites del plan SaaS (`max_credits`, `max_users`, `max_webhooks`) se
apliquen en **todas las vías de creación** del sistema, con el mismo mecanismo
(`assertPlanLimit` → 403 `plan_limit_reached`) y estados de suscripción
(TRIAL/ACTIVE/PAST_DUE). El backend SaaS (planes, suscripción, facturación, gateways,
scheduler de expiración) ya estaba implementado y **no fue modificado** salvo la guarda
de cambio de plan.

## 2. Gaps detectados y corregidos

| # | Gap | Vía | Fix |
|---|---|---|---|
| 1 | `assertPlanLimit` solo en `clients/devices` y legacy `POST /credits` | La vía real de creación de créditos (`POST /loans`) eludía el límite `max_credits` | `loans.routes.ts:58` — `assertPlanLimit(tenantId, 'credits')` |
| 2 | Creación de usuarios sin límite `max_users` | `POST /users` (tenant destino) | `users.routes.ts:145` — `assertPlanLimit(dbTenantId, 'users')` solo si `tenant_id > 0` (no aplica a SUPER_ADMIN global) |
| 3 | Límite de webhooks inconsistente | `webhookService.createWebhook` usaba `getPlanMaxWebhooks` (solo suscripción `ACTIVE`, error 400 `badRequest`) | Unificado a `assertPlanLimit(tenantId, 'webhooks')` en la ruta (TRIAL/ACTIVE/PAST_DUE, 403) y eliminada la lógica del service |

## 3. Archivos modificados

| Archivo | Cambio Fase 4 |
|---|---|
| `server/src/routes/v1/loans.routes.ts` | `assertPlanLimit('credits')` en `POST /` (préstamo crea crédito) |
| `server/src/routes/v1/users.routes.ts` | `assertPlanLimit('users')` en `POST /` cuando el usuario pertenece a un tenant |
| `server/src/routes/v1/webhooks.routes.ts` | `assertPlanLimit('webhooks')` en `POST /` |
| `server/src/services/planService.ts` | `webhooks` añadido a `PlanResource`, `RESOURCE_COLUMN` (`max_webhooks`) y `SubscriptionUsage` + conteo en `getSubscriptionUsage` |
| `server/src/services/webhookService.ts` | Eliminados `getPlanMaxWebhooks` y el chequeo `webhook_limit_reached` (400) — ahora única fuente: `assertPlanLimit` (403) |
| `server/src/routes/v1/saas.routes.ts` | Guarda `plan_usage_exceeds_limits` del cambio de plan incluye `max_webhooks` |
| `src/components/SaaSAvView.tsx` | Medidor "Webhooks" en "Uso actual vs Límites del Plan" (grilla 5 columnas) + check `fits` incluye `max_webhooks` |
| `src/services/api.ts` | `SubscriptionUsage.webhooks: number` |

## 4. Evidencia del gate F4

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` (web + server) | **0 errores** |
| ESLint | `npm run lint` | **0 errors** · 26 warnings preexistentes (patrón fetch-on-mount `set-state-in-effect`/`exhaustive-deps` — aceptados) |
| Vitest (server) | `npm --prefix server test` | **8 files / 68 tests passed** (2.8–3.1s) |
| Build | `npm run build` | **PASS** 7.2s / 17.6s · warning chunk >500 kB no bloqueante (preexistente) |

## 5. Decisiones y desviaciones

- **Mecanismo único de límites**: los 4 recursos (`clients`, `credits`, `devices`, `users`,
  `webhooks`) pasan por `assertPlanLimit`, que lanza 403 `plan_limit_reached` y considera
  suscripciones `TRIAL`/`ACTIVE`/`PAST_DUE` (antes los webhooks solo miraban `ACTIVE` y
  devolvían 400).
- **Sin límite sin suscripción**: un tenant recién creado sin plan asignado no recibe
  restricciones (`getActiveSubscription` → null → return temprano), comportamiento
  idéntico al resto de recursos.
- **SUPER_ADMIN global excluido**: la creación de usuarios globales (`tenant_id` null) no
  valida límite de plan.
- **Webhooks sin doble validación**: `createWebhook` quedó con solo validación de URL;
  el límite lo aplica la ruta (única fuente de verdad, patrón consistente con clients/devices).
- El backend SaaS existente (planes CRUD, suscripción, billing, gateways, scheduler de
  expiración, auto-suscripción al crear tenant) **permanece intacto**: esta fase solo
  completó el enforcement faltante.

## 6. Cierre

Fase 4 **cerrada y estable**. Pendiente a decisión del usuario: siguiente fase del Plan
Maestro v2.9.

Fecha del cierre: 2026-08-07.
