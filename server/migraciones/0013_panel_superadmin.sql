-- ============================================================
-- CrediPay MDM - Panel del Super Administrador
-- Migración 0013 - Gestión completa de empresas y plataforma
-- Trazabilidad de suspensiones/reactivaciones del tenant y
-- usabilidad del panel global. IDEMPOTENTE.
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- TRAZABILIDAD DE SUSPENSIÓN --------------------
ALTER TABLE tenants
  ADD COLUMN suspended_at DATETIME NULL AFTER trial_ends_at,
  ADD COLUMN suspended_by BIGINT UNSIGNED NULL AFTER suspended_at,
  ADD COLUMN suspended_reason VARCHAR(500) NULL AFTER suspended_by,
  ADD COLUMN activated_at DATETIME NULL AFTER suspended_reason;