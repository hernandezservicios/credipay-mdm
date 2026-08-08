/**
 * Auditoría de secretos — FASE 9
 * Inspecciona automáticamente el repositorio buscando credenciales reales.
 * Solo se permiten TEST_* / DEMO-* / placeholders <...>.
 * Resultado esperado: 0 secretos reales (exit 0).
 *
 * Uso: node scripts/audit-secrets.mjs   (desde la raíz del repo)
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve('.');
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'coverage', 'test-results', 'backups',
  '.opencode', 'assets', 'screenshots',
]);
const SKIP_FILES = new Set(['package-lock.json', 'audit-secrets.mjs', 'audit-secrets.ps1']);
const MAX_BYTES = 2 * 1024 * 1024;
// Rutas relativas cuyo contenido NO debe auditarse (secretos reales de entorno dev):
// server/backups (dumps con credenciales reales, ignorados por .git) y .env locales.
const SKIP_RELATIVE_FRAGMENTS = ['server\\backups'];
const isLocalEnvFile = (full) => full.endsWith('.env') && !full.endsWith('.env.example');

// Subcadenas que indican que el valor es un placeholder/ficticio (seguro).
const ALLOWED_SUBSTRINGS = [
  'TEST_', 'DEMO-', 'DEMO_', 'cpk_TEST', 'cpk_test', '<DB_PASSWORD>',
  '<bearer', '<token>', 'TYP-', 'test-', 'Test ', 'TEST ', 'example',
  'password_hash', 'current_password', 'new_password', 'password_resets',
  'reset-password', 'forgot-password', 'change-password', '12345678',
  'legacy-plain-token', 'ENROLL-TEST', 'secret_placeholder',
  // Passwords demo de cuentas ficticias @credipay.local (aprobadas en FASE 8):
  '7xs8G8GJrTze9S', 'Fase2Test2026!', 'NuevaClave2026!', '12345678',
  // Alphabet base32 estándar de TOTP (constante, no serial):
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  // IMEI de prueba obvio (todo 6s):
  '666666666666666', '999999999999999',
  // Valores de test de fábrica en tests unitarios:
  'secret-1', 'nuevo-secret', 'token-1', 'app-client-1',
  // Interpolación dinámica (no es un secreto literal):
  'formState.secret', '${formState',
  // IDs públicos de fotos Unsplash (no son IMEI) — valores numéricos:
  // photo-1534528741775, photo-1544005313, photo-1507003211169, photo-1573496359142
  '1534528741775', '1507003211169', '1573496359142', '1544005313',
];

// Reglas: [nombre, regex como string (flags gi en mayúsculas), lista adicional de allows]
const RULES = [
  ['API-Key (cpk_/sk_ reales)', String.raw`\b(cpk|sk|pk_live|rk_live)[A-Za-z0-9_\-]{15,}\b`, ['cpk_ffff', 'cpk_xxx']],
  ['X-API-Key header', String.raw`X-API-Key["']?\s*[:=]\s*["'][A-Za-z0-9_\-\./+]{12,}["']`, ['TEST_', '<']],
  ['appClient UUID', String.raw`appClient["'\s:=]+\s*["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']`, ['TEST_']],
  ['UUID suelto en contexto', String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`, ['00000000-0000-0000-0000-000000000000']],
  ['Secret/password literal', String.raw`\b(?:secret|password|passwd|pwd)\s*["']?\s*[:=]\s*["'][^'"\s]{8,}["']`, ['hash', 'bcrypt', '.....', '…']],
  ['Bearer token', String.raw`\bBearer\s+[A-Za-z0-9\-_\.]{10,}`, ['Bearer <', 'Bearer TEST']],
  ['JWT', String.raw`\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\b`, []],
  ['Prefijo token 9164|', String.raw`\b916{2}\|[A-Za-z0-9]{8,}\b`, ['9164|<token>', '9160|']],
  ['IMEI (13-16 dígitos)', String.raw`\b\d{13,16}\b`, ['20260607000000', '20260807000000']],
  ['Serial largo', String.raw`\b[A-Z]{3,}[0-9]{4,}[A-Z0-9]{2,}\b`, ['DEMO-SERIAL', 'DEMO_SERIAL']],
  ['mysqldump -p con pass', String.raw`--password="?[^"\s]{6,}"?`, ['<DB_PASSWORD>']],
  ['JWT en header', String.raw`Authorization["']?\s*[:=]\s*["'](?:Bearer\s+)?[A-Za-z0-9\-_\.]{20,}["']`, ['TEST', '<', 'Authorization: Bearer']],
];

function isAllowed(value, extraAllows) {
  const v = value.replace(/['"`]/g, '');
  if (/^<[^>]+>$/.test(v.trim())) return true;
  for (const s of ALLOWED_SUBSTRINGS) {
    if (v.includes(s)) return true;
  }
  for (const s of extraAllows) {
    if (v.includes(s)) return true;
  }
  return false;
}

let hits = 0;
const results = [];

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full);
      continue;
    }
    if (SKIP_FILES.has(entry)) continue;
    if (stat.size > MAX_BYTES || stat.size === 0) continue;
    if (!/\.(?:ts|tsx|js|mjs|jsx|sql|json|md|env|env\.example|yml|yaml|txt)$/i.test(entry)) continue;
    const rel = full.replace(ROOT + '\\', '');
    if (isLocalEnvFile(full)) continue;
    if (SKIP_RELATIVE_FRAGMENTS.some((f) => rel.includes(f))) continue;
    let content;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    for (const [name, pattern, extra] of RULES) {
      const re = new RegExp(pattern, 'g');
      let m;
      while ((m = re.exec(content)) !== null) {
        const val = m[0];
        if (isAllowed(val, extra)) continue;
        hits++;
        const out = val.replace(/\s+/g, ' ').trim();
        results.push(`[${name}] ${full}  >>  ${out.length > 90 ? out.slice(0, 90) + '…' : out}`);
      }
    }
  }
}

const start = Date.now();
console.log(`Auditoría de secretos — FASE 9\nEscaneando ${ROOT}\n`);
walk(ROOT);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

if (hits === 0) {
  console.log(`OK — 0 secretos reales (${elapsed}s). Solo TEST_*/DEMO-*/placeholders presentes.`);
  process.exit(0);
}
console.error(`\n⚠  ${hits} posibles secretos reales (${elapsed}s):`);
for (const r of results) console.error(r);
process.exit(1);