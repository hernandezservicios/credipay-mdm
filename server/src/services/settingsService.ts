// ============================================================================
// CrediPay MDM - Fase 8
// settingsService.ts
// Lectura de system_settings (JSON) con caché en memoria de 60s para evitar
// consultas repetidas dentro del scheduler.
// ============================================================================

import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';

interface SettingsCache {
  data: Map<string, unknown>;
  loadedAt: number;
}

let cache: SettingsCache = { data: new Map(), loadedAt: 0 };
const TTL_MS = 60_000;

async function refresh(force = false): Promise<void> {
  if (!force && Date.now() - cache.loadedAt < TTL_MS) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT setting_key, setting_value FROM system_settings'
  );
  cache = {
    data: new Map(rows.map((r) => [r.setting_key, r.setting_value])),
    loadedAt: Date.now(),
  };
}

function unwrap(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj && 'value' in obj && Object.keys(obj).length === 1) return obj.value;
    return obj;
  }
  return value;
}

export async function getSetting(key: string): Promise<unknown> {
  await refresh();
  const raw = cache.data.get(key);
  return unwrap(raw ?? null);
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) && v !== null ? n : fallback;
}

export async function getSettingString(key: string, fallback: string): Promise<string> {
  const v = await getSetting(key);
  return typeof v === 'string' ? v : fallback;
}

export async function getSettingBoolean(key: string, fallback: boolean): Promise<boolean> {
  const v = await getSetting(key);
  if (v === null || v === undefined) return fallback;
  return Boolean(v);
}

/** Impide que los tests/seeds usen valores en caché obsoletos. */
export function resetSettingsCache(): void {
  cache = { data: new Map(), loadedAt: 0 };
}