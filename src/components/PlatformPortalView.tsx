import React from 'react';
import {
  RefreshCw,
  Building2,
  Crown,
  Users,
  CreditCard,
  Globe2,
  TrendingUp,
  Plus,
  Pencil,
  Power,
  Copy,
  Trash2,
} from 'lucide-react';
import { PlatformAdminView } from './PlatformAdminView';
import { UsersView } from './UsersView';
import type { PlatformTenantRow, PlanRow, BillingCycle } from '../services/api';
import type { PortalTab } from './PlatformSidebar';

const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

const CYCLE_MONTHS: Record<BillingCycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

function formatPrice(value: string | null, code: string | null): string {
  const n = Number(value) || 0;
  const symbol = code === 'USD' ? 'US$' : code === 'DOP' ? 'RD$' : `${code ?? ''} `;
  return `${symbol}${n.toLocaleString('es-DO', { maximumFractionDigits: 2 })}`;
}

interface PlatformPortalViewProps {
  tab: PortalTab;
  tenants: PlatformTenantRow[];
  loading: boolean;
  plans: PlanRow[];
  onReload: () => void;
  onReloadPlans: () => void;
  onEnter: (tenantId: number) => void;
  onEditTenant: (tenantId: number) => void;
  onNewTenant: () => void;
  onNewPlan: () => void;
  onEditPlan: (plan: PlanRow) => void;
  onTogglePlan: (plan: PlanRow) => void;
  onDuplicatePlan: (plan: PlanRow) => void;
  onDeletePlan: (plan: PlanRow) => void;
  onNotify: (text: string, type?: 'INFO' | 'LOCK') => void;
}

function OverviewSection({
  tenants,
  onReload,
}: {
  tenants: PlatformTenantRow[];
  onReload: () => void;
}) {
  const active = tenants.filter((t) => t.subscription_status === 'ACTIVE');
  const trial = tenants.filter((t) => t.subscription_status === 'TRIAL');
  const suspended = tenants.filter((t) => t.tenant_status === 'SUSPENDED');
  const pastDue = tenants.filter((t) => t.subscription_status === 'PAST_DUE');
  const totalClients = tenants.reduce((acc, t) => acc + (t.client_count || 0), 0);
  const totalCredits = tenants.reduce((acc, t) => acc + (t.credit_count || 0), 0);
  const totalDevices = tenants.reduce((acc, t) => acc + (t.device_count || 0), 0);
  const collectedMonth = tenants.reduce((acc, t) => acc + (Number(t.collected_month) || 0), 0);
  const collectedTotal = tenants.reduce((acc, t) => acc + (Number(t.collected_total) || 0), 0);
  const mrr = tenants.reduce((acc, t) => {
    if (!t.price || !t.billing_cycle) return acc;
    if (t.subscription_status !== 'ACTIVE' && t.subscription_status !== 'TRIAL') return acc;
    return acc + (Number(t.price) || 0) / CYCLE_MONTHS[t.billing_cycle];
  }, 0);
  const symbol = tenants[0]?.currency_code === 'USD' ? 'US$' : 'RD$';

  const cards = [
    { label: 'Empresas totales', value: String(tenants.length), icon: Building2, tone: 'bg-indigo-600' },
    { label: 'Con suscripción activa', value: String(active.length), icon: CreditCard, tone: 'bg-emerald-600' },
    { label: 'En prueba (trial)', value: String(trial.length), icon: Globe2, tone: 'bg-amber-600' },
    { label: 'Suspendidas', value: String(suspended.length), icon: Globe2, tone: 'bg-rose-600' },
    { label: 'Clientes en cartera', value: totalClients.toLocaleString('es-DO'), icon: Users, tone: 'bg-sky-600' },
    { label: 'Créditos activos', value: totalCredits.toLocaleString('es-DO'), icon: CreditCard, tone: 'bg-violet-600' },
    { label: 'Dispositivos MDM', value: totalDevices.toLocaleString('es-DO'), icon: Users, tone: 'bg-fuchsia-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Resumen de Plataforma</h2>
          <p className="text-xs text-slate-400">
            Estado global del negocio SaaS multi-tenant (métricas del servidor)
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

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl ${c.tone} text-white flex items-center justify-center shrink-0`}>
              <c.icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-extrabold text-white truncate">{c.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-extrabold text-white truncate">
              {symbol}
              {Math.round(mrr).toLocaleString('es-DO')}/mes
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400">MRR estimado</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-extrabold text-white truncate">
              {symbol}
              {Math.round(collectedMonth).toLocaleString('es-DO')}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400">Cobrado este mes</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-extrabold text-white truncate">
              {symbol}
              {Math.round(collectedTotal).toLocaleString('es-DO')}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400">Cobrado acumulado</div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
            <Globe2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-extrabold text-white truncate">{pastDue.length}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400">Morosas (PAST_DUE)</div>
          </div>
        </div>
      </div>

      {pastDue.length > 0 && (
        <div className="bg-amber-950/50 border border-amber-800 rounded-2xl p-4 text-xs text-amber-200">
          <span className="font-bold">⚠️ {pastDue.length} empresa(s)</span> con pago vencido (PAST_DUE). Revisa la
          sección Empresas para gestionarlas.
        </div>
      )}

      {tenants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          No hay empresas registradas en la plataforma.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-white">Últimas empresas</span>
            <span className="text-[10px] text-slate-400">{tenants.length} en total</span>
          </div>
          <div className="divide-y divide-slate-800">
            {tenants.slice(0, 6).map((t) => (
              <div key={t.tenant_id} className="flex items-center justify-between px-5 py-3 text-xs">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-300 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">{t.slug}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-4 shrink-0">
                  <span className="text-slate-400">
                    {t.plan_name ?? 'Sin plan'} · {t.client_count.toLocaleString('es-DO')} clientes
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      t.tenant_status === 'SUSPENDED'
                        ? 'bg-rose-950 text-rose-400 border-rose-800'
                        : t.subscription_status === 'ACTIVE'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                          : t.subscription_status === 'TRIAL'
                            ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                            : t.subscription_status === 'PAST_DUE'
                              ? 'bg-amber-950 text-amber-400 border-amber-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {t.tenant_status === 'SUSPENDED' ? 'SUSPENDED' : t.subscription_status ?? 'SIN PLAN'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlansSection({
  plans,
  onReload,
  onNewPlan,
  onEditPlan,
  onTogglePlan,
  onDuplicatePlan,
  onDeletePlan,
}: {
  plans: PlanRow[];
  onReload: () => void;
  onNewPlan: () => void;
  onEditPlan: (plan: PlanRow) => void;
  onTogglePlan: (plan: PlanRow) => void;
  onDuplicatePlan: (plan: PlanRow) => void;
  onDeletePlan: (plan: PlanRow) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Planes & Catálogo SaaS</h2>
          <p className="text-xs text-slate-400">
            Catálogo global de planes vendidos en la plataforma
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onNewPlan}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo plan</span>
          </button>
          <button
            onClick={onReload}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">{p.name}</span>
              <span className="text-[10px] font-bold text-indigo-300">
                {CYCLE_LABEL[p.billing_cycle]}
              </span>
            </div>
            <div className="text-2xl font-extrabold text-white mt-1">
              {formatPrice(p.price, p.currency_code)}
              <span className="text-[10px] text-slate-400 font-medium">
                {' '}
                /{CYCLE_LABEL[p.billing_cycle].toLowerCase()}
              </span>
            </div>
            {p.description && <p className="text-[11px] text-slate-400 mt-1">{p.description}</p>}
            <div className="mt-3 space-y-1 text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Clientes</span>
                <span className="font-bold">{p.max_clients === 0 ? '∞' : p.max_clients}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Dispositivos</span>
                <span className="font-bold">{p.max_devices === 0 ? '∞' : p.max_devices}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Usuarios</span>
                <span className="font-bold">{p.max_users === 0 ? '∞' : p.max_users}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Webhooks</span>
                <span className="font-bold">{p.max_webhooks === 0 ? '∞' : p.max_webhooks}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">API rate limit</span>
                <span className="font-bold">
                  {p.api_rate_limit_per_min === 0 ? '∞' : `${p.api_rate_limit_per_min}/min`}
                </span>
              </div>
            </div>
            {p.features.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-1">
                {p.features
                  .filter((f) => f.is_enabled)
                  .slice(0, 5)
                  .map((f) => (
                    <span
                      key={f.feature_key}
                      className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800"
                    >
                      {f.feature_name}
                    </span>
                  ))}
                {p.features.filter((f) => f.is_enabled).length > 5 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                    +{p.features.filter((f) => f.is_enabled).length - 5}
                  </span>
                )}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-2">
              <button
                onClick={() => onEditPlan(p)}
                className="flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-[11px] font-semibold transition-colors"
              >
                <Pencil className="w-3 h-3" />
                <span>Editar</span>
              </button>
              <button
                onClick={() => onTogglePlan(p)}
                className={`flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  p.status === 'ACTIVE'
                    ? 'bg-amber-950/50 text-amber-300 hover:bg-amber-900/50'
                    : 'bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                }`}
              >
                <Power className="w-3 h-3" />
                <span>{p.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}</span>
              </button>
              <button
                onClick={() => onDuplicatePlan(p)}
                className="flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-[11px] font-semibold transition-colors"
              >
                <Copy className="w-3 h-3" />
                <span>Duplicar</span>
              </button>
              <button
                onClick={() => onDeletePlan(p)}
                className="flex items-center justify-center space-x-1 px-2 py-1.5 rounded-lg bg-rose-950/50 text-rose-300 hover:bg-rose-900/50 text-[11px] font-semibold transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
          No hay planes definidos en el catálogo.
        </div>
      )}
    </div>
  );
}

export const PlatformPortalView: React.FC<PlatformPortalViewProps> = ({
  tab,
  tenants,
  loading,
  plans,
  onReload,
  onReloadPlans,
  onEnter,
  onEditTenant,
  onNewTenant,
  onNewPlan,
  onEditPlan,
  onTogglePlan,
  onDuplicatePlan,
  onDeletePlan,
  onNotify,
}) => {
  if (tab === 'OVERVIEW') {
    return <OverviewSection tenants={tenants} onReload={onReload} />;
  }
  if (tab === 'PLANS') {
    return (
      <PlansSection
        plans={plans}
        onReload={onReloadPlans}
        onNewPlan={onNewPlan}
        onEditPlan={onEditPlan}
        onTogglePlan={onTogglePlan}
        onDuplicatePlan={onDuplicatePlan}
        onDeletePlan={onDeletePlan}
      />
    );
  }
  if (tab === 'USERS') {
    return <UsersView tenants={tenants} onNotify={onNotify} />;
  }
  return (
    <PlatformAdminView
      tenants={tenants}
      loading={loading}
      plans={plans}
      onReload={onReload}
      onEnter={onEnter}
      onEditTenant={onEditTenant}
      onNewTenant={onNewTenant}
      onNotify={onNotify}
    />
  );
};
