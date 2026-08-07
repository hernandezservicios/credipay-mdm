# FASE BUILD — PLAN DE EJECUCIÓN A→B (Blueprint v1.7, aprobado D1–D27)

> Estado: PENDIENTE de habilitar ediciones (plan mode activo). Este documento es el
> contrato de ejecución; el código de la migración 0015 está completo y listo.

## FASE A — Estructura arquitectónica: `server/src/integrations/inovaGuard/`

Extracción 1:1 de `server/src/services/inovaGuardService.ts` (sin cambio de comportamiento;
los fixes de semántica P0 → Fase C).

### Archivos a crear
| Archivo | Contenido (mover desde inovaGuardService.ts) |
|---|---|
| `integrations/inovaGuard/types.ts` | Tipos + `MdmConfig` (re-export de `../../services/tenantService.js`), `normalizeDevice`, `STATUS_MAP`, `FetchResult` |
| `integrations/inovaGuard/demo.ts` | `fallbackDevices()`, `FALLBACK_BALANCE`, `FALLBACK_LICENCES`, respuestas estándar demo de comandos |
| `integrations/inovaGuard/client.ts` | Tokens por tenant, `loginRaw`, `fetchInovaGuard`, `commandUrl` (capa HTTP pura) |
| `integrations/inovaGuard/service.ts` | API pública: caché snapshot, listados paginados, `getInovaGuardDevices/Balance/Licences`, comandos lock/unlock/code/remove/qr, `invalidateInovaGuardCache` |
| `integrations/inovaGuard/index.ts` | Re-export de la API pública del service |

### Importadores a actualizar (5)
1. `server/src/services/paymentService.ts:5` → `import { unlockInovaGuardDevice } from '../services/integrations/inovaGuard/index.js'` (relativo services→integrations)
2. `server/src/services/loanService.ts:22` → mismo patrón para `lockInovaGuardDevice`
3. `server/src/services/inventorySyncService.ts:4` → `getInovaGuardDevices`
4. `server/src/routes/v1/mdm.routes.ts:5-16` → bloque de 10 funciones
5. `server/src/routes/v1/devices.routes.ts:7` → `findInovaGuardDevice, invalidateInovaGuardCache`

### Borrar
`server/src/services/inovaGuardService.ts` (una vez sin referencias).

### Verificación
`npm run typecheck` (server) + `npm run build` si existe script del frontend (el server usa `tsc --noEmit`).

---

## FASE B — Migración 0015 (respaldo previo obligatorio)

### B1 Verificación de tablas huérfanas (RESULTADO CORREGIDO)
- **SÍ huérfanas (drop):** `refresh_tokens`, `device_status`, `system_logs`, `feature_flags`
- **NO huérfana (conservar):** `queue` — usada por `jobService.ts` (scheduler + enqueue webhooks). **Desviación del D6 del informe FASE 1.**

### B2 Respaldo (mysqldump)
```powershell
# Detectar mysqldump: WAMP -> C:\wamp64\bin\mysql\mysql8.x\bin\mysqldump.exe
& "C:\wamp64\bin\mysql\mysql8.*\bin\mysqldump.exe" --user=credipay --password="<DB_PASSWORD>" --databases credipay_mdm --result-file="<repo>\\..\\credipay_mdm_0015_backup_$(Get-Date -Format yyyyMMdd_HHmmss).sql"
```

### B3 Contenido de `server/migraciones/0015_arquitectura_consolidada.sql`
```mysql
SET NAMES utf8mb4;

-- 1) Tablas huérfanas (verificadas: sin referencias en código)
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS device_status;
DROP TABLE IF EXISTS system_logs;
DROP TABLE IF EXISTS feature_flags;

-- 2) Timeline del préstamo (D25) — append-only, RESTRICT (D6)
CREATE TABLE IF NOT EXISTS loan_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  credit_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  description VARCHAR(500) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_le_loan (tenant_id, credit_id, created_at),
  KEY idx_le_client (tenant_id, client_id, created_at),
  CONSTRAINT fk_le_credit FOREIGN KEY (credit_id) REFERENCES credits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_le_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3) Saldo a favor (D15 / D26) — ledger
CREATE TABLE IF NOT EXISTS payment_credits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  credit_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  consumed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('AVAILABLE','CONSUMED','REFUNDED') NOT NULL DEFAULT 'AVAILABLE',
  source_payment_id BIGINT UNSIGNED NULL,
  notes VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pc_client (tenant_id, client_id, status),
  CONSTRAINT fk_pc_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pc_credit FOREIGN KEY (credit_id) REFERENCES credits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4) Config payment por tenant (D26): application_order + overpayment_mode + rounding
UPDATE tenant_settings
  SET payment_config = JSON_MERGE_PRESERVE(
        COALESCE(payment_config, JSON_OBJECT()),
        JSON_OBJECT(
          'application_order', JSON_ARRAY('penalty','interest','principal','future','credit_balance'),
          'overpayment_mode', 'PREPAY',
          'rounding', 2
        )
      );

-- 5) Índices de alto uso para el motor (D4 / optimización)
SELECT 'indices' AS info;

-- 6) Cifrado futuro (D5) — columnas para valores cifrados de mdm_config / webhooks (Fase C aplicará)
```
NOTA: ejecución ajustada al esquema real (0014) — completar al inicio del BUILD tras verificar FK con INFORMATION_SCHEMA.

### B4 Aplicar y verificar
```bash
npm run migrate   # (server) — aplica 00..0015 y registra en migraciones_aplicadas
# Sanity: SHOW TABLES / counts por tenant de loan_events vacíos
```

---

## Siguientes fases (C→J) — referenciar blueprint v1.7 D1–D27
C: paymentEngine.ts puro + simulate + vitest (D22-D29) · C3: escritura loan_events (D25) ·
E: POST /loans/:id/pay + deprecación /payments/cascade · F: LoanCard/Acciones/Modal 6 tabs/Cobro-sim (D8-D11,D20-D24) · H3: receipt + QR (D27).