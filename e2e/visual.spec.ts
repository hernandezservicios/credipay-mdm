import { execSync } from 'child_process';
import path from 'path';
import { test, expect, Page } from '@playwright/test';

/**
 * Verificación visual de la UI reconectada a la API (Fase 3):
 * flujos reales en navegador contra Vite (:3000) + API (:4000).
 * Requiere: servidor en :4000 y Vite en :3000 corriendo.
 * La BD se respalda antes y se restaura después (deja el estado semilla intacto).
 */

const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql8.4.7\\bin\\mysql.exe';
const MYSQLDUMP = 'C:\\wamp64\\bin\\mysql\\mysql8.4.7\\bin\\mysqldump.exe';
const DB_DUMP = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'credipay_mdm_e2e.sql');

const ADMIN = { email: 'demo.admin@credipay.local', password: 'Fase2Test2026!' };
const SUPER_ADMIN = { email: 'admin@credipay.local', password: '7xs8G8GJrTze9S' };
const OPERADOR = { email: 'demo.operador@credipay.local', password: 'Fase2Test2026!' };
const CLIENT_LOCKED = 'Yomaira Rosario Jiménez';
const CLIENT_UNLOCKED = 'Carlos Andrés Mendoza';

test.beforeAll(() => {
  execSync(`"${MYSQLDUMP}" --single-transaction --routines -u root credipay_mdm > "${DB_DUMP}"`, {
    stdio: 'ignore',
  });
});

test.afterAll(() => {
  execSync(
    `"${MYSQL}" --init-command="SET SESSION FOREIGN_KEY_CHECKS=0" -u root credipay_mdm < "${DB_DUMP}"`,
    { stdio: 'ignore' }
  );
});

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: /Cartera de Clientes/ })).toBeVisible({
    timeout: 30_000,
  });
}

// Super Admin global sin empresa activa: el panel por defecto es el Comercial
async function loginGlobal(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByText('Panel Comercial — Empresas & Suscripciones')).toBeVisible({
    timeout: 30_000,
  });
}

function card(page: Page, clientName: string) {
  return page.locator('div.bg-white.border.rounded-xl.p-5', { hasText: clientName }).first();
}

async function confirmDialog(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

const toast = (page: Page) => page.locator('div.fixed.bottom-6.right-6');

test('Login Super Admin y cartera real desde la API', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await expect(page.getByText(ADMIN.email)).toBeVisible();
  for (const name of ['Yomaira Rosario Jiménez', 'Rodolfo Peña Castro', 'Mariana Valenzuela Ortiz', 'Carlos Andrés Mendoza']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/4 clientes/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Super Admin: cambio de contraseña obligatorio (mustChangePassword)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(SUPER_ADMIN.email);
  await page.locator('input[type="password"]').fill(SUPER_ADMIN.password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();

  await expect(page.getByText('Cambio de Contraseña Obligatorio')).toBeVisible();
  const pws = page.locator('input[type="password"]');
  await pws.nth(0).fill(SUPER_ADMIN.password);
  const newPw = 'NuevaClaveE2E2026!';
  await pws.nth(1).fill(newPw);
  await pws.nth(2).fill(newPw);
  await page.getByRole('button', { name: 'Actualizar y Continuar' }).click();
  await expect(page.getByText('Panel Comercial — Empresas & Suscripciones')).toBeVisible({
    timeout: 30_000,
  });
});

test('Flujo MDM: Bloquear -> Desbloquear -> Código offline -> Logs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  const c = card(page, CLIENT_UNLOCKED);
  await c.getByRole('button', { name: /Acciones MDM/ }).click();
  await c.getByRole('button', { name: 'Bloquear Dispositivo (Lock MDM)' }).click();
  await confirmDialog(page, 'Sí, Bloquear');
  await expect(toast(page).getByText(/MDM LOCK/)).toBeVisible();
  await expect(c.getByText('CELULAR BLOQUEADO (MDM LOCK)')).toBeVisible({ timeout: 30_000 });

  await c.getByRole('button', { name: /Acciones MDM/ }).click();
  await c.getByRole('button', { name: 'Desbloquear Dispositivo (Unlock)' }).click();
  await confirmDialog(page, 'Sí, Desbloquear');
  await expect(toast(page).getByText(/MDM UNLOCK/)).toBeVisible();
  await expect(c.getByText('DESBLOQUEADO')).toBeVisible({ timeout: 30_000 });

  await c.getByRole('button', { name: /Acciones MDM/ }).click();
  await c.getByRole('button', { name: 'Generar Código Unlock Offline' }).click();
  await confirmDialog(page, 'Sí, Generar Código');
  await expect(toast(page).getByText(/CÓDIGO OFFLINE GENERADO/)).toBeVisible();

  await page.getByRole('button', { name: /Auditoría & Logs/ }).click();
  await expect(page.getByText('Auditoría Completa de Órdenes MDM & Sincronizaciones InovaGuard')).toBeVisible();
  for (const action of ['LOCK', 'UNLOCK', 'UNLOCK_CODE']) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Pago en cascada (cuota -> PAGADO) sobre cliente con dispositivo bloqueado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  const c = card(page, CLIENT_LOCKED);
  await c.getByRole('button', { name: 'Ver Cuotas & Cobrar' }).click();
  await expect(page.getByText('Historial de Cuotas y Cobranza')).toBeVisible();
  await page.getByRole('button', { name: /Registrar Pago/ }).first().click();

  await expect(page.getByText('Registrar Pago en Cascada & Desbloquear')).toBeVisible();
  await page.locator('input[placeholder="Efectivo del cliente"]').fill('4000');
  await page.getByRole('button', { name: 'Confirmar Pago & Desbloquear' }).click();
  await confirmDialog(page, 'Sí, Confirmar Pago');

  await expect(page.getByText('Pago en Cascada Registrado')).toBeVisible();
  await expect(page.getByText('Cuotas Completadas')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await expect(page.getByText(/PAGADO/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar Ventana' }).click();

  expect(errors).toEqual([]);
});

test('Nuevo préstamo: cliente + crédito + dispositivo desde la UI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  const name = 'Cliente E2E Verificación';
  await page.getByRole('button', { name: 'Nuevo Préstamo' }).click();
  await expect(page.getByText('Nuevo Crédito & Inscripción CrediPay MDM (RD$)')).toBeVisible();
  await page.locator('input[placeholder="Ej: Laura Sofía Torres"]').fill(name);
  await page.locator('input[placeholder="Ej: 001-9283741-2"]').fill('001-9999999-9');
  await page.locator('input[placeholder="+1 809-555-0101"]').fill('+1 809-555-0199');
  await page.locator('input[placeholder="Ej: Galaxy A55 5G 256GB"]').fill('E2E Phone 128GB');
  await page.locator('input[placeholder="358920198234001"]').fill('666666666666666');
  await page.getByRole('button', { name: 'Registrar Cliente y Préstamo' }).click();
  await confirmDialog(page, 'Sí, Registrar Crédito');

  await expect(toast(page).getByText(new RegExp(`Nuevo crédito y celular .* registrados para ${name}`))).toBeVisible();

  const search = page.getByPlaceholder(/Buscar por cliente/);
  await search.fill(name);
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, name).getByText('E2E Phone 128GB')).toBeVisible();

  expect(errors).toEqual([]);
});

test('Config MDM: probar conexión y guardar en el servidor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /API MDM/ }).click();
  const modal = page.locator('div.fixed.inset-0', { hasText: 'Inyección de API MDM & Configuración de Bloqueo' }).last();
  await expect(modal).toBeVisible();

  await modal.getByRole('button', { name: 'Probar Conexión API (Test cURL)' }).click();
  await expect(modal.getByText(/INOVAGUARD API CONECTADA|Error conectando/)).toBeVisible({ timeout: 40_000 });

  await modal.getByRole('button', { name: 'Guardar Configuración' }).click();
  await confirmDialog(page, 'Sí, Guardar');
  await expect(toast(page).getByText(/Configuración MDM guardada en el servidor/)).toBeVisible();

  await modal.getByRole('button').first().click();
  await expect(modal).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('Vistas DEVICES, FINANCE, ANALYTICS y LOGS renderizan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /Parque Dispositivos/ }).click();
  await expect(page.getByText('Parque de Dispositivos InovaGuard MDM')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Caja & Flujo Cobros/ }).click();
  await expect(page.getByText('Caja & Flujo de Cobros CrediPay MDM')).toBeVisible();

  await page.getByRole('button', { name: /Estadísticas & KPIs/ }).click();
  await expect(page.getByText('Estadísticas & Efectividad del Bloqueo CrediPay MDM')).toBeVisible();

  await page.getByRole('button', { name: /Auditoría & Logs/ }).click();
  await expect(page.getByText('Auditoría Completa de Órdenes MDM & Sincronizaciones InovaGuard')).toBeVisible();
  await expect(page.getByText(/Eventos Registrados/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('RBAC: Operador sin permisos -> toast de denegación', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, OPERADOR.email, OPERADOR.password);
  await expect(page.getByText(OPERADOR.email)).toBeVisible();

  await page.getByRole('button', { name: /API MDM/ }).click();
  await expect(toast(page).getByText(/Acción denegada: falta el permiso/)).toBeVisible();
  await expect(page.getByText('Inyección de API MDM & Configuración de Bloqueo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Nuevo Préstamo' }).click();
  await expect(toast(page).getByText(/Acción denegada: falta el permiso/)).toBeVisible();

  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Entrar a la Consola' })).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Fase 4: multi-tenancy — switch de empresa en sesión, sync masivo y búsquedas
// ---------------------------------------------------------------------------

test('Aislamiento de tenant: usuario de empresa no puede cambiar de empresa (403)', async ({ request }) => {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password, remember: false },
  });
  expect(loginRes.ok()).toBeTruthy();

  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === 'csrf')?.value;
  const res = await request.post('/api/v1/tenants/1/switch', {
    headers: { 'X-CSRF-Token': csrf ?? '' },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('tenant_switch_forbidden');
});

test('Sync masivo: reconciliación InovaGuard -> dispositivos locales (SYSTEM_SYNC)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /Parque Dispositivos/ }).click();
  await expect(page.getByText('Parque de Dispositivos InovaGuard MDM')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Refrescar API (/devices)' }).click();
  await expect(toast(page).getByText(/SYNC INVENTARIO COMPLETO|SYNC SIMULADO/)).toBeVisible({
    timeout: 60_000,
  });

  expect(errors).toEqual([]);
});

test('Búsqueda sin guiones: cédula y teléfono con guiones localizan clientes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  const search = page.getByPlaceholder(/Buscar por cliente/);
  await search.fill('001-18-29384-5');
  await expect(card(page, 'Carlos Andrés Mendoza')).toBeVisible();
  await expect(card(page, 'Mariana Valenzuela Ortiz')).toHaveCount(0);

  await search.fill('809-555-88 21');
  await expect(card(page, 'Mariana Valenzuela Ortiz')).toBeVisible();
  await expect(card(page, 'Carlos Andrés Mendoza')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('Tenant switch: Super Admin global ve la cartera tras cambiar de empresa', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // La contraseña se rota a NuevaClaveE2E2026! en el test "cambio de contraseña
  // obligatorio" (los tests corren en orden secuencial, workers=1).
  await loginGlobal(page, SUPER_ADMIN.email, 'NuevaClaveE2E2026!');

  const switcher = page.getByRole('button', { name: 'Plataforma (sin empresa)' });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole('button', { name: 'CrediPay Principal' }).click();

  await expect(page.getByText('Yomaira Rosario Jiménez', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'CrediPay Principal' })).toBeVisible();

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Fase 5: SaaS comercial — suscripción, planes, límites y facturación
// ---------------------------------------------------------------------------

const dbClient = (cmd: string) => `"${MYSQL}" -u root credipay_mdm -N -B -e "${cmd}"`;

test('SaaS: vista Suscripción con historial y cambio de plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /Suscripción & Planes/ }).click();
  await expect(page.getByText('Suscripción & Planes CrediPay MDM')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Empresa', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('REC-SAAS-000001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Uso actual vs Límites del Plan/).first()).toBeVisible();

  await page.getByRole('button', { name: /Cambiar de Plan/ }).click();
  const target = page.getByRole('button', { name: 'Cambiar a Profesional' }).first();
  await expect(target).toBeVisible();
  await target.click();
  await confirmDialog(page, 'Sí, Cambiar Plan');
  await expect(toast(page).getByText(/Plan actualizado: Profesional/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Renovar \/ Registrar Pago/ }).click();
  await confirmDialog(page, 'Sí, Renovar');
  await expect(toast(page).getByText(/Pago de renovación registrado/)).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});

test('SaaS límite de plan: alcanzar max_clients devuelve 403 plan_limit_reached', async ({ request }) => {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password, remember: false },
  });
  expect(loginRes.ok()).toBeTruthy();
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === 'csrf')?.value;

  const planIdRaw = execSync(
    dbClient(
      "SELECT MAX(pl.id) FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.tenant_id = 1 AND s.deleted_at IS NULL AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')"
    )
  )
    .toString()
    .trim();
  const planId = parseInt(planIdRaw, 10);

  const countRaw = execSync(
    dbClient('SELECT COUNT(*) FROM clients WHERE tenant_id = 1 AND deleted_at IS NULL')
  )
    .toString()
    .trim();
  const clientCount = parseInt(countRaw, 10);

  try {
    execSync(dbClient(`UPDATE plans SET max_clients = ${clientCount} WHERE id = ${planId};`));
    const res = await request.post('/api/v1/clients', {
      headers: { 'X-CSRF-Token': csrf ?? '' },
      data: { fullName: 'Cliente Plan Límite E2E', phone: '+1 809-555-0199' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('plan_limit_reached');
  } finally {
    execSync(dbClient(`UPDATE plans SET max_clients = 5000 WHERE id = ${planId};`));
  }
});

test('SaaS: Panel Comercial del Super Admin lista empresas y entra de la lista', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await loginGlobal(page, SUPER_ADMIN.email, 'NuevaClaveE2E2026!');

  await expect(page.getByText('Panel Comercial — Empresas & Suscripciones')).toBeVisible({
    timeout: 30_000,
  });
  const card = page
    .locator('div.bg-slate-900.border.border-slate-800.rounded-2xl.p-5', {
      hasText: 'CrediPay Principal',
    })
    .first();
  await expect(card.getByRole('button', { name: 'Entrar a la empresa' })).toBeVisible();

  await card.getByRole('button', { name: 'Entrar a la empresa' }).click();
  await expect(page.getByRole('heading', { name: /Cartera de Clientes/ })).toBeVisible({
    timeout: 30_000,
  });

  expect(errors).toEqual([]);
});
