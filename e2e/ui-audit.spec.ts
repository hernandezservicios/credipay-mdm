import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Auditoría UI/UX (Fase 10):
 * Matriz viewport (375/768/1440) x claro/oscuro x chromium/firefox/webkit.
 * Comprueba: sin desborde horizontal de documento, inputs/selects >=16px en
 * móvil (anti auto-zoom iOS/Android), vistas principales renderizan, sin
 * pageerrors/console errors, y capturas en e2e/screenshots/.
 *
 * REQUIERE: Vite en :3000 (proxy /api -> :4000) y API+DB vivos.
 */

const ADMIN = { email: 'admin@alpha.com', password: '12345678' };

const VIEWS: Array<{ nav: string; marker: string | RegExp; kind: 'h2' | 'text'; file: string }> = [
  { nav: 'Dashboard', marker: /Dashboard/, kind: 'h2', file: 'dashboard' },
  { nav: 'Préstamos', marker: /Ciclo de Vida de Préstamos/, kind: 'h2', file: 'loans' },
  { nav: 'Caja & Flujo', marker: /^Caja$/, kind: 'text', file: 'cash' },
  { nav: 'Reportes', marker: /Reportes/, kind: 'h2', file: 'reports' },
];

async function isMobile(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 1024;
}

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(ADMIN.email);
  await page.locator('input[type="password"]').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar a la Consola' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function forceTheme(page: Page, dark: boolean): Promise<void> {
  const root = page.locator('html');
  const cls = ((await root.getAttribute('class')) ?? '').split(' ');
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  if (dark && !cls.includes('dark')) {
    await page.locator('button[title="Modo oscuro"]').click();
    await expect(root).toHaveClass(/dark/);
  } else if (!dark && cls.includes('dark')) {
    await page.locator('button[title="Modo claro"]').click();
    await expect(root).not.toHaveClass(/dark/);
  }
}

async function openView(page: Page, nav: string): Promise<void> {
  const mobile = await isMobile(page);
  if (mobile) {
    await page.locator('button[title="Abrir menú de vistas (Sidebar)"]').first().click();
  }
  await page.locator('aside button').filter({ hasText: nav }).first().click();
}

test('Matriz viewport x tema x vista: sin overflow, sin errores JS, capturas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  const project = test.info().project.name;
  const width = page.viewportSize()?.width ?? 0;

  await login(page);

  for (const dark of [false, true]) {
    await forceTheme(page, dark);
    const themeName = dark ? 'dark' : 'light';
    const shotDir = path.join('e2e', 'screenshots', project, themeName);
    fs.mkdirSync(shotDir, { recursive: true });

    for (const view of VIEWS) {
      await openView(page, view.nav);
      if (view.kind === 'h2') {
        await expect(page.locator('h2', { hasText: view.marker }).first()).toBeVisible({
          timeout: 30_000,
        });
      } else {
        await expect(page.getByText(view.marker as RegExp, { exact: true }).first()).toBeVisible({
          timeout: 30_000,
        });
      }

      const { scrollW, innerW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      expect(
        scrollW,
        `[${project}/${themeName}/${view.nav}] overflow: scrollWidth=${scrollW} > innerWidth=${innerW}`
      ).toBeLessThanOrEqual(innerW + 1);

      if (width < 768) {
        const sizes = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea')).map(
            (el) => `${el.tagName}:${getComputedStyle(el).fontSize}`
          )
        );
        for (const s of sizes) {
          const px = parseInt(s.split(':')[1], 10);
          expect(px, `[${project}/${themeName}/${view}] fuente ${s}`).toBeGreaterThanOrEqual(16);
        }
      }

      await page.screenshot({ path: path.join(shotDir, `${view.file}.png`), fullPage: true });
    }
  }

  expect(errors, 'pageerrors/console errors detectados').toEqual([]);
});