-- ============================================================
-- CrediPay MDM - Seed Demo (tenant principal + datos de ejemplo)
-- Migración 0003
-- Replica los datos demo del frontend (src/data/initialData.ts)
-- con fechas relativas a hoy para mostrar todos los estados.
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- TENANT DEMO --------------------
INSERT INTO tenants
  (id, name, slug, domain, status, email, phone, currency_code, country_code, language_code, timezone)
VALUES
  (1, 'CrediPay Principal', 'credipay-demo', NULL, 'ACTIVE', 'soporte@credipay.local', '+1 809-555-0000',
   'DOP', 'DO', 'es', 'America/Santo_Domingo');

-- FASE 8: credenciales ficticias (TEST_*) — nunca valores reales.
INSERT INTO tenant_settings
  (tenant_id, mdm_config, theme, grace_days, overdue_penalty, receipt_prefix, invoice_prefix, notifications)
VALUES
  (1,
   JSON_OBJECT(
     'provider', 'INOVAGUARD',
     'baseUrl', 'https://dashboard.inovaguardapp.com/api/v1/customer',
     'apiKey', '',
     'appClient', 'TEST_APP_CLIENT',
     'secret', 'TEST_SECRET',
     'bearerToken', 'TEST_BEARER',
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
   JSON_OBJECT('whatsapp', FALSE, 'sms', FALSE, 'email', TRUE));

-- -------------------- SUSCRIPCIÓN DEMO --------------------
INSERT INTO subscriptions
  (tenant_id, plan_id, status, starts_at, current_period_start, current_period_end, auto_renew)
SELECT 1, pl.id, 'ACTIVE',
  DATE_SUB(NOW(), INTERVAL 20 DAY),
  DATE_SUB(NOW(), INTERVAL 20 DAY),
  DATE_ADD(NOW(), INTERVAL 10 DAY),
  1
FROM plans pl WHERE pl.slug = 'empresa-mensual';

INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description)
SELECT s.id, 1, 'CREATED', 'Suscripción inicial del tenant demo (plan Empresa Mensual)'
FROM subscriptions s WHERE s.tenant_id = 1;

INSERT INTO storage (tenant_id, used_bytes, quota_bytes)
SELECT 1, 0, (SELECT storage_mb FROM plans pl
  JOIN subscriptions s ON s.plan_id = pl.id AND s.tenant_id = 1) * 1048576;

-- -------------------- CLIENTES --------------------
INSERT INTO clients (id, tenant_id, full_name, cedula_or_id, phone, email, address, avatar_url, notes, status) VALUES
  (1, 1, 'Carlos Andrés Mendoza', '001-1829384-5', '+1 809-555-1024', 'carlos.mendoza@email.com',
   'Av. Winston Churchill #104, Santo Domingo',
   'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
   'Cliente presenta atraso en la primera cuota (>3 días). Dispositivo bloqueado automáticamente el día 4.',
   'DELINQUENT'),
  (2, 1, 'Mariana Valenzuela Ortiz', '402-2349182-1', '+1 809-555-8821', 'mariana.valenzuela@email.com',
   'Calle El Conde #45, Zona Colonial',
   'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
   'Cuota actual en estado VENCIDO. Aún dentro de los 3 días de gracia antes de aplicar mora y bloqueo MDM.',
   'ACTIVE'),
  (3, 1, 'Rodolfo Peña Castro', '001-0982734-8', '+1 829-555-4431', 'rodolfo.pena@email.com',
   'Sector Los Prados, Edif. 4B, Apto 201',
   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
   'Cliente puntual, pagos al día.',
   'ACTIVE'),
  (4, 1, 'Yomaira Rosario Jiménez', '031-0029381-0', '+1 809-555-7733', 'yomaira.r@email.com',
   'Ave. San Martín #88, Ensanche Miraflores',
   'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
   'Se notificó por WhatsApp sobre bloqueo MDM tras cumplir 3 días después del vencimiento.',
   'DELINQUENT');

-- -------------------- CRÉDITOS --------------------
INSERT INTO credits (id, client_id, tenant_id, credit_number, start_date, total_amount, monthly_amount, installments_count, status) VALUES
  (1, 1, 1, 'CRD-0001', DATE_SUB(CURDATE(), INTERVAL 35 DAY), 48000.00, 4000.00, 12, 'ACTIVE'),
  (2, 2, 1, 'CRD-0002', DATE_SUB(CURDATE(), INTERVAL 65 DAY), 54000.00, 4500.00, 12, 'ACTIVE'),
  (3, 3, 1, 'CRD-0003', DATE_SUB(CURDATE(), INTERVAL 120 DAY), 24000.00, 2000.00, 12, 'ACTIVE'),
  (4, 4, 1, 'CRD-0004', DATE_SUB(CURDATE(), INTERVAL 40 DAY), 36000.00, 3000.00, 12, 'ACTIVE');

-- -------------------- CUOTAS --------------------
INSERT INTO credit_installments
  (id, credit_id, tenant_id, installment_number, amount, due_date, status, penalty_amount, total_amount,
   paid_date, payment_reference, paid_amount) VALUES
  -- Carlos (CRD-0001): cuota 1 atrasada con mora
  (1, 1, 1, 1, 4000.00, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'ATRASADO', 200.00, 4200.00, NULL, NULL, NULL),
  (2, 1, 1, 2, 4000.00, DATE_ADD(CURDATE(), INTERVAL 25 DAY), 'PENDIENTE', 0.00, 4000.00, NULL, NULL, NULL),
  (3, 1, 1, 3, 4000.00, DATE_ADD(CURDATE(), INTERVAL 55 DAY), 'PENDIENTE', 0.00, 4000.00, NULL, NULL, NULL),
  -- Mariana (CRD-0002): cuota 1 pagada, cuota 2 vence hoy
  (4, 2, 1, 1, 4500.00, DATE_SUB(CURDATE(), INTERVAL 35 DAY), 'PAGADO', 0.00, 4500.00,
   DATE_SUB(CURDATE(), INTERVAL 36 DAY), 'REC-90812', 4500.00),
  (5, 2, 1, 2, 4500.00, CURDATE(), 'VENCIDO', 0.00, 4500.00, NULL, NULL, NULL),
  (6, 2, 1, 3, 4500.00, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'PENDIENTE', 0.00, 4500.00, NULL, NULL, NULL),
  -- Rodolfo (CRD-0003): 3 cuotas pagadas, 1 pendiente
  (7, 3, 1, 1, 2000.00, DATE_SUB(CURDATE(), INTERVAL 90 DAY), 'PAGADO', 0.00, 2000.00,
   DATE_SUB(CURDATE(), INTERVAL 91 DAY), 'REC-11029', 2000.00),
  (8, 3, 1, 2, 2000.00, DATE_SUB(CURDATE(), INTERVAL 60 DAY), 'PAGADO', 0.00, 2000.00,
   DATE_SUB(CURDATE(), INTERVAL 60 DAY), 'REC-22108', 2000.00),
  (9, 3, 1, 3, 2000.00, DATE_SUB(CURDATE(), INTERVAL 30 DAY), 'PAGADO', 0.00, 2000.00,
   DATE_SUB(CURDATE(), INTERVAL 29 DAY), 'REC-33819', 2000.00),
  (10, 3, 1, 4, 2000.00, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'PENDIENTE', 0.00, 2000.00, NULL, NULL, NULL),
  -- Yomaira (CRD-0004): cuota 1 atrasada con mora
  (11, 4, 1, 1, 3000.00, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'ATRASADO', 200.00, 3200.00, NULL, NULL, NULL),
  (12, 4, 1, 2, 3000.00, DATE_ADD(CURDATE(), INTERVAL 22 DAY), 'PENDIENTE', 0.00, 3000.00, NULL, NULL, NULL);

-- -------------------- PAGOS RECIBIDOS --------------------
INSERT INTO payments_received
  (client_id, tenant_id, credit_id, amount, method, reference, received_date, notes) VALUES
  (2, 1, 2, 4500.00, 'CASH', 'REC-90812', DATE_SUB(CURDATE(), INTERVAL 36 DAY), 'Cuota #1'),
  (3, 1, 3, 2000.00, 'CASH', 'REC-11029', DATE_SUB(CURDATE(), INTERVAL 91 DAY), 'Cuota #1'),
  (3, 1, 3, 2000.00, 'CASH', 'REC-22108', DATE_SUB(CURDATE(), INTERVAL 60 DAY), 'Cuota #2'),
  (3, 1, 3, 2000.00, 'CASH', 'REC-33819', DATE_SUB(CURDATE(), INTERVAL 29 DAY), 'Cuota #3');

-- -------------------- DISPOSITIVOS --------------------
-- FASE 8: IDs y seriales ficticios (DEMO-*) — nunca valores que parezcan reales.
INSERT INTO devices
  (id, client_id, tenant_id, inovaguard_id, device_name, brand, model, imei, serial_number,
   mdm_status, unlock_code, remote_lock_supported, last_mdm_sync_at, last_mdm_sync_note) VALUES
  (1, 1, 1, 'DEMO-DEVICE-000001', 'S24-Carlos-Mendoza', 'Samsung', 'Galaxy S24 Ultra 256GB',
   'DEMO-IMEI-000001', 'DEMO-SERIAL-000001', 'LOCKED', '53645', 1,
   DATE_SUB(NOW(), INTERVAL 15 MINUTE), 'Hace 15 minutos (Automático por atraso)'),
  (2, 2, 1, 'DEMO-DEVICE-000002', 'iPhone15-Mariana-V', 'Apple', 'iPhone 15 Pro 128GB',
   'DEMO-IMEI-000002', 'DEMO-SERIAL-000002', 'UNLOCKED', NULL, 1,
   DATE_SUB(NOW(), INTERVAL 2 HOUR), 'Hace 2 horas (Comprobación de estado OK)'),
  (3, 3, 1, 'DEMO-DEVICE-000003', 'Redmi-Rodolfo-Pena', 'Xiaomi', 'Redmi Note 13 Pro+ 5G',
   'DEMO-IMEI-000003', 'DEMO-SERIAL-000003', 'UNLOCKED', NULL, 1,
   DATE_SUB(NOW(), INTERVAL 1 DAY), 'Hace 1 día (Desbloqueado al recibir pago)'),
  (4, 4, 1, 'DEMO-DEVICE-000004', 'Edge50-Yomaira-R', 'Motorola', 'Edge 50 Pro 512GB',
   'DEMO-IMEI-000004', 'DEMO-SERIAL-000004', 'LOCKED', NULL, 1,
   DATE_SUB(NOW(), INTERVAL 3 DAY), 'Hace 3 días (Bloqueo automático - Cuota Atrasada #1)');

-- -------------------- HISTORIAL DE ESTADO --------------------
INSERT INTO device_status (device_id, tenant_id, status, reason, source) VALUES
  (1, 1, 'UNLOCKED', 'Enrolamiento inicial del dispositivo', 'API'),
  (1, 1, 'LOCKED', 'Bloqueo automático por cuota atrasada', 'AUTO'),
  (2, 1, 'UNLOCKED', 'Enrolamiento inicial del dispositivo', 'API'),
  (3, 1, 'UNLOCKED', 'Enrolamiento inicial del dispositivo', 'API'),
  (3, 1, 'UNLOCKED', 'Desbloqueado al recibir pago de cuota #3', 'AUTO'),
  (4, 1, 'UNLOCKED', 'Enrolamiento inicial del dispositivo', 'API'),
  (4, 1, 'LOCKED', 'Bloqueo automático - Cuota Atrasada #1', 'AUTO');

-- -------------------- EVENTOS MDM (logs de actividad) --------------------
INSERT INTO device_events
  (device_id, tenant_id, client_id, action, trigger_source, status, imei, details, created_at) VALUES
  (1, 1, 1, 'LOCK', 'AUTOMATIC_OVERDUE', 'SUCCESS', 'DEMO-IMEI-000001',
   'Cuota #1 en estado ATRASADO (>3 días). Mora fija RD$200 aplicada. Comando MDM Lock enviado.',
   NOW() - INTERVAL 1 HOUR),
  (4, 1, 4, 'LOCK', 'AUTOMATIC_OVERDUE', 'SUCCESS', 'DEMO-IMEI-000004',
   'Cuota #1 en estado ATRASADO (>3 días). Dispositivo bloqueado exitosamente vía API externa.',
   NOW() - INTERVAL 1 DAY),
  (3, 1, 3, 'UNLOCK', 'AUTOMATIC_PAYMENT', 'SUCCESS', 'DEMO-IMEI-000003',
   'Pago registrado para Cuota #3. Desbloqueo MDM ejecutado automáticamente.',
   NOW() - INTERVAL 2 DAY);

-- -------------------- AUDITORÍA INICIAL --------------------
INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_values, ip_address, metadata) VALUES
  (1, NULL, 'SEED_DEMO_CREATED', 'tenant', '1',
   JSON_OBJECT('name', 'CrediPay Principal', 'clients', 4, 'devices', 4, 'credits', 4),
   '127.0.0.1', JSON_OBJECT('source', 'migracion 0003'));

INSERT INTO notifications (tenant_id, user_id, type, title, body, data) VALUES
  (1, NULL, 'SYSTEM', 'Bienvenido a CrediPay MDM',
   'El tenant demo fue creado con datos de ejemplo. Revise el panel de suscripción y configuración.',
   JSON_OBJECT('phase', 'seed'));
