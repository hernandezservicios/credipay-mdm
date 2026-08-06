SET NAMES utf8mb4;

-- =========================================================================
-- 0015 - Arquitectura Consolidada (Blueprint v2.1: D25, D26, D37, D49)
--   B1: Elimina tablas huerfanas verificadas (sin referencias en codigo ni FK)
--       NOTA: `queue` se CONSERVA (usada por jobService/scheduler/webhooks).
-- =========================================================================

-- 1) Tablas huerfanas (verificadas: sin uso en codigo server)
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS device_status;
DROP TABLE IF EXISTS system_logs;
DROP TABLE IF EXISTS feature_flags;

-- 2) Timeline del prestamo (D25) -- append-only, RESTRICT (D6)
CREATE TABLE IF NOT EXISTS loan_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  credit_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  description VARCHAR(500) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_le_loan (tenant_id, credit_id, created_at),
  KEY idx_le_client (tenant_id, client_id, created_at),
  CONSTRAINT fk_le_credit FOREIGN KEY (credit_id) REFERENCES credits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_le_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3) Saldo a favor (D15 / D26) -- ledger por cliente
CREATE TABLE IF NOT EXISTS payment_credits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  credit_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  consumed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('AVAILABLE','CONSUMED','REFUNDED') NOT NULL DEFAULT 'AVAILABLE',
  source_payment_id BIGINT UNSIGNED NULL,
  notes VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pc_client (tenant_id, client_id, status),
  CONSTRAINT fk_pc_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pc_credit FOREIGN KEY (credit_id) REFERENCES credits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4) Config motor de pagos por tenant (D26): application_order + overpayment_mode + rounding
UPDATE tenant_settings
  SET payment_config = JSON_MERGE_PRESERVE(
        COALESCE(payment_config, JSON_OBJECT()),
        JSON_OBJECT(
          'application_order', JSON_ARRAY('penalty','interest','principal','future','credit_balance'),
          'overpayment_mode', 'PREPAY',
          'rounding', 2
        )
      );

-- 5) Indices de alto uso para el motor (D37 / D49 / R15) -- agregados condicionales
SET @exists := 0;
SELECT COUNT(*) INTO @exists
  FROM information_schema.statistics
 WHERE table_schema = DATABASE()
   AND table_name = 'credit_installments'
   AND index_name = 'idx_inst_tenant_credit_status';
SET @sql := IF(@exists = 0,
  'CREATE INDEX idx_inst_tenant_credit_status ON credit_installments (tenant_id, credit_id, status)',
  'SELECT ''idx_inst_tenant_credit_status ya existe''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := 0;
SET @sql := NULL;
SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'payments_received'
     AND index_name = 'idx_payrec_tenant_credit_date');
SET @sql := IF(@exists = 0,
  'CREATE INDEX idx_payrec_tenant_credit_date ON payments_received (tenant_id, credit_id, received_date)',
  'SELECT ''idx_payrec_tenant_credit_date ya existe''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;