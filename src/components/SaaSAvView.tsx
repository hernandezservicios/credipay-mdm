import React, { useState } from 'react';
import {
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Crown,
  Users,
  Smartphone,
  FileText,
  Layers,
  ShieldCheck,
  Repeat,
} from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { formatCurrencyRD, formatDateTime } from '../utils/formatters';
import type {
  BillingPaymentRow,
  BillingCycle,
  GatewayRow,
  PlanRow,
  SubscriptionRow,
  SubscriptionUsage,
} from '../services/api';

const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

function formatPrice(price: string, code: string): string {
  const n = Number(price) || 0;
  const symbol = code === 'USD' ? 'US$' : code === 'DOP' ? 'RD$' : `${code} `;
  return formatCurrencyRD(n, true, symbol);
}

function formatDate(value: string | null | undefined): string {
  return formatDateTime(value);
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    TRIAL: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    PAST_DUE: 'bg-amber-100 text-amber-700 border-amber-200',
    SUSPENDED: 'bg-rose-100 text-rose-700 border-rose-200',
    CANCELED: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    EXPIRED: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    PAID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    REFUNDED: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
        map[status] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

interface MeterProps {
  label: string;
  used: number;
  max: number;
  icon: React.ReactNode;
}

function Meter({ label, used, max, icon }: MeterProps) {
  const unlimited = max <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100));
  return (
    <div className="bg-white rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <span className="w-7 h-7 rounded-lg bg-slate-900 text-indigo-300 flex items-center justify-center">
            {icon}
          </span>
          {label}
        </div>
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {used.toLocaleString('es-DO')}
          <span className="text-slate-400"> / </span>
          {unlimited ? '∞' : max.toLocaleString('es-DO')}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-rose-50 dark:bg-rose-500/100' : pct >= 70 ? 'bg-amber-50 dark:bg-amber-500/100' : 'bg-emerald-50 dark:bg-emerald-500/100'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface SaaSAvViewProps {
  subscription: SubscriptionRow | null;
  usage: SubscriptionUsage;
  plans: PlanRow[];
  payments: BillingPaymentRow[];
  gateways: GatewayRow[];
  preferredGateway: string | null;
  permits: { manage: boolean; renew: boolean };
  onChangePlan: (planId: number) => void;
  onRenew: () => void;
  onSetGateway: (code: string | null) => void;
}

export const SaaSAvView: React.FC<SaaSAvViewProps> = ({
  subscription: plan,
  usage,
  plans,
  payments,
  gateways,
  preferredGateway,
  permits,
  onChangePlan,
  onRenew,
  onSetGateway,
}) => {
  const confirmDialog = useConfirm();
  const [showPlans, setShowPlans] = useState(false);

  const handleRequestChange = (target: PlanRow) => {
    if (!plan || target.id === plan.plan_id) return;
    confirmDialog({
      title: 'Cambiar Plan de Suscripción',
      message: `¿Deseas cambiar a "${target.name}" (${CYCLE_LABEL[target.billing_cycle]}) por ${formatPrice(
        target.price,
        target.currency_code
      )} por período?\n\nEl período actual se mantendrá vigente hasta su vencimiento.`,
      confirmLabel: 'Sí, Cambiar Plan',
      cancelLabel: 'Cancelar',
      tone: 'indigo',
    }).then((ok) => {
      if (ok) onChangePlan(target.id);
    });
  };

  const handleRenew = () => {
    if (!plan) return;
    confirmDialog({
      title: 'Renovar Suscripción',
      message:
        'Se registrará un pago de renovación (simulado) y se extenderá el período actual de la suscripción.\n\n¿Continuar?',
      confirmLabel: 'Sí, Renovar',
      cancelLabel: 'Cancelar',
      tone: 'emerald',
    }).then((ok) => {
      if (ok) onRenew();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Suscripción & Planes CrediPay MDM</h2>
          <p className="text-xs text-slate-400">
            Plan activo, uso vs límites, facturación y pasarelas de pago
          </p>
        </div>
        {plan && permits.renew && (
          <button
            onClick={handleRenew}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            <Repeat className="w-4 h-4" />
            <span>Renovar / Registrar Pago</span>
          </button>
        )}
      </div>

      {/* Plan activo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        {plan ? (
          <div className="relative grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-xl font-extrabold text-white">{plan.plan_name}</h3>
                    <StatusChip status={plan.status} />
                  </div>
                  <p className="text-xs text-slate-400">{plan.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-center">
                <div className="bg-slate-800/80 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Precio</div>
                  <div className="text-base font-extrabold text-white mt-1">
                    {formatPrice(plan.price, plan.currency_code)}
                    <span className="text-[10px] text-slate-400 font-medium">
                      {' '}
                      /{CYCLE_LABEL[plan.billing_cycle].toLowerCase()}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    setup {Number(plan.setup_fee) > 0 ? formatPrice(plan.setup_fee, plan.currency_code) : formatCurrencyRD(0)}
                  </div>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Ciclo</div>
                  <div className="text-base font-extrabold text-white mt-1">
                    {CYCLE_LABEL[plan.billing_cycle]}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    renovación {plan.auto_renew ? 'automática' : 'manual'}
                  </div>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Inicio</div>
                  <div className="text-sm font-bold text-white mt-1">
                    {formatDate(plan.current_period_start)}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">vigente</div>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Vence</div>
                  <div className="text-sm font-bold text-white mt-1">
                    {formatDate(plan.current_period_end)}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">fin de período</div>
                </div>
              </div>

              {permits.manage && (
                <button
                  onClick={() => setShowPlans((s) => !s)}
                  className="mt-4 inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-indigo-600/50 bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900 text-xs font-semibold transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Cambiar de Plan</span>
                </button>
              )}
            </div>

            <div className="bg-slate-800/60 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Características
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              {plans
                .find((p) => p.id === plan.plan_id)
                ?.features.slice(0, 8)
                .map((f) => (
                  <div
                    key={f.feature_key}
                    className="flex items-center space-x-2 py-1.5 text-xs text-slate-300"
                  >
                    {f.is_enabled ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                    )}
                    <span>{f.feature_name}</span>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-400 text-sm">
            Sin suscripción activa para esta empresa.
          </div>
        )}
      </div>

      {/* Límites / uso */}
      {plan && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Uso actual vs Límites del Plan</h3>
            <span className="text-[10px] text-slate-400">∞ = ilimitado</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Meter label="Clientes" used={usage.clients} max={plan.max_clients} icon={<Users className="w-3.5 h-3.5" />} />
            <Meter label="Créditos" used={usage.credits} max={plan.max_credits} icon={<FileText className="w-3.5 h-3.5" />} />
            <Meter label="Dispositivos" used={usage.devices} max={plan.max_devices} icon={<Smartphone className="w-3.5 h-3.5" />} />
            <Meter label="Usuarios" used={usage.users} max={plan.max_users} icon={<Users className="w-3.5 h-3.5" />} />
          </div>
        </div>
      )}

      {/* Selector de planes (colapsable) */}
      {showPlans && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-white">Elige un nuevo plan</span>
            <button
              onClick={() => setShowPlans(false)}
              className="text-[11px] text-slate-400 hover:text-white"
            >
              Cerrar
            </button>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = plan?.plan_id === p.id;
              const fits =
                !plan ||
                ((p.max_clients === 0 || usage.clients <= p.max_clients) &&
                  (p.max_credits === 0 || usage.credits <= p.max_credits) &&
                  (p.max_devices === 0 || usage.devices <= p.max_devices) &&
                  (p.max_users === 0 || usage.users <= p.max_users));
              return (
                <div
                  key={p.id}
                  className={`bg-slate-800/70 rounded-xl border p-4 ${
                    isCurrent ? 'border-indigo-500/60' : 'border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{p.name}</span>
                    <span className="text-[10px] font-bold text-indigo-300">
                      {CYCLE_LABEL[p.billing_cycle]}
                    </span>
                  </div>
                  <div className="text-2xl font-extrabold text-white mt-1">
                    {formatPrice(p.price, p.currency_code)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {p.max_clients === 0 ? '∞' : p.max_clients} clientes ·{' '}
                    {p.max_devices === 0 ? '∞' : p.max_devices} dispositivos ·{' '}
                    {p.max_users === 0 ? '∞' : p.max_users} usuarios
                  </div>
                  <button
                    onClick={() => handleRequestChange(p)}
                    disabled={isCurrent || !permits.manage}
                    className={`mt-3 w-full py-2 rounded-lg text-xs font-bold transition-colors ${
                      isCurrent
                        ? 'bg-slate-700 text-slate-300 cursor-default'
                        : fits
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isCurrent
                      ? 'Plan actual'
                      : fits
                        ? `Cambiar a ${p.name}`
                        : 'Uso supera límites'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pasarelas */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center space-x-2 mb-3">
            <CreditCard className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Pasarela de Pago</h3>
          </div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Método preferido para renovaciones
          </label>
          <select
            value={preferredGateway ?? ''}
            onChange={(e) => onSetGateway(e.target.value || null)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Sin pasarela configurada</option>
            {gateways.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1.5">
            {preferredGateway
              ? `Los pagos de renovación se procesarán con ${preferredGateway}.`
              : 'Selecciona la pasarela que usará esta empresa.'}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center space-x-2 mb-3">
            <Layers className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Historial de Pagos</h3>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {payments.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Sin pagos registrados aún.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-1.5 pr-2">Ref</th>
                    <th className="py-1.5 pr-2">Concepto</th>
                    <th className="py-1.5 pr-2">Monto</th>
                    <th className="py-1.5 pr-2">Fecha</th>
                    <th className="py-1.5">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 10).map((p) => (
                    <tr key={p.id} className="border-b border-slate-50">
                      <td className="py-2 pr-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {p.reference ?? `#${p.id}`}
                      </td>
                      <td className="py-2 pr-2 text-slate-600 dark:text-slate-400 max-w-[180px] truncate">
                        {p.description ?? p.plan_name ?? 'Pago de suscripción'}
                      </td>
                      <td className="py-2 pr-2 font-bold text-slate-800 dark:text-slate-100">{formatCurrencyRD(Number(p.amount))}</td>
                      <td className="py-2 pr-2 text-slate-500 dark:text-slate-400">{formatDate(p.paid_at ?? p.created_at)}</td>
                      <td className="py-2">
                        <StatusChip status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};