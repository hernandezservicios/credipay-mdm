import React from 'react';
import { Building2, ArrowRight, RefreshCw } from 'lucide-react';
import type { PlatformTenantRow } from '../services/api';

const CYCLE_LABEL: Record<string, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusChip({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    TRIAL: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    PAST_DUE: 'bg-amber-100 text-amber-700 border-amber-200',
    SUSPENDED: 'bg-rose-100 text-rose-700 border-rose-200',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
        status ? (map[status] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700') : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
      }`}
    >
      {status ? status.replace('_', ' ') : 'SIN PLAN'}
    </span>
  );
}

interface PlatformAdminViewProps {
  tenants: PlatformTenantRow[];
  loading: boolean;
  onReload: () => void;
  onEnter: (tenantId: number) => void;
}

export const PlatformAdminView: React.FC<PlatformAdminViewProps> = ({
  tenants,
  loading,
  onReload,
  onEnter,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Panel Comercial — Empresas & Suscripciones</h2>
          <p className="text-xs text-slate-400">
            Vista global del Super Administrador: empresas, planes activos y renovaciones
          </p>
        </div>
        <button
          onClick={onReload}
          className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualizar</span>
        </button>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          Cargando empresas y suscripciones...
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          No hay empresas registradas en la plataforma.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tenants.map((t) => (
            <div
              key={t.tenant_id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{t.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{t.slug}</div>
                  </div>
                </div>
                <StatusChip status={t.subscription_status ?? t.tenant_status} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.client_count.toLocaleString('es-DO')}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Clientes</div>
                </div>
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.max_devices === 0 ? '∞' : t.max_devices}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Dispositivos</div>
                </div>
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.max_users === 0 ? '∞' : t.max_users}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Usuarios</div>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Plan</span>
                  <span className="font-bold text-white">
                    {t.plan_name ?? 'Sin plan'} {t.billing_cycle ? `· ${CYCLE_LABEL[t.billing_cycle] ?? ''}` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Precio</span>
                  <span className="font-bold text-white">
                    {t.price ? `${t.currency_code} ${Number(t.price).toLocaleString('es-DO', { maximumFractionDigits: 2 })}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Período</span>
                  <span className="text-slate-300">
                    {t.current_period_start ? `${formatDate(t.current_period_start)} → ${formatDate(t.current_period_end)}` : '—'}
                  </span>
                </div>
              </div>

              <button
                onClick={() => onEnter(t.tenant_id)}
                className="mt-4 flex items-center justify-center space-x-1.5 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Entrar a la empresa</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};