import { execSync } from 'child_process';
import path from 'path';
import { createHmac } from 'crypto';
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
const CLIENT_LOCKED = 'Carmen Valenzuela';
const CLIENT_UNLOCKED = 'Carlos Mendoza';

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
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible({
    timeout: 30_000,
  });
}

// La cartera de clientes (tarjetas con Acciones MDM) vive en la vista CLIENTS.
async function openCartera(page: Page) {
  await page.getByRole('button', { name: /Créditos & Cobranza/ }).click();
  await expect(page.getByText('Cartera de Clientes & Control MDM')).toBeVisible({
    timeout: 30_000,
  });
}

// Super Admin global sin empresa activa: el panel por defecto es el Resumen de Plataforma
async function loginGlobal(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen de Plataforma' })).toBeVisible({
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
  await openCartera(page);

  await expect(page.getByText(ADMIN.email)).toBeVisible();
  for (const name of ['Carlos Mendoza', 'Mariana Santana', 'Lucia Castillo', 'Ana Nunez']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/Ver Cuotas & Cobrar/).first()).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Resumen de Plataforma' })).toBeVisible({
    timeout: 30_000,
  });
});

test('Flujo MDM: Bloquear -> Desbloquear -> Código offline -> Logs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);
  await openCartera(page);

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

test('Pago en cascada: cobro confirmado desbloquea el dispositivo bloqueado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);
  await openCartera(page);

  const c = card(page, CLIENT_LOCKED);
  await c.getByRole('button', { name: 'Ver Cuotas & Cobrar' }).click();
  await expect(page.getByText('Historial de Cuotas y Cobranza')).toBeVisible();
  await expect(page.getByText('BLOQUEADO MDM')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar Ventana' }).click();

  await page.getByRole('button', { name: /Solicitudes, desembolsos y acuerdos/ }).click();
  await expect(page.getByRole('heading', { name: /Ciclo de Vida de Préstamos/ })).toBeVisible({ timeout: 30_000 });

  const loanRow = page.locator('tbody tr', { hasText: CLIENT_LOCKED }).first();
  await loanRow.getByRole('button', { name: 'Cobrar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder('0.00').first().fill('999999');
  await dialog.getByRole('button', { name: /Simular distribución/ }).click();
  await expect(dialog.getByText(/Distribución propuesta/)).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole('button', { name: /Confirmar cobro/ }).click();
  await expect(toast(page).getByText(/Cobro registrado: recibo #/)).toBeVisible({ timeout: 30_000 });
  await dialog.getByText('Cerrar', { exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openCartera(page);
  const c2 = card(page, CLIENT_LOCKED);
  await c2.getByRole('button', { name: 'Ver Cuotas & Cobrar' }).click();
  await expect(page.getByText(/PAGADO/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cerrar Ventana' }).click();

  expect(errors).toEqual([]);
});

test('Nuevo préstamo: cliente existente + crédito desde el wizard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: 'Nuevo Préstamo' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder('Buscar por nombre…').fill('Mariana');
  await dialog.getByRole('button', { name: /Mariana Santana/ }).click();
  await expect(dialog.getByText('Mariana Santana')).toBeVisible();

  await dialog.locator('select').first().selectOption({ index: 1 });

  const numbers = dialog.locator('input[type="number"]');
  await numbers.nth(0).fill('1000');
  await numbers.nth(1).fill('24');
  await numbers.nth(2).fill('6');
  await numbers.nth(3).fill('0');

  await dialog.getByRole('button', { name: 'COTIZAR' }).click();
  await expect(dialog.getByText(/Vista previa de la cotización/)).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole('button', { name: 'CREAR PRÉSTAMO' }).click();
  await expect(toast(page).getByText(/Préstamo creado: CR-/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const loansTab = page.getByRole('button', { name: /Préstamos/ }).last();
  await loansTab.click();
  await expect(page.getByText(/Ciclo de Vida de Préstamos/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Mariana Santana', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });

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

  await modal.getByRole('button', { name: 'Cerrar Panel' }).click();
  await expect(modal).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('Vistas DEVICES, FINANCE, ANALYTICS y LOGS renderizan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /Parque Dispositivos/ }).click();
  await expect(page.getByText('Parque de Dispositivos InovaGuard MDM')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Caja & Flujo/ }).click();
  await expect(page.getByText('Historial de Cajas')).toBeVisible();

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
  await openCartera(page);

  const search = page.getByPlaceholder(/Buscar por cliente/);
  await search.fill('001-11000000-1');
  await expect(card(page, 'Carlos Mendoza')).toBeVisible();
  await expect(card(page, 'Mariana Santana')).toHaveCount(0);

  await search.fill('809-555-204 6');
  await expect(card(page, 'Julio Espinal')).toBeVisible();
  await expect(card(page, 'Carlos Mendoza')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('Tenant switch: Super Admin global ve la cartera tras cambiar de empresa', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // La contraseña se rota a NuevaClaveE2E2026! en el test "cambio de contraseña
  // obligatorio" (los tests corren en orden secuencial, workers=1).
  await loginGlobal(page, SUPER_ADMIN.email, 'NuevaClaveE2E2026!');

  await page.getByRole('button', { name: /Empresas/ }).click();
  const tenantCard = page
    .locator('div.bg-slate-900.border.border-slate-800.rounded-2xl.p-5', {
      hasText: 'Financiera Alpha',
    })
    .first();
  await tenantCard.getByRole('button', { name: 'Entrar a la empresa' }).click();
  await expect(page.getByRole('heading', { name: /Motor de Bloqueo MDM/ })).toBeVisible({
    timeout: 30_000,
  });

  await openCartera(page);
  await expect(page.getByText('Carlos Mendoza', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Financiera Alpha' })).toBeVisible();

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

  await expect(page.getByText(/Básico/).first()).toBeVisible();
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
      "SELECT MAX(pl.id) FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.tenant_id = 5 AND s.deleted_at IS NULL AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')"
    )
  )
    .toString()
    .trim();
  const planId = parseInt(planIdRaw, 10);

  const countRaw = execSync(
    dbClient('SELECT COUNT(*) FROM clients WHERE tenant_id = 5 AND deleted_at IS NULL')
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

  await page.getByRole('button', { name: /Empresas/ }).click();
  const card = page
    .locator('div.bg-slate-900.border.border-slate-800.rounded-2xl.p-5', {
      hasText: 'Financiera Alpha',
    })
    .first();
  await expect(card.getByRole('button', { name: 'Entrar a la empresa' })).toBeVisible();

  await card.getByRole('button', { name: 'Entrar a la empresa' }).click();
  await expect(page.getByRole('heading', { name: /Motor de Bloqueo MDM/ })).toBeVisible({
    timeout: 30_000,
  });

  expect(errors).toEqual([]);
});

test('SaaS: detalle de empresa muestra suscripción, pagos, historial y auditoría', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await loginGlobal(page, SUPER_ADMIN.email, 'NuevaClaveE2E2026!');

  await page.getByRole('button', { name: /Empresas/ }).click();
  const card = page
    .locator('div.bg-slate-900.border.border-slate-800.rounded-2xl.p-5', {
      hasText: 'Financiera Alpha',
    })
    .first();
  const detailBtn = card.getByRole('button', { name: 'Ver detalles' });
  await expect(detailBtn).toBeVisible();
  await detailBtn.click();

  const dialog = page.getByRole('dialog', { name: /Detalle — Financiera Alpha/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Suscripción', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/Historial de suscripción/)).toBeVisible();
  await expect(dialog.getByText(/Últimos pagos/)).toBeVisible();
  await expect(dialog.getByText(/Auditoría/)).toBeVisible();
  await expect(dialog.getByText(/Administrador de la empresa/)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  expect(errors).toEqual([]);
});

test('SaaS: switch bloqueado cuando la suscripción está vencida (EXPIRED)', async ({ request }) => {
  const subRaw = execSync(
    dbClient(
      "SELECT s.id FROM subscriptions s WHERE s.tenant_id = 5 AND s.deleted_at IS NULL AND s.status IN ('TRIAL','ACTIVE','PAST_DUE') ORDER BY s.id DESC LIMIT 1"
    )
  )
    .toString()
    .trim();
  test.skip(!subRaw, 'No existe suscripción activa para el tenant de prueba');

  // La suite puede haber rotado la contraseña del Super Admin en el test
  // anterior (mustChangePassword); probamos ambas variantes.
  let loginRes = await request.post('/api/v1/auth/login', {
    data: { email: SUPER_ADMIN.email, password: SUPER_ADMIN.password, remember: false },
  });
  if (!loginRes.ok()) {
    loginRes = await request.post('/api/v1/auth/login', {
      data: { email: SUPER_ADMIN.email, password: 'NuevaClaveE2E2026!', remember: false },
    });
  }
  expect(loginRes.ok()).toBeTruthy();
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === 'csrf')?.value;

  const prevStatus = execSync(dbClient(`SELECT status FROM subscriptions WHERE id = ${subRaw};`))
    .toString()
    .trim();
  try {
    execSync(dbClient(`UPDATE subscriptions SET status = 'EXPIRED' WHERE id = ${subRaw};`));
    const res = await request.post('/api/v1/tenants/5/switch', {
      headers: { 'X-CSRF-Token': csrf ?? '' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('subscription_inactive');
  } finally {
    execSync(dbClient(`UPDATE subscriptions SET status = '${prevStatus}' WHERE id = ${subRaw};`));
  }
});

// ---------------------------------------------------------------------------
// Fase 6: Motor de cobranza automática + IA de mensajería
// ---------------------------------------------------------------------------

test('F6: Motor IA genera recordatorio desde una cuota atrasada y se marca como enviado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  execSync(
    dbClient(
      `SET @cid = (SELECT id FROM clients WHERE tenant_id = 5 AND deleted_at IS NULL ORDER BY id LIMIT 1);
       SET @iid = (SELECT ci.id FROM credit_installments ci
                    JOIN credits c ON c.id = ci.credit_id
                   WHERE c.client_id = @cid AND ci.status = 'PENDIENTE' AND ci.deleted_at IS NULL
                   ORDER BY ci.id LIMIT 1);
       UPDATE credit_installments SET status = 'ATRASADO', penalty_amount = 200, total_amount = amount + 200
        WHERE id = @iid;`
    )
  );

  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('button', { name: /Cobranza Inteligente IA/ }).click();
  await expect(page.getByText('Cobranza Inteligente (IA)', { exact: true })).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText(/En riesgo \(Atrasado\)/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ejecutar Motor de Cobranza' })).toBeVisible();

  await page.getByRole('button', { name: 'Ejecutar Motor de Cobranza' }).click();
  await expect(toast(page).getByText(/Motor de cobranza ejecutado/)).toBeVisible({ timeout: 30_000 });

  const sendBtn = page.getByRole('button', { name: 'Marcar Enviado' }).first();
  await expect(sendBtn).toBeVisible({ timeout: 30_000 });
  await sendBtn.click();
  await expect(toast(page).getByText(/Recordatorio enviado a/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Enviado', { exact: true }).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('F6: RBAC - OPERADOR ve el motor pero no puede ejecutarlo (403 forbidden)', async ({ request }) => {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { email: OPERADOR.email, password: OPERADOR.password, remember: false },
  });
  expect(loginRes.ok()).toBeTruthy();
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === 'csrf')?.value;

  const summaryRes = await request.get('/api/v1/collection/summary');
  expect(summaryRes.ok()).toBeTruthy();
  const summaryBody = await summaryRes.json();
  expect(typeof summaryBody.data.installments).toBe('object');

  const runRes = await request.post('/api/v1/collection/run', {
    headers: { 'X-CSRF-Token': csrf ?? '' },
    data: { source: 'MANUAL' },
  });
  expect(runRes.status()).toBe(403);
  const runBody = await runRes.json();
  expect(runBody.error).toBe('forbidden');
});

// ---------------------------------------------------------------------------
// Fase 7: 2FA TOTP, API keys y documentación OpenAPI
// ---------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32Decode(value: string): Buffer {
  const clean = value.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  let acc = 0n;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    acc = (acc << 5n) | BigInt(idx);
    bits += 5;
    while (bits >= 8) {
      bytes.push(Number((acc >> BigInt(bits - 8)) & 0xffn));
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpNow(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', b32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

test('F7: 2FA TOTP - setup, reto de login, código y desactivación', async ({ request }) => {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { email: OPERADOR.email, password: OPERADOR.password, remember: false },
  });
  expect(loginRes.ok()).toBeTruthy();

  const statusBefore = await request.get('/api/v1/auth/2fa/status');
  expect((await statusBefore.json()).data.enabled).toBe(false);

  const csrf = (await request.storageState()).cookies.find((c) => c.name === 'csrf')?.value ?? '';
  const setupRes = await request.post('/api/v1/auth/2fa/setup', { headers: { 'X-CSRF-Token': csrf } });
  expect(setupRes.ok()).toBeTruthy();
  const secret = (await setupRes.json()).data.secret;
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  const enableRes = await request.post('/api/v1/auth/2fa/enable', {
    headers: { 'X-CSRF-Token': csrf },
    data: { code: totpNow(secret) },
  });
  expect(enableRes.ok()).toBeTruthy();
  const enableBody = await enableRes.json();
  expect(enableBody.data.recoveryCodes).toHaveLength(10);

  await request.post('/api/v1/auth/logout', { headers: { 'X-CSRF-Token': csrf } });

  // El login ahora exige el segundo factor
  const challengeRes = await request.post('/api/v1/auth/login', {
    data: { email: OPERADOR.email, password: OPERADOR.password, remember: false },
  });
  expect(challengeRes.ok()).toBeTruthy();
  const challenge = await challengeRes.json();
  expect(challenge.twoFactorRequired).toBe(true);
  expect(challenge.ticket.length).toBeGreaterThanOrEqual(10);

  // Código incorrecto -> rechazado
  const badRes = await request.post('/api/v1/auth/login/totp', {
    data: { ticket: challenge.ticket, code: '000000', remember: false },
  });
  expect(badRes.status()).toBe(401);

  const totpRes = await request.post('/api/v1/auth/login/totp', {
    data: { ticket: challenge.ticket, code: totpNow(secret), remember: false },
  });
  expect(totpRes.ok()).toBeTruthy();
  expect((await totpRes.json()).user.email).toBe(OPERADOR.email);

  const statusAfter = await request.get('/api/v1/auth/2fa/status');
  expect((await statusAfter.json()).data.enabled).toBe(true);

  const csrfAfter = (await request.storageState()).cookies.find((c) => c.name === 'csrf')?.value ?? '';
  const disableRes = await request.post('/api/v1/auth/2fa/disable', {
    headers: { 'X-CSRF-Token': csrfAfter },
    data: { code: totpNow(secret) },
  });
  expect(disableRes.ok()).toBeTruthy();
  const statusFinal = await request.get('/api/v1/auth/2fa/status');
  expect((await statusFinal.json()).data.enabled).toBe(false);
});

test('F7: API keys - crear, probe por X-API-Key, inválida 401 y revocar', async ({ request }) => {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password, remember: false },
  });
  expect(loginRes.ok()).toBeTruthy();
  const csrf = (await request.storageState()).cookies.find((c) => c.name === 'csrf')?.value ?? '';

  const createRes = await request.post('/api/v1/api-keys', {
    headers: { 'X-CSRF-Token': csrf },
    data: { name: 'E2E F7', expiresInDays: 30 },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.data.key).toMatch(/^cpk_[0-9a-f]{24,64}$/);
  expect(created.data.printed).toContain('-');
  const keyId = created.data.id;

  const listRes = await request.get('/api/v1/api-keys');
  expect(listRes.ok()).toBeTruthy();
  const listBody = await listRes.json();
  expect(listBody.data.some((k: { id: number }) => k.id === keyId)).toBe(true);

  const probeRes = await request.get('/api/v1/api-keys/probe', {
    headers: { 'X-API-Key': created.data.printed },
  });
  expect(probeRes.ok()).toBeTruthy();
  const probe = await probeRes.json();
  expect(probe.data.authenticatedVia).toBe('api_key');
  expect(probe.data.keyName).toBe('E2E F7');
  expect(probe.data.permissions.length).toBeGreaterThan(0);

  const badRes = await request.get('/api/v1/api-keys/probe', {
    headers: { 'X-API-Key': 'cpk_TEST_INVALID_KEY_000000000000000000000000' },
  });
  expect(badRes.status()).toBe(401);

  const revokeRes = await request.delete(`/api/v1/api-keys/${keyId}`, {
    headers: { 'X-CSRF-Token': csrf },
  });
  expect(revokeRes.ok()).toBeTruthy();

  const afterRes = await request.get('/api/v1/api-keys/probe', {
    headers: { 'X-API-Key': created.data.printed },
  });
  expect(afterRes.status()).toBe(401);
});

test('F7: Documentación OpenAPI (spec JSON y docs HTML)', async ({ request }) => {
  const specRes = await request.get('/api/v1/openapi.json');
  expect(specRes.ok()).toBeTruthy();
  const spec = await specRes.json();
  expect(spec.openapi).toBe('3.1.0');
  expect(Object.keys(spec.paths)).toContain('/auth/login/totp');
  expect(Object.keys(spec.paths)).toContain('/api-keys');
  expect(Object.keys(spec.paths)).toContain('/api-keys/probe');

  const docsRes = await request.get('/api/v1/docs');
  expect(docsRes.ok()).toBeTruthy();
  const html = await docsRes.text();
  expect(html).toContain('openapi.json');
  expect(html).toContain('CrediPay');
});

test('F7: UI - modal Seguridad & API (2FA + API keys) y tema oscuro', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('button', { name: 'Seguridad & API' }).click();
  await expect(page.getByRole('heading', { name: 'Seguridad & API' })).toBeVisible();
  await expect(page.getByText(/Activa la verificación en dos pasos/)).toBeVisible();

  await page.getByRole('button', { name: 'API Keys', exact: true }).click();
  await page.getByPlaceholder(/Nombre \(ej:/).fill('E2E UI');
  await page.getByRole('button', { name: 'Crear llave' }).click();
  await expect(page.getByText(/¡Llave creada!/)).toBeVisible();
  await page.locator('button:has(svg.lucide-x)').first().click();
  await expect(page.getByRole('heading', { name: 'Seguridad & API' })).not.toBeVisible();

  const root = page.locator('html');
  await expect(root).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Modo oscuro' }).click();
  await expect(root).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Modo claro' }).click();
  await expect(root).not.toHaveClass(/dark/);

  expect(errors).toEqual([]);
});
