import React, { useCallback, useEffect, useState } from 'react';
import {
  Wallet,
  RefreshCw,
  Download,
  HandCoins,
  Eye,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  apiListLoans,
  apiGetPaymentStats,
  apiExportPaymentsCsv,
  errorMessage,
  type LoanListRow,
  type PaymentStats,
} from '../services/api';
import { SearchInput } from './ui/SearchInput';
import { Pagination } from './ui/Pagination';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { EmptyState } from './ui/EmptyState';
import { CobranzaModal } from './CobranzaModal';
import { LoanDetailModal } from './LoanDetailModal';
import { formatCurrencyRD, formatDate } from '../utils/formatters';
import { DEFAULT_PAGE_SIZE } from '../constants';

type Notify = (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'TODOS' },
  { id: 'PENDING', label: 'SOLICITUDES' },
  { id: 'APPROVED', label: 'APROBADOS' },
  { id: 'ACTIVE', label: 'ACTIVOS' },
  { id: 'DEFAULTED', label: 'EN MORA' },
];

interface FinanceViewProps {
  onNotify?: Notify;
}

/**
 * Cobranza unificada (F11). Consume SOLO /loans + /payments/stats y /payments/export.
 * Cero lógica financiera en React (F10); cartera paginada por el servidor (F12).
 */
export const FinanceView: React.FC<FinanceViewProps> = ({ onNotify }) => {
  const [loans, setLoans] = useState<LoanListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [cobranza, setCobranza] = useState<LoanListRow | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [exportMsg, setExportMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiListLoans({
        search: search || undefined,
        status: status || undefined,
        page,
        perPage: DEFAULT_PAGE_SIZE,
      });
      setLoans(res.data);
      setTotal(res.pagination.total);
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setLoading(false);
    }
  }, [search, status, page, onNotify]);

  useEffect(() => {
    let cancelled = false;
    apiGetPaymentStats()
      .then((res) => {
        if (!cancelled) setStats(res.data);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleCsv = async () => {
    setExportMsg('');
    try {
      await apiExportPaymentsCsv();
      setExportMsg('CSV exportado');
    } catch (err) {
      setExportMsg(errorMessage(err));
    }
  };

  const statsCards = [
    { icon: <TrendingUp className="h-4 w-4" />, label: 'Recaudado en el mes', value: stats ? formatCurrencyRD(stats.mesActual) : '—' },
    { icon: <Wallet className="h-4 w-4" />, label: 'Total pagos', value: stats ? String(stats.totalPagos) : '—' },
    { icon: <AlertTriangle className="h-4 w-4" />, label: 'Cartera por cobrar', value: stats ? formatCurrencyRD(stats.carteraPorCobrar) : '—' },
    { icon: <HandCoins className="h-4 w-4" />, label: 'Moras cobradas', value: stats ? formatCurrencyRD(stats.morasCobradas) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="card-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Cobranza</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cartera de préstamos, cobros con simulación e historial
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleCsv}>
              <Download className="h-4 w-4" />
              Exportar pagos CSV
            </Button>
            <Button variant="secondary" onClick={() => void load()} loading={loading}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>
        {exportMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">{exportMsg}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {statsCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                {c.icon} {c.label}
              </p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card-panel">
        <div className="p-5 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
          <SearchInput value={search} onChange={handleSearch} placeholder="Buscar por cliente o crédito…" className="flex-1 min-w-[200px]" />
          <select
            className="select-field w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrar por estado"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.id || 'ALL'} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner label="Cargando cartera…" />
        ) : loans.length === 0 ? (
          <EmptyState title="Sin resultados" message="Ajusta la búsqueda o el filtro de estado." />
        ) : (
          <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    <th className="py-2.5 px-3"># Crédito</th>
                    <th className="py-2.5 px-3">Cliente</th>
                    <th className="py-2.5 px-3 text-right">Desembolsado</th>
                    <th className="py-2.5 px-3 text-right">Pendiente</th>
                    <th className="py-2.5 px-3">Próxima cuota</th>
                    <th className="py-2.5 px-3">Estado</th>
                    <th className="py-2.5 px-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loans.map((l) => {
                    const cobrable = l.status === 'ACTIVE' || l.status === 'DEFAULTED';
                    return (
                      <tr key={l.id}>
                        <td className="py-2.5 px-3 font-mono">{l.creditNumber}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">{l.clientName}</td>
                        <td className="py-2.5 px-3 text-right">{formatCurrencyRD(l.totalAmount)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrencyRD(l.outstanding)}
                        </td>
                        <td className="py-2.5 px-3">
                          {l.nextDue ? (
                            <>
                              <span className="block">{formatDate(l.nextDue)}</span>
                              <span className="block text-slate-400">{l.pendingCount} pendientes</span>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge status={l.status} />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1.5">
                            {cobrable && (
                              <Button
                                size="sm"
                                onClick={() => setCobranza(l)}
                                disabled={l.outstanding <= 0}
                              >
                                <HandCoins className="h-3.5 w-3.5" />
                                Cobrar
                              </Button>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => setDetailId(l.id)}>
                              <Eye className="h-3.5 w-3.5" />
                              Detalle
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {loans.map((l) => {
                const cobrable = l.status === 'ACTIVE' || l.status === 'DEFAULTED';
                return (
                  <div key={l.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{l.creditNumber}</span>
                      <Badge status={l.status} />
                    </div>
                    <p className="text-sm font-semibold">{l.clientName}</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Pendiente</span>
                      <span className="font-bold">{formatCurrencyRD(l.outstanding)}</span>
                    </div>
                    <div className="flex gap-2">
                      {cobrable && (
                        <Button size="sm" className="flex-1" onClick={() => setCobranza(l)} disabled={l.outstanding <= 0}>
                          <HandCoins className="h-3.5 w-3.5" /> Cobrar
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDetailId(l.id)}>
                        <Eye className="h-3.5 w-3.5" /> Detalle
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4">
              <Pagination page={page} perPage={DEFAULT_PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>

      {cobranza && (
        <CobranzaModal
          loan={{
            id: cobranza.id,
            creditNumber: cobranza.creditNumber,
            clientName: cobranza.clientName,
            outstanding: cobranza.outstanding,
          }}
          onClose={() => setCobranza(null)}
          onSuccess={() => void load()}
          onNotify={onNotify}
        />
      )}

      {detailId !== null && <LoanDetailModal loanId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
};