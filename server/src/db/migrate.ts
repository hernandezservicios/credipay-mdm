import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';
import { runMigrations } from './runMigrations.js';

interface IdRow extends RowDataPacket {
  id: number;
}

interface SeedUser {
  email: string;
  name: string;
  roleSlug: string;
  tenantSlug: string | null;
  description: string;
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'admin@credipay.local',
    name: 'Super Administrador',
    roleSlug: 'SUPER_ADMIN',
    tenantSlug: null,
    description: 'Acceso global a todos los tenants',
  },
  {
    email: 'demo.admin@credipay.local',
    name: 'Administrador Demo',
    roleSlug: 'ADMIN',
    tenantSlug: 'credipay-demo',
    description: 'Tenant demo - rol ADMIN',
  },
  {
    email: 'demo.gestor@credipay.local',
    name: 'Gestor Demo',
    roleSlug: 'GESTOR',
    tenantSlug: 'credipay-demo',
    description: 'Tenant demo - rol GESTOR',
  },
  {
    email: 'demo.operador@credipay.local',
    name: 'Operador Demo',
    roleSlug: 'OPERADOR',
    tenantSlug: 'credipay-demo',
    description: 'Tenant demo - rol OPERADOR',
  },
  {
    email: 'demo.consulta@credipay.local',
    name: 'Consulta Demo',
    roleSlug: 'CONSULTA',
    tenantSlug: 'credipay-demo',
    description: 'Tenant demo - rol CONSULTA',
  },
];

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function ensureSeedUsers(): Promise<void> {
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);

  console.log('\n=== Usuarios semilla ===');
  for (const u of SEED_USERS) {
    const [tenantRows] = await pool.query<IdRow[]>(
      'SELECT id FROM tenants WHERE slug = ?',
      [u.tenantSlug]
    );
    const tenantId = u.tenantSlug ? tenantRows[0]?.id ?? null : null;

    const [roleRows] = await pool.query<IdRow[]>(
      'SELECT id FROM roles WHERE slug = ? AND tenant_id IS NULL',
      [u.roleSlug]
    );
    const roleId = roleRows[0]?.id;
    if (!roleId) throw new Error(`Rol ${u.roleSlug} no encontrado`);

    const [existing] = await pool.query<IdRow[]>(
      'SELECT id FROM users WHERE email = ?',
      [u.email]
    );
    if (existing.length > 0) {
      console.log(`  [ya existe] ${u.email}`);
      continue;
    }

    const [result] = await pool.query(
      `INSERT INTO users
        (tenant_id, name, email, email_verified_at, password_hash, status, must_change_password)
       VALUES (?, ?, ?, NOW(), ?, 'ACTIVE', 1)`,
      [tenantId, u.name, u.email, hash]
    );
    const userId = (result as { insertId: number }).insertId;

    await pool.query('INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [
      userId,
      roleId,
      tenantId,
    ]);
    console.log(`  [creado] ${u.email} (${u.description})`);
  }

  console.log('\n=== CREDENCIALES INICIALES ===');
  console.log('Todos los usuarios comparten esta contraseÃ±a temporal:');
  console.log(`  ContraseÃ±a: ${password}`);
  console.log('Deben cambiarla en el primer inicio de sesiÃ³n (must_change_password).');
  console.log('============================================\n');
}

async function main() {
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`Migraciones aplicadas (${applied.length}): ${applied.join(', ')}`);
  } else {
    console.log('Sin migraciones pendientes: la base de datos ya estÃ¡ al dÃ­a.');
  }
  await ensureSeedUsers();
  await pool.end();
}

main().catch((err) => {
  console.error('Error ejecutando migraciones:', err);
  process.exit(1);
});

