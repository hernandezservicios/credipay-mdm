import React from 'react';
import {
  Building2,
  CreditCard,
  History,
  Receipt,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { TenantDetailRow } from '../services/api';
import { ModalShell } from './ui/ModalShell';
import { formatDate, formatCurrencyRD } from '../utils/formatters';

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
    EXPIRED: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-800',
    CANCELED: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
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

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center space-x-2">
        <Icon className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-bold text-white">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-800 dark:text-slate-200 font-semibold text-right">{value ?? '—'}</span>
    </div>
  );
}

interface TenantDetailModalProps {
  tenant: TenantDetailRow;
  onClose: () => void;
}

export const TenantDetailModal: React.FC<TenantDetailModalProps> = ({ tenant, onClose }) => {
  const { subscription, settings, admin, history = [], payments = [], auditLogs = [] } = tenant;

  return (
    <ModalShell
      isOpen
      size="xl"
      headerVariant="dark"
      zIndex="z-[70]"
      title={`Detalle — ${tenant.name}`}
      subtitle={`Empresa #${tenant.id} · ${tenant.slug}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={Building2} title="Empresa">
            <Row label="Estado" value={<StatusChip status={tenant.status} />} />
            <Row label="Correo" value={tenant.email} />
            <Row label="Teléfono" value={tenant.phone} />
            <Row label="Dominio" value={tenant.domain} />
            <Row label="Moneda" value={tenant.currency_code} />
            <Row label="Zona horaria" value={tenant.timezone} />
            <Row label="Creada" value={tenant.created_at ? formatDate(tenant.created_at) : null} />
            <Row label="Activada" value={tenant.activated_at ? formatDate(tenant.activated_at) : null} />
            <Row label="Trial hasta" value={tenant.trial_ends_at ? formatDate(tenant.trial_ends_at) : null} />
            {tenant.status === 'SUSPENDED' && (
              <div className="mt-2 px-2.5 py-2 rounded-lg bg-rose-950/40 border border-rose-800 text-[10px] text-rose-300">
                {tenant.suspended_reason ?? 'Sin motivo registrado'}
              </div>
            )}
          </Section>

          <div className="space-y-5">
            <Section icon={CreditCard} title="Suscripción">
              {subscription ? (
                <>
                  <Row label="Plan" value={subscription.plan_name} />
                  <Row label="Ciclo" value={subscription.billing_cycle} />
                  <Row label="Estado" value={<StatusChip status={subscription.status} />} />
                  <Row label="Período" value={
                    subscription.current_period_start
                      ? `${formatDate(subscription.current_period_start)} → ${formatDate(subscription.current_period_end)}`
                      : null
                  } />
                  <Row label="Renovación automática" value={subscription.auto_renew === 1 ? 'Sí' : 'No'} />
                  <Row label="Cancelada" value={subscription.canceled_at ? formatDate(subscription.canceled_at) : null} />
                  <Row label="Finaliza" value={subscription.ends_at ? formatDate(subscription.ends_at) : null} />
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Sin suscripción registrada.</p>
              )}
            </Section>

            <Section icon={User} title="Administrador de la empresa">
              {admin ? (
                <>
                  <Row label="Nombre" value={admin.name} />
                  <Row label="Correo" value={admin.email} />
                  <Row label="Estado" value={<StatusChip status={admin.status} />} />
                  <Row label="Último acceso" value={admin.last_login_at ? formatDate(admin.last_login_at) : null} />
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Sin administrador creado.</p>
              )}
            </Section>
          </div>
        </div>

        {settings && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Section icon={ShieldCheck} title="Ajustes de cobranza">
              <Row label="Días de gracia" value={String(settings.grace_days)} />
              <Row label="Penalidad por mora" value={formatMoney(settings.overdue_penalty, tenant.currency_code)} />
              <Row label="Prefijo recibos" value={settings.receipt_prefix} />
              <Row label="Prefijo facturas" value={settings.invoice_prefix} />
            </Section>
          </div>
        )}

        <Section icon={History} title={`Historial de suscripción (${history.length})`}>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Sin eventos registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3">Evento</th>
                    <th className="py-2 pr-3">Detalle</th>
                    <th className="py-2">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2 pr-3 font-mono text-indigo-300 whitespace-nowrap">{h.event_type}</td>
                      <td className="py-2 pr-3 text-slate-300">{h.description}</td>
                      <td className="py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(h.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={Receipt} title={`Últimos pagos (${payments.length})`}>
            {payments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Sin pagos registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-3">Monto</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Método</th>
                      <th className="py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-3 font-bold text-white whitespace-nowrap">{formatMoney(p.amount, p.currency_code)}</td>
                        <td className="py-2 pr-3">
                          <StatusChip status={p.status} />
                        </td>
                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{p.payment_method ?? '—'}</td>
                        <td className="py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{p.paid_at ? formatDate(p.paid_at) : formatDate(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={ShieldCheck} title={`Auditoría (${auditLogs.length})`}>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Sin eventos de auditoría.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-3">Acción</th>
                      <th className="py-2 pr-3">Entidad</th>
                      <th className="py-2 pr-3">Usuario</th>
                      <th className="py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs">
                    {auditLogs.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 pr-3 font-mono text-indigo-300 whitespace-nowrap">{a.action}</td>
                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {a.entity_type ? `${a.entity_type}:${a.entity_id}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{a.user_name}</td>
                        <td className="py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </ModalShell>
  );
};