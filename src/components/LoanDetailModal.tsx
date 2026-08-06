import React, { useEffect, useState } from 'react';
import { User, CalendarRange, Landmark, History, Smartphone } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { Badge } from './ui/Badge';
import { Spinner } from './ui/Spinner';
import { Button } from './ui/Button';
import {
  apiGetLoanDetail,
  apiGetLoanTimeline,
  errorMessage,
  type LoanDetailPayload,
  type LoanTimelineEntry,
} from '../services/api';
import { formatCurrencyRD, formatDate, formatDateTime } from '../utils/formatters';
import { STATUS_LABEL } from '../constants';

interface LoanDetailModalProps {
  loanId: number;
  onClose: () => void;
}

const EVENT_ICON: Record<string, string> = {
  PAYMENT: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10',
  PAYMENT_FAILED: 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10',
  LOAN_CREATED: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-500/10',
  LOAN_ACTIVATED: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-500/10',
  LOAN_CLOSED: 'text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/10',
  MDM_LOCK: 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10',
  MDM_UNLOCK: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10',
};

export const LoanDetailModal: React.FC<LoanDetailModalProps> = ({ loanId, onClose }) => {
  const [detail, setDetail] = useState<LoanDetailPayload | null>(null);
  const [timeline, setTimeline] = useState<LoanTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([apiGetLoanDetail(loanId), apiGetLoanTimeline(loanId)])
      .then(([d, t]) => {
        if (cancelled) return;
        setDetail(d.data);
        setTimeline(t.data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loanId]);

  const credit = detail?.credit as (LoanDetailPayload['credit'] & Record<string, unknown>) | undefined;

  return (
    <ModalShell isOpen onClose={onClose} title="Detalle del préstamo" size="xl">
      {loading ? (
        <Spinner label="Cargando detalle…" />
      ) : error ? (
        <p className="text-center text-sm text-rose-500 py-8">{error}</p>
      ) : detail && credit ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoCard
              icon={<User className="h-4 w-4" />}
              label="Cliente"
              value={String(detail.client?.full_name ?? credit.client_name ?? '—')}
            />
            <InfoCard
              icon={<CalendarRange className="h-4 w-4" />}
              label="Inicio"
              value={formatDate(credit.start_date)}
            />
            <InfoCard
              icon={<Landmark className="h-4 w-4" />}
              label="Capital desembolsado"
              value={formatCurrencyRD(Number(credit.total_amount))}
            />
            <InfoCard
              icon={<Smartphone className="h-4 w-4" />}
              label="Monto / Cuota"
              value={formatCurrencyRD(Number(credit.monthly_amount))}
            />
            <InfoCard label="Estado" value={<Badge status={String(credit.status)} />} />
            <InfoCard label="Notas" value={String(credit.notes ?? '—')} />
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase text-slate-400 mb-2">Cuotas</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Vence</th>
                    <th className="py-2 px-3 text-right">Monto</th>
                    <th className="py-2 px-3 text-right">Pagado</th>
                    <th className="py-2 px-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.installments.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 px-3 font-mono">{i.installment_number}</td>
                      <td className="py-2 px-3">{formatDate(i.due_date)}</td>
                      <td className="py-2 px-3 text-right">{formatCurrencyRD(i.total_amount)}</td>
                      <td className="py-2 px-3 text-right">{formatCurrencyRD(i.paid_amount)}</td>
                      <td className="py-2 px-3">
                        <Badge status={String(i.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-2">
              <History className="h-4 w-4" /> Timeline
            </h4>
            {timeline.length === 0 ? (
              <p className="text-xs text-slate-400">Sin eventos registrados.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <span
                      className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
                        EVENT_ICON[e.eventType] ?? 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <span className="text-[10px] font-black">{e.eventType.slice(0, 1)}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {STATUS_LABEL[e.eventType] ?? e.eventType}
                      </p>
                      {e.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{e.description}</p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {formatDateTime(e.createdAt)}
                        {e.userName ? ` · ${e.userName}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-center text-sm text-slate-400 py-8">No se encontró el préstamo.</p>
      )}
    </ModalShell>
  );
};

const InfoCard: React.FC<{
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}> = ({ icon, label, value }) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
    <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
      {icon} {label}
    </p>
    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);