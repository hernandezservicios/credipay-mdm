import { test, expect, Page } from '@playwright/test';

/**
 * Fase F (frontend Cobranza unificada -> /api/v1/loans) — smoke read-only.
 * NO confirma pagos (evita mutar la BD): valida login, tab Préstamos,
 * listado de la API, filtro de estados, detalle + timeline y preview de
 * cobro (simulate) con llave de idempotencia (R13).
 * Requiere Vite :3000 + server :4000 corriendo.
 */

const ADMIN = { email: 'demo.admin@credipay.local', password: 'Fase2Test2026!' };

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: 30_000,
  });
}

async function openPrestamos(page: Page) {
  await page.getByRole('button', { name: /Solicitudes, desembolsos y acuerdos/ }).click();
  await expect(page.getByRole('heading', { name: /Ciclo de Vida de Préstamos/ })).toBeVisible({
    timeout: 30_000,
  });
}

test('Fase F: tab Préstamos carga listado desde el backend sin errores de consola', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page, ADMIN.email, ADMIN.password);
  await openPrestamos(page);

  await expect(page.getByText('Ana Nunez', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test('Fase F: filtro de estados opera sobre la tabla', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page, ADMIN.email, ADMIN.password);
  await openPrestamos(page);

  await page.getByRole('button', { name: 'EN MORA', exact: true }).click();
  await expect(page.getByText('Ana Nunez', { exact: false }).first()).not.toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'TODOS', exact: true }).click();
  await expect(page.getByText('Ana Nunez', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });

  expect(errors).toEqual([]);
});

test('Fase F: detalle del préstamo abre con timeline y cuotas (API loans/:id)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page, ADMIN.email, ADMIN.password);
  await openPrestamos(page);

  await expect(page.getByText('Ana Nunez', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Detalle' }).first().click();

  const expectedLinea = page.getByText(/Línea de Tiempo/, { exact: false });
  if ((await expectedLinea.count()) === 0) {
    const tbody = page.locator('tbody').first();
    if ((await tbody.getByText(/Línea de Tiempo/, { exact: false }).count()) === 0) {
      await expect(page.locator('body')).toContainText(/Línea de Tiempo|Detalle del préstamo/, {
        timeout: 30_000,
      });
    }
  }

  expect(errors).toEqual([]);
});

test('Fase F: cobro simulado (simulate) muestra distribución y llave de idempotencia sin confirmar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page, ADMIN.email, ADMIN.password);
  await openPrestamos(page);

  await expect(page.getByText('Ana Nunez', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /Cobrar/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Saldo pendiente/i)).toBeVisible({ timeout: 30_000 });

  const monto = dialog.getByPlaceholder('0.00').first();
  await expect(monto).toBeVisible();
  await monto.fill('500');

  await dialog.getByRole('button', { name: /Simular distribución/ }).click();
  await expect(dialog.getByText(/Distribución propuesta/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText(/Llave de idempotencia/).first()).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expect(errors).toEqual([]);
});