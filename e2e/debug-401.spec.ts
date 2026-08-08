import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// FASE 9 (auditoría): reemplaza el viejo artefacto 'debug 401'. Ahora valida que
// el flujo login -> Dashboard NO genere respuestas 401 inesperadas y escribe el
// listado (vacío en verde) en test-results/401-urls.txt para la evidencia.

const ADMIN = { email: 'demo.admin@credipay.local', password: 'Fase2Test2026!' };

test('Smoke: sin 401 no autenticados durante login y carga del Dashboard', async ({ page }) => {
  const urls: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 401 && !r.url().includes('/api/v1/auth/')) {
      urls.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  await page.goto('/');
  await page.locator('input[type="email"]').fill(ADMIN.email);
  await page.locator('input[type="password"]').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(4000);

  const outDir = 'test-results';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '401-urls.txt'), urls.join('\n'));
  expect(urls, 'respuestas 401 inesperadas detectadas (ver test-results/401-urls.txt)').toEqual([]);
});