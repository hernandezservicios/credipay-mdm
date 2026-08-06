import React, { useEffect, useState, useCallback } from 'react';
import {
  Wallet,
  Banknote,
  PlusCircle,
  RefreshCw,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import {
  apiGetCash,
  apiOpenCash,
  apiCloseCash,
  apiListCashMovements,
  apiListCashRegisters,
  apiCreateCashMovement,
  errorMessage,
} from '../services/api';
import type { CashCurrent, CashRegisterRow, CashMovementRow } from '../services/api';
import { ModalShell } from './ui/ModalShell';
import { formatCurrencyRD, formatDateTime } from '../utils/formatters';

export interface CashViewProps {
  onNotify?: (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;
}

const money = (n: number | string | null | undefined): string => {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (num === null || num === undefined || Number.isNaN(num)) return formatCurrencyRD(0);
  return formatCurrencyRD(num);
};

const dateShort = (d: string | null | undefined): string => {
  if (!d) return '—';
  return formatDateTime(d);
};

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  INCOME: { label: 'Ingreso', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  EXPENSE: { label: 'Egreso', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  ADJUSTMENT: { label: 'Ajuste', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  COLLECTION: { label: 'Cobro', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  DISBURSEMENT: { label: 'Desembolso', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  OPENING: { label: 'Apertura', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

const labelForType = (type: string) => TYPE_LABEL[type]?.label ?? type;
const labelForMethod = (method: string | null | undefined) =>
  method ? METHOD_LABEL[method] ?? method : '—';

const inputCls =
  'input-field';
const btnPrimary =
  'px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white';
const btnSecondary =
  'px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700';
const thCls =
  'py-3 px-4';
const tableWrap =
  'w-full text-left';

export const CashView: React.FC<CashViewProps> = ({ onNotify }) => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cash, setCash] = useState<CashCurrent | null>(null);
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [registers, setRegisters] = useState<CashRegisterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'open' | 'close' | 'manual' | null>(null);
  const [form, setForm] = useState({
    openingBalance: '',
    countedCash: '',
    closeNotes: '',
    type: 'INCOME',
    amount: '',
    method: 'CASH',
    reference: '',
    description: '',
  });

  const notify = useCallback(
    (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK' = 'INFO') => {
      onNotify?.(text, type);
    },
    [onNotify]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, mv, rg] = await Promise.all([
        apiGetCash(),
        apiListCashMovements({ perPage: 200 }),
        apiListCashRegisters({ perPage: 100 }),
      ]);
      setCash(c.data);
      setMovements(mv.data ?? []);
      setRegisters(rg.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitOpen = async () => {
    const balance = parseFloat(form.openingBalance);
    if (Number.isNaN(balance) || balance < 0) {
      setError('Ingresa un monto de apertura válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiOpenCash(balance);
      notify('✅ Caja abierta', 'INFO');
      setModal(null);
      setForm((f) => ({ ...f, openingBalance: '' }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitClose = async () => {
    const counted = parseFloat(form.countedCash);
    if (Number.isNaN(counted) || counted < 0) {
      setError('Ingresa un monto de caja contado válido.');
      return;
    }
    if (!cash?.current) return;
    setBusy(true);
    setError(null);
    try {
      await apiCloseCash(cash.current.id, counted, form.closeNotes.trim() || undefined);
      notify('✅ Caja cerrada', 'INFO');
      setModal(null);
      setForm((f) => ({ ...f, countedCash: '', closeNotes: '' }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    const amount = parseFloat(form.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiCreateCashMovement({
        type: form.type as 'INCOME' | 'EXPENSE' | 'ADJUSTMENT',
        amount,
        description: form.description.trim() || undefined,
        method: form.method,
        reference: form.reference.trim() || undefined,
      });
      notify('✅ Movimiento registrado', 'INFO');
      setModal(null);
      setForm((f) => ({ ...f, amount: '', method: 'CASH', reference: '', description: '', type: 'INCOME' }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isOpen = cash?.current?.status === 'OPEN';
  const totals = cash?.totals;

  const modalInner = (title: string, children: React.ReactNode, onOk: () => void, okLabel: string) => (
    <ModalShell
      isOpen
      title={title}
      onClose={() => setModal(null)}
      size="md"
      footer={
        <>
          <button onClick={() => setModal(null)} disabled={busy} className={btnSecondary}>
            Cancelar
          </button>
          <button onClick={onOk} disabled={busy} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="inline animate-spin" /> : okLabel}
          </button>
        </>
      }
    >
      {children}
      {error && <p className="text-xs text-rose-500 mt-3">{error}</p>}
    </ModalShell>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
          <Wallet size={18} className="text-emerald-600" />
          Caja
        </div>
        <button onClick={load} disabled={loading || busy} className={btnSecondary}>
          <RefreshCw size={14} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div
            className={`bg-white rounded-2xl border p-6 shadow-xs ${
              isOpen
                ? 'border-emerald-200 dark:border-emerald-800'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {isOpen ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                        CAJA ABIERTA
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        ABIERTA
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {cash?.current?.opened_by_name ?? '—'} · {dateShort(cash?.current?.opened_at)}
                    </p>
                  </div>
                  <button onClick={() => setModal('close')} className={btnPrimary}>
                    Cerrar Caja
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-5">
                  <Stat label="Apertura" value={money(cash?.current?.opening_balance)} />
                  <Stat label="Ingresos" value={money(totals?.cashIn ?? 0)} cls="text-emerald-600" />
                  <Stat label="Egresos" value={money(totals?.cashOut ?? 0)} cls="text-rose-500" />
                  <Stat label="Saldo Esperado" value={money(totals?.expected ?? 0)} cls="text-emerald-600" />
                  <Stat label="Movimientos" value={String(totals?.movementsCount ?? 0)} />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                        CAJA CERRADA
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        CERRADA
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      No hay ninguna caja abierta actualmente.
                    </p>
                  </div>
                  <button
                    onClick={() => setModal('open')}
                    className={btnPrimary}
                  >
                    <Banknote size={14} className="inline mr-1" />
                    Abrir Caja RD$
                  </button>
                </div>
                {totals && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-5">
                    <Stat label="Ingresos" value={money(totals.cashIn)} cls="text-emerald-600" />
                    <Stat label="Egresos" value={money(totals.cashOut)} cls="text-rose-500" />
                    <Stat label="Saldo Esperado" value={money(totals.expected)} cls="text-emerald-600" />
                    <Stat label="Movimientos" value={String(totals.movementsCount)} />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Movimientos</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {movements.length} movimientos registrados
                </p>
              </div>
              <button onClick={() => setModal('manual')} className={btnPrimary}>
                <PlusCircle size={14} className="inline mr-1" />
                REGISTRO MANUAL
              </button>
            </div>
            {!isOpen && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                La caja está cerrada: los movimientos manuales quedarán registrados sin apertura activa.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className={tableWrap}>
                <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                  <tr>
                    <th className={thCls}>Fecha</th>
                    <th className={thCls}>Tipo</th>
                    <th className={thCls}>Dirección</th>
                    <th className={thCls}>Método</th>
                    <th className={thCls}>Monto</th>
                    <th className={thCls}>Referencia</th>
                    <th className={thCls}>Descripción</th>
                    <th className={thCls}>Registrado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Sin movimientos.
                      </td>
                    </tr>
                  ) : (
                    movements.map((m) => {
                      const raw = m.created_at;
                      const created = raw && raw.length >= 19 ? raw.slice(0, 19) : raw;
                      const info = TYPE_LABEL[m.type];
                      const dirIsIn =
                        m.direction === 'IN' ||
                        m.type === 'COLLECTION' ||
                        (m.type === 'ADJUSTMENT' && m.direction === 'IN');
                      const dirIsOut =
                        m.direction === 'OUT' ||
                        m.type === 'DISBURSEMENT' ||
                        (m.type === 'ADJUSTMENT' && m.direction === 'OUT');
                      return (
                        <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{created ?? '—'}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                info?.cls ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {labelForType(m.type)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {dirIsIn ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600">
                                <ArrowDownLeft size={14} /> Entrada
                              </span>
                            ) : dirIsOut ? (
                              <span className="inline-flex items-center gap-1 text-rose-500">
                                <ArrowUpRight size={14} /> Salida
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                            {labelForMethod(m.method)}
                          </td>
                          <td
                            className={`py-3 px-4 font-semibold ${
                              dirIsIn ? 'text-emerald-600' : dirIsOut ? 'text-rose-500' : 'text-slate-700'
                            }`}
                          >
                            {money(m.amount)}
                          </td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{m.reference ?? '—'}</td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{m.description ?? '—'}</td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{m.created_by_name ?? '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Historial de Cajas</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              {registers.length} cierres de caja registrados
            </p>
            <div className="overflow-x-auto">
              <table className={tableWrap}>
                <thead className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
                  <tr>
                    <th className={thCls}>Fecha</th>
                    <th className={thCls}>Estado</th>
                    <th className={thCls}>Apertura</th>
                    <th className={thCls}>Saldo Esperado</th>
                    <th className={thCls}>Contado</th>
                    <th className={thCls}>Diferencia</th>
                    <th className={thCls}>Apertura por</th>
                    <th className={thCls}>Cierre por</th>
                    <th className={thCls}>Movimientos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {registers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Sin historial.
                      </td>
                    </tr>
                  ) : (
                    [...registers]
                      .sort((a, b) => String(a.register_date ?? b.opened_at).localeCompare(String(b.register_date ?? a.opened_at)))
                      .reverse()
                      .map((r) => {
                        const diff = typeof r.difference === 'string' ? parseFloat(r.difference) : null;
                        const diffNum = diff ?? 0;
                        const diffCls =
                          diff === null
                            ? 'text-slate-500 dark:text-slate-400'
                            : diffNum === 0
                            ? 'text-slate-600 dark:text-slate-300'
                            : diffNum > 0
                            ? 'text-emerald-600'
                            : 'text-rose-500';
                        const openedByName = Array.isArray(r.opened_by_name)
                          ? r.opened_by_name.join(', ')
                          : r.opened_by_name ?? '—';
                        return (
                          <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{dateShort(r.register_date)}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  r.status === 'OPEN'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{money(r.opening_balance)}</td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{money(r.expected_closing)}</td>
                            <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{money(r.counted_cash)}</td>
                            <td className={`py-3 px-4 font-semibold ${diffCls}`}>
                              {diff !== null && diffNum > 0 ? '+' : diff !== null && diffNum < 0 ? '−' : ''}
                              {money(Math.abs(diffNum))}
                            </td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{openedByName}</td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{r.closed_by_name ?? '—'}</td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{r.movements_count ?? '—'}</td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modal === 'open' &&
        modalInner(
          'Abrir Caja',
          <>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Monto de apertura (RD$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={form.openingBalance}
              onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
              placeholder="0.00"
            />
          </>,
          submitOpen,
          'Abrir Caja'
        )}

      {modal === 'close' &&
        modalInner(
          'Cerrar Caja',
          <>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Contado en caja (RD$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={form.countedCash}
              onChange={(e) => setForm((f) => ({ ...f, countedCash: e.target.value }))}
              placeholder="0.00"
            />
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">
              Notas (opcional)
            </label>
            <textarea
              className={`${inputCls} resize-y`}
              rows={2}
              value={form.closeNotes}
              onChange={(e) => setForm((f) => ({ ...f, closeNotes: e.target.value }))}
              placeholder="Notas del cierre"
            />
          </>,
          submitClose,
          'Cerrar Caja'
        )}

      {modal === 'manual' &&
        modalInner(
          'Registro Manual',
          <>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Tipo</label>
            <select
              className={inputCls}
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="INCOME">Ingreso</option>
              <option value="EXPENSE">Egreso</option>
              <option value="ADJUSTMENT">Ajuste</option>
            </select>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">Monto (RD$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
            />
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">Método</label>
            <select
              className={inputCls}
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
            >
              <option value="CASH">Efectivo</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="CARD">Tarjeta</option>
              <option value="OTHER">Otro</option>
            </select>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">Referencia</label>
            <input
              className={inputCls}
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="Referencia (opcional)"
            />
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">Descripción</label>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descripción (opcional)"
            />
          </>,
          submitManual,
          'Registrar'
        )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; cls?: string }> = ({ label, value, cls }) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 ${cls ?? ''}`}>{value}</p>
  </div>
);