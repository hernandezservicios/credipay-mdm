-- ============================================================
-- CrediPay MDM - Deduplicación de roles globales (Fase 2)
-- 0006_fix_roles_dedupe.sql
-- ============================================================
-- Problema: INSERT IGNORE con tenant_id NULL no deduplica en el
-- índice único (tenant_id, slug) porque NULL != NULL en MySQL,
-- por lo que ejecuciones repetidas del seed duplicaban los roles.
-- Se conserva el rol de menor id por slug (los usuarios apuntan a
-- esos); los duplicados se eliminan y sus role_permissions se
-- borran en cascada (son copias de los mismos permisos).

SET NAMES utf8mb4;

DELETE r2
  FROM roles r1
  JOIN roles r2
    ON r2.tenant_id <=> r1.tenant_id
   AND r2.slug = r1.slug
   AND r2.id > r1.id
 WHERE r1.tenant_id IS NULL;
