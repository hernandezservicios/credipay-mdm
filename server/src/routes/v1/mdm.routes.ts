import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { updateMdmConfig } from '../../services/tenantService.js';
import {
  findInovaGuardDevice,
  generateInovaGuardUnlockCode,
  getInovaGuardBalance,
  getInovaGuardDevices,
  getInovaGuardLicences,
  getInovaGuardQrEnrollment,
  invalidateInovaGuardCache,
  lockInovaGuardDevice,
  removeInovaGuardDevice,
  unlockInovaGuardDevice,
} from '../../services/inovaGuardService.js';
import { recordAudit, recordActivity } from '../../services/auditService.js';
import { syncInovaGuardInventory } from '../../services/inventorySyncService.js';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

// ---------------------------------------------------------------------------
// Configuración del MDM (solo mdm.config — contiene secretos)
// ---------------------------------------------------------------------------
router.get('/config', requirePermission('mdm.config'), async (req: TenantRequest, res) => {
  res.json({ data: req.ctx!.mdmConfig });
});

router.put('/config', requirePermission('mdm.config'), async (req: TenantRequest, res) => {
  const patch = req.body as Record<string, unknown>;
  const allowed: Record<string, unknown> = {};
  for (const key of [
    'provider', 'baseUrl', 'apiKey', 'appClient', 'secret', 'bearerToken',
    'authLoginEndpoint', 'devicesEndpoint', 'lockEndpoint', 'unlockEndpoint',
    'unlockCodeEndpoint', 'removeEndpoint', 'qrEndpoint', 'balanceEndpoint',
    'statusEndpoint', 'enabled', 'autoLockOnOverdue', 'autoUnlockOnPaid', 'liveMode',
  ]) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  if (Object.keys(allowed).length === 0) {
    res.status(400).json({ error: 'empty_patch', message: 'Sin cambios' });
    return;
  }
  const merged = await updateMdmConfig(req.ctx!.tenantId, allowed as never);
  invalidateInovaGuardCache(req.ctx!.tenantId);
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'MDM_CONFIG_UPDATED',
      entityType: 'tenant',
      entityId: String(req.ctx!.tenantId),
      newValues: { keys: Object.keys(allowed) },
    },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'MDM',
    'Configuración MDM actualizada',
    req as AuthRequest
  );
  res.json({ data: merged });
});

// ---------------------------------------------------------------------------
// Fotografía InovaGuard (devices + balance + licences)
// ---------------------------------------------------------------------------
router.get('/devices', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const { devices, isSimulated, totalDevices } = await getInovaGuardDevices(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig,
    { force }
  );
  res.json({ data: { devices, isSimulated, totalDevices } });
});

router.get('/balance', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const { balance, isSimulated } = await getInovaGuardBalance(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig,
    { force }
  );
  res.json({ data: { balance, isSimulated } });
});

router.get('/licences', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const { licences, isSimulated } = await getInovaGuardLicences(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig,
    { force }
  );
  res.json({ data: { licences, isSimulated } });
});

router.get('/devices/find/:id', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const { device, isSimulated } = await findInovaGuardDevice(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig,
    String(req.params.id)
  );
  res.json({ data: { device, isSimulated } });
});

router.get('/qr-enrollment', requirePermission('mdm.manual'), async (req: TenantRequest, res) => {
  const { qrDataUrl, enrollmentToken, isSimulated } = await getInovaGuardQrEnrollment(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig
  );
  res.json({ data: { qrDataUrl, enrollmentToken, isSimulated } });
});

// ---------------------------------------------------------------------------
// Reconciliación de inventario (SYSTEM_SYNC)
// ---------------------------------------------------------------------------
router.post('/sync-all', requirePermission('devices.edit'), async (req: TenantRequest, res) => {
  const report = await syncInovaGuardInventory(req.ctx!.tenantId, req.ctx!.mdmConfig);
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'MDM_SYNC',
    `Sincronización de inventario InovaGuard: ${report.created} creados, ${report.updated} actualizados (${report.simulated ? 'simulado' : 'real'})`,
    req as AuthRequest
  );
  res.json({ data: report });
});

// ---------------------------------------------------------------------------
// Comandos manuales sobre dispositivos
// ---------------------------------------------------------------------------
async function recordMdmAction(
  req: TenantRequest,
  deviceId: string,
  action: 'LOCK' | 'UNLOCK' | 'UNLOCK_CODE' | 'REMOVE',
  status: 'SUCCESS' | 'FAILED',
  details: string
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, client_id, imei FROM devices WHERE inovaguard_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1',
    [deviceId, req.ctx!.tenantId]
  );
  const device = rows[0] as { id: number; client_id: number | null; imei: string | null } | undefined;
  if (!device) return;
  await pool.query(
    `INSERT INTO device_events (device_id, tenant_id, client_id, action, trigger_source, status, imei, details)
     VALUES (?, ?, ?, ?, 'MANUAL', ?, ?, ?)`,
    [device.id, req.ctx!.tenantId, device.client_id, action, status, device.imei, details]
  );
  if (action === 'LOCK' && status === 'SUCCESS') {
    await pool.query(
      `INSERT INTO device_locks (device_id, tenant_id, trigger_source, reason, requested_at, completed_at, result, details)
       VALUES (?, ?, 'MANUAL', 'Bloqueo manual por operador', NOW(), NOW(), 'SUCCESS', ?)`,
      [device.id, req.ctx!.tenantId, details]
    );
  }
  if (action === 'UNLOCK' && status === 'SUCCESS') {
    await pool.query(
      `INSERT INTO device_unlocks (device_id, tenant_id, trigger_source, reason, requested_at, completed_at, result, details)
       VALUES (?, ?, 'MANUAL', 'Desbloqueo manual por operador', NOW(), NOW(), 'SUCCESS', ?)`,
      [device.id, req.ctx!.tenantId, details]
    );
  }
}

router.post('/devices/lock/:id', requirePermission('devices.lock'), async (req: TenantRequest, res) => {
  const result = await lockInovaGuardDevice(req.ctx!.tenantId, req.ctx!.mdmConfig, String(req.params.id));
  const status = result.err ? 'FAILED' : 'SUCCESS';
  await recordMdmAction(req, String(req.params.id), 'LOCK', status, result.message);
  if (status === 'SUCCESS') {
    await pool.query(
      `UPDATE devices SET mdm_status = 'LOCKED', last_mdm_sync_at = NOW(), last_mdm_sync_note = ?
        WHERE inovaguard_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [result.message, String(req.params.id), req.ctx!.tenantId]
    );
  }
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'MDM_LOCK',
    `Bloqueo MDM del dispositivo ${String(req.params.id)} (${result.isSimulated ? 'simulado' : 'real'})`,
    req as AuthRequest
  );
  res.json({ data: { ...result, recordedStatus: status } });
});

router.post('/devices/unlock/:id', requirePermission('devices.unlock'), async (req: TenantRequest, res) => {
  const result = await unlockInovaGuardDevice(req.ctx!.tenantId, req.ctx!.mdmConfig, String(req.params.id));
  const status = result.err ? 'FAILED' : 'SUCCESS';
  await recordMdmAction(req, String(req.params.id), 'UNLOCK', status, result.message);
  if (status === 'SUCCESS') {
    await pool.query(
      `UPDATE devices SET mdm_status = 'UNLOCKED', last_mdm_sync_at = NOW(), last_mdm_sync_note = ?
        WHERE inovaguard_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [result.message, String(req.params.id), req.ctx!.tenantId]
    );
  }
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'MDM_UNLOCK',
    `Desbloqueo MDM del dispositivo ${String(req.params.id)} (${result.isSimulated ? 'simulado' : 'real'})`,
    req as AuthRequest
  );
  res.json({ data: { ...result, recordedStatus: status } });
});

router.post(
  '/devices/unlock-code/:id',
  requirePermission('devices.unlock'),
  async (req: TenantRequest, res) => {
    const result = await generateInovaGuardUnlockCode(
      req.ctx!.tenantId,
      req.ctx!.mdmConfig,
      String(req.params.id)
    );
    const status = result.err ? 'FAILED' : 'SUCCESS';
    await recordMdmAction(req, String(req.params.id), 'UNLOCK_CODE', status, result.message);
    void recordActivity(
      req.ctx!.tenantId,
      req.auth!.userId,
      'MDM_UNLOCK_CODE',
      `Código de desbloqueo generado para ${String(req.params.id)}`,
      req as AuthRequest
    );
    res.json({ data: result });
  }
);

router.post(
  '/devices/remove/:id',
  requirePermission('devices.delete'),
  async (req: TenantRequest, res) => {
    const result = await removeInovaGuardDevice(req.ctx!.tenantId, req.ctx!.mdmConfig, String(req.params.id));
    const status = result.err ? 'FAILED' : 'SUCCESS';
    await recordMdmAction(req, String(req.params.id), 'REMOVE', status, result.message);
    void recordActivity(
      req.ctx!.tenantId,
      req.auth!.userId,
      'MDM_REMOVE',
      `Dispositivo ${String(req.params.id)} removido del MDM`,
      req as AuthRequest
    );
    res.json({ data: { ...result, recordedStatus: status } });
  }
);

export default router;
