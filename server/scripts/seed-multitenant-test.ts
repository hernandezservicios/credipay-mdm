// ============================================================================
// CrediPay MDM - Seed de entorno de pruebas Multi-Tenant
// ----------------------------------------------------------------------------
// Sustituye TODOS los datos de prueba existentes por un entorno limpio con dos
// empresas totalmente aisladas:
//   1) Financiera Alpha   (slug 'alpha')       -> plan Profesional (semestral, 6 meses)
//   2) Credit Plus        (slug 'creditplus')  -> plan Premium (anual, 12 meses)
//
// Conserva: migraciones, esquema, catálogos globales, roles/permisos, planes
// (añade 'premium-anual' si no existe) y la configuración del Super Admin
// (admin@credipay.local, contraseña restaurada a la canónica de la migración 0007).
//
// Re-ejecutable: cada corrida borra y re-crea los tenants demo/alpha/creditplus.
// Contraseña de los usuarios creados: 12345678 (bcrypt)
// ============================================================================

import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../src/db/pool.js';

// ---------------------------------------------------------------------------
// Utilidades de fecha
// ---------------------------------------------------------------------------

const NOW = new Date();
const todayTs = NOW.getTime();

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateTime(d: Date): string {
  return `${iso(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function daysFromNow(n: number): string {
  return iso(new Date(todayTs + n * 86400000));
}
function monthsFromNow(n: number, dayShift = 0): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth() + n, NOW.getDate() + dayShift);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

// ---------------------------------------------------------------------------
// RNG determinista
// ---------------------------------------------------------------------------

function mullberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// Pools de datos (100% distintos entre tenants)
// ---------------------------------------------------------------------------

const ALPHA_FIRST = [
  'Carlos', 'Mariana', 'Rodolfo', 'Yomaira', 'Francisco', 'Lucia', 'Ernesto', 'Isabel', 'Miguel',
  'Rosa', 'Pedro', 'Ana', 'Jose', 'Carmen', 'Luis', 'Raquel', 'Julio', 'Sofia', 'Ramon',
  'Milagros', 'Eduardo', 'Gloria', 'Victor', 'Patricia', 'Andres', 'Nereyda', 'Tomas', 'Elvira',
  'Rafael', 'Xiomara',
];
const ALPHA_LAST = [
  'Mendoza', 'Valenzuela', 'Pena', 'Rosario', 'Jimenez', 'Castillo', 'Delgado', 'Santana', 'Feliz',
  'Medina', 'Caceres', 'Reyes', 'Guerrero', 'Tavarez', 'Bautista', 'Morel', 'Estevez', 'Nunez',
  'Concepcion', 'Ariza', 'Vargas', 'Luna', 'Espinal', 'Tejada', 'Lara', 'Marte', 'Duarte',
  'Perdomo', 'Aquino', 'Burgos',
];
const CP_FIRST = [
  'Wilson', 'Jacqueline', 'Moises', 'Yudelka', 'Randy', 'Edwin', 'Karla', 'Jonathan', 'Mercedes',
  'Nelson', 'Yajaira', 'Alexander', 'Wendy', 'Cristian', 'Kenia', 'Braison', 'Sarai', 'Jhensy',
  'Yarleni', 'Samuel', 'Lissette', 'Gabriel', 'Arabelis', 'Enmanuel', 'Dariana', 'Brayan',
  'Altagracia', 'Paola', 'Felipe', 'Rocio',
];
const CP_LAST = [
  'Ramirez', 'Perez', 'Gonzalez', 'Fernandez', 'Sanchez', 'Torres', 'Vasquez', 'Ortiz', 'Flores',
  'Cabrera', 'Almonte', 'Guzman', 'Salas', 'Colon', 'Mota', 'Berroa', 'Nova', 'Herrera',
  'Custodio', 'Liriano', 'Diaz', 'Contreras', 'Valdez', 'Roque', 'Matos', 'Cepeda', 'Rosendo',
  'Ventura', 'Peralta', 'Mena',
];
const ADDRESS: Record<string, string[]> = {
  alpha: [
    'Av. Winston Churchill #104, Santo Domingo', 'Calle El Conde #45, Zona Colonial',
    'Sector Los Prados, Edif. 4B Apto 201', 'Ave. San Martin #88, Ensanche Miraflores',
    'Ensanche Naco, Calle Oregano #7', 'Reparto Alma Rosa II, C/ 8va #22', 'Santo Domingo Este, Multimodal',
    'Boca Chica, Res. Costa Sur', 'Los Rios, Av. Gustavo Mejia #45', 'Villa Mella, Sector Altos #3',
    'Gazcue, Calle Santiago #9', 'Mirador Sur, Edif. Torre Azul', 'Herrera, Km 12 autopista',
    'San Isidro, Campo Lindo', 'Piantini, Winston Churchill #58', 'Bella Vista, Calle Isabel Aguiar',
  ],
  creditplus: [
    'Av. 27 de Febrero #233, Santiago', 'Calle del Sol #18, Santiago Centro',
    'La Cienga, Villa Progreso #12', 'Los Jardines Metropolitanos, Santiago',
    'Reparto Jardines, Calle Norte', 'Cerro Alto, Santiago', 'Gurabo, Res. Esmeralda #5',
    'Villa Olga, Santiago', 'Ensanche Bermudez, Santiago', 'Cienfuegos, Santiago Oeste',
    'Los Cerros de Gurabo, Santiago', 'Pontezuela, Av. Hispanoamericana', 'Sabana Perdida, Santiago',
    'Tamboril, Km 5', 'Licey al Medio, Sector Los Mameyes', 'San Lorenzo, Santiago',
  ],
};
const PHONE: Record<string, string> = { alpha: '+1 809-555-2', creditplus: '+1 829-555-7' };
const CEDULA: Record<string, string> = { alpha: '001-1', creditplus: '402-2' };
const DOMAIN: Record<string, string> = { alpha: 'alpha.com', creditplus: 'creditplus.com' };
const BRAND: Record<string, string[]> = {
  alpha: ['Samsung', 'Xiaomi'],
  creditplus: ['Apple', 'Motorola'],
};
const MODEL: Record<string, string[]> = {
  alpha: ['Galaxy S24 Ultra 256GB', 'Galaxy A55 5G', 'Redmi Note 13 Pro+ 5G', 'Redmi 13 256GB'],
  creditplus: ['iPhone 15 Pro 128GB', 'iPhone 14 128GB', 'Edge 50 Pro 512GB', 'Moto G84 5G'],
};
const IMEI_PREFIX: Record<string, string> = { alpha: '358921', creditplus: '354891' };
const SERIAL_PREFIX: Record<string, string> = { alpha: 'RF8WA', creditplus: 'F17HK' };

// ---------------------------------------------------------------------------
// Especificación de los dos tenants
// ---------------------------------------------------------------------------

interface UserSpec {
  email: string;
  name: string;
  role: 'ADMIN' | 'GESTOR' | 'OPERADOR';
}
interface TenantSpec {
  slug: string;
  name: string;
  email: string;
  phone: string;
  planSlug: string;
  periodMonths: number;
  users: UserSpec[];
  monthlyRange: [number, number];
  monthsMix: number[];
}

const SPECS: TenantSpec[] = [
  {
    slug: 'alpha',
    name: 'Financiera Alpha',
    email: 'admin@alpha.com',
    phone: '+1 809-555-2000',
    planSlug: 'profesional-semestral',
    periodMonths: 6,
    users: [
      { email: 'admin@alpha.com', name: 'Administrador Alpha', role: 'ADMIN' },
      { email: 'ventas1@alpha.com', name: 'Ventas Alpha 1', role: 'GESTOR' },
      { email: 'ventas2@alpha.com', name: 'Ventas Alpha 2', role: 'GESTOR' },
    ],
    monthlyRange: [3000, 5500],
    monthsMix: [12, 12, 6],
  },
  {
    slug: 'creditplus',
    name: 'Credit Plus',
    email: 'admin@creditplus.com',
    phone: '+1 829-555-7000',
    planSlug: 'premium-anual',
    periodMonths: 12,
    users: [
      { email: 'admin@creditplus.com', name: 'Administrador Credit Plus', role: 'ADMIN' },
      { email: 'cobrador@creditplus.com', name: 'Cobrador Credit Plus', role: 'OPERADOR' },
      { email: 'ventas@creditplus.com', name: 'Ventas Credit Plus', role: 'GESTOR' },
    ],
    monthlyRange: [1500, 8000],
    monthsMix: [12, 6, 6],
  },
];

const ADMIN_HASH_CANONICO =
  '$2b$12$FgTIruhsXzlVYDR/4HoIOewB84u1EBiB1fKoL2XntKp/1gmW0gaNa'; // 7xs8G8GJrTze9S (migración 0007)

const PLANS_TO_CLEAN = ['credipay-demo', 'alpha', 'creditplus'];

// ---------------------------------------------------------------------------
// Helpers SQL
// ---------------------------------------------------------------------------

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return Number((rows[0] as { c: number }).c);
}
async function firstVal<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? (Object.values(r)[0] as T) : null;
}
async function bulkInsert(table: string, cols: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
  await pool.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders}`, rows.flat());
}

// ---------------------------------------------------------------------------
// Paso 1: limpieza idempotente
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  const inList = PLANS_TO_CLEAN.map((s) => `'${s}'`).join(',');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, slug FROM tenants WHERE slug IN (${inList})`
  );
  const ids = (rows as Array<{ id: number; slug: string }>).map((r) => r.id);
  console.log(`[cleanup] tenants a reemplazar: ${ids.join(', ') || 'ninguno'}`);

  if (ids.length > 0) {
    const [userRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE tenant_id IN (?)',
      [ids]
    );
    const userIds = (userRows as Array<{ id: number }>).map((r) => r.id);

    // Tablas con columna tenant_id (no dependen de cascada; borrado explícito).
    const TENANT_TABLES = [
      'tenant_settings', 'subscription_history', 'subscriptions', 'payment_transactions',
      'receipts', 'payments', 'payments_received', 'credit_installments', 'credits',
      'clients', 'device_events', 'device_status', 'device_locks', 'device_unlocks',
      'devices', 'webhook_deliveries', 'webhooks', 'collection_reminders',
      'collection_runs', 'notification_templates', 'email_templates', 'files', 'storage',
      'api_keys', 'backups', 'users', 'user_roles', 'user_permissions',
      'audit_logs', 'activity_logs', 'notifications', 'roles', 'sessions',
    ];
    // Tablas que dependen de user_id pero sin tenant_id (o ambas).
    const USER_TABLES = [
      'refresh_tokens', 'sessions', 'login_attempts', 'password_resets',
      'two_factor_tokens', 'email_verifications', 'api_keys', 'user_roles',
      'user_permissions', 'audit_logs', 'activity_logs', 'notifications',
    ];

    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const t of TENANT_TABLES) {
        const [res] = await pool.query<ResultSetHeader>(
          `DELETE FROM ${t} WHERE tenant_id IN (?)`,
          [ids]
        );
        if (res.affectedRows > 0) console.log(`[cleanup] ${t}: ${res.affectedRows}`);
      }
      if (userIds.length > 0) {
        for (const t of USER_TABLES) {
          const [res] = await pool.query<ResultSetHeader>(
            `DELETE FROM ${t} WHERE user_id IN (?)`,
            [userIds]
          );
          if (res.affectedRows > 0) console.log(`[cleanup] ${t} (user): ${res.affectedRows}`);
        }
      }
      // Sesiones "switchadas" de un Super Admin a un tenant que desaparece.
      const [sess] = await pool.query<ResultSetHeader>(
        'UPDATE sessions SET tenant_id = NULL WHERE tenant_id IN (?)',
        [ids]
      );
      console.log(`[cleanup] sesiones reencuadradas a plataforma: ${sess.affectedRows}`);
      const [del] = await pool.query<ResultSetHeader>('DELETE FROM tenants WHERE id IN (?)', [ids]);
      console.log(`[cleanup] tenants borrados: ${del.affectedRows}`);
    } finally {
      await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }

  // Restaurar contraseña canónica del Super Admin (corrige credencial temporal).
  const [adm] = await pool.query<ResultSetHeader>(
    `UPDATE users SET password_hash = ?, must_change_password = 1, status = 'ACTIVE'
      WHERE email = 'admin@credipay.local'`,
    [ADMIN_HASH_CANONICO]
  );
  console.log(`[cleanup] admin@ restaurado a credencial canónica (filas=${adm.affectedRows})`);
}

// ---------------------------------------------------------------------------
// Paso 2: plan Premium (solo si no existe)
// ---------------------------------------------------------------------------

async function ensurePremiumPlan(): Promise<void> {
  const exists = await firstVal<number>('SELECT id FROM plans WHERE slug = ? LIMIT 1', [
    'premium-anual',
  ]);
  if (exists) {
    console.log('[plans] premium-anual ya existe');
    return;
  }
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO plans
      (name, slug, description, billing_cycle, price, setup_fee, currency_code,
       max_users, max_clients, max_credits, max_devices, storage_mb, api_rate_limit_per_min,
       max_webhooks, status, is_default, sort_order)
     VALUES ('Premium', 'premium-anual', 'Plan Premium anual para operaciones de alto volumen',
             'ANNUAL', 4999.00, 0.00, 'DOP',
             20, 5000, 10000, 10000, 20480, 120, 10, 'ACTIVE', 0, 40)`
  );
  const planId = res.insertId;
  await bulkInsert('plan_features', ['plan_id', 'feature_key', 'feature_name', 'feature_value', 'is_enabled'], [
    [planId, 'mdm_lock', 'Bloqueo MDM', '1', 1],
    [planId, 'auto_lock_overdue', 'Bloqueo automático por atraso', '1', 1],
    [planId, 'auto_unlock_paid', 'Desbloqueo automático al pagar', '1', 1],
    [planId, 'sms_notifications', 'Notificaciones SMS', '0', 0],
    [planId, 'multi_user', 'Múltiples usuarios', '1', 1],
    [planId, 'whatsapp_notifications', 'Notificaciones WhatsApp', '1', 1],
    [planId, 'reports', 'Reportes avanzados', '1', 1],
    [planId, 'api_access', 'Acceso API REST', '1', 1],
    [planId, 'priority_support', 'Soporte prioritario', '1', 1],
    [planId, 'custom_branding', 'Marca personalizada', '1', 1],
  ]);
  console.log('[plans] premium-anual creado');
}

// ---------------------------------------------------------------------------
// Paso 3: crear tenant + usuarios + suscripción
// ---------------------------------------------------------------------------

interface Ctx {
  spec: TenantSpec;
  tenantId: number;
  planId: number;
  rng: () => number;
  adminId: number;
  userIds: number[];
}

async function createTenant(spec: TenantSpec, passwordHash: string): Promise<Ctx> {
  const [tRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO tenants
      (name, slug, domain, status, email, phone, currency_code, country_code,
       language_code, timezone)
     VALUES (?, ?, NULL, 'ACTIVE', ?, ?, 'DOP', 'DO', 'es', 'America/Santo_Domingo')`,
    [spec.name, spec.slug, spec.email, spec.phone]
  );
  const tenantId = tRes.insertId;

  const [planRes] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM plans WHERE slug = ? LIMIT 1',
    [spec.planSlug]
  );
  const plan = planRes[0] as { id: number };
  const planId = plan.id;

  // tenant_settings
  await pool.query<ResultSetHeader>(
    `INSERT INTO tenant_settings
      (tenant_id, mdm_config, theme, grace_days, overdue_penalty, receipt_prefix,
       invoice_prefix, notifications, billing_config)
     VALUES (?, ?, ?, 3, 200.00, 'REC', 'INV', ?, ?)`,
    [
      tenantId,
      JSON.stringify({
        provider: 'INOVAGUARD',
        baseUrl: 'https://dashboard.inovaguardapp.com/api/v1/customer',
        apiKey: '',
        appClient: 'd13cb763-1998-4cf8-9bb4-c6dbc8b513cb',
        secret: 'kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm',
        bearerToken: '9164|Z6Qg7uS91iRNt4jVrwFAZx4MkyJivl1IOTp97mjE9540f41b',
        authLoginEndpoint: '/auth/login',
        devicesEndpoint: '/devices',
        lockEndpoint: '/devices/lock/{id}',
        unlockEndpoint: '/devices/unlock/{id}',
        unlockCodeEndpoint: '/devices/unlock-code/{id}',
        removeEndpoint: '/devices/remove/{id}',
        qrEndpoint: '/devices/qr-enrollment',
        balanceEndpoint: '/balance',
        statusEndpoint: '/devices/find/{id}',
        enabled: false,
        autoLockOnOverdue: true,
        autoUnlockOnPaid: true,
        liveMode: false,
      }),
      JSON.stringify({ mode: 'light' }),
      JSON.stringify({ whatsapp: false, sms: false, email: false }),
      JSON.stringify({ preferredGateway: 'STRIPE', gateways: [] }),
    ]
  );

  // Suscripción
  const startDate = monthsFromNow(-1, -3);
  const end = addMonths(startDate, spec.periodMonths);
  const [subRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO subscriptions
      (tenant_id, plan_id, status, starts_at, current_period_start, current_period_end, auto_renew)
     VALUES (?, ?, 'ACTIVE', ?, ?, ?, 1)`,
    [tenantId, planId, dateTime(startDate), dateTime(startDate), dateTime(end)]
  );
  await pool.query<ResultSetHeader>(
    `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
     VALUES (?, ?, 'CREATED', ?, JSON_OBJECT('planSlug', ?))`,
    [subRes.insertId, tenantId, `Suscripción inicial: plan ${spec.planSlug}`, spec.planSlug]
  );

  // Storage con la cuota del plan
  const storageMb = await firstVal<number>('SELECT storage_mb FROM plans WHERE id = ?', [planId]);
  await pool.query<ResultSetHeader>(
    'INSERT INTO storage (tenant_id, used_bytes, quota_bytes) VALUES (?, 0, ?)',
    [tenantId, (storageMb ?? 0) * 1048576]
  );

  // Pago inicial de facturación (historial SaaS, como en migración 0009)
  await pool.query<ResultSetHeader>(
    `INSERT INTO payments
      (tenant_id, subscription_id, gateway_id, user_id, amount, currency_code,
       status, payment_method, reference, description, paid_at)
     SELECT ?, s.id, (SELECT g.id FROM payment_gateways g WHERE g.code = 'STRIPE' LIMIT 1),
            NULL, pl.price, pl.currency_code, 'PAID', 'card', ?, ?, s.current_period_start
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
      WHERE s.tenant_id = ?`,
    [
      tenantId,
      `REC-SAAS-${spec.slug.toUpperCase()}-0001`,
      `Pago inicial del plan (${spec.planSlug})`,
      tenantId,
    ]
  );

  // Usuarios
  const userIds: number[] = [];
  let adminId = 0;
  for (const u of spec.users) {
    const [uRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO users
        (tenant_id, name, email, password_hash, email_verified_at, status, must_change_password)
       VALUES (?, ?, ?, ?, NOW(), 'ACTIVE', 0)`,
      [tenantId, u.name, u.email, passwordHash]
    );
    userIds.push(uRes.insertId);
    if (u.role === 'ADMIN') adminId = uRes.insertId;
    const roleId = await firstVal<number>(
      "SELECT id FROM roles WHERE slug = ? AND tenant_id IS NULL LIMIT 1",
      [u.role]
    );
    if (roleId) {
      await pool.query<ResultSetHeader>(
        'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)',
        [uRes.insertId, roleId, tenantId]
      );
    }
  }

  return { spec, tenantId, planId, rng: mullberry(hashSeed(spec.slug)), adminId, userIds };
}

// ---------------------------------------------------------------------------
// Paso 4: datos de negocio por tenant
// ---------------------------------------------------------------------------

type Pattern =
  | 'PAID_ALL'
  | 'CURRENT'
  | 'OVERDUE'
  | 'GRACE'
  | 'NEW'
  | 'PARTIAL_OVERDUE'
  | 'DEFAULTED'
  | 'CANCELED';

const PATTERNS: Pattern[] = [
  'PAID_ALL', 'PAID_ALL', 'PAID_ALL', 'PAID_ALL', 'PAID_ALL', 'PAID_ALL', 'PAID_ALL', 'PAID_ALL',
  'CURRENT', 'CURRENT', 'CURRENT', 'CURRENT',
  'OVERDUE', 'OVERDUE', 'OVERDUE',
  'GRACE', 'GRACE',
  'NEW', 'NEW',
  'PARTIAL_OVERDUE',
  'DEFAULTED', 'DEFAULTED', 'DEFAULTED',
  'CANCELED', 'CANCELED',
];

interface InstRow {
  creditId: number;
  num: number;
  amount: number;
  due: string;
  status: string;
  penalty: number;
  total: number;
  paidDate: string | null;
  ref: string | null;
}

function planOverdue(pattern: Pattern): boolean {
  return pattern === 'OVERDUE' || pattern === 'PARTIAL_OVERDUE' || pattern === 'DEFAULTED';
}
function planClientStatus(pattern: Pattern): 'ACTIVE' | 'INACTIVE' | 'DELINQUENT' {
  return planOverdue(pattern)
    ? 'DELINQUENT'
    : pattern === 'CANCELED'
      ? 'INACTIVE'
      : 'ACTIVE';
}
function planCreditStatus(pattern: Pattern): 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED' | 'CANCELED' {
  if (pattern === 'PAID_ALL') return 'PAID_OFF';
  if (pattern === 'DEFAULTED') return 'DEFAULTED';
  if (pattern === 'CANCELED') return 'CANCELED';
  return 'ACTIVE';
}

function pastInstalls(start: Date, count: number): number {
  let c = 0;
  for (let i = 1; i <= count; i++) {
    if (addMonths(start, i - 1).getTime() <= todayTs) c++;
  }
  return c;
}

function buildInstalls(
  ctx: Ctx,
  creditId: number,
  pattern: Pattern,
  count: number,
  monthly: number,
  start: Date
): InstRow[] {
  const past = pastInstalls(start, count);
  const prefix = ctx.spec.slug === 'alpha' ? 'A' : 'P';
  const out: InstRow[] = [];

  for (let i = 1; i <= count; i++) {
    let due = addMonths(start, i - 1);
    let status: string = 'PENDIENTE';
    let penalty = 0;
    let paidDate: string | null = null;
    let ref: string | null = null;

    const markPaid = () => {
      status = 'PAGADO';
      const pd = new Date(Math.min(due.getTime() + 2 * 86400000 + Math.floor(ctx.rng() * 3) * 86400000, todayTs - 86400000));
      paidDate = iso(pd);
      ref = `REC-${prefix}-${String(100000 + Math.floor(ctx.rng() * 899999))}`;
    };

    if (pattern === 'PAID_ALL') {
      if (due.getTime() <= todayTs) markPaid();
    } else if (pattern === 'CURRENT') {
      if (i <= past) markPaid();
    } else if (pattern === 'NEW') {
      // sin pagos todavía
    } else if (pattern === 'OVERDUE') {
      if (i < past) markPaid();
      else if (i === past) {
        status = 'ATRASADO';
        penalty = 200;
      }
    } else if (pattern === 'GRACE') {
      if (i < past) markPaid();
      else if (i === past) {
        status = 'VENCIDO';
        due = new Date(todayTs - 2 * 86400000);
      }
    } else if (pattern === 'PARTIAL_OVERDUE') {
      if (i === 1) markPaid();
      else if (i === 2) {
        status = 'ATRASADO';
        penalty = 200;
      }
    } else if (pattern === 'DEFAULTED') {
      if (i <= Math.ceil(count * 0.2)) markPaid();
      else if (i <= past) {
        status = 'ATRASADO';
        penalty = 200;
      }
    } else {
      // CANCELED
      if (i === 1) markPaid();
      else status = 'CANCELADO';
    }

    const amount = monthly;
    const total = Number((amount + penalty).toFixed(2));
    out.push({
      creditId,
      num: i,
      amount: Number(amount.toFixed(2)),
      due: iso(due),
      status,
      penalty,
      total,
      paidDate,
      ref,
    });
  }
  return out;
}

async function generateBusinessData(ctx: Ctx): Promise<void> {
  const spec = ctx.spec;
  const rng = ctx.rng;
  const isAlpha = spec.slug === 'alpha';
  const firstPool = isAlpha ? ALPHA_FIRST : CP_FIRST;
  const lastPool = isAlpha ? ALPHA_LAST : CP_LAST;
  const tId = ctx.tenantId;

  // ----- 30 clientes -----
  const clientRows: unknown[][] = [];
  for (let i = 0; i < 30; i++) {
    const first = firstPool[i % firstPool.length];
    const last = lastPool[(i * 7) % lastPool.length];
    const cedula = `${CEDULA[spec.slug]}${String(1000000 + i * 137).slice(0, 7)}-${(i % 9) + 1}`;
    const phone = `${PHONE[spec.slug]}${String(30 + i).padStart(3, '0')}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${DOMAIN[spec.slug]}`;
    clientRows.push([
      tId,
      `${first} ${last}`,
      cedula,
      phone,
      email,
      ADDRESS[spec.slug][i % ADDRESS[spec.slug].length],
      'ACTIVE',
      null,
    ]);
  }
  await bulkInsert('clients', ['tenant_id', 'full_name', 'cedula_or_id', 'phone', 'email', 'address', 'status', 'created_by'], clientRows);
  const clientIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    clientIds.push((await firstVal<number>(
      "SELECT id FROM clients WHERE tenant_id = ? AND cedula_or_id = ? LIMIT 1",
      [tId, clientRows[i][2]]
    )) ?? 0);
  }

  // ----- 25 créditos -----
  const creditDefs: Array<{ clientId: number; pattern: Pattern; count: number; monthly: number; start: Date }> = [];
  for (let i = 0; i < 25; i++) {
    const pattern = PATTERNS[i];
    const count = pick(rng, spec.monthsMix);
    const monthly = Math.round((spec.monthlyRange[0] + rng() * (spec.monthlyRange[1] - spec.monthlyRange[0])) / 50) * 50;
    let start: Date;
    if (pattern === 'PAID_ALL') {
      start = monthsFromNow(-(count + 2), -2);
    } else if (pattern === 'CURRENT') {
      start = monthsFromNow(-(2 + Math.floor(rng() * 4)));
    } else if (pattern === 'OVERDUE' || pattern === 'PARTIAL_OVERDUE') {
      start = monthsFromNow(-(3 + Math.floor(rng() * 4)));
    } else if (pattern === 'GRACE') {
      start = monthsFromNow(-1, 2);
    } else if (pattern === 'NEW') {
      start = monthsFromNow(0, -5);
    } else if (pattern === 'DEFAULTED') {
      start = monthsFromNow(-(7 + Math.floor(rng() * 3)));
    } else {
      start = monthsFromNow(-2, -5);
    }
    creditDefs.push({ clientId: clientIds[i], pattern, count, monthly, start });
  }

  const creditIdByClient = new Map<number, number>();
  const creditRows: unknown[][] = [];
  let seq = 1;
  for (const def of creditDefs) {
    creditRows.push([
      def.clientId,
      tId,
      `CR-${spec.slug.toUpperCase()}-${String(seq).padStart(4, '0')}`,
      iso(def.start),
      Number((def.monthly * def.count).toFixed(2)),
      Number(def.monthly.toFixed(2)),
      def.count,
      planCreditStatus(def.pattern),
      ctx.adminId,
    ]);
    seq++;
  }
  await bulkInsert('credits', ['client_id', 'tenant_id', 'credit_number', 'start_date', 'total_amount', 'monthly_amount', 'installments_count', 'status', 'created_by'], creditRows);
  for (let i = 0; i < creditDefs.length; i++) {
    const id = (await firstVal<number>(
      "SELECT id FROM credits WHERE tenant_id = ? AND credit_number = ? LIMIT 1",
      [tId, creditRows[i][2]]
    )) ?? 0;
    creditIdByClient.set(creditDefs[i].clientId, id);
  }

  // ----- cuotas + pagos recibidos -----
  const installRows: unknown[][] = [];
  const payRows: unknown[][] = [];
  for (const def of creditDefs) {
    const creditId = creditIdByClient.get(def.clientId) ?? 0;
    const insts = buildInstalls(ctx, creditId, def.pattern, def.count, def.monthly, def.start);
    for (const it of insts) {
      installRows.push([
        creditId,
        tId,
        it.num,
        it.amount,
        it.due,
        it.status,
        it.penalty,
        it.total,
        it.paidDate,
        it.ref,
        it.status === 'PAGADO' ? it.total : null,
      ]);
    }
    // Ingresos de caja = cada cuota pagada
    const payerIds = [...ctx.userIds];
    for (const it of insts.filter((x) => x.status === 'PAGADO')) {
      payRows.push([
        def.clientId,
        tId,
        creditId,
        it.total,
        0,
        pick(rng, ['CASH', 'CASH', 'CASH', 'TRANSFER', 'CARD']),
        it.ref,
        it.paidDate,
        pick(rng, payerIds),
        `Cuota #${it.num}`,
      ]);
    }
  }
  await bulkInsert('credit_installments', ['credit_id', 'tenant_id', 'installment_number', 'amount', 'due_date', 'status', 'penalty_amount', 'total_amount', 'paid_date', 'payment_reference', 'paid_amount'], installRows);
  await bulkInsert('payments_received', ['client_id', 'tenant_id', 'credit_id', 'amount', 'change_amount', 'method', 'reference', 'received_date', 'received_by', 'notes'], payRows);

  // ----- 25 dispositivos (1 por cliente con crédito) -----
  const deviceRows: unknown[][] = [];
  const enrolledEvents: unknown[][] = [];
  const lockEvents: unknown[][] = [];
  for (let i = 0; i < 25; i++) {
    const clientId = creditDefs[i].clientId;
    const credit = creditIdByClient.get(clientId) ?? 0;
    const first = firstPool[i % firstPool.length];
    const last = lastPool[(i * 7) % lastPool.length];
    const brand = pick(rng, BRAND[spec.slug]);
    const model = pick(rng, MODEL[spec.slug]);
    const imei = `${IMEI_PREFIX[spec.slug]}${String(Math.floor(rng() * 1e9)).padStart(9, '0')}`;
    const serial = `${SERIAL_PREFIX[spec.slug]}${String(100000 + Math.floor(rng() * 899999))}`;
    const pattern = creditDefs[i].pattern;
    const overdue = planOverdue(pattern);
    const mdmStatus = overdue ? 'LOCKED' : pattern === 'CANCELED' ? 'REMOVED' : 'UNLOCKED';
    const unlockCode = overdue ? String(10000 + Math.floor(rng() * 89999)) : null;

    deviceRows.push([
      clientId,
      tId,
      String(100 + i),
      `${brand.replace(/\s/g, '')}-${first}-${last}`,
      brand,
      model,
      imei,
      serial,
      mdmStatus,
      unlockCode,
      1,
      dateTime(monthsFromNow(-2, -3)),
      mdmStatus === 'LOCKED' ? 'Bloqueo automático - Cuota atrasada' : 'Sincronizado al crear en entorno de pruebas',
    ]);
    enrolledEvents.push([
      credit, // device_id (se reemplaza abajo con el id real)
      tId,
      clientId,
      'ENROLL',
      'API',
      'SUCCESS',
      imei,
      'Enrolamiento inicial del dispositivo',
      dateTime(monthsFromNow(-10)),
    ]);
    if (mdmStatus === 'LOCKED') {
      lockEvents.push([
        credit,
        tId,
        clientId,
        'LOCK',
        'AUTOMATIC_OVERDUE',
        'SUCCESS',
        imei,
        'Cuota atrasada > 3 días. Mora RD$200 aplicada y comando MDM lock',
        dateTime(monthsFromNow(-2, -1)),
      ]);
    }
  }
  await bulkInsert('devices', ['client_id', 'tenant_id', 'inovaguard_id', 'device_name', 'brand', 'model', 'imei', 'serial_number', 'mdm_status', 'unlock_code', 'remote_lock_supported', 'last_mdm_sync_at', 'last_mdm_sync_note'], deviceRows);

  const deviceIds: number[] = [];
  for (let i = 0; i < 25; i++) {
    const imei = deviceRows[i][6] as string;
    deviceIds.push((await firstVal<number>(
      'SELECT id FROM devices WHERE tenant_id = ? AND imei = ? LIMIT 1',
      [tId, imei]
    )) ?? 0);
  }

  const eventRows: unknown[][] = [];
  for (let i = 0; i < enrolledEvents.length; i++) {
    eventRows.push([deviceIds[i], ...enrolledEvents[i].slice(1)]);
  }
  for (let i = 0; i < lockEvents.length; i++) {
    eventRows.push([deviceIds[creditDefs.findIndex((d) => d.clientId === lockEvents[i][2]) ?? 0], ...lockEvents[i].slice(1)]);
  }
  await bulkInsert('device_events', ['device_id', 'tenant_id', 'client_id', 'action', 'trigger_source', 'status', 'imei', 'details', 'created_at'], eventRows);

  // ----- notificaciones -----
  const notifRows: unknown[][] = [];
  const overdueClient = creditDefs.find((d) => planOverdue(d.pattern));
  const paidRef = payRows[payRows.length - 1]?.[6] ?? 'N/A';
  notifRows.push(
    [tId, ctx.adminId, 'SYSTEM', `Bienvenido a CrediPay MDM - ${spec.name}`, 'Tenant creado en entorno de pruebas multi-tenant con datos de demostración.', JSON.stringify({ phase: 'seed' })],
    [tId, ctx.adminId, 'COLLECTION', 'Recordatorio de pago', 'Un cliente tiene cuota vencida; se envió recordatorio de cobranza.', JSON.stringify({ clientId: overdueClient?.clientId ?? null })],
    [tId, ctx.adminId, 'PAYMENT', 'Pago confirmado', `Pago registrado con referencia ${paidRef}.`, JSON.stringify({ reference: paidRef })],
    [tId, ctx.adminId, 'COLLECTION', 'Aviso de bloqueo (MDM)', 'Dispositivo bloqueado por cuota atrasada más de 3 días.', JSON.stringify({ auto: true })],
  );
  await bulkInsert('notifications', ['tenant_id', 'user_id', 'type', 'title', 'body', 'data'], notifRows);

  // ----- actividad reciente -----
  const actRows: unknown[][] = [
    [tId, ctx.adminId, 'TENANT', `Empresa "${spec.name}" activada`, dateTime(monthsFromNow(-1, -3))],
    [tId, ctx.adminId, 'CLIENT', '30 clientes cargados en cartera', dateTime(monthsFromNow(-1, -2))],
    [tId, ctx.adminId, 'CREDIT', '25 créditos generados con cuotas', dateTime(monthsFromNow(-1, -1))],
    [tId, ctx.adminId, 'PAYMENT', `${payRows.length} pagos registrados en caja`, dateTime(monthsFromNow(-1, -1))],
    [tId, ctx.adminId, 'BILLING', `Suscripción activa (${spec.planSlug})`, dateTime(monthsFromNow(-1, -3))],
    [tId, ctx.adminId, 'SETTINGS', 'Configuración MDM desactivada para entorno de pruebas', dateTime(monthsFromNow(-1, -3))],
  ];
  await bulkInsert('activity_logs', ['tenant_id', 'user_id', 'activity_type', 'description', 'created_at'], actRows);

  // ----- auditoría del seed -----
  await pool.query<ResultSetHeader>(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_values, ip_address, metadata)
     VALUES (?, ?, 'SEED_MULTITENANT_CREATED', 'tenant', ?, JSON_OBJECT('name', ?, 'clients', ?, 'credits', ?, 'devices', 25), '127.0.0.1', JSON_OBJECT('source', 'scripts/seed-multitenant-test'))`,
    [tId, ctx.adminId, String(tId), spec.name, 30, 25]
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== Seed Multi-Tenant de pruebas ===');
  await cleanup();
  await ensurePremiumPlan();

  const passwordHash = await bcrypt.hash('12345678', 12);
  console.log('[users] hash de contraseña listo (12345678)');

  const ctxs: Ctx[] = [];
  for (const spec of SPECS) {
    const ctx = await createTenant(spec, passwordHash);
    ctxs.push(ctx);
    console.log(`[tenant] ${spec.slug} creado con id=${ctx.tenantId} (admin=${ctx.adminId})`);
  }
  for (const ctx of ctxs) {
    await generateBusinessData(ctx);
    console.log(`[seed] datos de ${ctx.spec.slug} listos`);
  }

  console.log('\n=== Resumen ===');
  for (const ctx of ctxs) {
    const q = (t: string) => countRows(`SELECT COUNT(*) AS c FROM ${t} WHERE tenant_id = ?`, [ctx.tenantId]);
    const [users, clients, credits, inst, pay, dev, evts, notif, act] = await Promise.all([
      q('users'), q('clients'), q('credits'), q('credit_installments'),
      q('payments_received'), q('devices'), q('device_events'), q('notifications'), q('activity_logs'),
    ]);
    console.log(
      `- ${ctx.spec.name} (${ctx.spec.slug}): usuarios=${users} clientes=${clients} créditos=${credits} cuotas=${inst} pagos=${pay} dispositivos=${dev} eventos=${evts} notif=${notif} actividad=${act}`
    );
  }
  console.log(`\nTiempo total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

void main().catch(async (err) => {
  console.error('Seed falló:', err);
  await pool.end();
  process.exit(1);
});