import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export async function runMigrations(): Promise<string[]> {
  const migrationsDir = path.resolve(env.MIGRATIONS_DIR);
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Directorio de migraciones no encontrado: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length === 0) {
    throw new Error(`No hay archivos .sql en ${migrationsDir}`);
  }

  // Conexión dedicada con múltiples statements por archivo
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  const applied: string[] = [];
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        nombre VARCHAR(200) NOT NULL,
        aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_migraciones_nombre (nombre)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    );

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT nombre FROM migraciones_aplicadas'
    );
    const done = new Set(rows.map((r) => r.nombre));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      process.stdout.write(`Aplicando ${file} ... `);
      await conn.query(sql);
      await conn.query('INSERT INTO migraciones_aplicadas (nombre) VALUES (?)', [file]);
      applied.push(file);
      process.stdout.write('OK\n');
    }
  } finally {
    await conn.end();
  }

  return applied;
}
