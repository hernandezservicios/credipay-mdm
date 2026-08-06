SET NAMES utf8mb4;

-- ============================================================
-- 0017 - Formato de moneda (Adenda v2.5 / Plan Maestro v2.9, FASE 1)
-- La moneda única vive en `tenants.currency_code` + tabla `currencies`.
-- Esta migración añade el formato regional de cada moneda:
--   thousand_separator y decimal_separator (idempotente).
-- ============================================================

-- Añadir columnas solo si no existen (idempotente a nivel de esquema).
SET @has_thousand := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'currencies'
    AND COLUMN_NAME = 'thousand_separator');
SET @sql_add_thousand := IF(@has_thousand = 0,
  'ALTER TABLE currencies ADD COLUMN thousand_separator VARCHAR(1) NOT NULL DEFAULT '','' AFTER symbol',
  'SELECT 1');
PREPARE stmt_add_thousand FROM @sql_add_thousand;
EXECUTE stmt_add_thousand;
DEALLOCATE PREPARE stmt_add_thousand;

SET @has_decimal := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'currencies'
    AND COLUMN_NAME = 'decimal_separator');
SET @sql_add_decimal := IF(@has_decimal = 0,
  'ALTER TABLE currencies ADD COLUMN decimal_separator VARCHAR(1) NOT NULL DEFAULT ''.'' AFTER thousand_separator',
  'SELECT 1');
PREPARE stmt_add_decimal FROM @sql_add_decimal;
EXECUTE stmt_add_decimal;
DEALLOCATE PREPARE stmt_add_decimal;

-- Formato regional por moneda (re-ejecutable; solo actualiza filas ya existentes).
UPDATE currencies
   SET thousand_separator = '.',
       decimal_separator  = ','
 WHERE code IN ('EUR','ARS','CLP','COP','BRL');

UPDATE currencies
   SET thousand_separator = ',',
       decimal_separator  = '.'
 WHERE code IN ('DOP','USD','MXN','PEN');