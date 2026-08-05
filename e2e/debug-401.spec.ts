import { test, expect } from '@playwright/test';
import fs from 'fs';

const urls: string[] = [];

test('debug 401 urls', async ({ page }) => {
  page.on('response', (r) => {
    if (r.status() === 401) urls.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  await page.goto('/');
  await page.locator('input[type="email"]').fill('admin@alpha.com');
  await page.locator('input[type="password"]').fill('12345678');
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.waitForTimeout(8000);
  fs.writeFileSync(require('path').join(__dirname, 'test-results', '401-urls.txt'), urls.join('\n'));
});