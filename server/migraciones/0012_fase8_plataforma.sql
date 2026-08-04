-- ============================================================
-- CrediPay MDM - Fase 8
-- Migración 0012 - Plataforma de automatización
-- Scheduler real (jobs/queue), webhooks con entregas, backups
-- automáticos, plantillas de email y notificaciones multi-canal.
-- IDEMPOTENTE.
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- WEBHOOK DELIVERIES --------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  webhook_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  event VARCHAR(50) NOT NULL,
  payload JSON NULL,
  status ENUM('PENDING','SUCCESS','FAILED','RETRY') NOT NULL DEFAULT 'PENDING',
  attempt TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  response_status SMALLINT NULL,
  response_body TEXT NULL,
  error TEXT NULL,
  next_retry_at DATETIME NULL,
  duration_ms INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_deliveries_webhook (webhook_id, created_at),
  KEY idx_deliveries_retry (status, next_retry_at),
  CONSTRAINT fk_deliveries_webhook FOREIGN KEY (webhook_id)
    REFERENCES webhooks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- CONFIGURACIÓN DE PLATAFORMA (F8) --------------------
INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
  ('scheduler.enabled', JSON_OBJECT('value', TRUE), 'Scheduler automático activo'),
  ('scheduler.collection_hour', JSON_OBJECT('value', 9), 'Hora del día (0-23) para la corrida diaria de cobranza'),
  ('scheduler.tick_seconds', JSON_OBJECT('value', 60), 'Intervalo del tick del scheduler (segundos)'),
  ('backups.hour', JSON_OBJECT('value', 3), 'Hora del día (0-23) para el respaldo diario'),
  ('backups.retention_days', JSON_OBJECT('value', 14), 'Días a conservar respaldos antes de poda'),
  ('backups.directory', JSON_QUOTE('./backups'), 'Directorio de respaldos (relativo a server/)'),
  ('notifications.channels', JSON_OBJECT('whatsapp', FALSE, 'sms', FALSE, 'email', FALSE), 'Canales de notificación habilitados globalmente');

-- -------------------- FEATURE FLAGS (F8) --------------------
INSERT IGNORE INTO feature_flags (flag_key, enabled, description) VALUES
  ('scheduler.enabled', 1, 'Scheduler de tareas automáticas'),
  ('webhooks.enabled', 1, 'Webhooks de integraciones'),
  ('backups.enabled', 1, 'Respaldos automáticos de la base de datos'),
  ('smtp.enabled', 0, 'Envío de correo transaccional por SMTP (se activa al configurar SMTP)');

-- -------------------- PLANTILLAS DE EMAIL (globales) --------------------
INSERT INTO email_templates (tenant_id, template_key, subject, body_html, body_text)
SELECT NULL, m.template_key, m.subject, m.body_html, m.body_text
FROM (
  SELECT 'email.verification' AS template_key, 'Verifica tu correo - CrediPay MDM' AS subject,
         '<h2>Hola {{nombre}}</h2><p>Para activar tu cuenta de CrediPay MDM, confirma tu correo:</p><p><a href="{{link}}">Verificar correo</a></p><p>Si no solicitaste esto, ignora este mensaje.</p>' AS body_html,
         'Hola {{nombre}}, confirma tu correo en CrediPay MDM usando este enlace: {{link}}' AS body_text
  UNION ALL SELECT 'email.password_reset', 'Restablece tu contraseña - CrediPay MDM',
         '<h2>Hola {{nombre}}</h2><p>Recibimos una solicitud para restablecer tu contraseña:</p><p><a href="{{link}}">Restablecer contraseña</a></p><p>El enlace vence en 24 horas. Si no lo solicitaste, ignora este mensaje.</p>',
         'Hola {{nombre}}, restablece tu contraseña de CrediPay MDM con este enlace: {{link}} (vence en 24 horas)'
  UNION ALL SELECT 'email.payment_receipt', 'Recibo de pago - {{empresa}}',
         '<h2>Pago registrado</h2><p>Hola {{cliente}}, registramos un pago de <strong>{{monto}}</strong> en {{empresa}}.</p><p>Referencia: {{referencia}}<br>Fecha: {{fecha}}<br>Método: {{metodo}}</p>',
         'Hola {{cliente}}, registramos un pago de {{monto}} en {{empresa}}. Referencia: {{referencia}}. Fecha: {{fecha}}. Método: {{metodo}}.'
  UNION ALL SELECT 'email.collection_reminder', 'Recordatorio de pago - {{empresa}}',
         '<h2>Hola {{cliente}}</h2><p>{{mensaje}}</p><p>Contacta a {{empresa}} si ya realizaste el pago o necesitas ayuda.</p>',
         '{{mensaje}} - {{empresa}}'
  UNION ALL SELECT 'email.collection_lock_alert', 'Aviso de bloqueo - {{empresa}}',
         '<h2>Hola {{cliente}}</h2><p>{{mensaje}}</p><p>Tu equipo será bloqueado por MDM hasta regularizar tu pago en {{empresa}}.</p>',
         '{{mensaje}} - Tu equipo será bloqueado hasta regularizar tu pago en {{empresa}}.'
) m
WHERE NOT EXISTS (
  SELECT 1 FROM email_templates e
  WHERE e.tenant_id IS NULL AND e.template_key = m.template_key
);

-- -------------------- PLANTILLAS DE NOTIFICACIÓN (globales) --------------------
INSERT INTO notification_templates (tenant_id, template_key, name, channel, subject, body)
SELECT NULL, m.template_key, m.name, m.channel, m.subject, m.body
FROM (
  SELECT 'collection.reminder' AS template_key, 'Recordatorio de pago' AS name, 'EMAIL' AS channel, 'Recordatorio de pago' AS subject, '{{mensaje}}' AS body
  UNION ALL SELECT 'collection.reminder', 'Recordatorio de pago', 'WHATSAPP', NULL, '{{mensaje}}'
  UNION ALL SELECT 'collection.reminder', 'Recordatorio de pago', 'IN_APP', 'Recordatorio de pago', '{{mensaje}}'
  UNION ALL SELECT 'collection.lock_alert', 'Aviso de bloqueo', 'EMAIL', 'Aviso de bloqueo', '{{mensaje}}'
  UNION ALL SELECT 'collection.lock_alert', 'Aviso de bloqueo', 'WHATSAPP', NULL, '{{mensaje}}'
  UNION ALL SELECT 'collection.payment_confirm', 'Pago confirmado', 'EMAIL', 'Pago confirmado', 'Hola {{cliente}}, confirmamos tu pago de {{monto}}. ¡Gracias!'
  UNION ALL SELECT 'collection.payment_confirm', 'Pago confirmado', 'WHATSAPP', NULL, 'Hola {{cliente}}, confirmamos tu pago de {{monto}}. ¡Gracias!'
) m
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates n
  WHERE n.tenant_id IS NULL AND n.template_key = m.template_key AND n.channel = m.channel
);

-- -------------------- PERMISOS WEBHOOKS Y BACKUPS (ADMIN) --------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('webhooks.manage', 'backups.manage')
WHERE r.slug = 'ADMIN' AND r.tenant_id IS NULL;
