SET NAMES utf8mb4;

-- 0016 - Idempotencia de cobros (R13) y soporte del motor unificado (Fase E)
-- Los pagos posteriores en /loans/:id/pay llevan idempotency_key unica por
-- tenant: un reintento (doble clic/recarga) no registra un pago duplicado.

ALTER TABLE payments_received
  ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER reference,
  ADD UNIQUE KEY idx_payrec_idem (tenant_id, idempotency_key);