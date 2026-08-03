-- ============================================================
-- CrediPay MDM - Migración 0004
-- Añade token CSRF ligado a la sesión (defensa anti-CSRF)
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE sessions
  ADD COLUMN csrf_token CHAR(64) NULL AFTER is_remember;
