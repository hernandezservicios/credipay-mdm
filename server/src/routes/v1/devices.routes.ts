import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { pool } from '../../db/pool.js';
import { listDevices, updateDevice } from '../../services/repoService.js';
import { findInovaGuardDevice, invalidateInovaGuardCache } from '../../services/inovaGuardService.js';
import { recordAudit, recordActivity } from '../../services/auditService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

router.get('/', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 50), 200);
  const result = await listDevices(req.ctx!.tenantId, {
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page,
    perPage,
  });
  res.json(result);
});

router.post('/', requirePermission('devices.edit'), async (req: TenantRequest, res) => {
  const body = req.body as {
    clientId?: number;
    deviceName?: string;
    inovaguardId?: string;
    brand?: string;
    model?: string;
    imei?: string;
    serialNumber?: string;
    mdmStatus?: string;
    unlockCode?: string;
  };
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const imei = typeof body.imei === 'string' ? body.imei.trim() : '';
  if (!model && !imei) {
    res.status(400).json({ error: 'invalid_device', message: 'Modelo o IMEI son obligatorios' });
    return;
  }
  const clientId = body.clientId !== undefined ? Number(body.clientId) : null;
  if (clientId !== null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [clientId, req.ctx!.tenantId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
      return;
    }
  }
  const [insertRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO devices
      (tenant_id, client_id, device_name, inovaguard_id, brand, model, imei,
       serial_number, mdm_status, unlock_code, remote_lock_supported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      req.ctx!.tenantId,
      clientId,
      typeof body.deviceName === 'string' ? body.deviceName.trim() || null : null,
      typeof body.inovaguardId === 'string' ? body.inovaguardId.trim() || null : null,
      body.brand?.trim() || null,
      model || null,
      imei || null,
      typeof body.serialNumber === 'string' ? body.serialNumber.trim() || null : null,
      body.mdmStatus === 'LOCKED' ? 'LOCKED' : 'UNLOCKED',
      typeof body.unlockCode === 'string' ? body.unlockCode.trim() || null : null,
    ]
  );
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'DEVICE_CREATED',
      entityType: 'device',
      entityId: String(insertRes.insertId),
      newValues: body,
    },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'DEVICE',
    'Dispositivo registrado en el parque MDM',
    req as AuthRequest
  );
  res.status(201).json({ data: { id: insertRes.insertId } });
});

router.patch('/:id', requirePermission('devices.edit'), async (req: TenantRequest, res) => {
  const id = Number(req.params.id);
  await updateDevice(req.ctx!.tenantId, id, {
    clientId: req.body.clientId !== undefined ? req.body.clientId : undefined,
    deviceName: typeof req.body.deviceName === 'string' ? req.body.deviceName : undefined,
    inovaguardId: typeof req.body.inovaguardId === 'string' ? req.body.inovaguardId : undefined,
    brand: typeof req.body.brand === 'string' ? req.body.brand : undefined,
    model: typeof req.body.model === 'string' ? req.body.model : undefined,
    imei: typeof req.body.imei === 'string' ? req.body.imei : undefined,
    serialNumber: typeof req.body.serialNumber === 'string' ? req.body.serialNumber : undefined,
    mdmStatus: typeof req.body.mdmStatus === 'string' ? req.body.mdmStatus : undefined,
    unlockCode: typeof req.body.unlockCode === 'string' ? req.body.unlockCode : undefined,
  });
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'DEVICE_UPDATED',
      entityType: 'device',
      entityId: String(id),
      newValues: req.body,
    },
    req as AuthRequest
  );
  res.json({ data: { id } });
});

router.post('/:id/sync', requirePermission('devices.view'), async (req: TenantRequest, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, inovaguard_id, mdm_status FROM devices WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [id, req.ctx!.tenantId]
  );
  const device = rows[0] as { id: number; inovaguard_id: string | null; mdm_status: string } | undefined;
  if (!device) {
    res.status(404).json({ error: 'not_found', message: 'Dispositivo no encontrado' });
    return;
  }
  if (!device.inovaguard_id) {
    res.status(400).json({ error: 'no_inovaguard_id', message: 'El dispositivo no tiene ID InovaGuard' });
    return;
  }

  const { device: remote, isSimulated } = await findInovaGuardDevice(
    req.ctx!.tenantId,
    req.ctx!.mdmConfig,
    device.inovaguard_id
  );

  if (remote) {
    await updateDevice(req.ctx!.tenantId, id, {
      mdmStatus: remote.status,
      imei: remote.imei !== 'N/D' ? remote.imei : undefined,
      unlockCode: remote.unlockCode,
      model: remote.model !== 'N/D' ? remote.model : undefined,
      brand: remote.brand !== 'Desconocido' ? remote.brand : undefined,
    });
  }
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'DEVICE_SYNC',
    `Sincronización MDM del dispositivo #${id} (${isSimulated ? 'simulada' : 'real'})`,
    req as AuthRequest
  );
  res.json({ data: { id, remoteStatus: remote?.status ?? null, isSimulated } });
});

export default router;
