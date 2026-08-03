-- ============================================================
-- CrediPay MDM - Seed Global (rol Super Admin y datos de catálogo)
-- Migración 0002 - IDEMPOTENTE (re-ejecutable sin errores)
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- PERMISOS --------------------
INSERT IGNORE INTO permissions (permission_key, module, name, description) VALUES
  ('dashboard.view', 'dashboard', 'Ver dashboard', 'Ver KPIs y métricas del panel'),
  ('dashboard.export', 'dashboard', 'Exportar reportes', 'Exportar datos de dashboards'),
  ('tenants.view', 'tenants', 'Ver tenants', 'Listar y consultar tenants'),
  ('tenants.create', 'tenants', 'Crear tenant', 'Crear nuevas empresas/tenants'),
  ('tenants.edit', 'tenants', 'Editar tenant', 'Modificar datos del tenant'),
  ('tenants.suspend', 'tenants', 'Suspender tenant', 'Suspender o reactivar tenant'),
  ('users.view', 'users', 'Ver usuarios', 'Listar usuarios del tenant'),
  ('users.create', 'users', 'Crear usuarios', 'Crear usuarios'),
  ('users.edit', 'users', 'Editar usuarios', 'Editar usuarios y estado'),
  ('users.delete', 'users', 'Eliminar usuarios', 'Eliminar usuarios'),
  ('users.roles', 'users', 'Asignar roles', 'Gestionar roles y permisos de usuarios'),
  ('roles.view', 'roles', 'Ver roles', 'Consultar roles'),
  ('roles.manage', 'roles', 'Gestionar roles', 'Crear/editar roles y permisos'),
  ('clients.view', 'clients', 'Ver clientes', 'Listar y consultar clientes'),
  ('clients.create', 'clients', 'Crear clientes', 'Registrar nuevos clientes'),
  ('clients.edit', 'clients', 'Editar clientes', 'Modificar datos de clientes'),
  ('clients.delete', 'clients', 'Eliminar clientes', 'Eliminar clientes'),
  ('credits.view', 'credits', 'Ver créditos', 'Listar y consultar créditos'),
  ('credits.create', 'credits', 'Crear créditos', 'Crear créditos y cuotas'),
  ('credits.edit', 'credits', 'Editar créditos', 'Modificar créditos'),
  ('credits.delete', 'credits', 'Eliminar créditos', 'Eliminar créditos'),
  ('installments.view', 'credits', 'Ver cuotas', 'Consultar cuotas'),
  ('installments.edit', 'credits', 'Editar cuotas', 'Ajustar cuotas y moras'),
  ('payments.view', 'payments', 'Ver pagos', 'Consultar pagos recibidos'),
  ('payments.create', 'payments', 'Registrar pagos', 'Registrar pagos y desbloqueos automáticos'),
  ('payments.refund', 'payments', 'Reembolsar pagos', 'Anular/reembolsar pagos'),
  ('devices.view', 'devices', 'Ver dispositivos', 'Listar y consultar dispositivos'),
  ('devices.create', 'devices', 'Crear dispositivos', 'Registrar dispositivos'),
  ('devices.edit', 'devices', 'Editar dispositivos', 'Editar dispositivos'),
  ('devices.delete', 'devices', 'Eliminar dispositivos', 'Eliminar dispositivos'),
  ('devices.lock', 'devices', 'Bloquear dispositivos', 'Ejecutar bloqueo MDM'),
  ('devices.unlock', 'devices', 'Desbloquear dispositivos', 'Ejecutar desbloqueo MDM'),
  ('mdm.config', 'mdm', 'Configurar MDM', 'Gestionar credenciales y endpoints MDM'),
  ('mdm.manual', 'mdm', 'Acciones manuales MDM', 'Acciones MDM manuales sobre dispositivos'),
  ('logs.view', 'logs', 'Ver logs', 'Consultar registros de actividad'),
  ('logs.export', 'logs', 'Exportar logs', 'Exportar logs'),
  ('audit.view', 'audit', 'Ver auditoría', 'Consultar auditoría completa'),
  ('subscriptions.view', 'subscriptions', 'Ver suscripciones', 'Consultar suscripción y plan'),
  ('subscriptions.manage', 'subscriptions', 'Gestionar suscripciones', 'Cambiar plan, renovar, cancelar'),
  ('billing.view', 'billing', 'Ver facturación', 'Consultar pagos y facturas de la plataforma'),
  ('billing.manage', 'billing', 'Gestionar facturación', 'Facturar, reembolsar, configurar cobro'),
  ('gateway.config', 'billing', 'Configurar pasarelas', 'Configurar pasarelas de pago del tenant'),
  ('notifications.view', 'notifications', 'Ver notificaciones', 'Consultar notificaciones'),
  ('notifications.send', 'notifications', 'Enviar notificaciones', 'Enviar notificaciones y plantillas'),
  ('files.view', 'files', 'Ver archivos', 'Consultar archivos'),
  ('files.upload', 'files', 'Subir archivos', 'Subir archivos'),
  ('files.delete', 'files', 'Eliminar archivos', 'Eliminar archivos'),
  ('settings.view', 'settings', 'Ver configuración', 'Consultar configuración del tenant'),
  ('settings.edit', 'settings', 'Editar configuración', 'Modificar configuración del tenant'),
  ('api_keys.manage', 'api', 'Gestionar API keys', 'Crear y revocar API keys'),
  ('webhooks.manage', 'api', 'Gestionar webhooks', 'Configurar webhooks'),
  ('backups.manage', 'backups', 'Gestionar respaldos', 'Ejecutar y restaurar respaldos'),
  ('reports.view', 'reports', 'Ver reportes', 'Consultar reportes');

-- -------------------- ROLES (globales, plantilla) --------------------
-- Idempotente: INSERT IGNORE no deduplica con tenant_id NULL
-- (NULL != NULL en el índice único), por eso se usa NOT EXISTS.
INSERT INTO roles (tenant_id, name, slug, description, is_system)
SELECT t.tenant_id, t.name, t.slug, t.description, t.is_system
FROM (
  SELECT NULL AS tenant_id, 'Super Admin' AS name, 'SUPER_ADMIN' AS slug, 'Acceso total a la plataforma' AS description, 1 AS is_system
  UNION ALL SELECT NULL, 'Administrador', 'ADMIN', 'Gestiona el tenant por completo', 1
  UNION ALL SELECT NULL, 'Gestor', 'GESTOR', 'Gestiona operaciones de negocio y dispositivos', 1
  UNION ALL SELECT NULL, 'Operador', 'OPERADOR', 'Operaciones diarias: pagos y dispositivos', 1
  UNION ALL SELECT NULL, 'Consulta', 'CONSULTA', 'Acceso de solo lectura', 1
) t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.slug = t.slug AND r.tenant_id <=> t.tenant_id
);

-- -------------------- PERMISOS POR ROL --------------------
-- SUPER_ADMIN: todos los permisos
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'SUPER_ADMIN' AND r.tenant_id IS NULL;

-- ADMIN: todo el negocio + usuarios + config, sin gestión de API global
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN (
    'dashboard.view','dashboard.export','tenants.view',
    'users.view','users.create','users.edit','users.delete','users.roles','roles.view',
    'clients.view','clients.create','clients.edit','clients.delete',
    'credits.view','credits.create','credits.edit','credits.delete',
    'installments.view','installments.edit',
    'payments.view','payments.create','payments.refund',
    'devices.view','devices.create','devices.edit','devices.delete','devices.lock','devices.unlock',
    'mdm.config','mdm.manual',
    'logs.view','logs.export','audit.view',
    'subscriptions.view','billing.view','gateway.config',
    'notifications.view','notifications.send',
    'files.view','files.upload','files.delete',
    'settings.view','settings.edit','reports.view'
  )
WHERE r.slug = 'ADMIN' AND r.tenant_id IS NULL;

-- GESTOR: operación de negocio + MDM, sin configuración ni usuarios
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN (
    'dashboard.view',
    'clients.view','clients.create','clients.edit',
    'credits.view','credits.create','credits.edit',
    'installments.view','installments.edit',
    'payments.view','payments.create',
    'devices.view','devices.create','devices.edit','devices.lock','devices.unlock',
    'mdm.manual','logs.view','reports.view'
  )
WHERE r.slug = 'GESTOR' AND r.tenant_id IS NULL;

-- OPERADOR: pagos y dispositivos
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN (
    'dashboard.view',
    'clients.view',
    'credits.view','installments.view',
    'payments.create',
    'devices.view','devices.lock','devices.unlock',
    'logs.view'
  )
WHERE r.slug = 'OPERADOR' AND r.tenant_id IS NULL;

-- CONSULTA: solo lectura
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN (
    'dashboard.view',
    'clients.view','credits.view','installments.view','payments.view','devices.view',
    'logs.view','reports.view'
  )
WHERE r.slug = 'CONSULTA' AND r.tenant_id IS NULL;

-- -------------------- PLANES --------------------
INSERT IGNORE INTO plans
  (name, slug, description, billing_cycle, price, setup_fee, currency_code,
   max_users, max_clients, max_credits, max_devices, storage_mb, api_rate_limit_per_min, max_webhooks,
   status, is_default, sort_order)
VALUES
  ('Básico', 'basico-mensual', 'Para tiendas pequeñas que inician con MDM', 'MONTHLY', 1499.00, 0.00, 'DOP',
   3, 100, 150, 150, 1024, 30, 1, 'ACTIVE', 1, 10),
  ('Profesional', 'profesional-mensual', 'Para empresas con operación activa', 'MONTHLY', 2499.00, 0.00, 'DOP',
   8, 500, 800, 800, 5120, 60, 3, 'ACTIVE', 0, 20),
  ('Profesional', 'profesional-trimestral', 'Ahorra con facturación trimestral', 'QUARTERLY', 6999.00, 0.00, 'DOP',
   8, 500, 800, 800, 5120, 60, 3, 'ACTIVE', 0, 21),
  ('Profesional', 'profesional-semestral', 'Ahorra con facturación semestral', 'SEMI_ANNUAL', 12999.00, 0.00, 'DOP',
   8, 500, 800, 800, 5120, 60, 3, 'ACTIVE', 0, 22),
  ('Profesional', 'profesional-anual', 'Ahorra con facturación anual', 'ANNUAL', 23999.00, 0.00, 'DOP',
   8, 500, 800, 800, 5120, 60, 3, 'ACTIVE', 0, 23),
  ('Empresa', 'empresa-mensual', 'Para operaciones multi-sucursal', 'MONTHLY', 4499.00, 0.00, 'DOP',
   25, 5000, 10000, 10000, 20480, 120, 10, 'ACTIVE', 0, 30),
  ('Empresa', 'empresa-anual', 'Para operaciones multi-sucursal con ahorro anual', 'ANNUAL', 42999.00, 0.00, 'DOP',
   25, 5000, 10000, 10000, 20480, 120, 10, 'ACTIVE', 0, 31);

-- -------------------- CARACTERÍSTICAS POR PLAN --------------------
-- Comunes a todos los planes
INSERT IGNORE INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
SELECT pl.id, f.feature_key, f.feature_name, f.feature_value, f.is_enabled
FROM plans pl
JOIN (
  SELECT 'mdm_lock' AS feature_key, 'Bloqueo MDM' AS feature_name, '1' AS feature_value, 1 AS is_enabled
  UNION ALL SELECT 'auto_lock_overdue', 'Bloqueo automático por atraso', '1', 1
  UNION ALL SELECT 'auto_unlock_paid', 'Desbloqueo automático al pagar', '1', 1
  UNION ALL SELECT 'sms_notifications', 'Notificaciones SMS', '0', 0
  UNION ALL SELECT 'multi_user', 'Múltiples usuarios', '1', 1
) f ON 1 = 1
WHERE pl.slug IN ('basico-mensual','profesional-mensual','profesional-trimestral','profesional-semestral','profesional-anual','empresa-mensual','empresa-anual');

-- Profesional: + acceso API
INSERT IGNORE INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
SELECT pl.id, f.feature_key, f.feature_name, f.feature_value, f.is_enabled
FROM plans pl
JOIN (
  SELECT 'api_access' AS feature_key, 'Acceso API REST' AS feature_name, '1' AS feature_value, 1 AS is_enabled
) f ON 1 = 1
WHERE pl.slug IN ('profesional-mensual','profesional-trimestral','profesional-semestral','profesional-anual');

-- Empresa: + WhatsApp, reportes, API, soporte prioritario y branding
INSERT IGNORE INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
SELECT pl.id, f.feature_key, f.feature_name, f.feature_value, f.is_enabled
FROM plans pl
JOIN (
  SELECT 'whatsapp_notifications' AS feature_key, 'Notificaciones WhatsApp' AS feature_name, '1' AS feature_value, 1 AS is_enabled
  UNION ALL SELECT 'reports', 'Reportes avanzados', '1', 1
  UNION ALL SELECT 'api_access', 'Acceso API REST', '1', 1
  UNION ALL SELECT 'priority_support', 'Soporte prioritario', '1', 1
  UNION ALL SELECT 'custom_branding', 'Marca personalizada', '1', 1
) f ON 1 = 1
WHERE pl.slug IN ('empresa-mensual','empresa-anual');

-- -------------------- PASARELAS --------------------
INSERT IGNORE INTO payment_gateways (code, name, is_active, config_schema) VALUES
  ('STRIPE', 'Stripe', 1, JSON_OBJECT('publishableKey','','secretKey','','webhookSecret','')),
  ('PAYPAL', 'PayPal', 1, JSON_OBJECT('clientId','','clientSecret','','webhookId','')),
  ('T_CHECKOUT', '2Checkout', 1, JSON_OBJECT('sellerId','','secretKey','','merchantCode','')),
  ('AUTHORIZE_NET', 'Authorize.Net', 1, JSON_OBJECT('loginId','','transactionKey','','publicKey','')),
  ('MERCADO_PAGO', 'Mercado Pago', 1, JSON_OBJECT('publicKey','','accessToken','','webhookSecret',''));

-- -------------------- CATÁLOGOS --------------------
INSERT IGNORE INTO currencies (code, name, symbol, decimals, is_active) VALUES
  ('DOP', 'Peso Dominicano', 'RD$', 2, 1),
  ('USD', 'Dólar Estadounidense', 'US$', 2, 1),
  ('EUR', 'Euro', '€', 2, 1),
  ('MXN', 'Peso Mexicano', 'MX$', 2, 1),
  ('ARS', 'Peso Argentino', 'AR$', 2, 1),
  ('CLP', 'Peso Chileno', 'CL$', 0, 1),
  ('COP', 'Peso Colombiano', 'CO$', 2, 1),
  ('BRL', 'Real Brasileño', 'R$', 2, 1),
  ('PEN', 'Sol Peruano', 'S/', 2, 1);

INSERT IGNORE INTO countries (code, name, phone_code, is_active) VALUES
  ('DO', 'República Dominicana', '+1', 1),
  ('US', 'Estados Unidos', '+1', 1),
  ('MX', 'México', '+52', 1),
  ('AR', 'Argentina', '+54', 1),
  ('CL', 'Chile', '+56', 1),
  ('CO', 'Colombia', '+57', 1),
  ('BR', 'Brasil', '+55', 1),
  ('PE', 'Perú', '+51', 1),
  ('EC', 'Ecuador', '+593', 1),
  ('ES', 'España', '+34', 1);

INSERT IGNORE INTO languages (code, name, native_name, is_active) VALUES
  ('es', 'Español', 'Español', 1),
  ('en', 'Inglés', 'English', 1),
  ('pt', 'Portugués', 'Português', 1),
  ('fr', 'Francés', 'Français', 0);

INSERT IGNORE INTO timezones (name, offset_minutes, is_active) VALUES
  ('America/Santo_Domingo', -240, 1),
  ('America/New_York', -300, 1),
  ('America/Mexico_City', -360, 1),
  ('America/Bogota', -300, 1),
  ('America/Lima', -300, 1),
  ('America/Santiago', -240, 1),
  ('America/Argentina/Buenos_Aires', -180, 1),
  ('Europe/Madrid', 60, 1),
  ('Europe/London', 0, 1),
  ('UTC', 0, 1);

-- -------------------- CONFIGURACIÓN DE PLATAFORMA --------------------
INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
  ('platform.name', JSON_QUOTE('CrediPay MDM'), 'Nombre de la plataforma'),
  ('platform.currency', JSON_QUOTE('DOP'), 'Moneda por defecto'),
  ('security.session_lifetime_minutes', JSON_OBJECT('value', 480), 'Vida de sesión en minutos'),
  ('security.remember_me_days', JSON_OBJECT('value', 30), 'Días de recordar sesión'),
  ('security.login_max_attempts', JSON_OBJECT('value', 5), 'Intentos de login antes de bloquear'),
  ('security.login_lockout_minutes', JSON_OBJECT('value', 15), 'Bloqueo tras intentos fallidos'),
  ('security.password_min_length', JSON_OBJECT('value', 10), 'Longitud mínima de contraseña'),
  ('mdm.overdue_grace_days', JSON_OBJECT('value', 3), 'Días de gracia antes de mora/bloqueo'),
  ('mdm.overdue_penalty_amount', JSON_OBJECT('value', 200.00), 'Mora fija por cuota atrasada (DOP)');

-- -------------------- FEATURE FLAGS --------------------
INSERT IGNORE INTO feature_flags (flag_key, enabled, description) VALUES
  ('signup_public', 0, 'Permitir registro público de tenants'),
  ('mdm_integration', 1, 'Integración InovaGuard activa'),
  ('payment_gateways', 1, 'Pasarelas de pago activas'),
  ('dark_mode', 1, 'Modo oscuro habilitado'),
  ('auto_backups', 0, 'Respaldos automáticos'),
  ('2fa', 0, 'Autenticación de dos factores');
