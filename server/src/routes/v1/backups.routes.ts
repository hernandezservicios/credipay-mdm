import { Router } from 'express';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { getBackupFile, listBackups, runBackup } from '../../services/backupService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect, requirePermission('backups.manage'));

// ---------------------------------------------------------------------------
// Backups (Fase 8): respaldo automático con mysqldump
// ---------------------------------------------------------------------------

router.get('/', async (req: AuthRequest, res) => {
  const rows = await listBackups(req.auth!.tenantId);
  res.json({ data: rows });
});

router.post('/run', async (req: AuthRequest, res) => {
  const type = req.body?.type === 'SCHEMA' || req.body?.type === 'DATA' ? req.body.type : 'FULL';
  const backup = await runBackup(type, req.auth!.tenantId);
  void recordAudit(
    {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: 'BACKUP_RUN',
      entityType: 'backup',
      entityId: String(backup.backupId),
      newValues: { type, filename: backup.filename, sizeBytes: backup.sizeBytes },
    },
    req as AuthRequest
  );
  void recordActivity(
    req.auth!.tenantId,
    req.auth!.userId,
    'BACKUP',
    `Respaldo ${type} completado: ${backup.filename} (${(backup.sizeBytes / 1024).toFixed(1)} KB)`,
    req as AuthRequest
  );
  res.json({ data: backup });
});

router.get('/:id/download', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('invalid_id', 'ID inválido');
  // El archivo se sirve con el nombre original y cabeceras de descarga.
  // Solo respaldos del propio tenant (o globales FULL que no requieren tenant).
  const file = await getBackupFile(id, req.auth!.tenantId);
  res.download(file.absPath, file.filename);
});

export default router;