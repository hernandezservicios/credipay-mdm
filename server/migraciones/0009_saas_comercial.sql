-- ============================================================
-- CrediPay MDM - Fase 5
-- Migración 0009 - SaaS Comercial
-- 1) billing_config JSON en tenant_settings: configuración de
--    pasarela de pago y método preferido por tenant.
-- 2) Pago inicial de ejemplo para que el historial de facturación
--    no esté vacío en la vista de suscripción.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE tenant_settings
  ADD COLUMN billing_config JSON NULL AFTER notifications;

UPDATE tenant_settings
  SET billing_config = JSON_OBJECT(
        'preferredGateway', 'STRIPE',
        'gateways', JSON_ARRAY()
      )
  WHERE tenant_id = 1 AND billing_config IS NULL;

INSERT INTO payments
  (tenant_id, subscription_id, gateway_id, user_id, amount, currency_code,
   status, payment_method, reference, description, paid_at)
SELECT
  s.tenant_id,
  s.id,
  (SELECT g.id FROM payment_gateways g WHERE g.code = 'STRIPE' LIMIT 1),
  NULL,
  pl.price,
  pl.currency_code,
  'PAID',
  'card',
  'REC-SAAS-000001',
  CONCAT('Pago inicial del plan ', pl.name, ' (ciclo ', pl.billing_cycle, ')'),
  s.current_period_start
FROM subscriptions s
JOIN plans pl ON pl.id = s.plan_id
WHERE s.tenant_id = 1
  AND s.status IN ('TRIAL','ACTIVE')
  AND NOT EXISTS (
    SELECT 1 FROM payments p WHERE p.tenant_id = 1 AND p.status = 'PAID'
  );

-- ADMIN del tenant: gestión de suscripción + renovación + facturación
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.permission_key IN ('subscriptions.manage','billing.manage','billing.view')
WHERE r.slug = 'ADMIN' AND r.tenant_id IS NULL;