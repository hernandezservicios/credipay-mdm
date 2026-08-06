import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { ApiError } from '../../utils/http.js';
import {
  approveLoan,
  condoneCredit,
  condoneInstallment,
  createAgreement,
  createLoan,
  disburseLoan,
  listAgreements,
  outstandingBalance,
  quoteLoan,
  refinanceLoan,
  rejectLoan,
  renewLoan,
  restructureLoan,
  runOverdueEngine,
  setAgreementStatus,
} from '../../services/loanService.js';
import { AMORTIZATION_METHODS, type AmortizationMethod } from '../../services/loanEngine.js';
import { listLoans, getLoanDetail } from '../../modules/loans/loanRepository.js';
import { getLoanTimeline } from '../../modules/loans/loanEvents.js';
import {
  applyLoanPayment,
  simulateLoanPayment,
} from '../../modules/loans/paymentApplier.js';
import { normalizePaymentMethod } from '../../services/paymentService.js';

const router = Router();
router.use(authRequired, requireTenant, csrfProtect);

function parseMethod(value: unknown): AmortizationMethod {
  const m = String(value || '').toUpperCase();
  if (!AMORTIZATION_METHODS.includes(m as AmortizationMethod)) {
    throw ApiError.badRequest('invalid_method', 'Método de amortización inválido');
  }
  return m as AmortizationMethod;
}

// Simulación de cronograma (sin perseguir)
router.post('/quote', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const quote = quoteLoan({
    principal: Number(req.body.principal) || 0,
    annualRate: Number(req.body.annualRate) || 0,
    method: parseMethod(req.body.method || 'FRENCH'),
    installmentsCount: Number(req.body.installmentsCount) || 0,
    startDate: typeof req.body.startDate === 'string' ? req.body.startDate : undefined,
  });
  res.json({ data: quote });
});

router.post('/', requirePermission('loans.manage'), async (req: TenantRequest, res) => {
  const status = req.body.status === 'PENDING' ? ('PENDING' as const) : ('ACTIVE' as const);
  const input = {
    clientId: Number(req.body.clientId),
    principal: Number(req.body.principal),
    annualRate: Number(req.body.annualRate) || 0,
    method: parseMethod(req.body.method || 'FRENCH'),
    installmentsCount: Number(req.body.installmentsCount),
    startDate: typeof req.body.startDate === 'string' ? req.body.startDate : undefined,
    financingFee: Number(req.body.financingFee) || 0,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
    status,
    disburseNow: req.body.disburseNow !== false,
  };
  const created = await createLoan(req.ctx!.tenantId, req.auth!.userId, input);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_CREATED', entityType: 'loan', entityId: String(created.id), newValues: input },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CREDIT',
    `Préstamo ${created.creditNumber} creado (${input.installmentsCount} cuotas a ${input.annualRate}% anual)`,
    req as AuthRequest
  );
  res.status(201).json({ data: created });
});

router.post('/:id/approve', requirePermission('loans.approve'), async (req: TenantRequest, res) => {
  const result = await approveLoan(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id), req.body?.notes);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_APPROVED', entityType: 'loan', entityId: String(req.params.id) },
    req as AuthRequest
  );
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'CREDIT', `Préstamo ${result.creditNumber} aprobado`, req as AuthRequest);
  res.json({ data: result });
});

router.post('/:id/reject', requirePermission('loans.approve'), async (req: TenantRequest, res) => {
  await rejectLoan(req.ctx!.tenantId, Number(req.params.id), req.body?.reason);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_REJECTED', entityType: 'loan', entityId: String(req.params.id), newValues: { reason: req.body?.reason } },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), status: 'REJECTED' } });
});

router.post('/:id/disburse', requirePermission('loans.disburse'), async (req: TenantRequest, res) => {
  const result = await disburseLoan(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id));
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_DISBURSED', entityType: 'loan', entityId: String(req.params.id) },
    req as AuthRequest
  );
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'CREDIT', `Préstamo ${result.creditNumber} desembolsado`, req as AuthRequest);
  res.json({ data: result });
});

router.get('/:id/outstanding', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const balance = await outstandingBalance(req.ctx!.tenantId, Number(req.params.id));
  res.json({ data: balance });
});

router.post('/:id/restructure', requirePermission('loans.refinance'), async (req: TenantRequest, res) => {
  const result = await restructureLoan(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id), {
    rate: Number(req.body.annualRate) || 0,
    method: parseMethod(req.body.method || 'FRENCH'),
    terms: Number(req.body.installmentsCount),
    startDate: typeof req.body.startDate === 'string' ? req.body.startDate : undefined,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
  });
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_RESTRUCTURED', entityType: 'loan', entityId: String(req.params.id), newValues: req.body },
    req as AuthRequest
  );
  res.json({ data: result });
});

router.post('/:id/refinance', requirePermission('loans.refinance'), async (req: TenantRequest, res) => {
  const result = await refinanceLoan(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id), {
    rate: Number(req.body.annualRate) || 0,
    method: parseMethod(req.body.method || 'FRENCH'),
    terms: Number(req.body.installmentsCount),
    additionalAmount: Number(req.body.additionalAmount) || 0,
    startDate: typeof req.body.startDate === 'string' ? req.body.startDate : undefined,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
  });
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_REFINANCED', entityType: 'loan', entityId: String(req.params.id), newValues: req.body },
    req as AuthRequest
  );
  res.json({ data: result });
});

router.post('/:id/renew', requirePermission('loans.refinance'), async (req: TenantRequest, res) => {
  const result = await renewLoan(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id), {
    rate: Number(req.body.annualRate) || 0,
    method: parseMethod(req.body.method || 'FRENCH'),
    terms: Number(req.body.installmentsCount),
    startDate: typeof req.body.startDate === 'string' ? req.body.startDate : undefined,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
  });
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_RENEWED', entityType: 'loan', entityId: String(req.params.id), newValues: req.body },
    req as AuthRequest
  );
  res.json({ data: result });
});

router.post('/:id/condone', requirePermission('loans.condone'), async (req: TenantRequest, res) => {
  const input = { type: req.body.type, amount: Number(req.body.amount) || 0 };
  const affected = await condoneCredit(req.ctx!.tenantId, req.auth!.userId, Number(req.params.id), input);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_CONDONED', entityType: 'loan', entityId: String(req.params.id), newValues: { ...input, affected } },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), affected } });
});

router.post('/installments/:installmentId/condone', requirePermission('loans.condone'), async (req: TenantRequest, res) => {
  await condoneInstallment(req.ctx!.tenantId, req.auth!.userId, Number(req.params.installmentId), {
    type: req.body.type,
    amount: Number(req.body.amount) || 0,
  });
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'INSTALLMENT_CONDONED', entityType: 'installment', entityId: String(req.params.installmentId), newValues: req.body },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.installmentId) } });
});

// Motor de mora: ejecución manual por tenant
router.post('/run-overdue', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const result = await runOverdueEngine(req.ctx!.tenantId);
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'CREDIT', `Motor de mora ejecutado: ${result.penalized} cuota(s) penalizada(s)`, req as AuthRequest);
  res.json({ data: result });
});

// Acuerdos de pago
router.get('/agreements', requirePermission('loans.agreements'), async (req: TenantRequest, res) => {
  const data = await listAgreements(req.ctx!.tenantId, {
    creditId: req.query.creditId ? Number(req.query.creditId) : undefined,
    clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  res.json({ data });
});

router.post('/agreements', requirePermission('loans.agreements'), async (req: TenantRequest, res) => {
  const agreement = await createAgreement(req.ctx!.tenantId, req.auth!.userId, {
    creditId: Number(req.body.creditId),
    clientId: Number(req.body.clientId),
    agreedDate: typeof req.body.agreedDate === 'string' ? req.body.agreedDate : undefined,
    totalAmount: req.body.totalAmount != null ? Number(req.body.totalAmount) : undefined,
    initialPayment: Number(req.body.initialPayment) || 0,
    terms: Number(req.body.terms),
    frequency: req.body.frequency || 'WEEKLY',
    firstDueDate: typeof req.body.firstDueDate === 'string' ? req.body.firstDueDate : undefined,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
  });
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'AGREEMENT_CREATED', entityType: 'agreement', entityId: String(agreement.id), newValues: req.body },
    req as AuthRequest
  );
  res.status(201).json({ data: agreement });
});

router.post('/agreements/:id/status', requirePermission('loans.agreements'), async (req: TenantRequest, res) => {
  await setAgreementStatus(req.ctx!.tenantId, Number(req.params.id), req.body.status);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'AGREEMENT_STATUS', entityType: 'agreement', entityId: String(req.params.id), newValues: { status: req.body.status } },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), status: req.body.status } });
});

// ---------------------------------------------------------------------------
// Fase E: listado/consulta unificada (D24) + cobro por préstamo (D20/D22, R13)
// ---------------------------------------------------------------------------

router.get('/', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const result = await listLoans(req.ctx!.tenantId, {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: Number(req.query.page) || 1,
    perPage: Number(req.query.perPage) || 20,
  });
  res.json(result);
});

router.get('/:id', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const detail = await getLoanDetail(req.ctx!.tenantId, Number(req.params.id));
  res.json({ data: detail });
});

router.get('/:id/timeline', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const timeline = await getLoanTimeline(req.ctx!.tenantId, Number(req.params.id));
  res.json({ data: timeline });
});

router.post('/:id/pay/simulate', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const simulation = await simulateLoanPayment(
    req.ctx!.tenantId,
    Number(req.params.id),
    Number(req.body?.amount) || 0
  );
  res.json({ data: simulation });
});

router.post('/:id/pay', requirePermission('payments.create'), async (req: TenantRequest, res) => {
  const body = req.body as {
    amount?: number;
    method?: string;
    bank?: string;
    received?: number;
    change?: number;
    idempotencyKey?: string;
    notes?: string;
  };
  const result = await applyLoanPayment(req, {
    creditId: Number(req.params.id),
    amount: Number(body.amount) || 0,
    method: normalizePaymentMethod(body.method ?? 'EFECTIVO'),
    bank: typeof body.bank === 'string' ? body.bank : undefined,
    received: Number(body.received) || 0,
    change: Number(body.change) || 0,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  res.status(result.duplicate ? 200 : 201).json({ data: result });
});

export default router;