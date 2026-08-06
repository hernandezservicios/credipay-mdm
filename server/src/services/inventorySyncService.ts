import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import type { MdmConfig } from './tenantService.js';
import { getInovaGuardDevices } from '../integrations/inovaGuard/index.js';

/**
 * Reconciliación del inventario InovaGuard con la tabla local `devices`
 * (SYSTEM_SYNC, Fase 4).
 * - Upsert por inovaguard_id dentro del tenant.
 * - Vincula el dispositivo al cliente local cuyo cédula/id coincida con
 *   el owner_identifier de InovaGuard (comparando solo dígitos).
 * - Registra device_events de tipo STATUS cuando el estado cambió.
 */

export interface SyncInventoryReport {
  total: number;
  created: number;
  updated: number;
  matchedClients: number;
  simulated: boolean;
  errors: number;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v || v === 'N/D' || v === 'Desconocido') return null;
  return v.length > max ? v.slice(0, max) : v;
}

async function matchClientByOwner(tenantId: number, ownerIdentifier: string): Promise<number | null> {
  const digits = String(ownerIdentifier ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM clients
      WHERE tenant_id = ? AND deleted_at IS NULL
        AND REGEXP_REPLACE(cedula_or_id, '[^0-9]', '') = ?
      LIMIT 1`,
    [tenantId, digits]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function recordStatusEvent(input: {
  deviceId: number;
  tenantId: number;
  clientId: number | null;
  action: 'LOCK' | 'UNLOCK' | 'STATUS';
  status: 'SUCCESS' | 'FAILED';
  imei: string | null;
  details: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO device_events
      (device_id, tenant_id, client_id, action, trigger_source, status, imei, details)
     VALUES (?, ?, ?, ?, 'SYSTEM_SYNC', ?, ?, ?)`,
    [
      input.deviceId,
      input.tenantId,
      input.clientId,
      input.action,
      input.status,
      input.imei,
      input.details,
    ]
  );
}

export async function syncInovaGuardInventory(
  tenantId: number,
  cfg: MdmConfig
): Promise<SyncInventoryReport> {
  const { devices, isSimulated } = await getInovaGuardDevices(tenantId, cfg, { force: true });

  let created = 0;
  let updated = 0;
  let matchedClients = 0;
  let errors = 0;

  for (const dev of devices) {
    try {
      const imei = truncate(dev.imei !== 'N/D' ? dev.imei : null, 20);
      const serial = truncate(dev.serie, 50);
      const brand = truncate(dev.brand !== 'Desconocido' ? dev.brand : null, 60);
      const model = truncate(dev.model !== 'N/D' ? dev.model : null, 150);
      const deviceName = truncate(dev.deviceName, 150);
      const unlockCode = truncate(dev.unlockCode, 20);
      const status = dev.status === 'LOCKED' ? 'LOCKED' : 'UNLOCKED';

      const clientId = dev.assignedClientId
        ? await matchClientByOwner(tenantId, dev.assignedClientId)
        : null;
      if (clientId !== null) matchedClients++;

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id, mdm_status, client_id, imei FROM devices
          WHERE inovaguard_id = ? AND tenant_id = ? AND deleted_at IS NULL
          LIMIT 1`,
        [dev.id, tenantId]
      );

      if (existing[0]) {
        const deviceId = Number(existing[0].id);
        const prevStatus = existing[0].mdm_status as string;
        await pool.query(
          `UPDATE devices
              SET client_id = COALESCE(?, client_id),
                  device_name = COALESCE(?, device_name),
                  brand = COALESCE(?, brand),
                  model = COALESCE(?, model),
                  imei = COALESCE(?, imei),
                  serial_number = COALESCE(?, serial_number),
                  mdm_status = ?,
                  unlock_code = COALESCE(?, unlock_code),
                  last_mdm_sync_at = NOW(),
                  last_mdm_sync_note = ?
            WHERE id = ? AND tenant_id = ?`,
          [
            clientId,
            deviceName,
            brand,
            model,
            imei,
            serial,
            status,
            unlockCode,
            `SYNC_INVENTORY (${isSimulated ? 'simulado' : 'real'})`,
            deviceId,
            tenantId,
          ]
        );
        updated++;

        if (prevStatus !== status) {
          const action = status === 'LOCKED' ? 'LOCK' : 'UNLOCK';
          await recordStatusEvent({
            deviceId,
            tenantId,
            clientId,
            action,
            status: 'SUCCESS',
            imei,
            details: `Reconciliación de inventario: estado ${prevStatus} → ${status}`,
          });
        }
      } else {
        const [insertRes] = await pool.query<import('mysql2').ResultSetHeader>(
          `INSERT INTO devices
            (tenant_id, client_id, device_name, inovaguard_id, brand, model, imei,
             serial_number, mdm_status, unlock_code, remote_lock_supported,
             last_mdm_sync_at, last_mdm_sync_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?)`,
          [
            tenantId,
            clientId,
            deviceName,
            truncate(dev.id, 50),
            brand,
            model,
            imei,
            serial,
            status,
            unlockCode,
            `SYNC_INVENTORY (${isSimulated ? 'simulado' : 'real'})`,
          ]
        );
        created++;
        await recordStatusEvent({
          deviceId: Number(insertRes.insertId),
          tenantId,
          clientId,
          action: status === 'LOCKED' ? 'LOCK' : 'UNLOCK',
          status: 'SUCCESS',
          imei,
          details: 'Dispositivo incorporado al parque desde el inventario InovaGuard',
        });
      }
    } catch (err) {
      errors++;
      console.error(`[SYNC_INVENTORY] dispositivo ${dev.id}:`, err);
    }
  }

  return { total: devices.length, created, updated, matchedClients, simulated: isSimulated, errors };
}
