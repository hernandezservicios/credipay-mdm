import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  namedPlaceholders: true,
});

export async function pingDatabase(): Promise<boolean> {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}
