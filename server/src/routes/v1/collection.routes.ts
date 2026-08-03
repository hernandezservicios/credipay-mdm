import { Router } from 'express';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import {
  getCollectionSummary,
  listReminders,
  listRuns,
  runCollectionEngine,
  sendReminder,
  type RunSource,
} from '../../services/collectionService.js';

const router = Router();

router.use(authRequired, csrfProtect);

// ---------------------------------------------------------------------------
// Motor de Cobranza Automática + IA (Fase 6)
// ---------------------------------------------------------------------------

router.get(
  '/summary',
  requireTenant,
  requirePermission('collection.view'),
  async (req: TenantRequest, res) => {
    const summary = await getCollectionSummary(req.ctx!.tenantId);
    res.json({ data: summary });
  }
);

router.post(
  '/run',
  requireTenant,
  requirePermission('collection.run'),
  async (req: TenantRequest, res) => {
    const source: RunSource =
      req.body?.source === 'SCHEDULED' || req.body?.source === 'API' ? req.body.source : 'MANUAL';
    const report = await runCollectionEngine(req.ctx!.tenantId, req.auth!.userId, source);
    void recordAudit(
      {
        tenantId: req.ctx!.tenantId,
        userId: req.auth!.userId,
        action: 'COLLECTION_RUN',
        entityType: 'collection_run',
        entityId: String(report.runId),
        newValues: report,
      },
      req as AuthRequest
    );
    void recordActivity(
      req.ctx!.tenantId,
      req.auth!.userId,
      'COBRANZA',
      `Motor de cobranza ejecutado: ${report.total} recordatorio(s) generados`,
      req as AuthRequest
    );
    res.json({ data: report });
  }
);

router.get(
  '/reminders',
  requireTenant,
  requirePermission('collection.view'),
  async (req: TenantRequest, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
    const limit = Math.min(Number(req.query.limit ?? 100), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const rows = await listReminders(req.ctx!.tenantId, status, limit, offset);
    res.json({ data: rows });
  }
);

router.post(
  '/reminders/:id/send',
  requireTenant,
  requirePermission('collection.send'),
  async (req: TenantRequest, res) => {
    const reminderId = Number(req.params.id);
    if (!Number.isInteger(reminderId) || reminderId <= 0) {
      res.status(400).json({ error: 'invalid_id', message: 'Recordatorio inválido' });
      return;
    }
    const reminder = await sendReminder(reminderId, req.ctx!.tenantId, req.auth!.userId);
    void recordAudit(
      {
        tenantId: req.ctx!.tenantId,
        userId: req.auth!.userId,
        action: 'COLLECTION_REMINDER_SENT',
        entityType: 'collection_reminder',
        entityId: String(reminderId),
        newValues: { clientName: reminder.full_name, type: reminder.reminder_type },
      },
      req as AuthRequest
    );
    void recordActivity(
      req.ctx!.tenantId,
      req.auth!.userId,
      'COBRANZA',
      `Recordatorio ${reminder.reminder_type} marcado como enviado (${reminder.full_name})`,
      req as AuthRequest
    );
    res.json({ data: reminder });
  }
);

router.get(
  '/runs',
  requireTenant,
  requirePermission('collection.view'),
  async (req: TenantRequest, res) => {
    const rows = await listRuns(req.ctx!.tenantId);
    res.json({ data: rows });
  }
);

export default router;