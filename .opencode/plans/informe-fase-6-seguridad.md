# INFORME — FASE 6 (Seguridad): Cifrado AES-256-GCM de credenciales en reposo

> Estado: **CERRADA** — gate F6 completo en verde (typecheck + lint + vitest + build).
> Plan Maestro Consolidado v2.9 · Fases 1–5 ya cerradas (Moneda única, Config dinámica,
> Mora desde Backend, SaaS, IA de Cobranza).

---

## 1. Alcance

Cifrar en reposo (BD `tenant_settings.mdm_config`) las **credenciales InovaGuard**
(`appClient`, `apiKey`, `secret`, `bearerToken`) usando **AES-256-GCM**, con clave
derivada de una nueva variable de entorno obligatoria `APP_ENCRYPTION_KEY`, y garantizar
que ningún secreto salga del backend hacia frontend, logs, auditorías o backups.

## 2. Técnica implementada

- **Módulo** `server/src/utils/crypto.ts`: `encrypt`, `decrypt`, `isEncrypted`,
  `generateEncryptionKey`.
- **Formato** de almacenamiento: `enc:v1:<iv>:<tag>:<ciphertext>` con IV aleatorio de
  **12 bytes** y tag **GCM de 16 bytes**, codificación **Base64URL**.
- **Clave**: se deriva de la `APP_ENCRYPTION_KEY` (`sha256` → 32 bytes exactos); AES-256-GCM.
- **Compatibilidad retroactiva**: los valores legados en texto claro (sin prefijo `enc:v1:`)
  se leen tal cual y se re-cifran automáticamente en el siguiente `updateMdmConfig`.
  No requiere migración manual de datos.
- **Nunca se expone** ningún secreto: ni en `GET/PUT /mdm/config`, ni en
  `GET/PUT /config` (integraciones), ni en auditorías.

## 3. Archivos modificados/creados

| Archivo | Cambio FASE 6 |
|---|---|
| `server/src/utils/crypto.ts` | **NUEVO** — cifrado AES-256-GCM (`encrypt`, `decrypt`, `isEncrypted`, `generateEncryptionKey`). Formato `enc:v1:<iv>:<tag>:<cipher>` Base64URL; IV aleatorio 12B; tag GCM 16B; clave derivada sha256 de `APP_ENCRYPTION_KEY`. |
| `server/src/config/env.ts` | **NUEVO requerimiento** — `APP_ENCRYPTION_KEY` (zod, `.min(32)`) obligatoria al arrancar. |
| `server/.env.example` | Documentada `APP_ENCRYPTION_KEY` (generación sugerida vía `crypto.randomBytes(32).toString('hex')`). |
| `server/.env` | Añadida `APP_ENCRYPTION_KEY` real del entorno de desarrollo. |
| `server/vitest.config.ts` | `test.env` inyecta `APP_ENCRYPTION_KEY` + `SESSION_SECRET` de test (tests herméticos, sin depender del `.env` real). |
| `server/src/services/tenantService.ts` | `getMdmConfig` descifra (`decrypt` de campos cifrados); `updateMdmConfig` cifra las 4 credenciales **antes** de persistir. Helpers `encrypt/decryptMdmConfigForTest` (puro, para unit tests). |
| `server/src/routes/v1/mdm.routes.ts` | `PUT /mdm/config` ahora responde con `redactMdmConfig(merged)` (antes devolvía los secretos en claro). |
| `server/src/services/configService.ts` | **NUEVO** `redactIntegrationsForApi(config)` — opaca `apiKey/secret/token` de `integrations` en respuestas HTTP. |
| `server/src/routes/v1/config.routes.ts` | `GET /` y `PUT /:section` devuelven config redactada; en PUT `integrations` se descarta el placeholder `'********'` para no sobrescribir un secreto real. |
| `server/src/services/loanService.ts` | El bloqueo automático por mora (`autoLockOverdueDevice`) ya no lee `mdm_config` en bruto; usa `getMdmConfig(tenantId)` (descifrado). |
| `server/src/__tests__/crypto.test.ts` | **NUEVO** — roundtrip, formato/IV/tag, IV aleatorio, `isEncrypted`, legacy, tamper (tag y ciphertext), clave generada. |
| `server/src/__tests__/tenantService.test.ts` | Casos nuevos: cifra 4 credenciales, roundtrip, idempotencia, compatibilidad legado, credenciales vacías. |

## 4. Evidencia del gate F6

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `npm --prefix server run typecheck` | **0 errores** |
| ESLint | `npm run lint` | **0 errors** · 26 warnings preexistentes (fetch-on-mount; aceptados) |
| Vitest (server) | `npm --prefix server test` | **9 files / 86 tests passed** (12 nuevos F6) |
| Build | `npm run build` | **PASS** 6.5s · warning chunk >500 kB no bloqueante (preexistente) |

## 5. Superficie de seguridad revisada

- **Lectura en bruto de `mdm_config`**: única ruta restante que lo tocaba directamente
  (`loanService.ts`) migrada a `getMdmConfig`. Ahora todos los accesos pasan por
  `tenantService.ts` (descifrado).
- **Respuestas HTTP**: `GET /mdm/config` (redactado via `redactMdmConfig` ya existente),
  `PUT /mdm/config` (**nuevo redactado**), `GET /config` y `PUT /config` (integraciones
  redactadas con `redactIntegrationsForApi`). El frontend ya ocultaba visualmente
  (`isSecretKey`) pero la API lo enviaba en claro — ahora el backend nunca lo envía.
- **Logs/auditorías**: `recordAudit` de MDM registra solo `{ keys }` (nombres), no valores.
- **Multi-tenant**: cifrado/descifrado por `tenantId` vía `tenant_settings`; no hay cacheo
  global que mezcle secretos.

## 6. Bug corregido durante desarrollo

El borrador inicial de `crypto.ts` tenía una guardia de prefijo que comparaba
`parts[0] + ':' + parts[1]` contra `PREFIX.slice(0, PREFIX.length)` y un formato que
generaba doble colon (`enc:v1::…`). Ambos se detectaron con los unit tests de
`crypto.test.ts`; se corrigieron a `PREFIX = 'enc:v1'` + `isEncrypted`/`startsWith('enc:v1:')`
y desestructura de IV/tag/cipher en las posiciones correctas.

## 7. Cierre

FASE 6 **cerrada y estable**. Pendiente a decisión del usuario: siguiente fase del Plan
Maestro v2.9 (no avanzar hasta un nuevo informe o confirmación).

Fecha del cierre: 2026-08-07.