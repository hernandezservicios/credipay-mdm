SET NAMES utf8mb4;

-- ============================================================
-- 0019 - Suscripciones demo deterministas (Plan Maestro v2.9, FASE 9)
-- Los tenants demo (Financiera Alpha y Credit Plus) se sembraron vía SQL
-- (sin pasar por la creación por API), por lo que nunca tuvieron fila en
-- `subscriptions`. Esta migración inserta la suscripción TRIAL inicial con
-- el recibo estándar REC-SAAS-<tenant>-0001 (mismo formato que tenants.routes).
-- Idempotente: solo actúa si el tenant no tiene suscripción vigente.
-- ============================================================

INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, current_period_start, current_period_end, auto_renew, created_at, updated_at)
SELECT t.id, pl.id, 'TRIAL', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 1, NOW(), NOW()
  FROM tenants t
  JOIN plans pl ON pl.name = 'Básico' AND pl.deleted_at IS NULL
 WHERE t.slug IN ('alpha', 'creditplus')
   AND NOT EXISTS (
     SELECT 1 FROM subscriptions s
      WHERE s.tenant_id = t.id AND s.deleted_at IS NULL
   );