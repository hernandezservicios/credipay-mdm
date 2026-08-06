import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  HandCoins,
  Plus,
  FileText,
  CheckCircle2,
  XCircle,
  Banknote,
  RefreshCw,
  Loader2,
  Cpu,
  Network,
  FileSignature,
  Handshake,
  Eye,
} from 'lucide-react';
import {
  errorMessage,
  apiListClients,
  apiGetClient,
  apiListLoanProducts,
  apiLoanQuote,
  apiCreateLoan,
  apiApproveLoan,
  apiRejectLoan,
  apiDisburseLoan,
  apiLoanOutstanding,
  apiRestructureLoan,
  apiRefinanceLoan,
  apiRenewLoan,
  apiCondoneCredit,
  apiCondoneInstallment,
  apiRunOverdue,
  apiListAgreements,
  apiCreateAgreement,
  apiSetAgreementStatus,
} from '../services/api';
import type {
  ClientFullRow,
  ClientListRow,
  CreditRow,
  InstallmentRow,
  LoanProductRow,
  AgreementRow,
  LoanQuote,
} from '../services/api';
import { ModalShell } from './ui/ModalShell';
import { useConfirm } from './ConfirmDialog';
import { CobranzaModal } from './CobranzaModal';
import { LoanDetailModal } from './LoanDetailModal';
import { formatCurrencyRD, formatDate } from '../utils/formatters';

export interface LoansViewProps {
  onNotify?: (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;
  onGoToClient?: (clientId: number) => void;
  permits?: {
    create?: boolean;
    approve?: boolean;
    disburse?: boolean;
    refinance?: boolean;
    condone?: boolean;
    agreements?: boolean;
  };
  /** Incrementa cada vez que una acción externa pide abrir el wizard de préstamo. */
  openWizardToken?: number;
}

type CreditEx = CreditRow & Record<string, string | number | Date | null>;

interface LoanRecord {
  client: ClientFullRow;
  credit: CreditEx;
  installments: InstallmentRow[];
  nextInstallment?: InstallmentRow;
  daysLate: number;
}

type FinKind = 'restructure' | 'refinance' | 'renew';

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const money = (v: unknown): string => formatCurrencyRD(num(v));

const datePart = (v: unknown): string => (v ? str(v).slice(0, 10) : '');

const fmtDate = (v: unknown): string => {
  const iso = datePart(v);
  return iso ? formatDate(iso) : '—';
};

const todayStr = (): string => new Date().toISOString().slice(0, 10);

const METHODS = ['FRENCH', 'CUOTA_NIVELADA', 'FLAT', 'SIMPLE', 'SALDO_INSOLUTO', 'COMPOUND'];

const STATUS_STYLE: Record<string, [string, string]> = {
  PENDING: ['bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300', 'Pendiente'],
  APPROVED: ['bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', 'Aprobado'],
  ACTIVE: ['bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300', 'Activo'],
  PAID_OFF: ['bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', 'Pagado'],
  DEFAULTED: ['bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300', 'En Mora'],
  REJECTED: ['bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300', 'Rechazado'],
  CANCELED: ['bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300', 'Cancelado'],
  REFINANCED: ['bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300', 'Refinanciado'],
  RESTRUCTURED: ['bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300', 'Reestructurado'],
};

const AGMT_STYLE: Record<string, [string, string]> = {
  ACTIVE: ['bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300', 'Activo'],
  COMPLETED: ['bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', 'Completado'],
  FAILED: ['bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300', 'Fallido'],
  PENDING: ['bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300', 'Pendiente'],
};

const INST_STYLE: Record<string, string> = {
  PENDIENTE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  VENCIDO: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  ATRASADO: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  PAGADO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  CANCELADO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const inputCls =
  'input-field';
const labelCls = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1';
const btnPrimary =
  'px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary =
  'px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger =
  'px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 disabled:cursor-not-allowed';
const chipActive = 'px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 text-white';
const chipIdle =
  'px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700';
const thCls = 'py-2.5 px-3 whitespace-nowrap';
const tdCls = 'py-2.5 px-3 align-top';

const TABS = [
  { key: 'ALL', label: 'TODOS' },
  { key: 'PENDING', label: 'SOLICITUDES' },
  { key: 'APPROVED', label: 'APROBADOS' },
  { key: 'ACTIVE', label: 'ACTIVOS' },
  { key: 'PAID_OFF', label: 'PAGADOS' },
  { key: 'DEFAULTED', label: 'EN MORA' },
  { key: 'HISTORIC', label: 'HISTÓRICO' },
  { key: 'AGREEMENTS', label: 'ACUERDOS' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const badge = (cls: string, label: string) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
    {label}
  </span>
);

const QuoteSummary: React.FC<{ quote: LoanQuote }> = ({ quote }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">Cuota Mensual</p>
        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
          {money(quote.monthlyPayment)}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">Interés Total</p>
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {money(quote.totalInterest)}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">Total a Pagar</p>
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{money(quote.totalPayment)}</p>
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 max-h-48 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
          <tr>
            <th className="py-2 px-3">#</th>
            <th className="py-2 px-3">Vencimiento</th>
            <th className="py-2 px-3">Monto</th>
            <th className="py-2 px-3">Principal</th>
            <th className="py-2 px-3">Interés</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {quote.schedule.map((s) => (
            <tr key={s.number}>
              <td className="py-2 px-3">{s.number}</td>
              <td className="py-2 px-3">{fmtDate(s.dueDate)}</td>
              <td className="py-2 px-3">{money(s.amount)}</td>
              <td className="py-2 px-3">{money(s.principalPart)}</td>
              <td className="py-2 px-3">{money(s.interestPart)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const LoansView: React.FC<LoansViewProps> = ({ onNotify, onGoToClient, permits, openWizardToken }) => {
  const confirmDialog = useConfirm();
  const p = {
    create: true,
    approve: true,
    disburse: true,
    refinance: true,
    condone: true,
    agreements: true,
    ...permits,
  };

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LoanRecord[]>([]);
  const [allClients, setAllClients] = useState<ClientListRow[]>([]);
  const [products, setProducts] = useState<LoanProductRow[]>([]);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('ALL');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [wizOpen, setWizOpen] = useState(false);
  const [wizClientQuery, setWizClientQuery] = useState('');
  const [wizClientId, setWizClientId] = useState<number | null>(null);
  const [wizProductId, setWizProductId] = useState<number | ''>('');
  const [wizForm, setWizForm] = useState({
    principal: '',
    annualRate: '',
    method: 'FRENCH',
    installmentsCount: '',
    startDate: todayStr(),
    financingFee: '',
    notes: '',
  });
  const [wizQuote, setWizQuote] = useState<LoanQuote | null>(null);
  const [wizQuoteLoading, setWizQuoteLoading] = useState(false);
  const [wizBusy, setWizBusy] = useState(false);

  const [fin, setFin] = useState<{ credit: CreditEx; kind: FinKind; outstanding: number } | null>(null);
  const [finForm, setFinForm] = useState({
    method: 'FRENCH',
    annualRate: '',
    installmentsCount: '',
    startDate: todayStr(),
    additionalAmount: '',
  });
  const [finQuote, setFinQuote] = useState<LoanQuote | null>(null);
  const [finQuoteLoading, setFinQuoteLoading] = useState(false);

  const [cnd, setCnd] = useState<CreditEx | null>(null);
  const [cndForm, setCndForm] = useState<{ type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount: string }>({
    type: 'PENALTY',
    amount: '',
  });

  const [agr, setAgr] = useState<LoanRecord | null>(null);
  const [agrForm, setAgrForm] = useState({
    agreedDate: todayStr(),
    terms: '',
    frequency: 'WEEKLY',
    initialPayment: '',
    totalAmount: '',
    firstDueDate: '',
    notes: '',
  });

  const [instCnd, setInstCnd] = useState<InstallmentRow | null>(null);
  const [instCndForm, setInstCndForm] = useState<{ type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount: string }>({
    type: 'PENALTY',
    amount: '',
  });

  const [overdueRunning, setOverdueRunning] = useState(false);
  const [agrBusy, setAgrBusy] = useState<number | null>(null);
  const [cobranzaLoan, setCobranzaLoan] = useState<{
    id: number;
    creditNumber: string;
    clientName: string;
    outstanding: number;
  } | null>(null);
  const [detailLoanId, setDetailLoanId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const productsRes = await apiListLoanProducts();
      setProducts(productsRes.data);
      const clientsRes = await apiListClients({ perPage: 200 });
      setAllClients(clientsRes.data);
      const agreementsRes = await apiListAgreements().catch(() => ({ data: [] as AgreementRow[] }));
      setAgreements(agreementsRes.data);

      const full = await Promise.all(
        clientsRes.data.map((c) => apiGetClient(c.id).catch(() => null))
      );
      const recs: LoanRecord[] = [];
      for (const f of full) {
        if (!f) continue;
        const client = f.data;
        for (const credit of client.credits) {
          const installments = client.installments.filter(
            (i) => num(i.credit_id) === num(credit.id)
          );
          const pending = installments
            .filter((i) => i.status !== 'PAGADO' && i.status !== 'CANCELADO')
            .sort(
              (a, b) =>
                datePart(a.due_date).localeCompare(datePart(b.due_date)) ||
                num(a.installment_number) - num(b.installment_number)
            );
          const next = pending[0];
          let daysLate = num((credit as CreditEx).days_late);
          if (!daysLate && next && next.due_date) {
            const dueMs = new Date(datePart(next.due_date)).getTime();
            const diff = Math.floor((Date.now() - dueMs) / 86400000);
            daysLate = diff > 0 ? diff : 0;
          }
          recs.push({
            client,
            credit: credit as CreditEx,
            installments,
            nextInstallment: next,
            daysLate,
          });
        }
      }
      setRecords(recs);
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (openWizardToken && openWizardToken > 0) {
      setWizOpen(true);
    }
  }, [openWizardToken]);

  const runLoan = useCallback(
    async (busyKey: number, fn: () => Promise<unknown>, okMsg: string) => {
      setBusyId(busyKey);
      try {
        await fn();
        onNotify?.(okMsg, 'INFO');
        await load();
      } catch (err) {
        onNotify?.(errorMessage(err), 'INFO');
      } finally {
        setBusyId(null);
      }
    },
    [load, onNotify]
  );

  const approve = (c: CreditEx) =>
    runLoan(num(c.id), () => apiApproveLoan(num(c.id)), 'Préstamo aprobado correctamente');

  const reject = async (c: CreditEx) => {
    const reason = await confirmDialog({
      title: 'Rechazar préstamo',
      message: `¿Rechazar el préstamo ${str(c.credit_number)}?`,
      confirmLabel: 'Rechazar',
      tone: 'rose',
      input: { label: 'Motivo (opcional)', placeholder: 'Ej.: documentación incompleta' },
    });
    if (reason === null || reason === false) return;
    await runLoan(
      num(c.id),
      () =>
        apiRejectLoan(
          num(c.id),
          typeof reason === 'string' && reason.trim() ? reason.trim() : undefined
        ),
      'Préstamo rechazado'
    );
  };

  const disburse = (c: CreditEx) =>
    runLoan(num(c.id), () => apiDisburseLoan(num(c.id)), 'Préstamo desembolsado correctamente');

  const openFin = async (c: CreditEx, kind: FinKind) => {
    const def = products.find((q) => q.is_default) ?? products[0];
    setFinForm({
      method: def?.amortization_method || 'FRENCH',
      annualRate: str(c.annual_rate) || str(def?.annual_rate || ''),
      installmentsCount: str(num(c.installments_count) || def?.default_terms || 12),
      startDate: datePart(c.start_date) || todayStr(),
      additionalAmount: '',
    });
    setFinQuote(null);
    let outstanding = num(c.total_amount);
    if (kind === 'refinance') {
      try {
        const r = await apiLoanOutstanding(num(c.id));
        outstanding = r.data.total || outstanding;
      } catch {
        onNotify?.('No se pudo obtener el saldo pendiente', 'INFO');
      }
    }
    setFin({ credit: c, kind, outstanding });
  };

  const calcFinQuote = async () => {
    if (!fin) return;
    const principal =
      fin.kind === 'refinance'
        ? fin.outstanding || num(fin.credit.total_amount)
        : num(fin.credit.total_amount);
    setFinQuoteLoading(true);
    try {
      const res = await apiLoanQuote({
        principal,
        annualRate: num(finForm.annualRate),
        method: finForm.method,
        installmentsCount: num(finForm.installmentsCount),
        startDate: finForm.startDate || undefined,
      });
      setFinQuote(res.data);
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setFinQuoteLoading(false);
    }
  };

  const confirmFin = async () => {
    if (!fin) return;
    const c = fin.credit;
    const body = {
      annualRate: num(finForm.annualRate),
      method: finForm.method,
      installmentsCount: num(finForm.installmentsCount),
      startDate: finForm.startDate || undefined,
    };
    const label =
      fin.kind === 'restructure' ? 'reestructurado' : fin.kind === 'refinance' ? 'refinanciado' : 'renovado';
    await runLoan(num(c.id), () => {
      if (fin.kind === 'restructure') return apiRestructureLoan(num(c.id), body);
      if (fin.kind === 'refinance')
        return apiRefinanceLoan(num(c.id), {
          ...body,
          additionalAmount: finForm.additionalAmount ? num(finForm.additionalAmount) : undefined,
        });
      return apiRenewLoan(num(c.id), body);
    }, `Préstamo ${label} correctamente`);
    setFin(null);
    setFinQuote(null);
  };

  const confirmCondone = async () => {
    if (!cnd) return;
    await runLoan(
      num(cnd.id),
      () =>
        apiCondoneCredit(num(cnd.id), {
          type: cndForm.type,
          amount: cndForm.type === 'AMOUNT' ? num(cndForm.amount) : undefined,
        }),
      'Crédito condonado correctamente'
    );
    setCnd(null);
  };

  const openAgr = async (r: LoanRecord) => {
    let total = num(r.credit.pending_principal) || num(r.credit.total_amount);
    setAgrForm({
      agreedDate: todayStr(),
      terms: str(num(r.credit.installments_count) || 12),
      frequency: 'WEEKLY',
      initialPayment: '',
      totalAmount: '',
      firstDueDate: '',
      notes: '',
    });
    try {
      const o = await apiLoanOutstanding(num(r.credit.id));
      if (o.data.total) total = o.data.total;
    } catch {
      // usa el saldo del crédito
    }
    setAgrForm((f) => ({ ...f, totalAmount: str(total) }));
    setAgr(r);
  };

  const confirmAgr = async () => {
    if (!agr) return;
    await runLoan(
      num(agr.credit.id),
      () =>
        apiCreateAgreement({
          creditId: num(agr.credit.id),
          clientId: agr.client.id,
          terms: num(agrForm.terms),
          frequency: agrForm.frequency,
          totalAmount: num(agrForm.totalAmount),
          initialPayment: agrForm.initialPayment ? num(agrForm.initialPayment) : undefined,
          agreedDate: agrForm.agreedDate || undefined,
          firstDueDate: agrForm.firstDueDate || undefined,
          notes: agrForm.notes || undefined,
        }),
      'Acuerdo de pago creado correctamente'
    );
    setAgr(null);
  };

  const confirmInstCnd = async () => {
    if (!instCnd) return;
    await runLoan(
      num(instCnd.id),
      () =>
        apiCondoneInstallment(num(instCnd.id), {
          type: instCndForm.type,
          amount: instCndForm.type === 'AMOUNT' ? num(instCndForm.amount) : undefined,
        }),
      'Cuota condonada correctamente'
    );
    setInstCnd(null);
  };

  const runOverdue = async () => {
    if (
      !(await confirmDialog({
        title: 'Motor de mora',
        message: '¿Ejecutar el motor de mora? Se procesarán vencidos y penalizaciones.',
        confirmLabel: 'Ejecutar',
        tone: 'amber',
      }))
    )
      return;
    setOverdueRunning(true);
    try {
      const res = await apiRunOverdue();
      const msg = `Motor de mora ejecutado: ${res.data.penalized} penalizada(s), ${res.data.defaulted} en mora`;
      onNotify?.(msg, res.data.penalized > 0 ? 'LOCK' : 'INFO');
      await load();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setOverdueRunning(false);
    }
  };

  const setAgrStatus = async (a: AgreementRow, status: string) => {
    setAgrBusy(a.id);
    try {
      await apiSetAgreementStatus(a.id, status);
      onNotify?.('Estado del acuerdo actualizado', 'INFO');
      await load();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setAgrBusy(null);
    }
  };

  const quoteWizard = async () => {
    setWizQuoteLoading(true);
    try {
      const res = await apiLoanQuote({
        principal: num(wizForm.principal),
        annualRate: num(wizForm.annualRate),
        method: wizForm.method,
        installmentsCount: num(wizForm.installmentsCount),
        startDate: wizForm.startDate || undefined,
      });
      setWizQuote(res.data);
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setWizQuoteLoading(false);
    }
  };

  const createLoan = async () => {
    if (!wizClientId) return;
    setWizBusy(true);
    try {
      const res = await apiCreateLoan({
        clientId: wizClientId,
        principal: num(wizForm.principal),
        annualRate: num(wizForm.annualRate),
        method: wizForm.method,
        installmentsCount: num(wizForm.installmentsCount),
        startDate: wizForm.startDate || undefined,
        financingFee: wizForm.financingFee ? num(wizForm.financingFee) : undefined,
        notes: wizForm.notes || undefined,
        status: 'PENDING',
      });
      onNotify?.(`Préstamo creado: ${res.data.creditNumber}`, 'INFO');
      setWizOpen(false);
      setWizQuote(null);
      setWizClientId(null);
      setWizClientQuery('');
      setWizProductId('');
      await load();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setWizBusy(false);
    }
  };

  const pickProduct = (id: number) => {
    setWizProductId(id);
    const prod = products.find((q) => q.id === id);
    if (!prod) return;
    setWizForm((f) => ({
      ...f,
      method: prod.amortization_method || 'FRENCH',
      annualRate: str(prod.annual_rate) || f.annualRate,
      installmentsCount: str(prod.default_terms || num(f.installmentsCount) || 12),
    }));
  };

  const filteredClients = useMemo(() => {
    const q = wizClientQuery.trim().toLowerCase();
    return allClients.filter((c) => !q || c.full_name.toLowerCase().includes(q)).slice(0, 50);
  }, [allClients, wizClientQuery]);

  const visible = useMemo(() => {
    const priority = (s: string): number => {
      const idx = ['PENDING', 'APPROVED', 'ACTIVE', 'DEFAULTED'].indexOf(s);
      return idx >= 0 ? idx : 4;
    };
    const sorted = [...records].sort((a, b) => {
      const pa = priority(a.credit.status);
      const pb = priority(b.credit.status);
      if (pa !== pb) return pa - pb;
      return str(a.credit.credit_number).localeCompare(str(b.credit.credit_number), undefined, {
        numeric: true,
      });
    });
    return sorted.filter((r) => {
      const s = r.credit.status;
      switch (activeTab) {
        case 'PENDING':
          return s === 'PENDING';
        case 'APPROVED':
          return s === 'APPROVED';
        case 'ACTIVE':
          return s === 'ACTIVE';
        case 'PAID_OFF':
          return s === 'PAID_OFF';
        case 'DEFAULTED':
          return s === 'DEFAULTED';
        case 'HISTORIC':
          return ['REJECTED', 'CANCELED', 'REFINANCED', 'RESTRUCTURED'].includes(s);
        default:
          return true;
      }
    });
  }, [records, activeTab]);

  const toggleExpand = (id: number) =>
    setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const selectedClient = allClients.find((c) => c.id === wizClientId);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Ciclo de Vida de Préstamos
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solicitudes, aprobación, desembolso, seguimiento y refinanciamiento
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className={btnSecondary} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : <RefreshCw className="h-3.5 w-3.5 inline mr-1" />}
              Actualizar
            </button>
            {p.create && (
              <button onClick={() => setWizOpen(true)} className={btnPrimary}>
                <Plus className="h-3.5 w-3.5 inline mr-1" />
                NUEVO PRÉSTAMO
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={activeTab === t.key ? chipActive : chipIdle}
          >
            {t.key === 'AGREEMENTS' && <FileText className="h-3 w-3 inline mr-1" />}
            {t.label}
          </button>
        ))}
      </div>

      {activeTab !== 'AGREEMENTS' && (
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Cpu className="h-4 w-4 text-rose-500" />
                Motor de Mora
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Detecta cuotas vencidas, aplica penalizaciones y marca créditos en mora
              </p>
            </div>
            <button
              onClick={() => void runOverdue()}
              className={btnDanger}
              disabled={overdueRunning}
            >
              {overdueRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />
              ) : (
                <Cpu className="h-3.5 w-3.5 inline mr-1" />
              )}
              EJECUTAR MOTOR DE MORA (RUN-OVERDUE)
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Cargando préstamos…
          </div>
        ) : activeTab === 'AGREEMENTS' ? (
          agreements.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
              No hay acuerdos de pago registrados
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                  <tr>
                    <th className={thCls}>Id</th>
                    <th className={thCls}># Crédito</th>
                    <th className={thCls}>Cliente</th>
                    <th className={thCls}>Fecha Acuerdo</th>
                    <th className={thCls}>Monto Total</th>
                    <th className={thCls}>Pago Inicial</th>
                    <th className={thCls}>Plazos</th>
                    <th className={thCls}>Frecuencia</th>
                    <th className={thCls}>1ª Cuota</th>
                    <th className={thCls}>Estado</th>
                    <th className={thCls}>Notas</th>
                    <th className={thCls}>Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {agreements.map((a) => {
                    const [cls, lbl] = AGMT_STYLE[a.status] ?? [
                      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                      a.status,
                    ];
                    return (
                      <tr key={a.id}>
                        <td className={tdCls}>{a.id}</td>
                        <td className={tdCls}>{a.credit_number}</td>
                        <td className={tdCls}>{a.client_name}</td>
                        <td className={tdCls}>{fmtDate(a.agreed_date)}</td>
                        <td className={tdCls}>{money(a.total_amount)}</td>
                        <td className={tdCls}>{money(a.initial_payment)}</td>
                        <td className={tdCls}>{a.terms}</td>
                        <td className={tdCls}>{a.frequency}</td>
                        <td className={tdCls}>{fmtDate(a.first_due_date)}</td>
                        <td className={tdCls}>{badge(cls, lbl)}</td>
                        <td className={tdCls}>{str(a.notes) || '—'}</td>
                        <td className={tdCls}>
                          <select
                            value={a.status}
                            disabled={agrBusy === a.id}
                            onChange={(e) => void setAgrStatus(a, e.target.value)}
                            className={inputCls}
                          >
                            <option value="PENDING">Pendiente</option>
                            <option value="ACTIVE">Activo</option>
                            <option value="COMPLETED">Completado</option>
                            <option value="FAILED">Fallido</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : visible.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
            No hay préstamos en esta sección
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className={thCls}># Crédito</th>
                  <th className={thCls}>Cliente</th>
                  <th className={thCls}>Inicio</th>
                  <th className={thCls}>Capital Desembolsado</th>
                  <th className={thCls}>Tasa %</th>
                  <th className={thCls}>Método</th>
                  <th className={thCls}>Cuotas</th>
                  <th className={thCls}>Saldo Pendiente</th>
                  <th className={thCls}>Próxima Cuota</th>
                  <th className={thCls}>Días Atraso</th>
                  <th className={thCls}>Estado</th>
                  <th className={thCls}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((r) => {
                  const c = r.credit;
                  const paidCount = r.installments.filter((i) => i.status === 'PAGADO').length;
                  const totalCount = num(c.installments_count) || r.installments.length || 0;
                  const disbursed = num(c.total_amount) || num(c.principal_amount);
                  const pending = num(c.pending_principal);
                  const st = c.status ?? 'UNKNOWN';
                  const [stCls, stLbl] = STATUS_STYLE[st] ?? [
                    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                    st,
                  ];
                  const busy = busyId === num(c.id);
                  const isOpen = !!expanded[num(c.id)];
                  const canAct = ['ACTIVE', 'DEFAULTED', 'PAID_OFF', 'REFINANCED', 'RESTRUCTURED', 'REJECTED', 'CANCELED'].includes(st);
                  return (
                    <React.Fragment key={num(c.id)}>
                      <tr>
                        <td className={tdCls}>
                          <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                            {str(c.credit_number)}
                          </span>
                        </td>
                        <td className={tdCls}>
                          <button
                            onClick={() => onGoToClient?.(r.client.id)}
                            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                          >
                            {r.client.full_name}
                          </button>
                        </td>
                        <td className={tdCls}>{fmtDate(c.start_date)}</td>
                        <td className={tdCls}>{money(disbursed)}</td>
                        <td className={tdCls}>{num(c.annual_rate)}</td>
                        <td className={tdCls}>
                          {badge(
                            'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
                            str(c.amortization_method)
                          )}
                        </td>
                        <td className={tdCls}>
                          {paidCount}/{totalCount}
                        </td>
                        <td className={tdCls}>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {money(pending)}
                          </span>
                        </td>
                        <td className={tdCls}>
                          {r.nextInstallment ? (
                            <span className="text-xs">
                              <span className="block">{fmtDate(r.nextInstallment.due_date)}</span>
                              <span className="block font-semibold text-slate-900 dark:text-slate-100">
                                {money(r.nextInstallment.amount)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className={tdCls}>
                          <span
                            className={`font-semibold ${r.daysLate > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}
                          >
                            {r.daysLate}
                          </span>
                        </td>
                        <td className={tdCls}>{badge(stCls, stLbl)}</td>
                        <td className={tdCls}>
                          <div className="flex flex-wrap gap-1.5 max-w-xs">
                            {st === 'PENDING' && p.approve && (
                              <>
                                <button
                                  className={btnPrimary}
                                  disabled={busy}
                                  onClick={() => void approve(c)}
                                >
                                  <CheckCircle2 className="h-3 w-3 inline mr-1" />
                                  Aprobar
                                </button>
                                <button
                                  className={btnDanger}
                                  disabled={busy}
                                  onClick={() => void reject(c)}
                                >
                                  <XCircle className="h-3 w-3 inline mr-1" />
                                  Rechazar
                                </button>
                              </>
                            )}
                            {st === 'APPROVED' && p.disburse && (
                              <button className={btnPrimary} disabled={busy} onClick={() => void disburse(c)}>
                                <Banknote className="h-3 w-3 inline mr-1" />
                                Desembolsar
                              </button>
                            )}
                            {st === 'ACTIVE' && p.refinance && (
                              <>
                                <button className={btnSecondary} disabled={busy} onClick={() => void openFin(c, 'restructure')}>
                                  <Network className="h-3 w-3 inline mr-1" />
                                  Reestructurar
                                </button>
                                <button className={btnSecondary} disabled={busy} onClick={() => void openFin(c, 'refinance')}>
                                  <FileSignature className="h-3 w-3 inline mr-1" />
                                  Refinanciar
                                </button>
                                <button className={btnSecondary} disabled={busy} onClick={() => void openFin(c, 'renew')}>
                                  <FileSignature className="h-3 w-3 inline mr-1" />
                                  Renovar
                                </button>
                              </>
                            )}
                            {st === 'ACTIVE' && p.condone && (
                              <button
                                className={btnSecondary}
                                disabled={busy}
                                onClick={() => {
                                  setCndForm({ type: 'PENALTY', amount: '' });
                                  setCnd(c);
                                }}
                              >
                                <HandCoins className="h-3 w-3 inline mr-1" />
                                Condonar
                              </button>
                            )}
                            {(st === 'ACTIVE' || st === 'DEFAULTED') && p.agreements && (
                              <button className={btnSecondary} disabled={busy} onClick={() => void openAgr(r)}>
                                <Handshake className="h-3 w-3 inline mr-1" />
                                Acuerdo de Pago
                              </button>
                            )}
                            {(st === 'ACTIVE' || st === 'DEFAULTED') && (
                              <button
                                className={btnPrimary}
                                disabled={busy}
                                onClick={() =>
                                  setCobranzaLoan({
                                    id: num(c.id),
                                    creditNumber: str(c.credit_number),
                                    clientName: r.client.full_name,
                                    outstanding: pending,
                                  })
                                }
                              >
                                <HandCoins className="h-3 w-3 inline mr-1" />
                                Cobrar
                              </button>
                            )}
                            {canAct && (
                              <button
                                className={btnSecondary}
                                onClick={() => setDetailLoanId(num(c.id))}
                              >
                                <Eye className="h-3 w-3 inline mr-1" />
                                Detalle
                              </button>
                            )}
                            {canAct && (
                              <button
                                className={btnSecondary}
                                onClick={() => toggleExpand(num(c.id))}
                              >
                                <FileText className="h-3 w-3 inline mr-1" />
                                Ver Cuotas
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={12} className={`${tdCls} bg-slate-50 dark:bg-slate-900/40`}>
                            {r.installments.length === 0 ? (
                              <p className="text-xs text-slate-400 py-2">Sin cuotas registradas</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase text-slate-400">
                                    <tr>
                                      <th className="py-2 px-3">Cuota #</th>
                                      <th className="py-2 px-3">Vencimiento</th>
                                      <th className="py-2 px-3">Monto</th>
                                      <th className="py-2 px-3">Principal</th>
                                      <th className="py-2 px-3">Interés</th>
                                      <th className="py-2 px-3">Penalidad</th>
                                      <th className="py-2 px-3">Estado</th>
                                      <th className="py-2 px-3">Pagado</th>
                                      <th className="py-2 px-3">Fecha Pago</th>
                                      <th className="py-2 px-3">Acción</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {r.installments.map((inst) => (
                                      <tr key={inst.id}>
                                        <td className="py-2 px-3">{num(inst.installment_number)}</td>
                                        <td className="py-2 px-3">{fmtDate(inst.due_date)}</td>
                                        <td className="py-2 px-3">{num(inst.amount)}</td>
                                        <td className="py-2 px-3">
                                          {money((inst as unknown as Record<string, unknown>).principal_part)}
                                        </td>
                                        <td className="py-2 px-3">
                                          {money((inst as unknown as Record<string, unknown>).interest_part)}
                                        </td>
                                        <td className="py-2 px-3">{money(inst.penalty_amount)}</td>
                                        <td className="py-2 px-3">
                                          {badge(
                                            INST_STYLE[inst.status] ??
                                              'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                                            str(inst.status)
                                          )}
                                        </td>
                                        <td className="py-2 px-3">{money(inst.paid_amount)}</td>
                                        <td className="py-2 px-3">{fmtDate(inst.paid_date)}</td>
                                        <td className="py-2 px-3">
                                          {p.condone && inst.status !== 'PAGADO' && (
                                            <button
                                              className={btnSecondary}
                                              onClick={() => {
                                                setInstCndForm({ type: 'PENALTY', amount: '' });
                                                setInstCnd(inst);
                                              }}
                                            >
                                              Condonar
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {wizOpen && (
        <ModalShell isOpen title="Nuevo Préstamo" onClose={() => setWizOpen(false)} size="lg">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Cliente</label>
              <input
                className={inputCls}
                placeholder="Buscar por nombre…"
                value={wizClientQuery}
                onChange={(e) => setWizClientQuery(e.target.value)}
              />
              {selectedClient ? (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-emerald-300 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {selectedClient.full_name}
                  </span>
                  <button
                    className="text-emerald-600 hover:text-emerald-800 dark:hover:text-emerald-200 text-sm"
                    onClick={() => {
                      setWizClientId(null);
                      setWizClientQuery('');
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                  {filteredClients.map((cl) => (
                    <button
                      key={cl.id}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:bg-slate-500/10 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                      onClick={() => {
                        setWizClientId(cl.id);
                        setWizClientQuery('');
                      }}
                    >
                      {cl.full_name}
                      <span className="block text-[10px] text-slate-400">{cl.cedula_or_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Producto de Préstamo</label>
              <select
                className={inputCls}
                value={wizProductId}
                onChange={(e) => pickProduct(Number(e.target.value))}
              >
                <option value="">— Seleccionar producto —</option>
                {products.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name} ({pr.amortization_method} · {num(pr.annual_rate)}% · {pr.default_terms} cuotas)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Capital (Principal)</label>
                <input
                  className={inputCls}
                  type="number"
                  value={wizForm.principal}
                  onChange={(e) => setWizForm((f) => ({ ...f, principal: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Tasa Anual %</label>
                <input
                  className={inputCls}
                  type="number"
                  value={wizForm.annualRate}
                  onChange={(e) => setWizForm((f) => ({ ...f, annualRate: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Método de Amortización</label>
                <select
                  className={inputCls}
                  value={wizForm.method}
                  onChange={(e) => setWizForm((f) => ({ ...f, method: e.target.value }))}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Número de Cuotas</label>
                <input
                  className={inputCls}
                  type="number"
                  value={wizForm.installmentsCount}
                  onChange={(e) => setWizForm((f) => ({ ...f, installmentsCount: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Fecha de Inicio</label>
                <input
                  className={inputCls}
                  type="date"
                  value={wizForm.startDate}
                  onChange={(e) => setWizForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Cargo Financiamiento</label>
                <input
                  className={inputCls}
                  type="number"
                  value={wizForm.financingFee}
                  onChange={(e) => setWizForm((f) => ({ ...f, financingFee: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Notas</label>
              <textarea
                className={inputCls}
                rows={2}
                value={wizForm.notes}
                onChange={(e) => setWizForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button className={btnSecondary} onClick={() => void quoteWizard()} disabled={wizQuoteLoading}>
                {wizQuoteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                COTIZAR
              </button>
              <button
                className={btnPrimary}
                disabled={!wizQuote || wizBusy}
                onClick={() => void createLoan()}
              >
                {wizBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                CREAR PRÉSTAMO
              </button>
            </div>

            {wizQuote && (
              <div>
                <h4 className="text-xs font-bold uppercase text-slate-400 mb-2">Vista previa de la cotización</h4>
                <QuoteSummary quote={wizQuote} />
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {fin && (
        <ModalShell
          isOpen
          title={
            fin.kind === 'restructure'
              ? 'Reestructurar Préstamo'
              : fin.kind === 'refinance'
                ? 'Refinanciar Préstamo'
                : 'Renovar Préstamo'
          }
          onClose={() => {
            setFin(null);
            setFinQuote(null);
          }}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs">
              <p className="text-slate-500 dark:text-slate-400">
                Crédito <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{str(fin.credit.credit_number)}</span>
              </p>
              {fin.kind === 'refinance' && (
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                  Saldo pendiente: <span className="font-bold text-emerald-600 dark:text-emerald-400">{money(fin.outstanding)}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Método</label>
                <select
                  className={inputCls}
                  value={finForm.method}
                  onChange={(e) => setFinForm((f) => ({ ...f, method: e.target.value }))}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tasa Anual %</label>
                <input
                  className={inputCls}
                  type="number"
                  value={finForm.annualRate}
                  onChange={(e) => setFinForm((f) => ({ ...f, annualRate: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Número de Cuotas</label>
                <input
                  className={inputCls}
                  type="number"
                  value={finForm.installmentsCount}
                  onChange={(e) => setFinForm((f) => ({ ...f, installmentsCount: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Fecha de Inicio</label>
                <input
                  className={inputCls}
                  type="date"
                  value={finForm.startDate}
                  onChange={(e) => setFinForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              {fin.kind === 'refinance' && (
                <div>
                  <label className={labelCls}>Monto Adicional</label>
                  <input
                    className={inputCls}
                    type="number"
                    value={finForm.additionalAmount}
                    onChange={(e) => setFinForm((f) => ({ ...f, additionalAmount: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button className={btnSecondary} onClick={() => void calcFinQuote()} disabled={finQuoteLoading}>
                {finQuoteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                CALCULAR
              </button>
              <button className={btnPrimary} disabled={busyId === num(fin.credit.id)} onClick={() => void confirmFin()}>
                {busyId === num(fin.credit.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                Confirmar
              </button>
            </div>

            {finQuote && <QuoteSummary quote={finQuote} />}
          </div>
        </ModalShell>
      )}

      {cnd && (
        <ModalShell isOpen title="Condonar Crédito" onClose={() => setCnd(null)} size="lg">
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Crédito <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{str(cnd.credit_number)}</span>
            </p>
            <div>
              <label className={labelCls}>Tipo</label>
              <select
                className={inputCls}
                value={cndForm.type}
                onChange={(e) => setCndForm((f) => ({ ...f, type: e.target.value as typeof cndForm.type }))}
              >
                <option value="PENALTY">Penalidades</option>
                <option value="INTEREST">Intereses</option>
                <option value="AMOUNT">Monto</option>
              </select>
            </div>
            {cndForm.type === 'AMOUNT' && (
              <div>
                <label className={labelCls}>Monto</label>
                <input
                  className={inputCls}
                  type="number"
                  value={cndForm.amount}
                  onChange={(e) => setCndForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            )}
            <div className="flex gap-2">
              <button className={btnSecondary} onClick={() => setCnd(null)}>
                Cancelar
              </button>
              <button className={btnDanger} disabled={busyId === num(cnd.id)} onClick={() => void confirmCondone()}>
                {busyId === num(cnd.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                Confirmar Condonación
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {agr && (
        <ModalShell isOpen title="Nuevo Acuerdo de Pago" onClose={() => setAgr(null)} size="lg">
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {agr.client.full_name} · Crédito{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{str(agr.credit.credit_number)}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Fecha Acuerdo</label>
                <input
                  className={inputCls}
                  type="date"
                  value={agrForm.agreedDate}
                  onChange={(e) => setAgrForm((f) => ({ ...f, agreedDate: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Número de Plazos</label>
                <input
                  className={inputCls}
                  type="number"
                  value={agrForm.terms}
                  onChange={(e) => setAgrForm((f) => ({ ...f, terms: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Frecuencia</label>
                <select
                  className={inputCls}
                  value={agrForm.frequency}
                  onChange={(e) => setAgrForm((f) => ({ ...f, frequency: e.target.value }))}
                >
                  <option value="WEEKLY">Semanal</option>
                  <option value="BIWEEKLY">Quincenal</option>
                  <option value="MONTHLY">Mensual</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Pago Inicial</label>
                <input
                  className={inputCls}
                  type="number"
                  value={agrForm.initialPayment}
                  onChange={(e) => setAgrForm((f) => ({ ...f, initialPayment: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Monto Total</label>
                <input
                  className={inputCls}
                  type="number"
                  value={agrForm.totalAmount}
                  onChange={(e) => setAgrForm((f) => ({ ...f, totalAmount: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>1ª Cuota</label>
                <input
                  className={inputCls}
                  type="date"
                  value={agrForm.firstDueDate}
                  onChange={(e) => setAgrForm((f) => ({ ...f, firstDueDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Notas</label>
              <textarea
                className={inputCls}
                rows={2}
                value={agrForm.notes}
                onChange={(e) => setAgrForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button className={btnSecondary} onClick={() => setAgr(null)}>
                Cancelar
              </button>
              <button className={btnPrimary} disabled={busyId === num(agr.credit.id)} onClick={() => void confirmAgr()}>
                {busyId === num(agr.credit.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                Crear Acuerdo
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {instCnd && (
        <ModalShell isOpen title="Condonar Cuota" onClose={() => setInstCnd(null)} size="lg">
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cuota #{num(instCnd.installment_number)} · {money(instCnd.amount)}
            </p>
            <div>
              <label className={labelCls}>Tipo</label>
              <select
                className={inputCls}
                value={instCndForm.type}
                onChange={(e) =>
                  setInstCndForm((f) => ({ ...f, type: e.target.value as typeof instCndForm.type }))
                }
              >
                <option value="PENALTY">Penalidad</option>
                <option value="INTEREST">Interés</option>
                <option value="AMOUNT">Monto</option>
              </select>
            </div>
            {instCndForm.type === 'AMOUNT' && (
              <div>
                <label className={labelCls}>Monto</label>
                <input
                  className={inputCls}
                  type="number"
                  value={instCndForm.amount}
                  onChange={(e) => setInstCndForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            )}
            <div className="flex gap-2">
              <button className={btnSecondary} onClick={() => setInstCnd(null)}>
                Cancelar
              </button>
              <button
                className={btnDanger}
                disabled={busyId === num(instCnd.id)}
                onClick={() => void confirmInstCnd()}
              >
                {busyId === num(instCnd.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {cobranzaLoan && (
        <CobranzaModal
          loan={cobranzaLoan}
          onClose={() => setCobranzaLoan(null)}
          onNotify={onNotify}
          onSuccess={() => void load()}
        />
      )}

      {detailLoanId !== null && (
        <LoanDetailModal loanId={detailLoanId} onClose={() => setDetailLoanId(null)} />
      )}
    </div>
  );
};