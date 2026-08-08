import React, { useState } from 'react';
import {
  Building2,
  ArrowRight,
  RefreshCw,
  Pencil,
  Ban,
  RotateCcw,
  Repeat,
  Trash2,
  Loader2,
  AlertTriangle,
  CalendarClock,
  CreditCard,
  Plus,
  Info,
} from 'lucide-react';
import {
  apiChangePlan,
  apiDeleteTenant,
  apiExtendSubscription,
  apiGetTenantDetail,
  apiRenewSubscription,
  apiReactivateTenant,
  apiSuspendTenant,
  errorMessage,
  type PlanRow,
  type PlatformTenantRow,
  type TenantDetailRow,
} from '../services/api';
import { useConfirm } from './ConfirmDialog';
import { ModalShell } from './ui/ModalShell';
import { TenantDetailModal } from './TenantDetailModal';
import { formatDate, formatCurrencyRD } from '../utils/formatters';

const CYCLE_LABEL: Record<string, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

function formatMoney(value: string | number | null | undefined, code: string | null): string {
  const n = Number(value) || 0;
  const symbol = code === 'USD' ? 'US$' : code === 'DOP' ? 'RD$' : `${code ?? ''} `;
  return formatCurrencyRD(n, true, symbol);
}

function StatusChip({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800',
    TRIAL: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-400 dark:border-indigo-800',
    PAST_DUE: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800',
    SUSPENDED: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-800',
    PENDING: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  };
  const value = status ?? 'SIN PLAN';
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
        map[value] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
      }`}
    >
      {value.replace('_', ' ')}
    </span>
  );
}

interface PlatformAdminViewProps {
  tenants: PlatformTenantRow[];
  loading: boolean;
  plans: PlanRow[];
  onReload: () => void;
  onEnter: (tenantId: number) => void;
  onEditTenant: (tenantId: number) => void;
  onNewTenant: () => void;
  onNotify: (text: string, type?: 'INFO' | 'LOCK') => void;
}

export const PlatformAdminView: React.FC<PlatformAdminViewProps> = ({
  tenants,
  loading,
  plans,
  onReload,
  onEnter,
  onEditTenant,
  onNewTenant,
  onNotify,
}) => {
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [changePlanFor, setChangePlanFor] = useState<PlatformTenantRow | null>(null);
  const [suspendFor, setSuspendFor] = useState<PlatformTenantRow | null>(null);
  const [extendFor, setExtendFor] = useState<PlatformTenantRow | null>(null);
  const [newPlanId, setNewPlanId] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [extendDays, setExtendDays] = useState('30');
  const [working, setWorking] = useState(false);
  const [detailTenant, setDetailTenant] = useState<TenantDetailRow | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);

  const openDetail = async (tenantId: number) => {
    setDetailLoadingId(tenantId);
    try {
      const res = await apiGetTenantDetail(tenantId);
      setDetailTenant(res.data);
    } catch (err) {
      onNotify(`❌ No se pudo cargar el detalle: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setDetailLoadingId(null);
    }
  };

  const doChangePlan = async (t: PlatformTenantRow) => {
    const pid = Number(newPlanId);
    if (!Number.isInteger(pid) || pid <= 0) return;
    const ok = await confirm({
      title: `Cambiar plan de "${t.name}"`,
      message: `¿Asignar el plan seleccionado a ${t.name}? Se respetarán los límites del nuevo plan.`,
      tone: 'indigo',
      confirmLabel: 'Cambiar plan',
    });
    if (!ok) return;
    setWorking(true);
    try {
      const res = await apiChangePlan(pid, t.tenant_id);
      onNotify(`✅ Plan actualizado a "${res.data.planName}".`);
      setChangePlanFor(null);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo cambiar el plan: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setWorking(false);
    }
  };

  const doSuspend = async (t: PlatformTenantRow) => {
    setWorking(true);
    try {
      await apiSuspendTenant(t.tenant_id, suspendReason || undefined);
      onNotify(`⛔ Empresa "${t.name}" suspendida.`);
      setSuspendFor(null);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo suspender: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setWorking(false);
    }
  };

  const doReactivate = async (t: PlatformTenantRow) => {
    const ok = await confirm({
      title: `Reactivar "${t.name}"`,
      message: 'La empresa volverá a estar activa y su suscripción reanudada.',
      tone: 'emerald',
      confirmLabel: 'Reactivar',
    });
    if (!ok) return;
    setBusyId(t.tenant_id);
    try {
      await apiReactivateTenant(t.tenant_id);
      onNotify(`✅ Empresa "${t.name}" reactivada.`);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo reactivar: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const doRenew = async (t: PlatformTenantRow) => {
    const ok = await confirm({
      title: `Renovar suscripción de "${t.name}"`,
      message: `Se registrará un pago simulado de ${formatMoney(t.price, t.currency_code)} y el período se extenderá un ciclo ${t.billing_cycle ? CYCLE_LABEL[t.billing_cycle].toLowerCase() : ''}.`,
      tone: 'emerald',
      confirmLabel: 'Renovar',
    });
    if (!ok) return;
    setBusyId(t.tenant_id);
    try {
      const res = await apiRenewSubscription(t.tenant_id);
      onNotify(`✅ Renovado hasta ${formatDate(res.data.periodEnd)}.`);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo renovar: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const doExtend = async (t: PlatformTenantRow) => {
    const days = Number(extendDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) return;
    setWorking(true);
    try {
      const res = await apiExtendSubscription(days, t.tenant_id);
      onNotify(`✅ Período extendido hasta ${formatDate(res.data.periodEnd)}.`);
      setExtendFor(null);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo extender: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setWorking(false);
    }
  };

  const doDelete = async (t: PlatformTenantRow) => {
    const ok = await confirm({
      title: `Eliminar "${t.name}"`,
      message: `Se eliminará la empresa (soft delete), se cancelará su suscripción y se cerrarán sus sesiones. Los datos quedan marcados como eliminados en la BD.`,
      tone: 'rose',
      confirmLabel: 'Eliminar empresa',
    });
    if (!ok) return;
    setBusyId(t.tenant_id);
    try {
      await apiDeleteTenant(t.tenant_id);
      onNotify(`🗑️ Empresa "${t.name}" eliminada.`);
      onReload();
    } catch (err) {
      onNotify(`❌ No se pudo eliminar: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setBusyId(null);
    }
  };

  const canEnter = (t: PlatformTenantRow) =>
    (t.tenant_status === 'ACTIVE' || t.tenant_status === 'TRIAL') &&
    (!t.subscription_status ||
      t.subscription_status === 'TRIAL' ||
      t.subscription_status === 'ACTIVE' ||
      t.subscription_status === 'PAST_DUE');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Panel Comercial — Empresas & Suscripciones</h2>
          <p className="text-xs text-slate-400">
            Vista global del Super Administrador: empresas, planes activos y renovaciones
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onNewTenant}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nueva empresa</span>
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
              className={`bg-slate-900 border rounded-2xl p-5 flex flex-col ${
                t.tenant_status === 'SUSPENDED'
                  ? 'border-rose-800'
                  : t.tenant_status === 'PENDING'
                    ? 'border-amber-800'
                    : 'border-slate-800'
              }`}
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
                <StatusChip status={t.tenant_status === 'SUSPENDED' ? 'SUSPENDED' : t.subscription_status ?? t.tenant_status} />
              </div>

              {t.tenant_status === 'SUSPENDED' && t.suspended_reason && (
                <div className="mt-3 flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-rose-950/40 border border-rose-800 text-[10px] text-rose-300">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{t.suspended_reason}</span>
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.client_count.toLocaleString('es-DO')}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Clientes</div>
                </div>
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.credit_count?.toLocaleString('es-DO') ?? 0}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Créditos</div>
                </div>
                <div className="bg-slate-800/70 rounded-lg py-2">
                  <div className="text-sm font-extrabold text-white">{t.device_count?.toLocaleString('es-DO') ?? 0}</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Dispositivos</div>
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
                    {t.price ? formatMoney(t.price, t.currency_code) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Período</span>
                  <span className="text-slate-300">
                    {t.current_period_start ? `${formatDate(t.current_period_start)} → ${formatDate(t.current_period_end)}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Cobrado este mes</span>
                  <span className="font-bold text-emerald-300">{formatMoney(t.collected_month, t.currency_code)}</span>
                </div>
                {(Number(t.overdue_installments) || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Cuotas atrasadas</span>
                    <span className="font-bold text-amber-300">{t.overdue_installments}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => onEditTenant(t.tenant_id)}
                  className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Editar</span>
                </button>
                {t.tenant_status === 'SUSPENDED' ? (
                  <button
                    onClick={() => void doReactivate(t)}
                    disabled={busyId === t.tenant_id}
                    className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white text-[11px] font-bold transition-colors disabled:opacity-60"
                  >
                    {busyId === t.tenant_id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3 h-3" />
                    )}
                    <span>Reactivar</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSuspendReason('');
                      setSuspendFor(t);
                    }}
                    className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-rose-950/60 border border-rose-800 hover:bg-rose-900/60 text-rose-300 text-[11px] font-bold transition-colors"
                  >
                    <Ban className="w-3 h-3" />
                    <span>Suspender</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setNewPlanId(t.plan_slug ? '' : '');
                    setChangePlanFor(t);
                  }}
                  className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
                >
                  <Repeat className="w-3 h-3" />
                  <span>Cambiar plan</span>
                </button>
                <button
                  onClick={() => {
                    setExtendDays('30');
                    setExtendFor(t);
                  }}
                  className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
                >
                  <CalendarClock className="w-3 h-3" />
                  <span>Extender</span>
                </button>
                <button
                  onClick={() => void doRenew(t)}
                  disabled={busyId === t.tenant_id || !t.subscription_id}
                  className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-emerald-950/60 border border-emerald-800 hover:bg-emerald-900/60 text-emerald-300 text-[11px] font-bold transition-colors disabled:opacity-50"
                >
                  {busyId === t.tenant_id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CreditCard className="w-3 h-3" />
                  )}
                  <span>Renovar</span>
                </button>
                <button
                  onClick={() => void doDelete(t)}
                  disabled={busyId === t.tenant_id}
                  className="flex items-center justify-center space-x-1 px-2 py-2 rounded-lg bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 text-[11px] font-semibold transition-colors disabled:opacity-60"
                >
                  {busyId === t.tenant_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  <span>Eliminar</span>
                </button>
              </div>

              <button
                onClick={() => void openDetail(t.tenant_id)}
                disabled={detailLoadingId === t.tenant_id}
                className="mt-2 flex items-center justify-center space-x-1.5 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors disabled:opacity-50"
              >
                {detailLoadingId === t.tenant_id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Info className="w-3.5 h-3.5" />
                )}
                <span>Ver detalles</span>
              </button>

              <button
                onClick={() => canEnter(t) && onEnter(t.tenant_id)}
                disabled={!canEnter(t)}
                className="mt-2 flex items-center justify-center space-x-1.5 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={canEnter(t) ? 'Entrar a la empresa' : 'No se puede entrar: empresa no activa o suscripción vencida'}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Entrar a la empresa</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {changePlanFor && (
        <ModalShell isOpen size="md" headerVariant="dark" zIndex="z-[70]" title={`Cambiar plan — ${changePlanFor.name}`} onClose={() => setChangePlanFor(null)}>
          <select
            value={newPlanId}
            onChange={(e) => setNewPlanId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-200 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Selecciona un plan...</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {CYCLE_LABEL[p.billing_cycle]} · {formatMoney(p.price, p.currency_code)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setChangePlanFor(null)} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => void doChangePlan(changePlanFor)}
              disabled={working || !newPlanId}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Asignar plan</span>
            </button>
          </div>
        </ModalShell>
      )}

      {suspendFor && (
        <ModalShell isOpen size="md" headerVariant="dark" zIndex="z-[70]" title={`Suspender — ${suspendFor.name}`} onClose={() => setSuspendFor(null)}>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Se bloqueará el acceso de la empresa, se cerrarán sus sesiones y su suscripción pasará a SUSPENDED.
          </p>
          <textarea
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Motivo de la suspensión (opcional)..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-200 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setSuspendFor(null)} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => void doSuspend(suspendFor)}
              disabled={working}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/20 dark:bg-rose-500/100 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Suspender empresa</span>
            </button>
          </div>
        </ModalShell>
      )}

      {extendFor && (
        <ModalShell isOpen size="md" headerVariant="dark" zIndex="z-[70]" title={`Extender período — ${extendFor.name}`} onClose={() => setExtendFor(null)}>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              className="w-28 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-200 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-400">días adicionales (1–365)</span>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setExtendFor(null)} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => void doExtend(extendFor)}
              disabled={working}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Extender</span>
            </button>
          </div>
        </ModalShell>
      )}

      {detailTenant && <TenantDetailModal tenant={detailTenant} onClose={() => setDetailTenant(null)} />}
    </div>
  );
};
