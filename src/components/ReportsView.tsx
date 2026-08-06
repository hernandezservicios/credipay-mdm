import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Download, Printer, Filter, RefreshCw, Loader2, CalendarRange, Search } from 'lucide-react';
import { apiReportTypes, apiReport, apiReportCsv, errorMessage, type ReportRow } from '../services/api';
import { formatCurrencyRD } from '../utils/formatters';

export interface ReportsViewProps {
  onNotify?: (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;
}

interface ReportDescriptor {
  key: string;
  label: string;
}

interface ReportResult {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  data: ReportRow[];
  headers: string[];
  pagination: { page: number; perPage: number; total: number };
}

const MONEY_KEYWORDS = [
  'importe',
  'monto',
  'saldo',
  'total',
  'mora',
  'capital',
  'interes',
  'interés',
  'comision',
  'comisión',
  'penalidad',
  'pago',
  'cuota',
  'balance',
  'desembolso',
  'cobrado',
  'recaudo',
];

function isMoneyHeader(header: string): boolean {
  const h = header.toLowerCase();
  return MONEY_KEYWORDS.some((k) => h.includes(k));
}

function formatMoney(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return formatCurrencyRD(n);
}

function formatDate(header: string, value: string | number | null): string | number | null {
  if (value === null || value === undefined) return value;
  const s = String(value);
  const h = header.toLowerCase();
  const withTime = h.includes('hora') || h.includes('created') || h.includes('registro');
  return withTime ? s.slice(0, 19) : s.slice(0, 10);
}

function formatCell(header: string, value: string | number | null): string {
  const h = header.toLowerCase();
  if (h.includes('fecha') || h.includes('date')) {
    return String(formatDate(header, value));
  }
  if (isMoneyHeader(h)) {
    return formatMoney(value);
  }
  return value === null || value === undefined ? '' : String(value);
}

export const ReportsView: React.FC<ReportsViewProps> = ({ onNotify }) => {
  const [groups, setGroups] = useState<Record<string, ReportDescriptor[]>>({});
  const [typesOrder, setTypesOrder] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<ReportDescriptor | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [loadingCsv, setLoadingCsv] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiReportTypes()
      .then((res) => {
        if (!mounted) return;
        setGroups(res.data);
        setTypesOrder(Object.keys(res.data));
      })
      .catch((err) => {
        if (mounted) setTypesError(errorMessage(err));
      })
      .finally(() => {
        if (mounted) setLoadingTypes(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const fetchReport = useCallback(
    (descriptor: ReportDescriptor, filters: { from?: string; to?: string; status?: string }) => {
      setActiveReport(descriptor);
      setLoadingReport(true);
      setReportError(null);
      apiReport(descriptor.key, { ...filters, perPage: 100 })
        .then((res) => setResult(res))
        .catch((err) => setReportError(errorMessage(err)))
        .finally(() => setLoadingReport(false));
    },
    []
  );

  const selectReport = useCallback(
    (descriptor: ReportDescriptor) => {
      fetchReport(descriptor, {});
    },
    [fetchReport]
  );

  const applyFilters = useCallback(() => {
    if (!activeReport) return;
    fetchReport(activeReport, { from: from || undefined, to: to || undefined, status: status || undefined });
  }, [activeReport, from, to, status, fetchReport]);

  const handleCsv = useCallback(async () => {
    if (!activeReport) return;
    setLoadingCsv(true);
    try {
      await apiReportCsv(activeReport.key, {
        from: from || undefined,
        to: to || undefined,
        status: status || undefined,
      });
      onNotify?.('CSV descargado', 'INFO');
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setLoadingCsv(false);
    }
  }, [activeReport, from, to, status, onNotify]);

  const hasItems = from !== '' || to !== '' || status !== '';
  const intervalText =
    result && (result.from || result.to)
      ? `${result.from ?? '…'} → ${result.to ?? '…'}`
      : 'Todo el período';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs h-fit">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Reportes</h2>
          </div>

          {loadingTypes ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            </div>
          ) : typesError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{typesError}</p>
          ) : typesOrder.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No hay reportes disponibles</p>
          ) : (
            <div className="space-y-6">
              {typesOrder.map((group) => (
                <div key={group}>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                    {group}
                  </h3>
                  <div className="space-y-1.5">
                    {(groups[group] ?? []).map((item) => {
                      const isActive = activeReport?.key === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => selectReport(item)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                            isActive
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span className="block truncate">{item.label}</span>
                          <span
                            className={`block text-[10px] font-mono truncate ${
                              isActive ? 'text-indigo-200' : 'text-slate-400'
                            }`}
                          >
                            {item.key}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          {!activeReport ? (
            <div className="py-16 text-center">
              <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecciona un reporte para visualizarlo
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{result?.label ?? activeReport.label}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{activeReport.key}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={applyFilters}
                    disabled={loadingReport}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                  >
                    {loadingReport ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Filter className="w-3.5 h-3.5" />
                    )}
                    FILTRAR
                  </button>
                  <button
                    type="button"
                    onClick={handleCsv}
                    disabled={loadingCsv}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                  >
                    {loadingCsv ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 dark:text-slate-300"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    IMPRIMIR
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-2 bg-slate-50 dark:bg-slate-900/40 rounded-xl px-3 py-3">
                <label className="flex-1 min-w-[160px]">
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                    <CalendarRange className="w-3 h-3" /> Desde
                  </span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                  />
                </label>
                <label className="flex-1 min-w-[160px]">
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                    <CalendarRange className="w-3 h-3" /> Hasta
                  </span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                  />
                </label>
                <label className="flex-1 min-w-[160px]">
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                    <Search className="w-3 h-3" /> Estado
                  </span>
                  <input
                    type="text"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    placeholder="estado (opcional, ej: ACTIVE)"
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                  />
                </label>
                {hasItems && (
                  <button
                    type="button"
                    onClick={() => {
                      setFrom('');
                      setTo('');
                      setStatus('');
                      if (activeReport) fetchReport(activeReport, {});
                    }}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Limpiar
                  </button>
                )}
              </div>

              {result && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {result.label} • {intervalText} • {result.pagination.total} registros
                </p>
              )}

              {loadingReport ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                </div>
              ) : reportError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{reportError}</p>
              ) : result && result.data.length === 0 ? (
                <div className="py-16 text-center">
                  <Search className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sin resultados para este reporte</p>
                </div>
              ) : result ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                      <tr>
                        {result.headers.map((h) => (
                          <th key={h} className="py-2.5 px-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {result.data.map((row, i) => (
                        <tr key={i} className="text-slate-700 dark:text-slate-300">
                          {result.headers.map((h) => (
                            <td key={h} className="py-2.5 px-3 align-top">
                              {formatCell(h, row[h])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};