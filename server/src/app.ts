import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { pingDatabase } from './db/pool.js';
import authRoutes from './routes/v1/auth.routes.js';
import auditRoutes from './routes/v1/audit.routes.js';
import clientsRoutes from './routes/v1/clients.routes.js';
import creditsRoutes from './routes/v1/credits.routes.js';
import installmentsRoutes from './routes/v1/installments.routes.js';
import paymentsRoutes from './routes/v1/payments.routes.js';
import devicesRoutes from './routes/v1/devices.routes.js';
import mdmRoutes from './routes/v1/mdm.routes.js';
import tenantsRoutes from './routes/v1/tenants.routes.js';
import usersRoutes from './routes/v1/users.routes.js';
import logsRoutes from './routes/v1/logs.routes.js';
import saasRoutes from './routes/v1/saas.routes.js';
import collectionRoutes from './routes/v1/collection.routes.js';
import apiKeysRoutes, { probeRouter } from './routes/v1/apiKeys.routes.js';
import webhooksRoutes from './routes/v1/webhooks.routes.js';
import backupsRoutes from './routes/v1/backups.routes.js';
import configRoutes from './routes/v1/config.routes.js';
import loanRoutes from './routes/v1/loans.routes.js';
import cashRoutes from './routes/v1/cash.routes.js';
import reportsRoutes from './routes/v1/reports.routes.js';
import dashboardRoutes from './routes/v1/dashboard.routes.js';
import { docsHtml, openApiSpec } from './docs/openapi.js';
import { ApiError } from './utils/http.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.GLOBAL_API_RATE_LIMIT) || 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Demasiadas solicitudes. Intente más tarde.',
    });
  },
});
app.use('/api/', globalLimiter);

app.get('/api/v1/health', async (_req: Request, res: Response) => {
  const db = await pingDatabase();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    db: db ? 'ok' : 'error',
    version: 'v1',
    time: new Date().toISOString(),
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/clients', clientsRoutes);
app.use('/api/v1/credits', creditsRoutes);
app.use('/api/v1/installments', installmentsRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/devices', devicesRoutes);
app.use('/api/v1/mdm', mdmRoutes);
app.use('/api/v1/tenants', tenantsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/logs', logsRoutes);
app.use('/api/v1/saas', saasRoutes);
app.use('/api/v1/collection', collectionRoutes);
app.use(probeRouter);
app.use('/api/v1/api-keys', apiKeysRoutes);
app.use('/api/v1/webhooks', webhooksRoutes);
app.use('/api/v1/backups', backupsRoutes);
app.use('/api/v1/config', configRoutes);
app.use('/api/v1/loans', loanRoutes);
app.use('/api/v1/cash', cashRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

app.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

app.get('/api/v1/docs', (_req: Request, res: Response) => {
  res.type('html').send(docsHtml);
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: 'Ruta no encontrada' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
});
