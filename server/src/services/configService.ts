// ============================================================
// CrediPay MDM - Configuración por tenant (plataforma)
// Secciones: empresa, sistema, préstamos, mora, pagos e
// integraciones. Almacenadas como JSON en tenant_settings y
// fusionadas con valores por defecto.
// ============================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';
import { getTenant, getTenantSettings, type TenantSettingsRow } from './tenantService.js';
import {
  DEFAULT_OVERDUE_CONFIG,
  type OverdueConfig,
  AMORTIZATION_METHODS,
} from './loanEngine.js';

export interface CompanyInfo {
  company_name: string;
  trade_name: string;
  slogan: string;
  logo_url: string;
  favicon_url: string;
  address: string;
  city: string;
  province: string;
  country: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  tax_id: string;
  timezone: string;
  language: string;
  date_format: string;
}

export interface GeneralConfig {
  credit_number_prefix: string;
  receipt_prefix: string;
  invoice_prefix: string;
  rounding: 'HALF_UP' | 'CEIL' | 'FLOOR';
  work_days: number[];
  week_start_day: number;
  holidays: string[];
  default_payment_method: string;
}

// Moneda única (Adenda v2.5 / Plan Maestro v2.9, FASE 1).
// Única fuente: `tenants.currency_code` + tabla `currencies`.
export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  thousand_separator: string;
  decimal_separator: string;
}

// Catálogo por defecto (solo si la tabla `currencies` está vacía).
const DEFAULT_CURRENCY_BY_CODE: Record<string, Omit<CurrencyConfig, 'code'>> = {
  DOP: { name: 'Peso Dominicano', symbol: 'RD$', decimals: 2, thousand_separator: ',', decimal_separator: '.' },
  USD: { name: 'Dólar Estadounidense', symbol: 'US$', decimals: 2, thousand_separator: ',', decimal_separator: '.' },
  EUR: { name: 'Euro', symbol: '€', decimals: 2, thousand_separator: '.', decimal_separator: ',' },
  MXN: { name: 'Peso Mexicano', symbol: 'MX$', decimals: 2, thousand_separator: ',', decimal_separator: '.' },
  ARS: { name: 'Peso Argentino', symbol: 'AR$', decimals: 2, thousand_separator: '.', decimal_separator: ',' },
  CLP: { name: 'Peso Chileno', symbol: 'CL$', decimals: 0, thousand_separator: '.', decimal_separator: ',' },
  COP: { name: 'Peso Colombiano', symbol: 'CO$', decimals: 2, thousand_separator: '.', decimal_separator: ',' },
  BRL: { name: 'Real Brasileño', symbol: 'R$', decimals: 2, thousand_separator: '.', decimal_separator: ',' },
  PEN: { name: 'Sol Peruano', symbol: 'S/', decimals: 2, thousand_separator: ',', decimal_separator: '.' },
};

const DEFAULT_CURRENCY: CurrencyConfig = { code: 'DOP', ...DEFAULT_CURRENCY_BY_CODE.DOP };

export interface LoanConfig {
  default_method: string;
  default_rate: number;
  default_terms: number;
  allow_partial_payment: boolean;
  allow_early_payment: boolean;
  allow_capital_payments: boolean;
  allow_discounts: boolean;
  allow_condonation: boolean;
  allow_refinance: boolean;
  allow_restructure: boolean;
  allow_renewal: boolean;
  auto_disburse_on_approve: boolean;
}

export interface PaymentConfig {
  allow_partial_payment: boolean;
  allow_early_payment: boolean;
  allow_capital_payments: boolean;
  application_priority: 'INTEREST_FIRST' | 'PENALTY_FIRST' | 'CAPITAL_FIRST';
  require_cash_register: boolean;
  auto_unlock_on_paid: boolean;
  accept_methods: string[];
}

export interface IntegrationConfig {
  code: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  secret: string;
  token: string;
  endpoint: string;
  baseUrl: string;
  last_sync_at: string | null;
  last_error: string | null;
  connection_ok: boolean | null;
}

export interface PlatformConfig {
  companyInfo: CompanyInfo;
  generalConfig: GeneralConfig;
  loanConfig: LoanConfig;
  overdueConfig: OverdueConfig;
  paymentConfig: PaymentConfig;
  integrations: IntegrationConfig[];
  currency: CurrencyConfig;
}

export const CONFIG_SECTIONS = [
  'companyInfo',
  'generalConfig',
  'loanConfig',
  'overdueConfig',
  'paymentConfig',
  'integrations',
] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

const VALID_METHODS = AMORTIZATION_METHODS;

// ---------------------------------------------------------------------------
// Valores por defecto
// ---------------------------------------------------------------------------

export function defaultPlatformConfig(tenant?: { currency_code?: string; timezone?: string }): PlatformConfig {
  return {
    companyInfo: {
      company_name: '',
      trade_name: '',
      slogan: '',
      logo_url: '',
      favicon_url: '',
      address: '',
      city: '',
      province: '',
      country: 'DO',
      phone: '',
      whatsapp: '',
      email: '',
      website: '',
      tax_id: '',
      timezone: tenant?.timezone ?? 'America/Santo_Domingo',
      language: 'es',
      date_format: 'DD/MM/YYYY',
    },
    generalConfig: {
      credit_number_prefix: 'CR',
      receipt_prefix: 'REC',
      invoice_prefix: 'INV',
      rounding: 'HALF_UP',
      work_days: [1, 2, 3, 4, 5],
      week_start_day: 1,
      holidays: [],
      default_payment_method: 'CASH',
    },
    loanConfig: {
      default_method: 'FRENCH',
      default_rate: 12,
      default_terms: 12,
      allow_partial_payment: true,
      allow_early_payment: true,
      allow_capital_payments: true,
      allow_discounts: true,
      allow_condonation: false,
      allow_refinance: true,
      allow_restructure: true,
      allow_renewal: true,
      auto_disburse_on_approve: false,
    },
    overdueConfig: { ...DEFAULT_OVERDUE_CONFIG },
    paymentConfig: {
      allow_partial_payment: true,
      allow_early_payment: true,
      allow_capital_payments: true,
      application_priority: 'INTEREST_FIRST',
      require_cash_register: true,
      auto_unlock_on_paid: true,
      accept_methods: ['CASH', 'TRANSFER', 'CARD', 'OTHER'],
    },
    integrations: [],
    currency: resolveDefaultCurrency(tenant?.currency_code),
  };
}

// Resuelve la moneda desde el catálogo por código (fallback DOP).
function resolveDefaultCurrency(code?: string | null): CurrencyConfig {
  if (code && DEFAULT_CURRENCY_BY_CODE[code]) {
    return { code, ...DEFAULT_CURRENCY_BY_CODE[code] };
  }
  return { ...DEFAULT_CURRENCY };
}

// ---------------------------------------------------------------------------
// Merge profundo
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function deepMerge(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key] as JsonRecord, value as JsonRecord);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeSection<T>(section: ConfigSection, value: JsonRecord): T {
  const defaults = (defaultPlatformConfig() as unknown as Record<string, JsonRecord>)[section] as JsonRecord;
  return deepMerge(defaults, value) as T;
}

// ---------------------------------------------------------------------------
// Lectura / escritura
// ---------------------------------------------------------------------------

function parseJson(raw: string | Record<string, unknown> | null | undefined): JsonRecord {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw as JsonRecord;
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {};
  }
}

const COLUMN_BY_SECTION: Record<ConfigSection, string> = {
  companyInfo: 'company_info',
  generalConfig: 'general_config',
  loanConfig: 'loan_config',
  overdueConfig: 'overdue_config',
  paymentConfig: 'payment_config',
  integrations: 'integrations',
};

export async function getPlatformConfig(tenantId: number): Promise<PlatformConfig> {
  const tenant = await getTenant(tenantId);
  const row = await getTenantSettings(tenantId);
  const raw = row as unknown as Record<string, string | null> | null;

  const load = <T>(section: ConfigSection): T =>
    sanitizeSection<T>(section, parseJson(raw?.[COLUMN_BY_SECTION[section]] as string | null));

  let overdue = load<OverdueConfig>('overdueConfig');
  // Compatibilidad: heredar grace_days/overdue_penalty de la migración original
  if (overdue.type === 'FIXED' && overdue.fixed_amount === 0 && row) {
    const legacy = raw as unknown as { overdue_penalty?: string; grace_days?: number } | null;
    if (legacy && Number(legacy.overdue_penalty) > 0) {
      overdue = { ...overdue, fixed_amount: Number(legacy.overdue_penalty) };
    }
    if (legacy && legacy.grace_days != null) {
      overdue = { ...overdue, grace_days: legacy.grace_days };
    }
  }

  return {
    companyInfo: stripLegacyCompanyKeys(load<CompanyInfo>('companyInfo')),
    generalConfig: stripLegacyGeneralKeys(load<GeneralConfig>('generalConfig')),
    loanConfig: load('loanConfig'),
    overdueConfig: overdue,
    paymentConfig: load('paymentConfig'),
    integrations: normalizeIntegrations(parseJson(raw?.['integrations'] as string | null)),
    currency: await loadCurrency(tenant.currency_code),
  };
}

// Moneda única (FASE 1): estas claves duplicadas ya NO existen en el tipo; se
// descartan de respuestas antiguas para mantener una única fuente de verdad.
const LEGACY_COMPANY_KEYS = ['currency', 'currency_format', 'decimals'] as const;
const LEGACY_GENERAL_KEYS = ['decimals'] as const;

function stripLegacyCompanyKeys(company: CompanyInfo): CompanyInfo {
  const out = { ...company };
  for (const k of LEGACY_COMPANY_KEYS) delete (out as Record<string, unknown>)[k];
  return out;
}

function stripLegacyGeneralKeys(general: GeneralConfig): GeneralConfig {
  const out = { ...general };
  for (const k of LEGACY_GENERAL_KEYS) delete (out as Record<string, unknown>)[k];
  return out;
}

// Moneda única: `tenants.currency_code` + tabla `currencies` (FASE 1).
export async function loadCurrency(code: string): Promise<CurrencyConfig> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT code, name, symbol, decimals, thousand_separator, decimal_separator
       FROM currencies
      WHERE code = ? AND is_active = 1`,
    [code]
  );
  const c = rows[0] as RowDataPacket | undefined;
  if (!c) return resolveDefaultCurrency(code);
  return {
    code: String(c.code),
    name: String(c.name),
    symbol: String(c.symbol),
    decimals: Number(c.decimals),
    thousand_separator: String(c.thousand_separator ?? ','),
    decimal_separator: String(c.decimal_separator ?? '.'),
  };
}

function normalizeIntegrations(value: unknown): IntegrationConfig[] {
  if (Array.isArray(value)) {
    return value.map((i) => ({
      code: i.code ?? '',
      name: i.name ?? '',
      enabled: Boolean(i.enabled),
      apiKey: i.apiKey ?? '',
      secret: i.secret ?? '',
      token: i.token ?? '',
      endpoint: i.endpoint ?? '',
      baseUrl: i.baseUrl ?? '',
      last_sync_at: i.last_sync_at ?? null,
      last_error: i.last_error ?? null,
      connection_ok: i.connection_ok ?? null,
    }));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map((i) => ({
      code: i.code ?? '',
      name: i.name ?? '',
      enabled: Boolean(i.enabled),
      apiKey: i.apiKey ?? '',
      secret: i.secret ?? '',
      token: i.token ?? '',
      endpoint: i.endpoint ?? '',
      baseUrl: i.baseUrl ?? '',
      last_sync_at: i.last_sync_at ?? null,
      last_error: i.last_error ?? null,
      connection_ok: i.connection_ok ?? null,
    }));
  }
  return [];
}

export async function updatePlatformConfig(
  tenantId: number,
  section: ConfigSection,
  patch: JsonRecord
): Promise<PlatformConfig> {
  if (!CONFIG_SECTIONS.includes(section)) {
    throw ApiError.badRequest('invalid_section', 'Sección de configuración inválida');
  }

  // Validaciones por sección
  if (section === 'loanConfig') {
    const method = patch.default_method;
    if (method && !VALID_METHODS.includes(method as never)) {
      throw ApiError.badRequest('invalid_method', 'Método de amortización inválido');
    }
    if (patch.default_rate != null && (Number(patch.default_rate) < 0 || Number(patch.default_rate) > 100)) {
      throw ApiError.badRequest('invalid_rate', 'Tasa anual entre 0 y 100');
    }
    if (patch.default_terms != null && (Number(patch.default_terms) < 1 || Number(patch.default_terms) > 120)) {
      throw ApiError.badRequest('invalid_terms', 'Plazo entre 1 y 120');
    }
  }
  if (section === 'overdueConfig') {
    if (patch.type && !['FIXED', 'PERCENTAGE'].includes(patch.type as string)) {
      throw ApiError.badRequest('invalid_overdue_type', 'Tipo de mora inválido');
    }
    if (patch.frequency && !['DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME'].includes(patch.frequency as string)) {
      throw ApiError.badRequest('invalid_frequency', 'Frecuencia de mora inválida');
    }
    if (patch.grace_days != null && Number(patch.grace_days) < 0) {
      throw ApiError.badRequest('invalid_grace', 'Días de gracia inválidos');
    }
  }
  if (section === 'paymentConfig' && patch.application_priority) {
    if (!['INTEREST_FIRST', 'PENALTY_FIRST', 'CAPITAL_FIRST'].includes(patch.application_priority as string)) {
      throw ApiError.badRequest('invalid_priority', 'Prioridad de aplicación inválida');
    }
  }

  // Moneda única (FASE 1): las claves legadas no se vuelven a persistir al guardar.
  const cleanPatch = { ...patch };
  if (section === 'companyInfo') {
    for (const k of LEGACY_COMPANY_KEYS) delete cleanPatch[k];
  }
  if (section === 'generalConfig') {
    for (const k of LEGACY_GENERAL_KEYS) delete cleanPatch[k];
  }

  await pool.query<RowDataPacket[]>(
    `INSERT INTO tenant_settings (tenant_id, ${COLUMN_BY_SECTION[section]})
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ${COLUMN_BY_SECTION[section]} = VALUES(${COLUMN_BY_SECTION[section]})`,
    [tenantId, JSON.stringify(cleanPatch)]
  );
  return getPlatformConfig(tenantId);
}

// ---------------------------------------------------------------------------
// Productos de préstamo
// ---------------------------------------------------------------------------

export interface LoanProductInput {
  name: string;
  description?: string;
  amortizationMethod: string;
  annualRate: number;
  minAmount?: number;
  maxAmount?: number;
  minTerms: number;
  maxTerms: number;
  defaultTerms: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export async function listLoanProducts(tenantId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, description, amortization_method, annual_rate, min_amount, max_amount,
            min_terms, max_terms, default_terms, is_default, is_active, created_at
       FROM loan_products
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY is_default DESC, id ASC`,
    [tenantId]
  );
  return rows;
}

export async function upsertLoanProduct(
  tenantId: number,
  id: number | null,
  input: LoanProductInput
): Promise<{ id: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const isDefault = input.isDefault ? 1 : 0;
    if (isDefault) {
      await conn.query(
        'UPDATE loan_products SET is_default = 0 WHERE tenant_id = ? AND is_default = 1',
        [tenantId]
      );
    }
    let resultId: number;
    if (id) {
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE loan_products
            SET name = ?, description = ?, amortization_method = ?, annual_rate = ?,
                min_amount = ?, max_amount = ?, min_terms = ?, max_terms = ?,
                default_terms = ?, is_default = ?, is_active = ?
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [
          input.name.trim(),
          input.description?.trim() || null,
          input.amortizationMethod,
          Math.round(input.annualRate * 10000) / 10000,
          input.minAmount ?? null,
          input.maxAmount ?? null,
          input.minTerms,
          input.maxTerms,
          input.defaultTerms,
          isDefault,
          input.isActive !== false ? 1 : 0,
          id,
          tenantId,
        ]
      );
      if (res.affectedRows === 0) throw ApiError.notFound('Producto no encontrado');
      resultId = id;
    } else {
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO loan_products
          (tenant_id, name, description, amortization_method, annual_rate, min_amount,
           max_amount, min_terms, max_terms, default_terms, is_default, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          input.name.trim(),
          input.description?.trim() || null,
          input.amortizationMethod,
          Math.round(input.annualRate * 10000) / 10000,
          input.minAmount ?? null,
          input.maxAmount ?? null,
          input.minTerms,
          input.maxTerms,
          input.defaultTerms,
          isDefault,
          input.isActive !== false ? 1 : 0,
        ]
      );
      resultId = res.insertId;
    }
    await conn.commit();
    return { id: resultId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteLoanProduct(tenantId: number, id: number): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    'UPDATE loan_products SET deleted_at = NOW(), is_active = 0 WHERE id = ? AND tenant_id = ? AND is_default = 0',
    [id, tenantId]
  );
  if (res.affectedRows === 0) {
    throw ApiError.badRequest('product_not_deletable', 'Producto no encontrado o es el predeterminado');
  }
}

// ---------------------------------------------------------------------------
// Log de errores de integraciones
// ---------------------------------------------------------------------------

export async function getIntegrationLog(tenantId: number): Promise<unknown[]> {
  const row = await getTenantSettings(tenantId);
  const log = parseJson(
    (row as unknown as Record<string, string | null>)?.integration_log ?? null
  );
  return Array.isArray(log.entries) ? log.entries : [];
}

export async function recordIntegrationStatus(
  tenantId: number,
  code: string,
  patch: Partial<IntegrationConfig>
): Promise<void> {
  const cfg = await getPlatformConfig(tenantId);
  const list = cfg.integrations.length > 0 ? cfg.integrations : [{ code, name: code, enabled: true } as IntegrationConfig];
  const idx = list.findIndex((i) => i.code === code);
  const base: IntegrationConfig = {
    code,
    name: code,
    enabled: true,
    apiKey: '',
    secret: '',
    token: '',
    endpoint: '',
    baseUrl: '',
    last_sync_at: null,
    last_error: null,
    connection_ok: null,
  };
  const target = idx >= 0 ? { ...list[idx], ...patch } : { ...base, ...patch };
  if (idx >= 0) list[idx] = target;
  else list.push(target);

  // Log de errores (circular, hasta 20 entradas)
  if (patch.last_error) {
    const row = await getTenantSettings(tenantId);
    const log = parseJson((row as unknown as Record<string, string | null>)?.integration_log ?? null);
    const entries = (Array.isArray(log.entries) ? log.entries : []) as unknown[];
    entries.unshift({ code, at: new Date().toISOString(), error: patch.last_error });
    log.entries = entries.slice(0, 20);
    await pool.query(
      'UPDATE tenant_settings SET integration_log = ? WHERE tenant_id = ?',
      [JSON.stringify(log), tenantId]
    );
  }
}