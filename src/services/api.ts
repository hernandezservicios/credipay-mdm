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
  } catch {
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

export function apiSwitchTenantExit(): Promise<{ data: { tenantId: null } }> {
  return request('POST', '/tenants/exit');
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
  suspended_at: string | null;
  suspended_reason: string | null;
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
  credit_count: number;
  device_count: number;
  user_count: number;
  overdue_installments: number;
  collected_month: number;
  collected_total: number;
}

export interface TenantDetailRow {
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
  logo_url: string | null;
  trial_ends_at: string | null;
  suspended_at: string | null;
  suspended_by: number | null;
  suspended_reason: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
  settings: {
    tenant_id: number;
    grace_days: number;
    overdue_penalty: string;
    receipt_prefix: string;
    invoice_prefix: string;
  } | null;
  subscription: {
    id: number;
    plan_id: number;
    plan_name: string;
    billing_cycle: BillingCycle;
    status: string;
    current_period_start: string;
    current_period_end: string;
    canceled_at: string | null;
    ends_at: string | null;
    auto_renew: number;
  } | null;
  admin: {
    id: number;
    name: string;
    email: string;
    status: string;
    last_login_at: string | null;
  } | null;
}

export interface PlatformUserRow {
  id: number;
  tenant_id: number | null;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  must_change_password: number;
  created_at: string;
  tenant_name: string | null;
  tenant_slug: string | null;
  tenant_status: string | null;
  role_slugs: string | null;
}

export interface PlatformUserDetailRow extends PlatformUserRow {
  two_factor_enabled: number;
  locale: string;
  updated_at: string;
  roles: Array<{ id: number; slug: string; name: string }>;
}

export function apiListPlans(): Promise<{ data: PlanRow[] }> {
  return request('GET', '/saas/plans');
}

export function apiSubscriptionCurrent(): Promise<{
  data: { subscription: SubscriptionRow | null; usage: SubscriptionUsage };
}> {
  return request('GET', '/saas/subscriptions/current');
}

export function apiChangePlan(planId: number, tenantId?: number): Promise<{
  data: { subscriptionId: number; planId: number; planName: string };
}> {
  return request('POST', '/saas/subscriptions/change', tenantId ? { planId, tenantId } : { planId });
}

export function apiRenewSubscription(tenantId?: number): Promise<{
  data: { paymentId: number; planName: string; periodEnd: string };
}> {
  return request('POST', '/saas/subscriptions/renew', tenantId ? { tenantId } : undefined);
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
// Panel del Super Administrador (Fase 9): gestión de empresas, planes y usuarios
// ---------------------------------------------------------------------------

export function apiGetTenantDetail(id: number): Promise<{ data: TenantDetailRow }> {
  return request('GET', `/tenants/${id}`);
}

export function apiCreateTenant(body: {
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  domain?: string;
  status?: string;
  currency_code?: string;
  planId?: number;
  periodMonths?: number;
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
}): Promise<{ data: { tenantId: number; name: string; slug: string; status: string; subscriptionId: number | null; adminUserId: number | null }; dev_password?: string }> {
  return request('POST', '/tenants', body);
}

export function apiUpdateTenant(
  id: number,
  body: {
    name?: string;
    email?: string;
    phone?: string;
    domain?: string;
    currency_code?: string;
    timezone?: string;
    language_code?: string;
    status?: string;
  }
): Promise<{ data: { tenantId: number; updated: boolean } }> {
  return request('PATCH', `/tenants/${id}`, body);
}

export function apiSuspendTenant(id: number, reason?: string): Promise<{ data: { tenantId: number; status: string } }> {
  return request('POST', `/tenants/${id}/suspend`, { reason });
}

export function apiReactivateTenant(id: number): Promise<{ data: { tenantId: number; status: string } }> {
  return request('POST', `/tenants/${id}/reactivate`);
}

export function apiDeleteTenant(id: number): Promise<{ data: { tenantId: number; deleted: boolean } }> {
  return request('DELETE', `/tenants/${id}`);
}

export function apiCreatePlan(body: {
  name: string;
  slug?: string;
  description?: string;
  billing_cycle: BillingCycle;
  price: number;
  setup_fee?: number;
  currency_code?: string;
  max_users?: number;
  max_clients?: number;
  max_credits?: number;
  max_devices?: number;
  storage_mb?: number;
  api_rate_limit_per_min?: number;
  max_webhooks?: number;
  features?: Array<{ feature_key: string; feature_name?: string; feature_value?: string | null; is_enabled?: number }>;
}): Promise<{ data: { planId: number; name: string; slug: string } }> {
  return request('POST', '/saas/plans', body);
}

export function apiUpdatePlan(
  id: number,
  body: Partial<Parameters<typeof apiCreatePlan>[0]>
): Promise<{ data: { planId: number; updated: boolean } }> {
  return request('PATCH', `/saas/plans/${id}`, body);
}

export function apiTogglePlan(id: number): Promise<{ data: { planId: number; status: string } }> {
  return request('POST', `/saas/plans/${id}/toggle`);
}

export function apiDuplicatePlan(id: number): Promise<{ data: { planId: number; name: string; slug: string } }> {
  return request('POST', `/saas/plans/${id}/duplicate`);
}

export function apiDeletePlan(id: number): Promise<{ data: { planId: number; deleted: boolean } }> {
  return request('DELETE', `/saas/plans/${id}`);
}

export function apiCancelSubscription(tenantId?: number): Promise<{ data: { subscriptionId: number; status: string } }> {
  return request('POST', '/saas/subscriptions/cancel', tenantId ? { tenantId } : undefined);
}

export function apiExtendSubscription(days: number, tenantId?: number): Promise<{ data: { subscriptionId: number; periodEnd: string } }> {
  return request('POST', '/saas/subscriptions/extend', tenantId ? { days, tenantId } : { days });
}

export function apiListUsers(params?: {
  tenant_id?: number;
  q?: string;
}): Promise<{ data: PlatformUserRow[] }> {
  const qs = new URLSearchParams();
  if (params?.tenant_id) qs.set('tenant_id', String(params.tenant_id));
  if (params?.q) qs.set('q', params.q);
  return request('GET', `/users?${qs.toString()}`);
}

export function apiGetUser(id: number): Promise<{ data: PlatformUserDetailRow }> {
  return request('GET', `/users/${id}`);
}

export function apiListTenantUsers(tenantId: number): Promise<{ data: PlatformUserRow[] }> {
  return request('GET', `/users/tenant/${tenantId}/users`);
}

export function apiCreateUser(body: {
  tenant_id?: number;
  name: string;
  email: string;
  phone?: string;
  password?: string;
  roles?: string[];
  status?: string;
}): Promise<{ data: { userId: number; name: string; email: string; status: string }; dev_password?: string }> {
  return request('POST', '/users', body);
}

export function apiUpdateUser(
  id: number,
  body: {
    name?: string;
    email?: string;
    phone?: string;
    status?: string;
    locale?: string;
    roles?: string[];
  }
): Promise<{ data: { userId: number; updated: boolean } }> {
  return request('PATCH', `/users/${id}`, body);
}

export function apiSetUserStatus(id: number, status: string): Promise<{
  data: { userId: number; status: string; changed: boolean };
}> {
  return request('POST', `/users/${id}/status`, { status });
}

export function apiResetUserPassword(id: number): Promise<{ data: { userId: number; ok: boolean }; dev_reset_link?: string }> {
  return request('POST', `/users/${id}/reset-password`);
}

export function apiDeleteUser(id: number): Promise<{ data: { userId: number; deleted: boolean } }> {
  return request('DELETE', `/users/${id}`);
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

// ---------------------------------------------------------------------------
// Plataforma profesional de préstamos (Fase 9)
// Configuración por tenant, préstamos, caja, reportes y dashboard
// ---------------------------------------------------------------------------

// ---------------- Configuración por tenant ----------------

export interface PlatformCurrency {
  code: string;
  symbol: string;
  decimals: number;
  thousand_separator: string;
  decimal_separator: string;
}

export interface PlatformConfig {
  companyInfo: Record<string, unknown>;
  generalConfig: Record<string, unknown>;
  loanConfig: Record<string, unknown>;
  overdueConfig: Record<string, unknown>;
  paymentConfig: Record<string, unknown>;
  integrations: Array<Record<string, unknown>>;
  currency: PlatformCurrency;
}

export function apiGetConfig(): Promise<{ data: PlatformConfig }> {
  return request('GET', '/config');
}

export function apiUpdateConfigSection(
  section: string,
  body: Record<string, unknown>
): Promise<{ data: PlatformConfig }> {
  return request('PUT', `/config/${section}`, body);
}

export interface LoanProductRow {
  id: number;
  name: string;
  description: string | null;
  amortization_method: string;
  annual_rate: string;
  min_amount: string | null;
  max_amount: string | null;
  min_terms: number;
  max_terms: number;
  default_terms: number;
  is_default: number;
  is_active: number;
  created_at: string;
}

export function apiListLoanProducts(): Promise<{ data: LoanProductRow[] }> {
  return request('GET', '/config/loan-products');
}

export function apiCreateLoanProduct(body: Record<string, unknown>): Promise<{ data: { id: number } }> {
  return request('POST', '/config/loan-products', body);
}

export function apiPatchLoanProduct(id: number, body: Record<string, unknown>): Promise<{ data: { id: number } }> {
  return request('PATCH', `/config/loan-products/${id}`, body);
}

export function apiDeleteLoanProduct(id: number): Promise<{ data: { id: number; deleted: boolean } }> {
  return request('DELETE', `/config/loan-products/${id}`);
}

export function apiGetIntegrationLog(): Promise<{ data: unknown[] }> {
  return request('GET', '/config/integration-log');
}

// ---------------- Préstamos ----------------

export interface LoanQuote {
  principal: number;
  annualRatePercent: number;
  method: string;
  installmentsCount: number;
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  schedule: Array<{
    number: number;
    dueDate: string;
    amount: number;
    principalPart: number;
    interestPart: number;
    capitalBalanceBefore: number;
    capitalBalanceAfter: number;
  }>;
}

export interface LoanResult {
  id: number;
  creditNumber: string;
  status: string;
  scheduleCount: number;
  totalInterest: number;
}

export function apiLoanQuote(body: {
  principal: number;
  annualRate: number;
  method: string;
  installmentsCount: number;
  startDate?: string;
}): Promise<{ data: LoanQuote }> {
  return request('POST', '/loans/quote', body);
}

export function apiCreateLoan(body: {
  clientId: number;
  principal: number;
  annualRate: number;
  method: string;
  installmentsCount: number;
  startDate?: string;
  financingFee?: number;
  notes?: string;
  status?: 'PENDING' | 'ACTIVE';
}): Promise<{ data: LoanResult }> {
  return request('POST', '/loans', body);
}

export function apiApproveLoan(id: number): Promise<{ data: LoanResult }> {
  return request('POST', `/loans/${id}/approve`);
}

export function apiRejectLoan(id: number, reason?: string): Promise<{ data: { id: number; status: string } }> {
  return request('POST', `/loans/${id}/reject`, { reason });
}

export function apiDisburseLoan(id: number): Promise<{ data: LoanResult }> {
  return request('POST', `/loans/${id}/disburse`);
}

export function apiLoanOutstanding(id: number): Promise<{
  data: { remainingPrincipal: number; remainingInterest: number; pendingPenalty: number; total: number };
}> {
  return request('GET', `/loans/${id}/outstanding`);
}

export function apiRestructureLoan(
  id: number,
  body: { annualRate: number; method: string; installmentsCount: number; startDate?: string; notes?: string }
): Promise<{ data: LoanResult }> {
  return request('POST', `/loans/${id}/restructure`, body);
}

export function apiRefinanceLoan(
  id: number,
  body: { annualRate: number; method: string; installmentsCount: number; additionalAmount?: number; startDate?: string; notes?: string }
): Promise<{ data: LoanResult }> {
  return request('POST', `/loans/${id}/refinance`, body);
}

export function apiRenewLoan(
  id: number,
  body: { annualRate: number; method: string; installmentsCount: number; startDate?: string; notes?: string }
): Promise<{ data: LoanResult }> {
  return request('POST', `/loans/${id}/renew`, body);
}

export function apiCondoneCredit(id: number, body: { type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount?: number }): Promise<{
  data: { id: number; affected: number };
}> {
  return request('POST', `/loans/${id}/condone`, body);
}

export function apiCondoneInstallment(
  installmentId: number,
  body: { type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount?: number }
): Promise<{ data: { id: number } }> {
  return request('POST', `/loans/installments/${installmentId}/condone`, body);
}

export function apiRunOverdue(): Promise<{
  data: { tenantId: number; penalized: number; defaulted: number; errors: string[] };
}> {
  return request('POST', '/loans/run-overdue');
}

export interface AgreementRow {
  id: number;
  credit_id: number;
  credit_number: string;
  client_id: number;
  client_name: string;
  agreed_date: string;
  total_amount: string;
  initial_payment: string;
  terms: number;
  frequency: string;
  first_due_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export function apiListAgreements(params?: { creditId?: number; clientId?: number; status?: string }): Promise<{ data: AgreementRow[] }> {
  const qs = new URLSearchParams();
  if (params?.creditId) qs.set('creditId', String(params.creditId));
  if (params?.clientId) qs.set('clientId', String(params.clientId));
  if (params?.status) qs.set('status', params.status);
  return request('GET', `/loans/agreements?${qs.toString()}`);
}

export function apiCreateAgreement(body: {
  creditId: number;
  clientId: number;
  agreedDate?: string;
  totalAmount?: number;
  initialPayment?: number;
  terms: number;
  frequency: string;
  firstDueDate?: string;
  notes?: string;
}): Promise<{ data: { id: number } }> {
  return request('POST', '/loans/agreements', body);
}

export function apiSetAgreementStatus(id: number, status: string): Promise<{ data: { id: number; status: string } }> {
  return request('POST', `/loans/agreements/${id}/status`, { status });
}

// ---------------------------------------------------------------------------
// Fase E/F: servicio único de cobranza por préstamo (F11). /loans unificado.
// ---------------------------------------------------------------------------

export type PayMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'DEPOSITO';

export interface LoanListRow {
  id: number;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  creditNumber: string;
  startDate: string;
  totalAmount: number;
  outstanding: number;
  monthlyAmount: number;
  installmentsCount: number;
  pendingCount: number;
  nextDue: string | null;
  status: string;
  daysLate: number;
  lastPaymentAt: string | null;
}

export interface PagedResult<T> {
  data: T[];
  pagination: { page: number; perPage: number; total: number };
}

export function apiListLoans(params?: {
  search?: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<PagedResult<LoanListRow>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 20));
  return request('GET', `/loans?${qs.toString()}`);
}

export interface LoanInstallmentRow {
  id: number;
  installment_number: number;
  amount: number;
  principal_part: number;
  interest_part: number;
  due_date: string;
  status: string;
  penalty_amount: number;
  total_amount: number;
  paid_amount: number;
  paid_date: string | null;
  payment_reference: string | null;
}

export interface LoanDetailPayload {
  credit: Record<string, unknown> & {
    id: number;
    client_id: number;
    credit_number: string;
    start_date: string;
    total_amount: number;
    status: string;
    outstanding?: number;
  };
  client: Record<string, unknown> | null;
  installments: LoanInstallmentRow[];
}

export function apiGetLoanDetail(id: number): Promise<{ data: LoanDetailPayload }> {
  return request('GET', `/loans/${id}`);
}

export interface LoanTimelineEntry {
  id: number;
  eventType: string;
  description: string | null;
  data: unknown;
  createdAt: string;
  userName: string | null;
}

export function apiGetLoanTimeline(id: number): Promise<{ data: LoanTimelineEntry[] }> {
  return request('GET', `/loans/${id}/timeline`);
}

export interface AllocatedLine {
  installmentId: number;
  installmentNumber: number;
  creditId: number;
  allocated: number;
  bucket: string;
  becamePaid: boolean;
  remainingAfter: number;
}

export interface SimulatePaymentResult {
  creditId: number;
  amount: number;
  config: {
    application_order: string[];
    overpayment_mode: string;
    rounding: number;
  };
  lines: AllocatedLine[];
  totalAllocated: number;
  remainder: number;
  coveredInstallmentIds: number[];
}

export function apiSimulateLoanPayment(id: number, amount: number): Promise<{ data: SimulatePaymentResult }> {
  return request('POST', `/loans/${id}/pay/simulate`, { amount });
}

export interface LoanPaymentResult {
  paymentId: number;
  creditId: number;
  amountApplied: number;
  received: number;
  change: number;
  method: string;
  remainder: number;
  duplicate: boolean;
  affected: AllocatedLine[];
  unlock: { deviceId: number; success: boolean; simulated: boolean; message: string } | null;
}

export function apiPayLoan(
  id: number,
  body: {
    amount: number;
    method?: PayMethod;
    bank?: string;
    received?: number;
    change?: number;
    idempotencyKey?: string;
    notes?: string;
  }
): Promise<{ data: LoanPaymentResult }> {
  return request('POST', `/loans/${id}/pay`, body);
}

// ---------------- Caja ----------------

export interface CashRegisterRow {
  id: number;
  register_date: string;
  status: 'OPEN' | 'CLOSED';
  opening_balance: string;
  expected_closing: string | null;
  counted_cash: string | null;
  difference: string | null;
  opened_at: string;
  closed_at: string | null;
  closing_notes: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  movements_count?: number;
}

export interface CashCurrent {
  current: CashRegisterRow | null;
  totals: {
    registerId: number | null;
    status: 'OPEN' | 'CLOSED' | null;
    openingBalance: number;
    cashIn: number;
    cashOut: number;
    expected: number;
    movementsCount: number;
  } | null;
}

export function apiGetCash(): Promise<{ data: CashCurrent }> {
  return request('GET', '/cash');
}

export function apiOpenCash(openingBalance: number): Promise<{ data: CashRegisterRow }> {
  return request('POST', '/cash/open', { openingBalance });
}

export function apiCloseCash(id: number, countedCash: number, notes?: string): Promise<{ data: CashRegisterRow }> {
  return request('POST', `/cash/${id}/close`, { countedCash, notes });
}

export function apiListCashRegisters(params?: { from?: string; to?: string; page?: number; perPage?: number }): Promise<{
  data: CashRegisterRow[];
  pagination: { page: number; perPage: number; total: number };
}> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 200));
  return request('GET', `/cash/registers?${qs.toString()}`);
}

export interface CashMovementRow {
  id: number;
  register_id: number | null;
  type: string;
  amount: string;
  direction: 'IN' | 'OUT';
  method: string;
  reference: string | null;
  description: string | null;
  payment_id: number | null;
  credit_id: number | null;
  created_at: string;
  created_by_name?: string | null;
  register_date?: string | null;
}

export function apiListCashMovements(params?: {
  registerId?: number;
  from?: string;
  to?: string;
  type?: string;
  page?: number;
  perPage?: number;
}): Promise<{ data: CashMovementRow[]; pagination: { page: number; perPage: number; total: number } }> {
  const qs = new URLSearchParams();
  if (params?.registerId) qs.set('registerId', String(params.registerId));
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.type) qs.set('type', params.type);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 100));
  return request('GET', `/cash/movements?${qs.toString()}`);
}

export function apiCreateCashMovement(body: {
  type: 'INCOME' | 'EXPENSE' | 'ADJUSTMENT';
  amount: number;
  description?: string;
  method?: string;
  reference?: string;
}): Promise<{ data: { id: number } }> {
  return request('POST', '/cash/movements', body);
}

// ---------------- Reportes ----------------

export interface ReportRow {
  [key: string]: string | number | null;
}

export function apiReportTypes(): Promise<{ data: Record<string, { key: string; label: string }[]> }> {
  return request('GET', '/reports/types');
}

export function apiReport(
  key: string,
  params?: { from?: string; to?: string; status?: string; page?: number; perPage?: number }
): Promise<{
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  data: ReportRow[];
  headers: string[];
  pagination: { page: number; perPage: number; total: number };
}> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.status) qs.set('status', params.status);
  qs.set('page', String(params?.page ?? 1));
  qs.set('perPage', String(params?.perPage ?? 100));
  return request('GET', `/reports/${encodeURIComponent(key)}?${qs.toString()}`);
}

export async function apiReportCsv(
  key: string,
  params?: { from?: string; to?: string; status?: string }
): Promise<void> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.status) qs.set('status', params.status);
  const res = await fetch(`/api/v1/reports/${encodeURIComponent(key)}?${qs.toString()}&format=csv`, {
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
  link.download = `credipay-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------- Dashboard ----------------

export interface DashboardSummary {
  cards: Record<string, number>;
  series: { month: string; recaudado: number; desembolsado: number; prestamos: number }[];
  porEstado: { status: string; count: number }[];
  porMetodo: { method: string; total: number }[];
  porClasificacion: { classification: string; count: number }[];
  actas: { id: number; type: string; message: string; user: string; created_at: string }[];
}

export function apiDashboardSummary(): Promise<{ data: DashboardSummary }> {
  return request('GET', '/dashboard/summary');
}
