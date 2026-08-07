SET NAMES utf8mb4;

-- ============================================================
-- 0018 - Limpieza de credenciales demo (Plan Maestro v2.9, FASE 8)
-- Sustituye cualquier credencial residual en mdm_config de tenants
-- DEMO (slug con '-demo' o email @algo.local) por placeholders TEST_*.
-- Idempotente (re-ejecutable) y sin efecto sobre tenants reales.
-- ============================================================

-- Detectar tenants demo en una tabla temporal (seguro y re-ejecutable).
DROP TEMPORARY TABLE IF EXISTS _demo_tenants;
CREATE TEMPORARY TABLE _demo_tenants AS
  SELECT id
    FROM tenants
   WHERE slug LIKE '%demo%'
      OR email LIKE '%@%.local';

-- Limpiar mdm_config de los tenants demo (API_KEY/APP_CLIENT/SECRET/BEARER).
-- JSON_SET sobre filas demo: re-ejecutable, no toca tenants reales.
UPDATE tenant_settings ts
JOIN _demo_tenants d ON d.id = ts.tenant_id
SET ts.mdm_config = JSON_SET(
      COALESCE(ts.mdm_config, JSON_OBJECT()),
      '$.apiKey', '',
      '$.appClient', 'TEST_APP_CLIENT',
      '$.secret', 'TEST_SECRET',
      '$.bearerToken', 'TEST_BEARER'
    )
WHERE JSON_UNQUOTE(JSON_EXTRACT(ts.mdm_config, '$.appClient')) IS NOT NULL;

DROP TEMPORARY TABLE IF EXISTS _demo_tenants;