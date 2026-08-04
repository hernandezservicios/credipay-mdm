import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().default(''),
  DB_NAME: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MIGRATIONS_DIR: z.string().default('./migraciones'),
  SCHEDULER_ENABLED: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  MYSQLDUMP_PATH: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('CrediPay MDM <no-reply@credipay.local>'),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración de entorno inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
