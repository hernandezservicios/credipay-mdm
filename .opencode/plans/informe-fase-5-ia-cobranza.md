# INFORME — FASE 5 (IA de Cobranza): Mensajes y motor con configuración dinámica del tenant

> Estado: **CERRADA** — gate F5 completo en verde (typecheck + lint + vitest + build).
> Plan Maestro Consolidado v2.9 · Fases 1–4 ya cerradas (Moneda única, Config dinámica,
> Mora desde Backend, SaaS). No se avanzó a FASE 6 hasta cerrar este informe.

---

## 1. Alcance

Hacer que toda la información monetaria y de mora producida por la **IA de cobranza**
(scoring + mensajes) provenga dinámicamente de `getPlatformConfig(tenantId)` y de la
configuración del tenant, eliminando cualquier valor hardcodeado (RD$ / USD / montos fijos /
`toLocale`) de los servicios de IA.

Servicios objetivo (por contrato de fase):
`server/src/services/aiMessagingService.ts` y `server/src/services/collectionService.ts`.

## 2. Archivos modificados

| Archivo | Cambio FASE 5 |
|---|---|
| `server/src/utils/money.ts` | **NUEVO** — formateador central de montos server-side `formatMoney(value, currency, withSymbol)`; espejo de `src/utils/formatters.ts` (FASE 1) usando symbol/thousand_separator/decimal_separator/decimals del `CurrencyConfig` del tenant. |
| `server/src/services/aiMessagingService.ts` | `generateAiMessage` ahora recibe `AiMessageContext { currency, overdue }`. Eliminados `toLocale('es-DO')`, símbolos `RD$`/`US$` y montos fijos del texto. `moraShowAmount` usa el sumatorio real `(totalPenalty)` o `overdueConfig.fixed_amount` si es mora FIJA. `overdueRuleText(cfg, currency)` describe regla FIXED/PERCENTAGE en lenguaje natural. Mensajes ATRASADO/RECORDATORIO con `grace_days` de la config. |
| `server/src/services/collectionService.ts` | `runCollectionEngine` obtiene `getPlatformConfig(tenantId)` **una sola vez por corrida** y construye el `msgCtx` (moneda + mora) para `generateAiMessage`. No hay montos fijos dentro del servicio; multitenant intacto (config por tenantId). |
| `server/src/__tests__/aiMessagingService.test.ts` | Tests actualizados a la nueva firma + casos nuevos: divisa distinta (USD) cambia el mensaje; mora FIJA define desde `overdueConfig.fixed_amount` (no 200); mora PORCENTUAL describe regla; `overdueRuleText` FIXED/PERCENTAGE. |

## 3. Evidencia del gate F5

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` (web + server) | **0 errores** |
| ESLint | `npm run lint` | **0 errors** · 26 warnings preexistentes (patrón fetch-on-mount `set-state-in-effect`/`exhaustive-deps` — aceptados) |
| Vitest (server) | `npm --prefix server test` | **8 files / 72 tests passed** (2 nuevos: config dinámica + overdueRuleText) |
| Build | `npm run build` | **PASS** 8.7s · warning chunk >500 kB no bloqueante (preexistente) |

## 4. Verificación de hardcodes (solo servicios de IA)

- `aiMessagingService.ts`: **0 referencias** a `RD$`/`US$`/`200`/`toLocale` en lógica (la única mención es un comentario de documentación).
- `collectionService.ts`: **0 referencias** a `RD$`/`US$`/montos fijos; toda cantidad proviene del PEYCOUNT de cuotas en BD o del `overdueConfig`.
- `notifService.ts`, `loanService.ts`, `paymentService.ts`: conservan `RD$`/`toLocale` en descripciones de auditoría/notificaciones — **fuera del alcance de FASE 5** (no son IA de cobranza).

## 5. Decisiones y desviaciones

- **Cómo se obtiene la config**: `getPlatformConfig(tenantId)` se consulta en `runCollectionEngine` una vez por corrida (no por cliente), evitando N+1 y garantizando que todos los mensajes de una misma corrida usen la misma moneda/mora del tenant.
- **`moraShowAmount`**: si `totalPenalty` (sumatorio SQL) es 0 pero el plan es mora FIJA, se muestra `overdueConfig.fixed_amount` — ya no el 200 hardcodeado.
- **`overdueRuleText` público** para permitir reutilizar la regla en otras pantallas (patrón paralelo a `src/utils/overdue.ts` del FE).
- **Sin cambios de DB ni de rutas**: solo servicios internos; la API de colección no expande el contrato.

## 6. Cierre

FASE 5 **cerrada y estable**. Pendiente a decisión del usuario: siguiente fase del Plan Maestro v2.9.

Fecha del cierre: 2026-08-07.