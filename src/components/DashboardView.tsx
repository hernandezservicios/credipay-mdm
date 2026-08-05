import React, { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  Smartphone,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import { apiDashboardSummary, errorMessage, type DashboardSummary } from '../services/api';

export interface DashboardViewProps {
  onNotify?: (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;
}

type CardKind = 'money' | 'count' | 'percent';

interface CardMeta {
  label: string;
  kind: CardKind;
  icon: React.ReactNode;
  accent: string;
  iconBg: string;
  text: string;
}

const CARD_LABELS: Record<string, CardMeta> = {
  carteraTotal: { label: 'Cartera Total', kind: 'money', icon: <Wallet size={16} />, accent: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
  prestadoTotal: { label: 'Total Prestado', kind: 'money', icon: <TrendingUp size={16} />, accent: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400', text: 'text-indigo-600 dark:text-indigo-400' },
  recaudadoTotal: { label: 'Total Recaudado', kind: 'money', icon: <TrendingDown size={16} />, accent: 'text-sky-600 dark:text-sky-400', iconBg: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  mesActual: { label: 'Desembolsado Mes Actual', kind: 'money', icon: <Wallet size={16} />, accent: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  cobradoHoy: { label: 'Cobrado Hoy', kind: 'money', icon: <TrendingUp size={16} />, accent: 'text-teal-600 dark:text-teal-400', iconBg: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400', text: 'text-teal-600 dark:text-teal-400' },
  desembolsadoHoy: { label: 'Desembolsado Hoy', kind: 'money', icon: <TrendingDown size={16} />, accent: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400', text: 'text-violet-600 dark:text-violet-400' },
  creditosActivos: { label: 'Créditos Activos', kind: 'count', icon: <Wallet size={16} />, accent: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
  cuotasVencidas: { label: 'Cuotas Vencidas', kind: 'count', icon: <AlertTriangle size={16} />, accent: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  cuotasAtrasadas: { label: 'Cuotas Atrasadas', kind: 'count', icon: <AlertTriangle size={16} />, accent: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400', text: 'text-rose-600 dark:text-rose-400' },
  moraTotal: { label: 'Total Mora Aplicada', kind: 'money', icon: <AlertTriangle size={16} />, accent: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400', text: 'text-rose-600 dark:text-rose-400' },
  clientes: { label: 'Clientes', kind: 'count', icon: <Users size={16} />, accent: 'text-slate-600 dark:text-slate-300', iconBg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', text: 'text-slate-600 dark:text-slate-100' },
  clientesAtrasados: { label: 'Clientes Atrasados', kind: 'count', icon: <Users size={16} />, accent: 'text-orange-600 dark:text-orange-400', iconBg: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
  dispositivos: { label: 'Dispositivos', kind: 'count', icon: <Smartphone size={16} />, accent: 'text-sky-600 dark:text-sky-400', iconBg: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  dispositivosBloqueados: { label: 'Dispositivos Bloqueados', kind: 'count', icon: <Smartphone size={16} />, accent: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400', text: 'text-rose-600 dark:text-rose-400' },
  porCobrar: { label: 'Por Cobrar', kind: 'money', icon: <Wallet size={16} />, accent: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400', text: 'text-indigo-600 dark:text-indigo-400' },
  efectividad: { label: 'Efectividad de Cobro', kind: 'percent', icon: <TrendingUp size={16} />, accent: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
};

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activos',
  PENDING: 'Pendientes',
  APPROVED: 'Aprobados',
  DEFAULTED: 'En Mora',
  PAID_OFF: 'Pagados',
  REJECTED: 'Rechazados',
  CANCELED: 'Cancelados',
  REFINANCED: 'Refinanciados',
  RESTRUCTURED: 'Reestructurados',
};

const STATUS_BADGES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  APPROVED: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  DEFAULTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  PAID_OFF: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  CANCELED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  REFINANCED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400',
  RESTRUCTURED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  DEPOSITO: 'Depósito',
};

const CLASS_BADGES: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  B: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  C: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  D: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
};

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMoney(n: number): string {
  return 'RD$ ' + Number(n).toLocaleString('es-DO', { maximumFractionDigits: 2 });
}

function monthShort(month: string): string {
  const parts = month.split('-');
  if (parts.length < 2) return month;
  const idx = Number(parts[1]) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return month;
  return MONTH_SHORT[idx];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNotify }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiDashboardSummary();
      setSummary(res.data);
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      onNotify?.(msg, 'INFO');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const entries = summary ? Object.entries(summary.cards) : [];
  const knownKeys = Object.keys(CARD_LABELS);
  const sortedEntries = [...entries].sort((a, b) => {
    return knownKeys.indexOf(a[0]) - knownKeys.indexOf(b[0]);
  });

  const chartMax = summary
    ? Math.max(2, ...summary.series.flatMap((s) => [Number(s.recaudado) || 0, Number(s.desembolsado) || 0]))
    : 2;

  const methodMax = summary
    ? Math.max(1, ...summary.porMetodo.map((m) => Number(m.total) || 0))
    : 1;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Dashboard</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Resumen general de la operación</p>
          </div>
          <button
            onClick={load}
            disabled
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-2"
          >
            <Loader2 size={14} className="animate-spin" />
            Actualizar
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Dashboard</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Resumen general de la operación</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-xl p-4 text-sm text-rose-700 dark:text-rose-300 inline-flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {sortedEntries.map(([key, value]) => {
          const meta = CARD_LABELS[key] ?? {
            label: titleCase(key),
            kind: 'count' as CardKind,
            icon: <LayoutDashboard size={16} />,
            accent: 'text-slate-600 dark:text-slate-300',
            iconBg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            text: 'text-slate-600 dark:text-slate-100',
          };
          const n = Number(value) || 0;
          const display =
            meta.kind === 'money'
              ? formatMoney(n)
              : meta.kind === 'percent'
                ? `${n.toFixed(1)}%`
                : Number(n).toLocaleString('es-DO', { maximumFractionDigits: 0 });
          return (
            <div
              key={key}
              className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs"
            >
              <div className="flex items-center justify-between mb-4">
                <span className={`text-xs font-semibold ${meta.accent}`}>{meta.label}</span>
                <span className={`p-2 rounded-lg ${meta.iconBg}`}>{meta.icon}</span>
              </div>
              <div className={`text-2xl font-bold ${meta.text}`}>{display}</div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Movimiento de los últimos 12 meses</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Recaudado y desembolsado por mes</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-500"></span>
              Recaudado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-indigo-500"></span>
              Desembolsado
            </span>
          </div>
        </div>
        <div className="flex items-end gap-2 h-48">
          {summary?.series.map((s) => {
            const rec = Number(s.recaudado) || 0;
            const des = Number(s.desembolsado) || 0;
            const recPct = Math.max(2, (rec / chartMax) * 100);
            const desPct = Math.max(2, (des / chartMax) * 100);
            return (
              <div key={s.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="flex items-end justify-center gap-1 w-full h-40">
                  <div
                    className="w-3 md:w-4 rounded-t bg-emerald-500"
                    style={{ height: `${recPct}%` }}
                    title={`${monthShort(s.month)} — Recaudado: ${formatMoney(rec)}`}
                  ></div>
                  <div
                    className="w-3 md:w-4 rounded-t bg-indigo-500"
                    style={{ height: `${desPct}%` }}
                    title={`${monthShort(s.month)} — Desembolsado: ${formatMoney(des)}`}
                  ></div>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-full">
                  {monthShort(s.month)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Estado de Créditos</h3>
          <div className="flex flex-wrap gap-2">
            {summary?.porEstado.map((e) => {
              const label = STATUS_LABELS[e.status] ?? e.status;
              const badge =
                STATUS_BADGES[e.status] ??
                'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
              return (
                <span
                  key={e.status}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${badge}`}
                >
                  {label}
                  <span className="rounded-full bg-white/70 dark:bg-black/20 px-1.5">
                    {Number(e.count).toLocaleString('es-DO')}
                  </span>
                </span>
              );
            })}
            {(!summary || summary.porEstado.length === 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Sin datos</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Recaudación por Método</h3>
          <div className="space-y-3">
            {summary?.porMetodo.map((m) => {
              const label = METHOD_LABELS[m.method] ?? m.method;
              const total = Number(m.total) || 0;
              const pct = (total / methodMax) * 100;
              return (
                <div key={m.method} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">{label}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoney(total)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
            {(!summary || summary.porMetodo.length === 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Sin datos</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Créditos por Clasificación</h3>
          <div className="space-y-2">
            {summary?.porClasificacion.map((c) => {
              const cls = c.classification.toUpperCase();
              const badge =
                CLASS_BADGES[cls] ??
                'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
              return (
                <div
                  key={c.classification}
                  className="flex items-center justify-between text-sm"
                >
                  <span
                    className={`w-7 h-7 rounded-lg inline-flex items-center justify-center text-xs font-bold ${badge}`}
                  >
                    {cls}
                  </span>
                  <span className="text-left flex-1 ml-3 text-slate-600 dark:text-slate-300">
                    Clasificación {cls || 'Sin clasificar'}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {Number(c.count).toLocaleString('es-DO')}
                  </span>
                </div>
              );
            })}
            {(!summary || summary.porClasificacion.length === 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Sin datos</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Bitácora de Actas</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Movimientos recientes</p>
          </div>
          <ClipboardList size={16} className="text-slate-400" />
        </div>
        {summary && summary.actas.length > 0 ? (
          <div className="overflow-auto max-h-72 rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="py-3 px-4">Fecha &amp; Hora</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Mensaje</th>
                  <th className="py-3 px-4">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {summary.actas.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {new Date(a.created_at).toLocaleString('es-DO')}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {a.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{a.message}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{a.user}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">Sin movimientos en la bitácora</p>
        )}
      </div>
    </div>
  );
};