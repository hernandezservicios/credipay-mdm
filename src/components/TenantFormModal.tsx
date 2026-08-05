import React, { useEffect, useState } from 'react';
import { Building2, AlertCircle, Loader2 } from 'lucide-react';
import {
  apiCreateTenant,
  apiUpdateTenant,
  errorMessage,
  type BillingCycle,
  type PlanRow,
  type TenantDetailRow,
} from '../services/api';
import { ModalShell } from './ui/ModalShell';

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

interface TenantFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  tenant: TenantDetailRow | null;
  plans: PlanRow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const TenantFormModal: React.FC<TenantFormModalProps> = ({
  isOpen,
  mode,
  tenant,
  plans,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [domain, setDomain] = useState('');
  const [currency, setCurrency] = useState('DOP');
  const [status, setStatus] = useState('ACTIVE');
  const [planId, setPlanId] = useState('');
  const [periodMonths, setPeriodMonths] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [devPassword, setDevPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setDevPassword(null);
    if (mode === 'edit' && tenant) {
      setName(tenant.name);
      setSlug(tenant.slug);
      setEmail(tenant.email ?? '');
      setPhone(tenant.phone ?? '');
      setDomain(tenant.domain ?? '');
      setCurrency(tenant.currency_code);
      setStatus(tenant.status);
      setPlanId('');
      setPeriodMonths('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
    } else {
      setName('');
      setSlug('');
      setEmail('');
      setPhone('');
      setDomain('');
      setCurrency('DOP');
      setStatus('ACTIVE');
      setPlanId(plans.length === 1 ? String(plans[0].id) : '');
      setPeriodMonths('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
    }
  }, [isOpen, mode, tenant, plans]);

  if (!isOpen) return null;

  const handlePeriodHint = () => {
    const pid = Number(planId);
    const plan = plans.find((p) => p.id === pid);
    return plan ? CYCLE_MONTHS[plan.billing_cycle] : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDevPassword(null);
    if (!name.trim()) {
      setError('El nombre de la empresa es obligatorio');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const res = await apiCreateTenant({
          name: name.trim(),
          slug: slug.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          domain: domain.trim() || undefined,
          currency_code: currency,
          status,
          planId: planId ? Number(planId) : undefined,
          periodMonths: periodMonths ? Number(periodMonths) : undefined,
          adminName: adminName.trim() || undefined,
          adminEmail: adminEmail.trim() || undefined,
          adminPassword: adminPassword || undefined,
        });
        if (res.dev_password) {
          setDevPassword(res.dev_password);
        }
        onSaved(`✅ Empresa "${res.data.name}" creada (${res.data.slug}).`);
        if (!res.dev_password) onClose();
      } else if (tenant) {
        await apiUpdateTenant(tenant.id, {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          domain: domain.trim() || undefined,
          currency_code: currency,
          status,
        });
        onSaved(`✅ Empresa "${name.trim()}" actualizada.`);
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const selectedPlan = plans.find((p) => p.id === Number(planId));

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      zIndex="z-[70]"
      headerVariant="dark"
      title={
        <span className="flex items-center space-x-2">
          <Building2 className="w-4 h-4 text-indigo-300" />
          <span>{mode === 'create' ? 'Crear empresa' : `Editar "${tenant?.name ?? ''}"`}</span>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {devPassword && (
            <div className="px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
              <p className="font-bold mb-1">Contraseña temporal del administrador (dev):</p>
              <code className="font-mono text-sm">{devPassword}</code>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Nombre de la empresa *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Financiera El Progreso"
              className="input-field bg-slate-100 dark:bg-slate-800"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Slug (URL)
              </label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="Auto-generado"
                className="input-field bg-slate-100 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Estado
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input-field bg-slate-100 dark:bg-slate-800"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="TRIAL">TRIAL</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Correo de la empresa
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contacto@empresa.com"
                className="input-field bg-slate-100 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Teléfono
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 809-000-0000"
                className="input-field bg-slate-100 dark:bg-slate-800"
              />
            </div>
          </div>

          {mode === 'edit' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Dominio
                </label>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="empresa.com"
                  className="input-field bg-slate-100 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Moneda
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input-field bg-slate-100 dark:bg-slate-800"
                >
                  <option value="DOP">DOP (RD$)</option>
                  <option value="USD">USD (US$)</option>
                </select>
              </div>
            </div>
          )}

          {mode === 'create' && (
            <>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Suscripción inicial
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Plan
                    </label>
                    <select
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value)}
                      className="input-field bg-slate-100 dark:bg-slate-800"
                    >
                      <option value="">Sin plan</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {CYCLE_LABEL[p.billing_cycle]} · {p.price} {p.currency_code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Período (meses)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={periodMonths}
                      onChange={(e) => setPeriodMonths(e.target.value)}
                      placeholder={handlePeriodHint() ? `${handlePeriodHint()} (ciclo)` : 'Por ciclo'}
                      className="input-field bg-slate-100 dark:bg-slate-800"
                    />
                  </div>
                </div>
                {selectedPlan && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Ciclo {CYCLE_LABEL[selectedPlan.billing_cycle].toLowerCase()} ·{' '}
                    {selectedPlan.max_clients === 0 ? '∞' : selectedPlan.max_clients} clientes ·{' '}
                    {selectedPlan.max_users === 0 ? '∞' : selectedPlan.max_users} usuarios
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Administrador inicial (opcional)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Nombre
                    </label>
                    <input
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="Nombre del admin"
                      className="input-field bg-slate-100 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Correo
                    </label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@empresa.com"
                      className="input-field bg-slate-100 dark:bg-slate-800"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Contraseña (mín. 8; si se omite se genera)
                  </label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Dejar vacío para generar"
                    className="input-field bg-slate-100 dark:bg-slate-800"
                  />
                </div>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white text-xs font-bold shadow-md shadow-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 flex items-center space-x-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{mode === 'create' ? 'Crear empresa' : 'Guardar cambios'}</span>
            </button>
          </div>
        </form>
    </ModalShell>
  );
};
