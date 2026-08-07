# INFORME — FASE 7 (Rotación de Credenciales InovaGuard)

> Estado: **CERRADA** — gate F7 completo en verde (typecheck + lint + build + vitest).
> Plan Maestro Consolidado v2.9 · Fases 1–6 ya cerradas (Moneda única, Config dinámica,
> Mora desde Backend, SaaS, IA de Cobranza, Seguridad AES-256-GCM).

---

## 1. Resumen técnico

Implementada la **rotación segura de credenciales InovaGuard por tenant** sin necesidad de
reiniciar el servidor. Al guardar la configuración MDM con cambios en `appClient`,
`apiKey`, `secret` o `bearerToken`, el backend:

1. Cifra las credenciales (FASE 6),
2. Persiste los cambios en `tenant_settings.mdm_config`,
3. Invalida **toda la caché del tenant** (Bearer Token, Snapshot, Dirty, Inflight),
4. El siguiente request fuerza auto-login contra InovaGuard → nuevo Bearer,
5. Nueva fotografía (devices + balance + licences) y nueva sincronización automática.

La invalidación es **exclusiva del tenant afectado**: el Bearer, snapshot y estado de
sincronización de los demás tenants permanecen intactos (estado en `Map`s keyed por
`tenantId` + generación por tenant).

## 2. Archivos modificados

| Archivo | Cambio FASE 7 |
|---|---|
| `server/src/integrations/inovaGuard/client.ts` | **NUEVO** `invalidateTenantTokens(tenantId)` — elimina solo el Bearer del tenant (no existe refresh token en el flujo actual; se documenta en el código). **NUEVO** `getStoredToken(tenantId)` (lectura acotada para diagnóstico/tests). |
| `server/src/integrations/inovaGuard/service.ts` | **NUEVO** `invalidateTenant(tenantId)` — limpieza total del tenant: tokens + snapshot + dirty + inflight + **generación incrementada** (un inflight en vuelo que resuelva después de la invalidación NO repuebla la caché). `loadSnapshot` valida la generación antes de persistir el snapshot. |
| `server/src/integrations/inovaGuard/index.ts` | Re-exporta `invalidateTenant`, `invalidateTenantTokens`, `getStoredToken`. |
| `server/src/services/tenantService.ts` | `updateMdmConfig()` compara las 4 credenciales antes/después del merge; si cambió alguna, ejecuta `invalidateTenant(tenantId)` tras persistir (hook automático, sin reinicio). |
| `server/src/__tests__/inovaGuardFase7.test.ts` | **NUEVO** — 9 tests: tokens por tenant, snapshot cacheado + reconstrucción tras invalidar, aislamiento entre tenants, dirty sin borrar token, recarga forzada, error 401 controlado, nuevo Bearer vía auto-login. |
| `server/src/__tests__/tenantFase7.test.ts` | **NUEVO** — 6 tests del hook: sin cambio de credenciales conserva token; cambio de `secret`/`appClient`/`bearerToken` invalida; patch sin secretos no rompe; persistencia cifrada; defaults sin secretos. |

## 3. Riesgos encontrados

1. **Inflight obsoleto repoblando caché**: si se invalidaba mientras un snapshot estaba en
   vuelo, su resolución re-llenaba la caché con datos de credenciales viejas. Solución:
   contador de **generación por tenant** — `invalidateTenant` incrementa la generación y
   `loadSnapshot` descarta el resultado si la generación cambió.
2. **Import circular potencial** (`tenantService` ↔ `inovaGuard`): se resolvió manteniendo
   los imports de tipos (`import type MdmConfig`) en las capas de integración; el runtime
   import es unidireccional `tenantService → inovaGuard`. Verificado con typecheck.
3. **Error 401/403 en el reintento**: si el login con las credenciales rotadas falla, se
   devuelve error controlado (`HTTP 401`) sin simular éxito y sin borrar información
   histórica (los datos en BD y snapshots previos no se tocan). El token viejo se descarta
   (no se vuelve a usar).
4. **Compatibilidad con `invalidateInovaGuardCache` (dirty)**: se conserva como mecanismo
   ligero para cambios de config no-credenciales (baseUrl, endpoints); `invalidateTenant`
   es la invalidación fuerte para rotación. Ambos conviven.

## 4. Evidencias / Validaciones

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `npm --prefix server run typecheck` | **0 errores** |
| ESLint | `npm run lint` | **0 errors** · 26 warnings preexistentes (fetch-on-mount; aceptados) |
| Build | `npm run build` | **PASS** 6.69s · warning chunk >500 kB no bloqueante (preexistente) |
| Vitest (server) | `npm --prefix server test` | **11 files / 100 tests passed** (15 nuevos F7) |

## 5. Cierre

FASE 7 **cerrada y estable**: rotación automática sin reinicio, caché invalidada solo del
tenant afectado, tokens antiguos descartados, nuevo Bearer + snapshot + sync generados sin
contaminación entre tenants. Pendiente a decisión del usuario: siguiente fase del Plan
Maestro v2.9 (no avanzar hasta un nuevo informe o confirmación).

Fecha del cierre: 2026-08-07.