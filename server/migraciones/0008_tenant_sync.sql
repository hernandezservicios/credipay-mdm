-- ============================================================
-- CrediPay MDM - Fase 4
-- Migración 0008 - Reconocimiento de inventario InovaGuard
-- 1) Permite el origen SYSTEM_SYNC en device_events (reconciliación
--    del inventario InovaGuard con la tabla local de dispositivos).
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE device_events
  MODIFY COLUMN trigger_source ENUM(
    'AUTOMATIC_OVERDUE','AUTOMATIC_PAYMENT','MANUAL','API','SCHEDULED','SYSTEM_SYNC'
  ) NOT NULL;