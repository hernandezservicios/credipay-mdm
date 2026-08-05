import React, { useEffect, useMemo, useState } from 'react';
import { ClientCredit, Installment } from '../types';
import {
  Banknote,
  Wallet,
  ShieldCheck,
  CheckCircle2,
  HandCoins,
  Layers,
} from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { ModalShell } from './ui/ModalShell';

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'DEPOSITO';

export interface CascadeAffected {
  installment: Installment;
  applied: number;
  becamePaid: boolean;
  remainingAfter: number;
}

export interface CascadePaymentPayload {
  clientId: string;
  clientName: string;
  amountApplied: number;
  received: number;
  change: number;
  method: PaymentMethod;
  bank: string;
  affected: CascadeAffected[];
}

/**
 * Distribución en CASCADA: cubre la primera cuota pendiente (por número),
 * el excedente fluye a la siguiente y así sucesivamente.
 */
export function computeCascadePayment(
  client: ClientCredit,
  monto: number
): CascadeAffected[] {
  const pending = client.installments
    .filter((i) => i.status !== 'PAGADO')
    .sort((a, b) => a.number - b.number);

  let restante = Math.max(0, monto);
  const affected: CascadeAffected[] = [];

  for (const inst of pending) {
    if (restante <= 0) break;
    const remaining = Math.max(0, inst.totalAmount - (inst.paidAmount || 0));
    const applied = Math.min(remaining, restante);
    restante -= applied;
    const newPaid = (inst.paidAmount || 0) + applied;
    affected.push({
      installment: inst,
      applied,
      becamePaid: newPaid >= inst.totalAmount,
      remainingAfter: Math.max(0, inst.totalAmount - newPaid),
    });
  }

  return affected;
}

const BANKS = [
  'Banco Popular Dominicano',
  'Banreservas (RD$)',
  'Banco BHD',
  'Caja Tienda Principal',
];

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'EFECTIVO', label: 'Efectivo (Caja / Tienda)' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'TARJETA', label: 'Tarjeta Débito/Crédito' },
  { id: 'DEPOSITO', label: 'Depósito Bancario' },
];

interface PaymentModalProps {
  clients: ClientCredit[];
  client: ClientCredit | null;
  initialInstallmentId?: string;
  onClose: () => void;
  onConfirm: (payload: CascadePaymentPayload) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  clients,
  client,
  initialInstallmentId,
  onClose,
  onConfirm,
}) => {
  const confirmDialog = useConfirm();
  const [selectedClientId, setSelectedClientId] = useState<string>(client?.id || '');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [bank, setBank] = useState<string>(BANKS[0]);
  const [montoStr, setMontoStr] = useState<string>('');
  const [receivedStr, setReceivedStr] = useState<string>('');
  const [success, setSuccess] = useState<CascadePaymentPayload | null>(null);

  const target = clients.find((c) => c.id === selectedClientId) || null;

  const pendingInstallments = useMemo(() => {
    if (!target) return [];
    return target.installments
      .filter((i) => i.status !== 'PAGADO')
      .sort((a, b) => a.number - b.number);
  }, [target]);

  // Monto de referencia: la próxima cuota a cubrir (la preseleccionada o la primera pendiente)
  const nextAmount = useMemo(() => {
    if (!target || pendingInstallments.length === 0) return 0;
    const preferred = initialInstallmentId
      ? target.installments.find(
          (i) => i.id === initialInstallmentId && i.status !== 'PAGADO'
        )
      : undefined;
    const start = preferred || pendingInstallments[0];
    if (!start) return 0;
    return Math.max(0, start.totalAmount - (start.paidAmount || 0));
  }, [target, pendingInstallments, initialInstallmentId]);

  // Pre-rellenar el monto con la próxima cuota al elegir cliente
  useEffect(() => {
    if (target && montoStr === '' && nextAmount > 0) {
      setMontoStr(String(nextAmount));
    }
  }, [target, nextAmount, montoStr]);

  const monto = parseFloat(montoStr) || 0;
  const received = parseFloat(receivedStr) || 0;
  const isEfectivo = method === 'EFECTIVO';
  const change = isEfectivo ? Math.max(0, received - monto) : 0;
  const receivedShort = isEfectivo && monto > 0 && received < monto;

  const affected = target ? computeCascadePayment(target, monto) : [];
  const amountApplied = affected.reduce((s, a) => s + a.applied, 0);
  const fullyPaid = affected.filter((a) => a.becamePaid);
  const abonos = affected.filter((a) => !a.becamePaid);

  const canConfirm =
    !!target && monto > 0 && affected.length > 0 && (!isEfectivo || received >= monto);

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
    setMontoStr('');
    setReceivedStr('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !canConfirm) return;

    const ok = await confirmDialog({
      icon: <Banknote className="w-5 h-5" />,
      tone: 'emerald',
      title: 'Confirmar Pago en Cascada',
      message:
        `Cliente: ${target.fullName}\n` +
        `Monto a aplicar: RD$${amountApplied.toLocaleString()}\n` +
        (fullyPaid.length
          ? `Cuotas pagadas: ${fullyPaid.map((a) => `#${a.installment.number}`).join(', ')}\n`
          : '') +
        (abonos.length
          ? `Abonos parciales: ${abonos
              .map((a) => `#${a.installment.number} (RD$${a.applied.toLocaleString()})`)
              .join(', ')}\n`
          : '') +
        (isEfectivo
          ? `\nRecibido: RD$${received.toLocaleString()}\nVuelto a devolver: RD$${change.toLocaleString()}`
          : `\nMétodo: ${method}`) +
        `\n\n¿Confirmar el pago?`,
      confirmLabel: 'Sí, Confirmar Pago',
    });
    if (!ok) return;

    const payload: CascadePaymentPayload = {
      clientId: target.id,
      clientName: target.fullName,
      amountApplied,
      received: isEfectivo ? received : amountApplied,
      change,
      method,
      bank,
      affected,
    };
    onConfirm(payload);
    setSuccess(payload);
  };

  // Vista de éxito con el vuelto destacado
  if (success) {
    return (
      <ModalShell
        isOpen
        onClose={onClose}
        size="sm"
        zIndex="z-[55]"
        headerVariant="dark"
        headerClassName="bg-emerald-600! border-emerald-700!"
        ariaLabel="Pago en Cascada Registrado"
        title={
          <span className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-base">Pago en Cascada Registrado</span>
          </span>
        }
      >
        <div className="space-y-4 text-sm">
            <p className="text-slate-700 dark:text-slate-300">
              <strong>{success.clientName}</strong> — RD$
              {success.amountApplied.toLocaleString()} aplicados.
            </p>

            {fullyPaid.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                <span className="text-[10px] font-bold uppercase text-emerald-700 block mb-1">
                  Cuotas Completadas
                </span>
                <span className="text-emerald-900 font-bold">
                  {fullyPaid.map((a) => `#${a.installment.number}`).join(', ')}
                </span>
              </div>
            )}

            {abonos.length > 0 && (
              <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3">
                <span className="text-[10px] font-bold uppercase text-indigo-700 block mb-1">
                  Abonos Parciales (siguientes cuotas)
                </span>
                <div className="space-y-0.5">
                  {abonos.map((a) => (
                    <div key={a.installment.id} className="text-indigo-900 font-semibold">
                      Cuota #{a.installment.number}: RD${a.applied.toLocaleString()} — restan
                      RD${a.remainingAfter.toLocaleString()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {success.change > 0 && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 rounded-xl p-4 text-center">
                <span className="text-[10px] font-bold uppercase text-amber-700 block">
                  Vuelto a Devolver al Cliente
                </span>
                <span className="text-3xl font-extrabold text-amber-900">
                  RD${success.change.toLocaleString()}
                </span>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl"
            >
              Cerrar
            </button>
        </div>
    </ModalShell>
    );
  }

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      size="lg"
      zIndex="z-[55]"
      headerVariant="dark"
      ariaLabel="Registrar Pago en Cascada & Desbloquear"
      title={
        <span className="flex items-center space-x-2.5">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-500/100/20 rounded-lg text-emerald-400">
            <HandCoins className="w-5 h-5" />
          </div>
          <span className="text-base">Registrar Pago en Cascada & Desbloquear</span>
        </span>
      }
      subtitle={
        <span>El excedente se distribuye automáticamente a las cuotas siguientes</span>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Cliente */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Seleccione Cliente (CrediPay MDM)
            </label>
            <select
              value={selectedClientId}
              onChange={(e) => handleSelectClient(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-slate-50 dark:bg-slate-900 font-medium"
            >
              <option value="">-- Seleccionar Cliente --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} — {c.device.model}
                </option>
              ))}
            </select>
          </div>

          {target && pendingInstallments.length === 0 && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-900 dark:text-emerald-200">
              Este cliente no tiene cuotas pendientes. Financiamiento pagado.
            </div>
          )}

          {target && pendingInstallments.length > 0 && (
            <>
              {/* Método y Banco */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Método de Pago</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 font-medium"
                  >
                    {METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Banco o Referencia
                  </label>
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 font-medium"
                  >
                    {BANKS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Monto a pagar */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Monto a Pagar (RD$) — se aplica en cascada
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Banknote className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={montoStr}
                      onChange={(e) => setMontoStr(e.target.value)}
                      placeholder={`Próxima cuota: RD$${nextAmount.toLocaleString()}`}
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 font-mono font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMontoStr(String(nextAmount))}
                    className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800 whitespace-nowrap"
                  >
                    Cuota completa (RD${nextAmount.toLocaleString()})
                  </button>
                </div>
              </div>

              {/* Vuelto (solo efectivo) */}
              {isEfectivo && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Monto Recibido (RD$)
                    </label>
                    <div className="relative">
                      <Wallet className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="number"
                        min={monto || 1}
                        step="0.01"
                        value={receivedStr}
                        onChange={(e) => setReceivedStr(e.target.value)}
                        placeholder="Efectivo del cliente"
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 font-mono font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                    {receivedShort && (
                      <p className="mt-1 text-[11px] font-semibold text-rose-600">
                        El efectivo recibido no cubre el monto a pagar.
                      </p>
                    )}
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold uppercase text-amber-700">
                      Vuelto a Devolver
                    </span>
                    <span className="text-2xl font-extrabold text-amber-900">
                      RD${change.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              {/* Preview de la cascada */}
              {affected.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Distribución en Cascada</span>
                    </span>
                    <span className="font-bold text-emerald-700">
                      RD${amountApplied.toLocaleString()}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {affected.map((a) => (
                      <div
                        key={a.installment.id}
                        className="px-3 py-2 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            Cuota #{a.installment.number}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 ml-2">
                            {a.becamePaid ? (
                              <span className="text-emerald-700 font-bold">COMPLETADA</span>
                            ) : (
                              <span className="text-indigo-700 font-bold">
                                ABONO — restan RD${a.remainingAfter.toLocaleString()}
                              </span>
                            )}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                          RD${a.applied.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-900 dark:text-emerald-200 flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>
                  Al confirmar, las cuotas cubiertas pasan a <strong>PAGADO</strong>, los
                  excedentes quedan como <strong>abono</strong> en las siguientes, y si no queda
                  ningún atraso se enviará el comando de <strong>Desbloqueo MDM</strong>.
                </span>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-500/20 dark:bg-slate-500/10 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canConfirm}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-md transition-colors"
                >
                  Confirmar Pago & Desbloquear
                </button>
              </div>
            </>
          )}
        </form>
    </ModalShell>
  );
};
