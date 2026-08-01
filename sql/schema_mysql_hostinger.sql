-- ==============================================================================
-- ESQUEMA DE BASE DE DATOS MySQL (COMPATIBLE CON HOSTINGER / cPANEL / VPS)
-- SISTEMA: CrediPay MDM & InovaGuard MDM
-- Versión: 1.0 PROD
-- ==============================================================================

-- 1. CONFIGURACIÓN INICIAL DEL ESQUEMA
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `mdm_logs`;
DROP TABLE IF EXISTS `cuotas`;
DROP TABLE IF EXISTS `dispositivos`;
DROP TABLE IF EXISTS `clientes`;
DROP TABLE IF EXISTS `mdm_configuracion`;
SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- 2. TABLA DE CONFIGURACIÓN GLOBAL MDM
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `mdm_configuracion` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `app_client` VARCHAR(100) NOT NULL COMMENT 'ID de empresa en InovaGuard',
  `username` VARCHAR(150) NOT NULL COMMENT 'Usuario InovaGuard',
  `api_key` VARCHAR(255) NOT NULL COMMENT 'Token / API Key REST InovaGuard',
  `base_url` VARCHAR(255) DEFAULT 'https://inovaguard.net' COMMENT 'Endpoint de API InovaGuard',
  `auto_engine_active` TINYINT(1) DEFAULT 1 COMMENT '1 = Motor 3 días de atraso activo',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 3. TABLA DE CLIENTES (TITULARES DEL CRÉDITO)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `clientes` (
  `id` VARCHAR(50) NOT NULL PRIMARY KEY COMMENT 'ID único del cliente (e.g., CLI-001)',
  `full_name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `email` VARCHAR(120) NULL,
  `credit_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `balance_due` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `days_overdue` INT NOT NULL DEFAULT 0,
  `status` ENUM('AL_DIA', 'ATRASADO', 'VENCIDO') NOT NULL DEFAULT 'AL_DIA',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_status` (`status`),
  INDEX `idx_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 4. TABLA DE DISPOSITIVOS (PARQUE INOVAGUARD MDM)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `dispositivos` (
  `id` VARCHAR(50) NOT NULL PRIMARY KEY COMMENT 'ID interno del dispositivo',
  `client_id` VARCHAR(50) NOT NULL,
  `inovaguard_id` VARCHAR(80) NULL COMMENT 'ID interno devuelto por InovaGuard API',
  `imei` VARCHAR(30) NOT NULL UNIQUE COMMENT 'IMEI de 15 dígitos del celular',
  `model` VARCHAR(100) NOT NULL COMMENT 'Modelo e.g. Samsung Galaxy A54',
  `mdm_status` ENUM('LOCKED', 'UNLOCKED', 'PENDING') NOT NULL DEFAULT 'UNLOCKED',
  `last_mdm_sync` VARCHAR(255) NULL COMMENT 'Texto descriptivo o timestamp de último sync',
  `last_unlock_code` VARCHAR(20) NULL COMMENT 'PIN de desbloqueo temporal generado',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_dispositivo_cliente` FOREIGN KEY (`client_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX `idx_imei` (`imei`),
  INDEX `idx_inovaguard_id` (`inovaguard_id`),
  INDEX `idx_mdm_status` (`mdm_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 5. TABLA DE CUOTAS / AMORTIZACIÓN
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `cuotas` (
  `id` VARCHAR(50) NOT NULL PRIMARY KEY COMMENT 'ID de cuota (e.g. c1, c2)',
  `client_id` VARCHAR(50) NOT NULL,
  `number` INT UNSIGNED NOT NULL COMMENT 'Número correlativo de cuota (1, 2, 3...)',
  `due_date` DATE NOT NULL COMMENT 'Fecha pactada de vencimiento (YYYY-MM-DD)',
  `amount` DECIMAL(10, 2) NOT NULL,
  `late_fee` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Recargo moratorio por atraso (RD$200 DOP)',
  `status` ENUM('PAID', 'PENDING', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
  `paid_at` DATETIME NULL COMMENT 'Fecha y hora real de pago',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cuota_cliente` FOREIGN KEY (`client_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX `idx_cuota_cliente` (`client_id`),
  INDEX `idx_cuota_due_date` (`due_date`),
  INDEX `idx_cuota_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 6. TABLA DE LOGS DE AUDITORÍA MDM & COBRANZA
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `mdm_logs` (
  `id` VARCHAR(60) NOT NULL PRIMARY KEY,
  `client_id` VARCHAR(50) NULL,
  `client_name` VARCHAR(150) NOT NULL,
  `imei` VARCHAR(50) NOT NULL,
  `action` ENUM('LOCK', 'UNLOCK', 'STATUS_CHECK', 'UNLOCK_CODE', 'REMOVE', 'SYNC_DEVICES') NOT NULL,
  `trigger_type` ENUM('AUTOMATIC_OVERDUE', 'AUTOMATIC_PAYMENT', 'MANUAL_OPERATOR', 'SYSTEM_SYNC') NOT NULL,
  `details` TEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_log_imei` (`imei`),
  INDEX `idx_log_action` (`action`),
  INDEX `idx_log_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 7. DATOS DE EJEMPLO PARA REEMPLAZO DE INITIAL_CLIENTS (SEEDING)
-- ==============================================================================

INSERT INTO `mdm_configuracion` (`id`, `app_client`, `username`, `api_key`, `base_url`, `auto_engine_active`)
VALUES (1, 'INOVA-EMP-8842', 'admin@fintechmx.com', 'ig_prod_token_9938201a3c8d', 'https://inovaguard.net', 1)
ON DUPLICATE KEY UPDATE `app_client`=VALUES(`app_client`);

-- Insertar Clientes
INSERT INTO `clientes` (`id`, `full_name`, `phone`, `credit_amount`, `balance_due`, `days_overdue`, `status`) VALUES
('CLI-001', 'Carlos Mendoza Rivera', '+52 55 4192 8831', 6500.00, 4800.00, 4, 'ATRASADO'),
('CLI-002', 'María Fernanda López', '+52 33 1928 3341', 8200.00, 3100.00, 0, 'AL_DIA'),
('CLI-003', 'Jorge Eduardo Gómez', '+52 81 2239 4410', 5000.00, 5000.00, 11, 'VENCIDO');

-- Insertar Dispositivos Asociados
INSERT INTO `dispositivos` (`id`, `client_id`, `inovaguard_id`, `imei`, `model`, `mdm_status`, `last_mdm_sync`, `last_unlock_code`) VALUES
('DEV-001', 'CLI-001', 'DEV-IG-8831', '358921098412334', 'Samsung Galaxy A54 5G', 'LOCKED', 'Lock automático ejecutado vía API (4 días mora)', '883921'),
('DEV-002', 'CLI-002', 'DEV-IG-3341', '864192048192831', 'Xiaomi Redmi Note 13', 'UNLOCKED', 'Ping OK - Estado en Regla', NULL),
('DEV-003', 'CLI-003', 'DEV-IG-4410', '359012849102938', 'Motorola Moto G84', 'LOCKED', 'Bloqueo crítico - Atraso de 11 días', '192833');

-- Insertar Cuotas de Ejemplo (Cliente CLI-001)
INSERT INTO `cuotas` (`id`, `client_id`, `number`, `due_date`, `amount`, `late_fee`, `status`, `paid_at`) VALUES
('CLI-001-c1', 'CLI-001', 1, '2025-01-01', 1200.00, 0.00, 'PAID', '2025-01-01 14:30:00'),
('CLI-001-c2', 'CLI-001', 2, '2025-01-15', 1200.00, 200.00, 'OVERDUE', NULL),
('CLI-001-c3', 'CLI-001', 3, '2025-02-01', 1200.00, 0.00, 'PENDING', NULL),
('CLI-001-c4', 'CLI-001', 4, '2025-02-15', 1200.00, 0.00, 'PENDING', NULL);

-- Insertar Logs Iniciales
INSERT INTO `mdm_logs` (`id`, `client_id`, `client_name`, `imei`, `action`, `trigger_type`, `details`) VALUES
('LOG-001', 'CLI-001', 'Carlos Mendoza Rivera', '358921098412334', 'LOCK', 'AUTOMATIC_OVERDUE', 'Bloqueo MDM aplicado automáticamente. Cuota vencida con 4 días de mora en Hostinger DB.'),
('LOG-002', 'CLI-002', 'María Fernanda López', '864192048192831', 'UNLOCK', 'AUTOMATIC_PAYMENT', 'Desbloqueo al día. Pago verificado en servidor MySQL.'),
('LOG-003', 'CLI-003', 'Jorge Eduardo Gómez', '359012849102938', 'LOCK', 'MANUAL_OPERATOR', 'Bloqueo manual por falta de acuerdo de pago en cobranza.');
