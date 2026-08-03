-- ============================================================
-- CrediPay MDM - Detalles de pagos en cascada (Fase 2)
-- 0005_payment_details.sql
-- ============================================================

SET NAMES utf8mb4;

-- change_amount: vuelto devuelto al cliente (efectivo)
-- installments_breakdown: distribución en cascada (cuotas afectadas)
ALTER TABLE payments_received
  ADD COLUMN change_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER amount,
  ADD COLUMN installments_breakdown JSON NULL AFTER change_amount;
