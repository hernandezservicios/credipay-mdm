// ============================================================================
// CrediPay MDM - Fase 8
// backupService.ts
// Respaldo de la base de datos con mysqldump (WAMP): registro en `backups`,
// checksum sha256, tamaño y poda por retención. Puede ejecutarse manualmente
// o a través del job diario del scheduler.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from './../db/pool.js';
import { env } from './../config/env.js';
import { getSettingNumber, getSettingString } from './settingsService.js';
import { ApiError } from './../utils/http.js';

export type BackupType = 'FULL' | 'SCHEMA' | 'DATA';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MYSQLDUMP_CANDIDATES = [
  'mysqldump',
  'C:\\wamp64\\bin\\mysql\\mysql8.4.7\\bin\\mysqldump.exe',
  'C:\\wamp64\\bin\\mysql\\mysql5.7.26\\bin\\mysqldump.exe',
  'C:\\wamp\\bin\\mysql\\mysql8.0.31\\bin\\mysqldump.exe',
];

export function resolveMysqldumpPath(): string {
  if (env.MYSQLDUMP_PATH && fs.existsSync(env.MYSQLDUMP_PATH)) return env.MYSQLDUMP_PATH;
  for (const candidate of MYSQLDUMP_CANDIDATES) {
    if (candidate === 'mysqldump') continue; // depende del PATH del proceso
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'mysqldump';
}

export async function resolveBackupDir(): Promise<string> {
  const dir = env.BACKUP_DIR || (await getSettingString('backups.directory', './backups'));
  const resolved = path.isAbsolute(dir) ? dir : path.resolve(SERVER_ROOT, dir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

async function pruneBackups(): Promise<void> {
  const retentionDays = await getSettingNumber('backups.retention_days', 14);
  const dir = await resolveBackupDir();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, filename, status FROM backups
      WHERE completed_at < NOW() - INTERVAL ? DAY AND status = 'SUCCESS'`,
    [retentionDays]
  );
  for (const row of rows) {
    const filePath = path.join(dir, String(row.filename));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[backups] no se pudo borrar ${filePath}:`, err);
      }
    }
  }
  if (rows.length > 0) {
    const ids = rows.map((r) => Number(r.id));
    await pool.query('DELETE FROM backups WHERE id IN (?)', [ids]);
  }
}

function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function runBackup(type: BackupType = 'FULL', tenantId: number | null): Promise<{
  backupId: number;
  filename: string;
  sizeBytes: number;
  checksum: string;
  status: 'SUCCESS';
}> {
  const dir = await resolveBackupDir();
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .slice(0, 19)
    .replace('-', '')
    .replace('-', '');
  const filename = `credipay_mdm_${stamp}_${type}.sql`;
  const filePath = path.join(dir, filename);

  const [insertRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO backups (tenant_id, backup_type, filename, status, started_at)
     VALUES (?, ?, ?, 'RUNNING', NOW())`,
    [tenantId, type, filename]
  );
  const backupId = insertRes.insertId;

  const mysqldump = resolveMysqldumpPath();
  const args = [
    '--no-tablespaces',
    '--single-transaction',
    '--routines',
    '--skip-comments',
    '-u',
    env.DB_USER,
    env.DB_NAME,
    `--result-file=${filePath}`,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(mysqldump, args, {
        env: { ...process.env, MYSQL_PWD: env.DB_PASS },
        windowsHide: true,
        shell: false,
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mysqldump terminó con código ${code}: ${stderr.slice(0, 300)}`));
      });
    });

    if (!fs.existsSync(filePath)) {
      throw new Error('mysqldump no generó el archivo de respaldo');
    }
    const sizeBytes = fs.statSync(filePath).size;
    const checksum = await checksumFile(filePath);

    await pool.query(
      `UPDATE backups SET status = 'SUCCESS', size_bytes = ?, checksum = ?, completed_at = NOW()
        WHERE id = ?`,
      [sizeBytes, checksum, backupId]
    );
    await pruneBackups();

    return { backupId, filename, sizeBytes, checksum, status: 'SUCCESS' };
  } catch (err) {
    await pool
      .query(
        `UPDATE backups SET status = 'FAILED', completed_at = NOW()
          WHERE id = ? AND status = 'RUNNING'`,
        [backupId]
      )
      .catch(() => undefined);
    console.error('[backups] respaldo fallido:', err);
    throw err;
  }
}

export async function listBackups(tenantId: number | null): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, backup_type AS type, filename, size_bytes AS sizeBytes,
            checksum, status, started_at AS startedAt, completed_at AS completedAt,
            UNIX_TIMESTAMP(started_at) * 1000 AS startedAtMs
       FROM backups
      WHERE (? IS NULL OR tenant_id = ?)
      ORDER BY id DESC
      LIMIT 50`,
    [tenantId, tenantId]
  );
  return rows;
}

export async function getBackupFile(
  backupId: number,
  tenantId: number | null = null
): Promise<{ filename: string; absPath: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT filename, status, tenant_id FROM backups WHERE id = ? AND (? IS NULL OR tenant_id = ?)`,
    [backupId, tenantId, tenantId]
  );
  const row = rows[0] as { filename: string; status: string } | undefined;
  if (!row) throw ApiError.notFound('Respaldo no encontrado');
  if (row.status !== 'SUCCESS') throw ApiError.badRequest('backup_not_ready', 'El respaldo no terminó correctamente');
  const dir = await resolveBackupDir();
  const absPath = path.join(dir, row.filename);
  if (!fs.existsSync(absPath)) throw ApiError.notFound('Archivo de respaldo no encontrado en disco');
  return { filename: row.filename, absPath };
}