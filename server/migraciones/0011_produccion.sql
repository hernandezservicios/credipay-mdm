-- ============================================================
-- CrediPay MDM - Fase 7
-- Migración 0011 - Producción: 2FA (TOTP) y soporte de API keys
-- users.two_factor_secret: secreto TOTP (base32) pendiente/activo.
-- users.two_factor_recovery_codes: códigos de recuperación (hash).
-- IDEMPOTENTE.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE users
  ADD COLUMN two_factor_secret VARCHAR(64) NULL AFTER two_factor_enabled,
  ADD COLUMN two_factor_recovery_codes JSON NULL AFTER two_factor_secret;

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  key_name VARCHAR(100) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  key_prefix VARCHAR(10) NOT NULL,
  scopes JSON NULL,
  rate_limit_per_min INT UNSIGNED NOT NULL DEFAULT 60,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  status ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY idx_api_keys_tenant (tenant_id, status),
  KEY fk_api_keys_user (user_id),
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- PERMISOS API KEYS --------------------
INSERT IGNORE INTO permissions (permission_key, module, name, description) VALUES
  ('api_keys.manage', 'security', 'Gestionar API keys', 'Crear, listar y revocar claves de API');

-- SUPER_ADMIN: cross join retroactivo
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'SUPER_ADMIN' AND r.tenant_id IS NULL
  AND p.permission_key IN ('api_keys.manage');

-- ADMIN: gestión de API keys de su tenant
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('api_keys.manage')
WHERE r.slug = 'ADMIN' AND r.tenant_id IS NULL;