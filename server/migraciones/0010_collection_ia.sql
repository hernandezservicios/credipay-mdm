-- ============================================================
-- CrediPay MDM - Fase 6
-- Migración 0010 - Motor de Cobranza Automática + IA de mensajería
-- 1) collection_runs: ejecuciones del motor (MANUAL/SCHEDULED/API).
-- 2) collection_reminders: recordatorios generados por el módulo IA.
-- 3) Permisos collection.* otorgados por rol.
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS / INSERT IGNORE.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS collection_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  triggered_by BIGINT UNSIGNED NULL,
  source ENUM('MANUAL','SCHEDULED','API') NOT NULL DEFAULT 'MANUAL',
  status ENUM('RUNNING','COMPLETED','FAILED') NOT NULL DEFAULT 'RUNNING',
  total_reminders INT UNSIGNED NOT NULL DEFAULT 0,
  sent_now INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  error TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_colruns_tenant (tenant_id, started_at),
  CONSTRAINT fk_colruns_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_colruns_user FOREIGN KEY (triggered_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collection_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  reminder_type ENUM('RECORDATORIO','ALERTA_BLOQUEO','CONFIRMACION_PAGO') NOT NULL,
  channel ENUM('WHATSAPP','SMS','EMAIL') NOT NULL DEFAULT 'WHATSAPP',
  status ENUM('PENDING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  risk_level ENUM('BAJO','MEDIO','ALTO') NOT NULL DEFAULT 'MEDIO',
  risk_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  subject VARCHAR(200) NULL,
  message TEXT NOT NULL,
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_colrem_tenant_status (tenant_id, status, created_at),
  KEY idx_colrem_client (client_id),
  KEY idx_colrem_run (run_id),
  CONSTRAINT fk_colrem_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_colrem_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE CASCADE,
  CONSTRAINT fk_colrem_run FOREIGN KEY (run_id)
    REFERENCES collection_runs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- PERMISOS E IA --------------------
INSERT IGNORE INTO permissions (permission_key, module, name, description) VALUES
  ('collection.view', 'collection', 'Ver cobranza IA', 'Ver motor de cobranza y recordatorios'),
  ('collection.run', 'collection', 'Ejecutar cobranza', 'Ejecutar el motor de cobranza automática'),
  ('collection.send', 'collection', 'Enviar recordatorios', 'Registrar envíos de recordatorios');

-- SUPER_ADMIN: los permisos nuevos (0002 ya corrió, el cross join no aplica retroactivo)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'SUPER_ADMIN' AND r.tenant_id IS NULL
  AND p.permission_key IN ('collection.view','collection.run','collection.send');

-- ADMIN y GESTOR: operar el motor de cobranza
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('collection.view','collection.run','collection.send')
WHERE r.slug IN ('ADMIN','GESTOR') AND r.tenant_id IS NULL;

-- OPERADOR: ver y registrar envíos
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('collection.view','collection.send')
WHERE r.slug = 'OPERADOR' AND r.tenant_id IS NULL;

-- CONSULTA: solo lectura del motor
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('collection.view')
WHERE r.slug = 'CONSULTA' AND r.tenant_id IS NULL;