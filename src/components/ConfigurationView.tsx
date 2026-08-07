import React, { useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  Settings2,
  Building2,
  SlidersHorizontal,
  Percent,
  Wallet,
  Plug,
  PackagePlus,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Save,
  Database,
} from 'lucide-react';
import {
  ApiError,
  errorMessage,
  apiGetConfig,
  apiUpdateConfigSection,
  apiListLoanProducts,
  apiCreateLoanProduct,
  apiPatchLoanProduct,
  apiDeleteLoanProduct,
  apiGetIntegrationLog,
  type PlatformConfig,
  type LoanProductRow,
} from '../services/api';
import { ModalShell } from './ui/ModalShell';
import { useConfirm } from './ConfirmDialog';
import { setMoneyConfig } from '../utils/formatters';
import { setOverdueConfig } from '../utils/overdue';

export interface ConfigurationViewProps {
  onNotify?: (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;
  permits?: { edit: boolean };
}

type SectionKey =
  | 'companyInfo'
  | 'generalConfig'
  | 'loanConfig'
  | 'overdueConfig'
  | 'paymentConfig'
  | 'integrations'
  | 'products';

const CONFIG_SECTIONS: SectionKey[] = [
  'companyInfo',
  'generalConfig',
  'loanConfig',
  'overdueConfig',
  'paymentConfig',
];

const TABS: { id: SectionKey; label: string }[] = [
  { id: 'companyInfo', label: 'Empresa' },
  { id: 'generalConfig', label: 'Sistema' },
  { id: 'loanConfig', label: 'Préstamos' },
  { id: 'overdueConfig', label: 'Mora' },
  { id: 'paymentConfig', label: 'Pagos' },
  { id: 'integrations', label: 'Integraciones' },
  { id: 'products', label: 'Productos' },
];

const TAB_ICONS: Record<SectionKey, ReactNode> = {
  companyInfo: <Building2 className="w-4 h-4" />,
  generalConfig: <Settings2 className="w-4 h-4" />,
  loanConfig: <Percent className="w-4 h-4" />,
  overdueConfig: <SlidersHorizontal className="w-4 h-4" />,
  paymentConfig: <Wallet className="w-4 h-4" />,
  integrations: <Plug className="w-4 h-4" />,
  products: <Database className="w-4 h-4" />,
};

const OVERDUE_DEFAULTS: Record<string, unknown> = {
  type: 'FIXED',
  fixed_amount: 0,
  percentage_base: 'BALANCE',
  percentage_rate: 0,
  grace_days: 3,
  frequency: 'MONTHLY',
  max_amount: 0,
  cap_percent: 0,
};

const AMORT_METHODS = [
  'FRENCH',
  'CUOTA_NIVELADA',
  'FLAT',
  'SIMPLE',
  'SALDO_INSOLUTO',
  'COMPOUND',
];

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function buildSectionForm(
  cfg: PlatformConfig | null,
  section: SectionKey
): { form: Record<string, unknown>; numKeys: string[] } {
  const base: Record<string, unknown> = { ...(cfg ? cfg[section] ?? {} : {}) };
  if (section === 'overdueConfig') {
    Object.entries(OVERDUE_DEFAULTS).forEach(([k, v]) => {
      if (!(k in base)) base[k] = v;
    });
  }
  const form: Record<string, unknown> = {};
  const numKeys: string[] = [];
  Object.keys(base).forEach((k) => {
    const v = base[k];
    if (typeof v === 'string' || typeof v === 'number') {
      form[k] = v;
      if (typeof v === 'number') numKeys.push(k);
    }
  });
  return { form, numKeys };
}

const EMPTY_PRODUCT_FORM: Record<string, unknown> = {
  name: '',
  description: '',
  amortization_method: 'FRENCH',
  annual_rate: '',
  min_amount: '',
  max_amount: '',
  min_terms: '',
  max_terms: '',
  default_terms: '',
  is_default: false,
  is_active: true,
};

export const ConfigurationView: React.FC<ConfigurationViewProps> = ({ onNotify, permits }) => {
  const confirm = useConfirm();
  const canEdit = permits?.edit !== false;
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [products, setProducts] = useState<LoanProductRow[]>([]);
  const [log, setLog] = useState<unknown[]>([]);
  const [activeSection, setActiveSection] = useState<SectionKey>('companyInfo');
  const [forms, setForms] = useState<Record<string, Record<string, unknown>>>({});
  const [numKeys, setNumKeys] = useState<Record<string, string[]>>({});
  const [newFieldName, setNewFieldName] = useState('');
  const [savingProducts, setSavingProducts] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [productForm, setProductForm] = useState<Record<string, unknown>>({});

  const rebuildForms = useCallback((cfg: PlatformConfig | null) => {
    const f: Record<string, Record<string, unknown>> = {};
    const nk: Record<string, string[]> = {};
    CONFIG_SECTIONS.forEach((s) => {
      const r = buildSectionForm(cfg, s);
      f[s] = r.form;
      nk[s] = r.numKeys;
    });
    setForms(f);
    setNumKeys(nk);
  }, []);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
    try {
      const [cfgRes, prdRes, logRes] = await Promise.all([
        apiGetConfig(),
        apiListLoanProducts(),
        apiGetIntegrationLog(),
      ]);
      setConfig(cfgRes.data);
      setProducts(prdRes.data);
      setLog(logRes.data);
      rebuildForms(cfgRes.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setAccessDenied(true);
      } else {
        onNotify?.(errorMessage(err), 'INFO');
      }
    } finally {
      setLoading(false);
    }
  }, [onNotify, rebuildForms]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  const reloadProducts = useCallback(async () => {
    const prdRes = await apiListLoanProducts();
    setProducts(prdRes.data);
  }, []);

  const handleSaveSection = async (sec: SectionKey) => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const raw = forms[sec] ?? {};
      const nk = numKeys[sec] ?? [];
      const body: Record<string, unknown> = {};
      Object.keys(raw).forEach((k) => {
        const v = raw[k];
        if (nk.includes(k) && typeof v === 'string') {
          const n = Number(v);
          body[k] = v.trim() === '' ? 0 : Number.isNaN(n) ? v : n;
        } else {
          body[k] = v;
        }
      });
      const res = await apiUpdateConfigSection(sec, body);
      setConfig(res.data);
      setOverdueConfig(res.data.overdueConfig);
      const c = res.data.currency;
      setMoneyConfig({
        code: String(c.code ?? 'DOP'),
        symbol: String(c.symbol ?? 'RD$'),
        decimals: Number(c.decimals ?? 2),
        thousandSeparator: String(c.thousand_separator ?? ','),
        decimalSeparator: String(c.decimal_separator ?? '.'),
      });
      rebuildForms(res.data);
      onNotify?.(`✅ Configuración de ${TABS.find((t) => t.id === sec)?.label ?? sec} guardada`, 'INFO');
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    const sec = activeSection as SectionKey;
    setForms((prev) => {
      const cur = prev[sec] ?? {};
      if (name in cur) return prev;
      return { ...prev, [sec]: { ...cur, [name]: '' } };
    });
    setNewFieldName('');
  };

  const handleFieldChange = (sec: SectionKey, key: string, value: string) => {
    setForms((prev) => ({ ...prev, [sec]: { ...prev[sec], [key]: value } }));
  };

  const openProductModal = () => {
    setEditingId(null);
    setProductForm({ ...EMPTY_PRODUCT_FORM });
    setProductModal(true);
  };

  const openEditModal = (p: LoanProductRow) => {
    setEditingId(p.id);
    setProductForm({
      name: p.name,
      description: p.description ?? '',
      amortization_method: p.amortization_method,
      annual_rate: p.annual_rate ?? '',
      min_amount: p.min_amount ?? '',
      max_amount: p.max_amount ?? '',
      min_terms: String(p.min_terms),
      max_terms: String(p.max_terms),
      default_terms: String(p.default_terms),
      is_default: Boolean(p.is_default),
      is_active: Boolean(p.is_active),
    });
    setProductModal(true);
  };

  const handleProductField = (key: string, value: string | boolean) => {
    setProductForm((prev) => ({ ...prev, [key]: value }));
  };

  const buildProductBody = (): Record<string, unknown> => {
    const f = productForm;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isNaN(n) ? 0 : n;
    };
    return {
      name: String(f.name ?? ''),
      description: String(f.description ?? ''),
      amortization_method: String(f.amortization_method ?? 'FRENCH'),
      annual_rate: num(f.annual_rate),
      min_amount: String(f.min_amount).trim() === '' ? null : num(f.min_amount),
      max_amount: String(f.max_amount).trim() === '' ? null : num(f.max_amount),
      min_terms: num(f.min_terms),
      max_terms: num(f.max_terms),
      default_terms: num(f.default_terms),
      is_default: Boolean(f.is_default),
      is_active: Boolean(f.is_active),
    };
  };

  const handleSaveProduct = async () => {
    if (!canEdit || savingProducts) return;
    setSavingProducts(true);
    try {
      if (editingId === null) {
        await apiCreateLoanProduct(buildProductBody());
        onNotify?.('✅ Producto creado', 'INFO');
      } else {
        await apiPatchLoanProduct(editingId, buildProductBody());
        onNotify?.('✅ Producto actualizado', 'INFO');
      }
      setProductModal(false);
      await reloadProducts();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setSavingProducts(false);
    }
  };

  const handleDeleteProduct = async (p: LoanProductRow) => {
    if (!canEdit) return;
    if (!(await confirm({ title: 'Eliminar producto', message: `¿Eliminar el producto "${p.name}"?`, tone: 'rose', confirmLabel: 'Eliminar' }))) return;
    try {
      await apiDeleteLoanProduct(p.id);
      onNotify?.('✅ Producto eliminado', 'INFO');
      await reloadProducts();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    }
  };

  const isSecretKey = (k: string) => /token|secret|key|password/i.test(k);

  const fmtValue = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const logRows = (Array.isArray(log) ? log : []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)
  );
  const logCols = Array.from(new Set(logRows.flatMap((r) => Object.keys(r)))).slice(0, 8);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Permiso insuficiente</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            No tienes permisos para acceder a la configuración de la plataforma.
          </p>
        </div>
      </div>
    );
  }

  const formCard = (sec: SectionKey) => {
    const form = forms[sec] ?? {};
    const nk = numKeys[sec] ?? [];
    const tab = TABS.find((t) => t.id === sec);
    return (
      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{tab?.label}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Configuración general de {tab?.label.toLowerCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleSaveSection(sec)}
            disabled={!canEdit || saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.keys(form).map((k) => {
            const isNum = nk.includes(k);
            return (
              <div key={k}>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  {humanize(k)}
                </label>
                <input
                  type={isNum ? 'number' : 'text'}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                  value={String(form[k] ?? '')}
                  onChange={(e) => handleFieldChange(sec, k, e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full disabled:opacity-60"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
              Agregar campo
            </label>
            <input
              type="text"
              disabled={!canEdit}
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              placeholder="nombre_del_campo"
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full disabled:opacity-60"
            />
          </div>
          <button
            type="button"
            onClick={handleAddField}
            disabled={!canEdit}
            className="px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar
          </button>
        </div>
      </div>
    );
  };

  const integrationsCard = () => {
    const integrations = config?.integrations ?? [];
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Integraciones</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Conexiones externas registradas en la plataforma.
          </p>
          {integrations.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">
              No hay integraciones configuradas. Use el modal MDM/API InovaGuard del menú lateral.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {integrations.map((it, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4"
                >
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
                    {String(it.name ?? it.code ?? `Integración ${idx + 1}`)}
                  </h3>
                  <dl className="space-y-1.5">
                    {Object.keys(it).map((k) => (
                      <div key={k} className="flex justify-between gap-3 text-xs">
                        <dt className="text-slate-500 dark:text-slate-400">{humanize(k)}</dt>
                        <dd className="text-slate-700 dark:text-slate-200 font-mono max-w-[60%] text-right break-all">
                          {isSecretKey(k) ? '••••••••' : fmtValue(it[k])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Bitácora de integración</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Últimas operaciones realizadas contra los servicios externos.
          </p>
          {logRows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin registros en la bitácora.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                    <tr>
                      {logCols.map((c) => (
                        <th key={c} className="py-2.5 px-3">{humanize(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {logRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:bg-slate-500/10 dark:hover:bg-slate-800/40">
                        {logCols.map((c) => (
                          <td key={c} className="py-2.5 px-3 text-slate-700 dark:text-slate-200 align-top">
                            {fmtValue(r[c]).slice(0, 120)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const productsCard = () => {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Productos de préstamo</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Métodos de amortización y montos disponibles.
            </p>
          </div>
          <button
            type="button"
            onClick={openProductModal}
            disabled={!canEdit}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PackagePlus className="w-3.5 h-3.5" />
            NUEVO PRODUCTO
          </button>
        </div>
        {products.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No hay productos registrados.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="py-2.5 px-3">Nombre</th>
                  <th className="py-2.5 px-3">Método</th>
                  <th className="py-2.5 px-3">Tasa %</th>
                  <th className="py-2.5 px-3">Monto mín</th>
                  <th className="py-2.5 px-3">Monto máx</th>
                  <th className="py-2.5 px-3">Plazos</th>
                  <th className="py-2.5 px-3">Default</th>
                  <th className="py-2.5 px-3">Activo</th>
                  <th className="py-2.5 px-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:bg-slate-500/10 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">{p.name}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{p.amortization_method}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{p.annual_rate}%</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{p.min_amount ?? '—'}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{p.max_amount ?? '—'}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                      {p.min_terms}–{p.max_terms}
                    </td>
                    <td className="py-2.5 px-3">
                      {p.is_default ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          DEFAULT
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {p.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                          ACTIVO
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          INACTIVO
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          disabled={!canEdit}
                          className="px-2 py-1 rounded-md text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:bg-indigo-500/10 dark:hover:bg-indigo-50 dark:bg-indigo-500/100/10 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p)}
                          disabled={!canEdit}
                          className="px-2 py-1 rounded-md text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:bg-rose-500/10 dark:hover:bg-rose-50 dark:bg-rose-500/100/10 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3 h-3" />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Configuración</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Preferencias de empresa, sistema, préstamos, mora, pagos e integraciones.
          </p>
        </div>
        <button
          type="button"
          onClick={reloadAll}
          className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Recargar
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = activeSection === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveSection(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {TAB_ICONS[t.id]}
              {t.label}
            </button>
          );
        })}
      </div>

      {activeSection === 'companyInfo' && formCard('companyInfo')}
      {activeSection === 'generalConfig' && formCard('generalConfig')}
      {activeSection === 'loanConfig' && formCard('loanConfig')}
      {activeSection === 'overdueConfig' && formCard('overdueConfig')}
      {activeSection === 'paymentConfig' && formCard('paymentConfig')}
      {activeSection === 'integrations' && integrationsCard()}
      {activeSection === 'products' && productsCard()}

      {productModal && (
        <ModalShell
          isOpen
          title={editingId === null ? 'Nuevo producto' : 'Editar producto'}
          onClose={() => setProductModal(false)}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProductModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProduct}
                disabled={savingProducts}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingProducts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingId === null ? 'Crear' : 'Guardar cambios'}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Nombre
                </label>
                <input
                  type="text"
                  value={String(productForm.name ?? '')}
                  onChange={(e) => handleProductField('name', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Descripción
                </label>
                <textarea
                  value={String(productForm.description ?? '')}
                  onChange={(e) => handleProductField('description', e.target.value)}
                  rows={2}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full resize-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Método de amortización
                </label>
                <select
                  value={String(productForm.amortization_method ?? 'FRENCH')}
                  onChange={(e) => handleProductField('amortization_method', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                >
                  {AMORT_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Tasa anual %
                </label>
                <input
                  type="number"
                  step="any"
                  value={String(productForm.annual_rate ?? '')}
                  onChange={(e) => handleProductField('annual_rate', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Monto mínimo
                </label>
                <input
                  type="number"
                  step="any"
                  value={String(productForm.min_amount ?? '')}
                  onChange={(e) => handleProductField('min_amount', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Monto máximo
                </label>
                <input
                  type="number"
                  step="any"
                  value={String(productForm.max_amount ?? '')}
                  onChange={(e) => handleProductField('max_amount', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Plazo mínimo
                </label>
                <input
                  type="number"
                  value={String(productForm.min_terms ?? '')}
                  onChange={(e) => handleProductField('min_terms', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Plazo máximo
                </label>
                <input
                  type="number"
                  value={String(productForm.max_terms ?? '')}
                  onChange={(e) => handleProductField('max_terms', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Plazo por defecto
                </label>
                <input type="number" value={String(productForm.default_terms ?? '')} onChange={(e) => handleProductField('default_terms', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm w-full" />
              </div>
              <div className="flex flex-col justify-end gap-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(productForm.is_default)}
                    disabled={editingId !== null}
                    onChange={(e) => handleProductField('is_default', e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                  />
                  Producto por defecto
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(productForm.is_active)}
                    onChange={(e) => handleProductField('is_active', e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Activo
                </label>
              </div>
            </div>
        </ModalShell>
      )}
    </div>
  );
};