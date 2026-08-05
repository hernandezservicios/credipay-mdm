import React, { useEffect, useState } from 'react';
import { X, Crown, AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  apiCreatePlan,
  apiUpdatePlan,
  errorMessage,
  type BillingCycle,
  type PlanRow,
} from '../services/api';

const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

interface FeatureDraft {
  feature_key: string;
  feature_name: string;
  feature_value: string;
  is_enabled: number;
}

interface PlanFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  plan: PlanRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const PlanFormModal: React.FC<PlanFormModalProps> = ({
  isOpen,
  mode,
  plan,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [price, setPrice] = useState('0');
  const [setupFee, setSetupFee] = useState('0');
  const [currency, setCurrency] = useState('DOP');
  const [maxUsers, setMaxUsers] = useState('1');
  const [maxClients, setMaxClients] = useState('0');
  const [maxCredits, setMaxCredits] = useState('0');
  const [maxDevices, setMaxDevices] = useState('0');
  const [storageMb, setStorageMb] = useState('0');
  const [rateLimit, setRateLimit] = useState('30');
  const [maxWebhooks, setMaxWebhooks] = useState('0');
  const [features, setFeatures] = useState<FeatureDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (mode === 'edit' && plan) {
      setName(plan.name);
      setSlug(plan.slug);
      setDescription(plan.description ?? '');
      setCycle(plan.billing_cycle);
      setPrice(plan.price);
      setSetupFee(plan.setup_fee);
      setCurrency(plan.currency_code);
      setMaxUsers(String(plan.max_users));
      setMaxClients(String(plan.max_clients));
      setMaxCredits(String(plan.max_credits));
      setMaxDevices(String(plan.max_devices));
      setStorageMb(String(plan.storage_mb));
      setRateLimit(String(plan.api_rate_limit_per_min));
      setMaxWebhooks(String(plan.max_webhooks));
      setFeatures(
        plan.features.map((f) => ({
          feature_key: f.feature_key,
          feature_name: f.feature_name,
          feature_value: f.feature_value ?? '',
          is_enabled: f.is_enabled,
        }))
      );
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setCycle('MONTHLY');
      setPrice('0');
      setSetupFee('0');
      setCurrency('DOP');
      setMaxUsers('1');
      setMaxClients('0');
      setMaxCredits('0');
      setMaxDevices('0');
      setStorageMb('0');
      setRateLimit('30');
      setMaxWebhooks('0');
      setFeatures([]);
    }
  }, [isOpen, mode, plan]);

  if (!isOpen) return null;

  const addFeature = () => {
    setFeatures((prev) => [...prev, { feature_key: '', feature_name: '', feature_value: '', is_enabled: 1 }]);
  };

  const updateFeature = (index: number, patch: Partial<FeatureDraft>) => {
    setFeatures((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFeature = (index: number) => {
    setFeatures((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('El nombre del plan es obligatorio');
      return;
    }
    const body = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      billing_cycle: cycle,
      price: Number(price) || 0,
      setup_fee: Number(setupFee) || 0,
      currency_code: currency,
      max_users: Number(maxUsers) || 0,
      max_clients: Number(maxClients) || 0,
      max_credits: Number(maxCredits) || 0,
      max_devices: Number(maxDevices) || 0,
      storage_mb: Number(storageMb) || 0,
      api_rate_limit_per_min: Number(rateLimit) || 0,
      max_webhooks: Number(maxWebhooks) || 0,
      features: features
        .filter((f) => f.feature_key.trim())
        .map((f) => ({
          feature_key: f.feature_key.trim(),
          feature_name: f.feature_name.trim() || f.feature_key.trim(),
          feature_value: f.feature_value || null,
          is_enabled: f.is_enabled,
        })),
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        const res = await apiCreatePlan(body);
        onSaved(`✅ Plan "${res.data.name}" creado.`);
      } else if (plan) {
        await apiUpdatePlan(plan.id, body);
        onSaved(`✅ Plan "${name.trim()}" actualizado.`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="bg-slate-900 px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
            <Crown className="w-4 h-4 text-amber-300" />
            <span>{mode === 'create' ? 'Crear plan' : `Editar "${plan?.name ?? ''}"`}</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Profesional" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Slug</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Auto-generado" className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Descripción</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve descripción del plan" className={inputCls} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Ciclo</label>
              <select value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)} className={inputCls}>
                {(Object.keys(CYCLE_LABEL) as BillingCycle[]).map((c) => (
                  <option key={c} value={c}>{CYCLE_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Precio</label>
              <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cuota inicial</label>
              <input type="number" min={0} step="0.01" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Moneda</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                <option value="DOP">DOP (RD$)</option>
                <option value="USD">USD (US$)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Usuarios (0 = ∞)</label>
              <input type="number" min={0} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Clientes (0 = ∞)</label>
              <input type="number" min={0} value={maxClients} onChange={(e) => setMaxClients(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Créditos (0 = ∞)</label>
              <input type="number" min={0} value={maxCredits} onChange={(e) => setMaxCredits(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Dispositivos (0 = ∞)</label>
              <input type="number" min={0} value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Storage (MB)</label>
              <input type="number" min={0} value={storageMb} onChange={(e) => setStorageMb(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>API rate limit (/min)</label>
              <input type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Webhooks</label>
              <input type="number" min={0} value={maxWebhooks} onChange={(e) => setMaxWebhooks(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Características
              </span>
              <button
                type="button"
                onClick={addFeature}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Añadir</span>
              </button>
            </div>
            {features.length === 0 && (
              <p className="text-[11px] text-slate-400">Sin características. Usa "Añadir" para crear una.</p>
            )}
            <div className="space-y-2">
              {features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={f.feature_key}
                    onChange={(e) => updateFeature(i, { feature_key: e.target.value })}
                    placeholder="clave (ej: sms_notifications)"
                    className={`${inputCls} flex-1`}
                  />
                  <input
                    value={f.feature_name}
                    onChange={(e) => updateFeature(i, { feature_name: e.target.value })}
                    placeholder="Nombre"
                    className={`${inputCls} flex-1`}
                  />
                  <select
                    value={f.is_enabled}
                    onChange={(e) => updateFeature(i, { is_enabled: Number(e.target.value) })}
                    className={`${inputCls} w-24`}
                  >
                    <option value={1}>Sí</option>
                    <option value={0}>No</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeFeature(i)}
                    className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors"
                    aria-label="Eliminar característica"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

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
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 flex items-center space-x-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{mode === 'create' ? 'Crear plan' : 'Guardar cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
