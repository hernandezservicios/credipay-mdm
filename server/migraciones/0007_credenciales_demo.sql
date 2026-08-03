-- ============================================================
-- CrediPay MDM - Credenciales demo canónicas (migración 0007)
-- ------------------------------------------------------------
-- Usuarios demo y configuración MDM canónica del tenant demo.
--
--  CUENTA                      CONTRASEÑA          CAMBIO OBLIGATORIO  ROL
--  -------------------------------------------------------------------------
--  admin@credipay.local        7xs8G8GJrTze9S      SÍ (must_change=1)  SUPER_ADMIN
--  demo.admin@credipay.local   Fase2Test2026!      NO                  ADMIN
--  demo.operador@credipay.local Fase2Test2026!     NO                  OPERADOR
--  demo.gestor@credipay.local  7xs8G8GJrTze9S      NO                  GESTOR
--  demo.consulta@credipay.local NuevaClave2026!    NO                  CONSULTA
--
-- Idempotente: re-ejecutar restaura contraseñas y roles demo.
-- También restaura la configuración MDM del tenant 1 (credenciales
-- InovaGuard) si algún script de pruebas la dejó vacía.
-- admin@ es un Super Admin GLOBAL (tenant_id NULL, acceso a todos los
-- tenants); los demo.* pertenecen al tenant 'credipay-demo'.
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- USUARIOS DEMO --------------------
-- admin@ y demo.gestor@ comparten hash (contraseña 7xs8G8GJrTze9S).
-- demo.admin@ y demo.operador@ comparten hash (contraseña Fase2Test2026!).
INSERT INTO users (tenant_id, name, email, password_hash, status, must_change_password)
SELECT
  CASE m.email
    WHEN 'admin@credipay.local' THEN NULL
    ELSE t.id
  END,
  m.name, m.email, m.hash, 'ACTIVE',
  CASE WHEN m.email = 'admin@credipay.local' THEN 1 ELSE 0 END
FROM (
  SELECT 'admin@credipay.local' AS email, 'Super Administrador' AS name,
         '$2b$12$FgTIruhsXzlVYDR/4HoIOewB84u1EBiB1fKoL2XntKp/1gmW0gaNa' AS hash
  UNION ALL SELECT 'demo.admin@credipay.local', 'Administrador Demo',
         '$2b$10$k57WV4NPay9ZsVCL2KqwhehMAgrZv20eakBSd54yHw08DbC1n.IFG'
  UNION ALL SELECT 'demo.operador@credipay.local', 'Operador Demo',
         '$2b$10$k57WV4NPay9ZsVCL2KqwhehMAgrZv20eakBSd54yHw08DbC1n.IFG'
  UNION ALL SELECT 'demo.gestor@credipay.local', 'Gestor Demo',
         '$2b$12$FgTIruhsXzlVYDR/4HoIOewB84u1EBiB1fKoL2XntKp/1gmW0gaNa'
  UNION ALL SELECT 'demo.consulta@credipay.local', 'Consulta Demo',
         '$2b$12$vlDgJc0Duwn8v8gsYh8q4Oy/IgxCAyI4AHppVMMi/ivHXZRdwgYaq'
) m
LEFT JOIN tenants t ON t.slug = 'credipay-demo'
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  status = VALUES(status),
  must_change_password = VALUES(must_change_password);

-- -------------------- ROLES DEMO --------------------
INSERT INTO user_roles (user_id, role_id, tenant_id)
SELECT u.id, r.id, u.tenant_id
FROM users u
JOIN (SELECT 'admin@credipay.local' AS email, 'SUPER_ADMIN' AS slug
      UNION ALL SELECT 'demo.admin@credipay.local', 'ADMIN'
      UNION ALL SELECT 'demo.gestor@credipay.local', 'GESTOR'
      UNION ALL SELECT 'demo.operador@credipay.local', 'OPERADOR'
      UNION ALL SELECT 'demo.consulta@credipay.local', 'CONSULTA') m
  ON m.email = u.email
JOIN roles r ON r.slug = m.slug AND r.tenant_id IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
);

-- -------------------- CONFIG MDM CANÓNICA (tenant 1) --------------------
INSERT INTO tenant_settings (tenant_id, mdm_config, theme, grace_days, overdue_penalty, receipt_prefix, invoice_prefix, notifications)
VALUES (1,
  JSON_OBJECT(
    'provider', 'INOVAGUARD',
    'baseUrl', 'https://dashboard.inovaguardapp.com/api/v1/customer',
    'apiKey', '',
    'appClient', 'd13cb763-1998-4cf8-9bb4-c6dbc8b513cb',
    'secret', 'kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm',
    'bearerToken', '9164|Z6Qg7uS91iRNt4jVrwFAZx4MkyJivl1IOTp97mjE9540f41b',
    'authLoginEndpoint', '/auth/login',
    'devicesEndpoint', '/devices',
    'lockEndpoint', '/devices/lock/{id}',
    'unlockEndpoint', '/devices/unlock/{id}',
    'unlockCodeEndpoint', '/devices/unlock-code/{id}',
    'removeEndpoint', '/devices/remove/{id}',
    'qrEndpoint', '/devices/qr-enrollment',
    'balanceEndpoint', '/balance',
    'statusEndpoint', '/devices/find/{id}',
    'enabled', TRUE,
    'autoLockOnOverdue', TRUE,
    'autoUnlockOnPaid', TRUE,
    'liveMode', TRUE
  ),
  JSON_OBJECT('mode', 'light'),
  3, 200.00, 'REC', 'INV',
  JSON_OBJECT('whatsapp', FALSE, 'sms', FALSE, 'email', TRUE))
ON DUPLICATE KEY UPDATE
  mdm_config = VALUES(mdm_config);
