import type { MdmApiConfig } from '../types';

/**
 * Cliente HTTP tipado para la API CrediPay MDM (Fase 3).
 * - Sesión httpOnly vía cookies (credentials: 'include')
 * - CSRF: lee la cookie `csrf` (no httpOnly) y la envía como header
 *   X-CSRF-Token en toda mutación (POST/PATCH/PUT/DELETE)
 * - Errores normalizados a ApiError { status, code, message }
 */

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Error de conexión con el servidor';
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = getCookie('csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, 'network_error', 'No se pudo conectar con el servidor. Verifica que esté en línea.');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // respuestas sin cuerpo JSON
  }

  if (!res.ok) {
    const payload = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      res.status,
      payload.error ?? 'http_error',
      payload.message ?? `HTTP ${res.status}`
    );
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Autenticación y sesión
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  tenantId: number | null;
  status?: string;
  mustChangePassword: boolean;
}

export interface Session {
  user: SessionUser;
  permissions: string[];
  mustChangePassword: boolean;
  activeTenantId: number | null;
  isGlobal: boolean;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  ticket: string;
  user: SessionUser;
}

export function apiLogin(
  email: string,
  password: string,
  remember: boolean
): Promise<Session | TwoFactorChallenge> {
  return request<Session | TwoFactorChallenge>('POST', '/auth/login', { email, password, remember });
}

export function apiLoginTotp(ticket: string, code: string, remember: boolean): Promise<Session> {
  return request<Session>('POST', '/auth/login/totp', { ticket, code, remember });
}

export function apiTwoFactorStatus(): Promise<{ data: { enabled: boolean } }> {
  return request('GET', '/auth/2fa/status');
}

export function apiTwoFactorSetup(): Promise<{ data: { secret: string; otpauthUrl: string } }> {
  return request('POST', '/auth/2fa/setup');
}

export function apiTwoFactorEnable(code: string): Promise<{ data: { recoveryCodes: string[] } }> {
  return request('POST', '/auth/2fa/enable', { code });
}

export function apiTwoFactorDisable(code: string): Promise<{ ok: boolean }> {
  return request('POST', '/auth/2fa/disable', { code });
}

// ---------------------------------------------------------------------------
// API Keys (Fase 7): integraciones externas
// ---------------------------------------------------------------------------

export interface ApiKeyRow {
  id: number;
  key_name: string;
  key_prefix: string;
  scopes: string[] | null;
  status: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export function apiListApiKeys(): Promise<{ data: ApiKeyRow[] }> {
  return request('GET', '/api-keys');
}

export function apiCreateApiKey(body: {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}): Promise<{ data: { id: number; name: string; key: string; printed: string } }> {
  return request('POST', '/api-keys', body);
}

export function apiRevokeApiKey(id: number): Promise<{ ok: boolean }> {
  return request('DELETE', `/api-keys/${id}`);
}

export function apiKeyProbe(): Promise<{
  data: {
    authenticatedVia: 'api_key' | 'session';
    keyName: string | null;
    userId: number;
    tenantId: number | null;
    permissions: string[];
  };
}> {
  return request('GET', '/api-keys/probe');
}

export function apiLogout(): Promise<{ ok: boolean }> {
  return request('POST', '/auth/logout');
}

export function apiFetchMe(): Promise<Session> {
  return request<Session>('GET', '/auth/me');
}

export function apiChangePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; message: string }> {
  return request('POST', '/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

// ---------------------------------------------------------------------------
// Empresas (tenants) — selector del Super Admin global
// ---------------------------------------------------------------------------

export interface TenantRow {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  email: string | null;
  phone: string | null;
  currency_code: string;
  country_code: string;
  language_code: string;
  timezone: string;
  plan_name?: string | null;
  client_count?: number | string;
  user_count?: number | string;
}

export function apiListTenants(): Promise<{ data: TenantRow[] }> {
  return request('GET', '/tenants');
}

export function apiSwitchTenant(tenantId: number): Promise<{
  data: { tenantId: number; name: string };
}> {
  return request('POST', `/tenants/${tenantId}/switch`);
}

// ---------------------------------------------------------------------------
// Modelos de filas (snake_case del servidor)
// ---------------------------------------------------------------------------

export interface ClientListRow {
  id: number;
  full_name: string;
  cedula_or_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  notes: string | null;
}

export interface CreditRow {
  id: number;
  credit_number: string;
  start_date: string | Date | null;
  total_amount: number | string;
  monthly_amount: number | string;
  installments_count: number | string;
  status: string;
}

export interface InstallmentRow {
  id: number;
  credit_id: number;
  installment_number: number | string;
  amount: number | string;
  due_date: string | Date | null;
  status: string;
  penalty_amount: number | string;
  total_amount: number | string;
  paid_date: string | Date | null;
  payment_reference: string | null;
  paid_amount: number | string;
}

export interface DeviceRow {
  id: number;
  inovaguard_id: string | null;
  device_name: string | null;
  brand: string | null;
  model: string | null;
  imei: string | null;
  serial_number: string | null;
  mdm_status: string;
  unlock_code: string | null;
  remote_lock_supported: number | boolean;
  last_mdm_sync_at: string | Date | null;
  last_mdm_sync_note: string | null;
}

export interface ClientFullRow extends ClientListRow {
  avatar_url: string | null;
  created_at: string | Date;
  credits: CreditRow[];
  installments: InstallmentRow[];
  devices: DeviceRow[];
}

export interface DeviceEventRow {
  id: number;
  device_id: number | null;
  device_name: string | null;
  model: string | null;
  imei: string | null;
  client_id: number | null;
  client_name: string | null;
  action: string;
  trigger_source: string | null;
  status: string;
  details: string | null;
  created_at: string | Date;
}

// ---------------------------------------------------------------------------
// Clientes / Créditos / Cuotas / Dispositivos
// ---------------------------------------------------------------------------

export function apiListClients(params?: {
  q?: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<{ data: ClientListRow[]; pagination: { page: number; perPage: number; total: number } }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 200));
  return request('GET', `/clients?${qs.toString()}`);
}

export function apiGetClient(id: number): Promise<{ data: ClientFullRow }> {
  return request('GET', `/clients/${id}`);
}

export function apiCreateClient(body: {
  fullName: string;
  cedulaOrId?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}): Promise<{ data: { id: number } }> {
  return request('POST', '/clients', body);
}

export function apiCreateCredit(body: {
  clientId: number;
  totalAmount: number;
  monthlyAmount: number;
  installmentsCount: number;
  startDate?: string;
}): Promise<{ data: { id: number; creditNumber: string } }> {
  return request('POST', '/credits', body);
}

export function apiPatchInstallment(
  id: number,
  patch: { status?: string; amount?: number; penaltyAmount?: number }
): Promise<{ data: { id: number } }> {
  return request('PATCH', `/installments/${id}`, patch);
}

export function apiCascadePayment(body: {
  clientId: number;
  amount: number;
  method: string;
  bank: string;
  received: number;
  change: number;
}): Promise<{ data: Record<string, unknown> }> {
  return request('POST', '/payments/cascade', body);
}

export interface PaymentStats {
  recaudado: number;
  totalPagos: number;
  mesActual: number;
  morasCobradas: number;
  carteraPorCobrar: number;
  efectividad: { cuotasTotal: number; cuotasPagadas: number; pct: number };
  morosidad: { clientesAtrasados: number; deudaAtrasada: number };
  porMetodo: { method: string; count: number; total: number }[];
}

export function apiGetPaymentStats(): Promise<{ data: PaymentStats }> {
  return request('GET', '/payments/stats');
}

export async function apiExportPaymentsCsv(): Promise<void> {
  const res = await fetch('/api/v1/payments/export', {
    method: 'GET',
    headers: { Accept: 'text/csv' },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, 'export_error', 'No se pudo exportar el CSV');
  const csv = await res.text();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `credipay-pagos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function apiCreateDevice(body: {
  clientId?: number;
  deviceName?: string;
  inovaguardId?: string;
  brand?: string;
  model?: string;
  imei?: string;
  serialNumber?: string;
  mdmStatus?: string;
  unlockCode?: string;
}): Promise<{ data: { id: number } }> {
  return request('POST', '/devices', body);
}

export function apiPatchDevice(
  id: number,
  patch: {
    mdmStatus?: string;
    inovaguardId?: string;
    unlockCode?: string;
    imei?: string;
    model?: string;
    brand?: string;
  }
): Promise<{ data: { id: number } }> {
  return request('PATCH', `/devices/${id}`, patch);
}

export function apiSyncDevice(id: number): Promise<{
  data: { id: number; remoteStatus: string | null; isSimulated: boolean };
}> {
  return request('POST', `/devices/${id}/sync`);
}

// ---------------------------------------------------------------------------
// MDM (proxy — los secretos viven en el servidor)
// ---------------------------------------------------------------------------

export function apiGetMdmConfig(): Promise<{ data: MdmApiConfig }> {
  return request('GET', '/mdm/config');
}

export function apiPutMdmConfig(patch: Partial<MdmApiConfig>): Promise<{ data: MdmApiConfig }> {
  return request('PUT', '/mdm/config', patch);
}

export function apiMdmDevices(force = false): Promise<{
  data: { devices: unknown[]; isSimulated: boolean; totalDevices: number };
}> {
  return request('GET', `/mdm/devices?force=${force ? 1 : 0}`);
}

export function apiMdmBalance(force = false): Promise<{
  data: { balance: unknown; isSimulated: boolean };
}> {
  return request('GET', `/mdm/balance?force=${force ? 1 : 0}`);
}

export function apiMdmLicences(force = false): Promise<{
  data: { licences: unknown; isSimulated: boolean };
}> {
  return request('GET', `/mdm/licences?force=${force ? 1 : 0}`);
}

export function apiMdmFindDevice(id: string): Promise<{
  data: { device: unknown; isSimulated: boolean };
}> {
  return request('GET', `/mdm/devices/find/${encodeURIComponent(id)}`);
}

export function apiMdmQrEnrollment(): Promise<{
  data: { qrDataUrl: string; enrollmentToken: string; isSimulated: boolean };
}> {
  return request('GET', '/mdm/qr-enrollment');
}

export interface SyncInventoryReport {
  total: number;
  created: number;
  updated: number;
  matchedClients: number;
  simulated: boolean;
  errors: number;
}

export function apiMdmSyncAll(): Promise<{ data: SyncInventoryReport }> {
  return request('POST', '/mdm/sync-all');
}

export function apiMdmLock(id: string): Promise<{
  data: { err: boolean; message: string; isSimulated: boolean };
}> {
  return request('POST', `/mdm/devices/lock/${encodeURIComponent(id)}`);
}

export function apiMdmUnlock(id: string): Promise<{
  data: { err: boolean; message: string; isSimulated: boolean };
}> {
  return request('POST', `/mdm/devices/unlock/${encodeURIComponent(id)}`);
}

export function apiMdmUnlockCode(id: string): Promise<{
  data: { err: boolean; message: string; code?: string; isSimulated: boolean };
}> {
  return request('POST', `/mdm/devices/unlock-code/${encodeURIComponent(id)}`);
}

export function apiMdmRemove(id: string): Promise<{
  data: { err: boolean; message: string; isSimulated: boolean };
}> {
  return request('POST', `/mdm/devices/remove/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Auditoría / Logs
// ---------------------------------------------------------------------------

export function apiGetDeviceEvents(params?: {
  deviceId?: number;
  action?: string;
  page?: number;
  perPage?: number;
}): Promise<{ data: DeviceEventRow[]; pagination: { page: number; perPage: number; total: number } }> {
  const qs = new URLSearchParams();
  if (params?.deviceId) qs.set('deviceId', String(params.deviceId));
  if (params?.action) qs.set('action', params.action);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 200));
  return request('GET', `/logs/device-events?${qs.toString()}`);
}

export function apiGetPayments(params?: {
  clientId?: number;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}): Promise<{ data: Record<string, unknown>[]; pagination: { page: number; perPage: number; total: number } }> {
  const qs = new URLSearchParams();
  if (params?.clientId) qs.set('clientId', String(params.clientId));
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 200));
  return request('GET', `/payments?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// SaaS Comercial (Fase 5): planes, suscripción, facturación y pasarelas
// ---------------------------------------------------------------------------

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export interface PlanFeatureRow {
  plan_id: number;
  feature_key: string;
  feature_name: string;
  feature_value: string | null;
  is_enabled: number;
}

export interface PlanRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  billing_cycle: BillingCycle;
  price: string;
  setup_fee: string;
  currency_code: string;
  max_users: number;
  max_clients: number;
  max_credits: number;
  max_devices: number;
  storage_mb: number;
  api_rate_limit_per_min: number;
  max_webhooks: number;
  status: string;
  is_default: number;
  sort_order: number;
  features: PlanFeatureRow[];
}

export interface SubscriptionRow {
  subscription_id: number;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED' | 'EXPIRED';
  starts_at: string;
  current_period_start: string;
  current_period_end: string;
  canceled_at: string | null;
  ends_at: string | null;
  auto_renew: number;
  plan_id: number;
  plan_name: string;
  plan_slug: string;
  billing_cycle: BillingCycle;
  price: string;
  setup_fee: string;
  currency_code: string;
  description: string | null;
  max_users: number;
  max_clients: number;
  max_credits: number;
  max_devices: number;
  storage_mb: number;
  api_rate_limit_per_min: number;
  max_webhooks: number;
}

export interface SubscriptionUsage {
  clients: number;
  credits: number;
  devices: number;
  users: number;
}

export interface BillingPaymentRow {
  id: number;
  amount: string;
  currency_code: string;
  status: string;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
  plan_name: string | null;
}

export interface GatewayRow {
  id: number;
  code: string;
  name: string;
  is_active: number;
}

export interface PlatformTenantRow {
  tenant_id: number;
  name: string;
  slug: string;
  tenant_status: string;
  currency_code: string;
  subscription_id: number | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  auto_renew: number | null;
  plan_name: string | null;
  plan_slug: string | null;
  billing_cycle: BillingCycle | null;
  price: string | null;
  max_clients: number;
  max_devices: number;
  max_users: number;
  client_count: number;
}

export function apiListPlans(): Promise<{ data: PlanRow[] }> {
  return request('GET', '/saas/plans');
}

export function apiSubscriptionCurrent(): Promise<{
  data: { subscription: SubscriptionRow | null; usage: SubscriptionUsage };
}> {
  return request('GET', '/saas/subscriptions/current');
}

export function apiChangePlan(planId: number): Promise<{
  data: { subscriptionId: number; planId: number; planName: string };
}> {
  return request('POST', '/saas/subscriptions/change', { planId });
}

export function apiRenewSubscription(): Promise<{
  data: { paymentId: number; planName: string; periodEnd: string };
}> {
  return request('POST', '/saas/subscriptions/renew');
}

export function apiBillingPayments(): Promise<{ data: BillingPaymentRow[] }> {
  return request('GET', '/saas/billing/payments');
}

export function apiGetGateways(): Promise<{
  data: {
    gateways: GatewayRow[];
    config: { preferredGateway: string | null; gateways: Record<string, unknown>[] };
  };
}> {
  return request('GET', '/saas/billing/gateways');
}

export function apiSetGateway(preferredGateway: string | null): Promise<{
  data: { preferredGateway: string | null; gateways: Record<string, unknown>[] };
}> {
  return request('POST', '/saas/billing/gateways', { preferredGateway });
}

export function apiPlatformOverview(): Promise<{ data: PlatformTenantRow[] }> {
  return request('GET', '/saas/platform/overview');
}

// ---------------------------------------------------------------------------
// Motor de Cobranza Automática + IA (Fase 6)
// ---------------------------------------------------------------------------

export type CollectionReminderType = 'RECORDATORIO' | 'ALERTA_BLOQUEO' | 'CONFIRMACION_PAGO';
export type CollectionRisk = 'BAJO' | 'MEDIO' | 'ALTO';

export interface CollectionSummaryRow {
  installments: { pendiente: number; vencido: number; atrasado: number; pagado: number };
  overdueAmount: number;
  clientsAtRisk: number;
  reminders: { pending: number; sent: number };
  riskDistribution: Record<CollectionRisk, number>;
  lastRun: {
    id: number;
    status: string;
    totalReminders: number;
    startedAt: number | null;
    finishedAt: number | null;
  } | null;
}

export interface CollectionReminderRow {
  id: number;
  run_id: number | null;
  client_id: number;
  reminder_type: CollectionReminderType;
  channel: string;
  status: string;
  risk_level: CollectionRisk;
  risk_score: number;
  subject: string | null;
  message: string;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
  full_name: string;
  phone: string;
  device_model: string | null;
}

export interface CollectionRunRow {
  id: number;
  source: string;
  status: string;
  totalReminders: number;
  sentNow: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface CollectionRunReport {
  runId: number;
  total: number;
  byType: Record<CollectionReminderType, number>;
  byRisk: Record<CollectionRisk, number>;
}

export function apiCollectionSummary(): Promise<{ data: CollectionSummaryRow }> {
  return request('GET', '/collection/summary');
}

export function apiCollectionRun(source = 'MANUAL'): Promise<{ data: CollectionRunReport }> {
  return request('POST', '/collection/run', { source });
}

export function apiCollectionReminders(status = 'ALL', limit = 100): Promise<{ data: CollectionReminderRow[] }> {
  return request('GET', `/collection/reminders?status=${status}&limit=${limit}`);
}

export function apiCollectionSendReminder(id: number): Promise<{ data: CollectionReminderRow }> {
  return request('POST', `/collection/reminders/${id}/send`);
}

export function apiCollectionRuns(): Promise<{ data: CollectionRunRow[] }> {
  return request('GET', '/collection/runs');
}
