-- ============================================================
-- CrediPay MDM - Fase 9: Plataforma profesional de préstamos
-- Migración 0014 - Motor financiero configurable, configuración
-- por tenant, caja, clientes extendidos y acuerdos de pago.
-- IDEMPOTENTE.
-- ============================================================

SET NAMES utf8mb4;

-- -------------------- CLIENTES EXTENDIDOS --------------------
ALTER TABLE clients
  ADD COLUMN customer_type ENUM('INDIVIDUAL','BUSINESS') NOT NULL DEFAULT 'INDIVIDUAL' AFTER status,
  ADD COLUMN birth_date DATE NULL AFTER customer_type,
  ADD COLUMN occupation VARCHAR(150) NULL AFTER birth_date,
  ADD COLUMN employer VARCHAR(150) NULL AFTER occupation,
  ADD COLUMN work_address VARCHAR(500) NULL AFTER employer,
  ADD COLUMN monthly_income DECIMAL(12,2) NULL AFTER work_address,
  ADD COLUMN monthly_expenses DECIMAL(12,2) NULL AFTER monthly_income,
  ADD COLUMN whatsapp VARCHAR(30) NULL AFTER phone,
  ADD COLUMN phone2 VARCHAR(30) NULL AFTER whatsapp,
  ADD COLUMN city VARCHAR(100) NULL AFTER address,
  ADD COLUMN province VARCHAR(100) NULL AFTER city,
  ADD COLUMN country VARCHAR(100) NULL AFTER province,
  ADD COLUMN postal_code VARCHAR(20) NULL AFTER country,
  ADD COLUMN personal_refs JSON NULL AFTER postal_code,
  ADD COLUMN commercial_refs JSON NULL AFTER personal_refs,
  ADD COLUMN documents JSON NULL AFTER commercial_refs,
  ADD COLUMN photos JSON NULL AFTER documents,
  ADD COLUMN signature_url VARCHAR(500) NULL AFTER photos,
  ADD COLUMN gps_location JSON NULL AFTER signature_url,
  ADD COLUMN internal_score TINYINT UNSIGNED NULL AFTER gps_location,
  ADD COLUMN classification VARCHAR(10) NULL AFTER internal_score,
  ADD COLUMN payment_capacity DECIMAL(12,2) NULL AFTER classification;

-- -------------------- CRÉDITOS: MOTOR FINANCIERO --------------------
ALTER TABLE credits
  ADD COLUMN principal_amount DECIMAL(12,2) NULL AFTER total_amount,
  ADD COLUMN annual_rate DECIMAL(8,4) NULL AFTER principal_amount,
  ADD COLUMN amortization_method VARCHAR(30) NOT NULL DEFAULT 'FRENCH' AFTER annual_rate,
  ADD COLUMN interest_total DECIMAL(12,2) NULL AFTER amortization_method,
  ADD COLUMN financing_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER interest_total,
  ADD COLUMN pending_principal DECIMAL(12,2) NULL AFTER financing_fee,
  ADD COLUMN approval_date DATE NULL AFTER pending_principal,
  ADD COLUMN disbursement_date DATE NULL AFTER approval_date,
  ADD COLUMN first_due_date DATE NULL AFTER disbursement_date,
  ADD COLUMN last_payment_at DATE NULL AFTER first_due_date,
  ADD COLUMN days_late INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_payment_at,
  ADD COLUMN last_overdue_at DATE NULL AFTER days_late,
  ADD COLUMN notes VARCHAR(1000) NULL AFTER last_overdue_at,
  ADD COLUMN refinanced_from BIGINT UNSIGNED NULL AFTER notes,
  ADD COLUMN previous_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER refinanced_from;

ALTER TABLE credits
  MODIFY status ENUM('PENDING','APPROVED','REJECTED','ACTIVE','PAID_OFF','CANCELED','DEFAULTED','REFINANCED','RESTRUCTURED')
    NOT NULL DEFAULT 'PENDING';

-- -------------------- CUOTAS: DESGLOSE --------------------
ALTER TABLE credit_installments
  ADD COLUMN principal_part DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER amount,
  ADD COLUMN interest_part DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER principal_part,
  ADD COLUMN capital_balance_before DECIMAL(12,2) NULL AFTER interest_part,
  ADD COLUMN last_penalty_calc DATE NULL AFTER penalty_amount;

-- -------------------- CONFIGURACIÓN POR TENANT (JSON) --------------------
ALTER TABLE tenant_settings
  ADD COLUMN company_info JSON NULL AFTER invoice_prefix,
  ADD COLUMN general_config JSON NULL AFTER company_info,
  ADD COLUMN loan_config JSON NULL AFTER general_config,
  ADD COLUMN overdue_config JSON NULL AFTER loan_config,
  ADD COLUMN payment_config JSON NULL AFTER overdue_config,
  ADD COLUMN integrations JSON NULL AFTER payment_config,
  ADD COLUMN integration_log JSON NULL AFTER integrations;

-- -------------------- PRODUCTOS DE PRÉSTAMO --------------------
CREATE TABLE IF NOT EXISTS loan_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  amortization_method VARCHAR(30) NOT NULL DEFAULT 'FRENCH',
  annual_rate DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
  min_amount DECIMAL(12,2) NULL,
  max_amount DECIMAL(12,2) NULL,
  min_terms SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  max_terms SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  default_terms SMALLINT UNSIGNED NOT NULL DEFAULT 12,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_lp_tenant (tenant_id, is_active),
  CONSTRAINT fk_lp_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- CAJA --------------------
CREATE TABLE IF NOT EXISTS cash_registers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  register_date DATE NOT NULL,
  status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  opened_by BIGINT UNSIGNED NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  expected_closing DECIMAL(12,2) NULL,
  counted_cash DECIMAL(12,2) NULL,
  difference DECIMAL(12,2) NULL,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME NULL,
  closing_notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cashreg_tenant_date (tenant_id, register_date),
  CONSTRAINT fk_cashreg_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cash_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  register_id BIGINT UNSIGNED NULL,
  type ENUM('COLLECTION','DISBURSEMENT','INCOME','EXPENSE','ADJUSTMENT') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  direction ENUM('IN','OUT') NOT NULL,
  method ENUM('CASH','TRANSFER','CARD','OTHER') NOT NULL DEFAULT 'CASH',
  reference VARCHAR(100) NULL,
  description VARCHAR(500) NULL,
  payment_id BIGINT UNSIGNED NULL,
  credit_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cm_tenant_date (tenant_id, created_at),
  KEY idx_cm_register (register_id),
  KEY idx_cm_payment (payment_id),
  CONSTRAINT fk_cm_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_register FOREIGN KEY (register_id)
    REFERENCES cash_registers (id) ON DELETE SET NULL,
  CONSTRAINT fk_cm_payment FOREIGN KEY (payment_id)
    REFERENCES payments_received (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- ACUERDOS DE PAGO --------------------
CREATE TABLE IF NOT EXISTS payment_agreements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  credit_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  agreed_date DATE NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  initial_payment DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  terms SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  frequency VARCHAR(20) NOT NULL DEFAULT 'WEEKLY',
  first_due_date DATE NULL,
  status ENUM('PENDING','ACTIVE','COMPLETED','BREACHED','CANCELED') NOT NULL DEFAULT 'ACTIVE',
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pa_tenant_credit (tenant_id, credit_id),
  KEY idx_pa_tenant_client (tenant_id, client_id),
  CONSTRAINT fk_pa_credit FOREIGN KEY (credit_id)
    REFERENCES credits (id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------- PERMISOS NUEVOS MÓDULOS --------------------
INSERT IGNORE INTO permissions (permission_key, module, name, description) VALUES
  ('loans.view',      'loans',  'Ver préstamos',         'Ver créditos y su detalle'),
  ('loans.manage',    'loans',  'Gestionar préstamos',   'Crear, editar y cancelar créditos'),
  ('loans.approve',   'loans',  'Aprobar préstamos',     'Aprobar o rechazar solicitudes'),
  ('loans.disburse',  'loans',  'Desembolsar préstamos', 'Registrar desembolsos'),
  ('loans.refinance', 'loans',  'Refinanciar préstamos', 'Refinanciar, reestructurar y renovar créditos'),
  ('loans.condone',   'loans',  'Condonar cuotas',       'Aplicar condonaciones y descuentos'),
  ('loans.agreements','loans',  'Acuerdos de pago',      'Gestionar acuerdos de pago'),
  ('cash.view',       'cash',   'Ver caja',              'Consultar caja y movimientos'),
  ('cash.register',   'cash',   'Abrir y cerrar caja',   'Apertura y cierre de caja'),
  ('cash.movements',  'cash',   'Movimientos de caja',   'Registrar ingresos, egresos y ajustes'),
  ('config.view',     'config', 'Ver configuración',     'Consultar la configuración del sistema'),
  ('config.manage',   'config', 'Gestionar configuración','Editar la configuración del sistema'),
  ('reports.view',    'reports','Ver reportes',          'Generar y exportar reportes'),
  ('dashboard.view',  'dashboard','Ver dashboard',       'Consultar métricas del tablero');

-- SUPER_ADMIN: cross join retroactivo
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'SUPER_ADMIN' AND r.tenant_id IS NULL
  AND p.permission_key IN ('loans.view','loans.manage','loans.approve','loans.disburse',
    'loans.refinance','loans.condone','loans.agreements','cash.view','cash.register',
    'cash.movements','config.view','config.manage','reports.view','dashboard.view');

-- ADMIN: permisos completos de su tenant
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('loans.view','loans.manage','loans.approve','loans.disburse',
    'loans.refinance','loans.condone','loans.agreements','cash.view','cash.register',
    'cash.movements','config.view','config.manage','reports.view','dashboard.view')
WHERE r.slug = 'ADMIN' AND r.tenant_id IS NULL;

-- GESTOR: operación diaria (caja, cobros, reportes, préstamos)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('loans.view','loans.manage','loans.agreements',
    'cash.view','cash.register','cash.movements','reports.view','dashboard.view')
WHERE r.slug = 'GESTOR' AND r.tenant_id IS NULL;

-- OPERADOR: cobranza y caja
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('loans.view','cash.view','cash.movements','dashboard.view')
WHERE r.slug = 'OPERADOR' AND r.tenant_id IS NULL;

-- CONSULTA: solo lectura
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.permission_key IN ('loans.view','cash.view','reports.view','dashboard.view')
WHERE r.slug = 'CONSULTA' AND r.tenant_id IS NULL;

-- -------------------- PRODUCTO PREDETERMINADO POR TENANT --------------------
INSERT IGNORE INTO loan_products
  (tenant_id, name, description, amortization_method, annual_rate,
   min_amount, max_amount, min_terms, max_terms, default_terms, is_default, is_active)
SELECT t.id, 'Préstamo General',
       'Producto predeterminado: cuota fija (francés) con tasa anual configurable',
       'FRENCH', 12.0000, 1000.00, 500000.00, 1, 24, 12, 1, 1
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM loan_products lp WHERE lp.tenant_id = t.id AND lp.is_default = 1
);

-- -------------------- RETROCOMPATIBILIDAD DE CRÉDITOS EXISTENTES --------------------
UPDATE credits
   SET principal_amount = total_amount,
       interest_total = 0.00,
       amortization_method = 'FRENCH'
 WHERE principal_amount IS NULL;

UPDATE credits c
   SET pending_principal = GREATEST(
         COALESCE(c.principal_amount, c.total_amount)
         - COALESCE((SELECT SUM(COALESCE(ci.paid_amount, 0))
                       FROM credit_installments ci
                      WHERE ci.credit_id = c.id AND ci.status = 'PAGADO' AND ci.deleted_at IS NULL), 0),
         0)
 WHERE c.pending_principal IS NULL;
