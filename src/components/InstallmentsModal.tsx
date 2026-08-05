import React from 'react';
import { ClientCredit, Installment } from '../types';
import { CheckCircle, AlertTriangle, Clock, Lock, Unlock, DollarSign, Calendar, Zap } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';

interface InstallmentsModalProps {
  client: ClientCredit | null;
  onClose: () => void;
  onOpenPayment: (clientId: string, installmentId: string) => void;
}

export const InstallmentsModal: React.FC<InstallmentsModalProps> = ({
  client,
  onClose,
  onOpenPayment,
}) => {
  if (!client) return null;

  const isDeviceLocked = client.device.mdmStatus === 'LOCKED';

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      size="xl"
      headerVariant="dark"
      ariaLabel="Historial de Cuotas y Cobranza"
      title={
        <span className="flex items-center space-x-2">
          <span className="text-lg">Historial de Cuotas y Cobranza</span>
          {isDeviceLocked ? (
            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 bg-rose-600 text-white text-xs font-semibold rounded-full">
              <Lock className="w-3.5 h-3.5" />
              <span>BLOQUEADO MDM</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 bg-emerald-600 text-white text-xs font-semibold rounded-full">
              <Unlock className="w-3.5 h-3.5" />
              <span>DESBLOQUEADO MDM</span>
            </span>
          )}
        </span>
      }
      subtitle={
        <span className="text-slate-300">
          Cliente: <strong>{client.fullName}</strong> ({client.cedulaOrId}) | Celular:{' '}
          <strong>{client.device.model}</strong> | IMEI: <span className="font-mono">{client.device.imei}</span>
        </span>
      }
      footer={
        <button
          onClick={onClose}
          className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Cerrar Ventana
        </button>
      }
    >
      {/* Banner Explicativo de Regla de Negocio */}
      <div className="-mx-6 -mt-5 mb-5 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-800 px-6 py-3 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Regla Automática:</strong> Tras 3 días de vencimiento el estado cambia a <strong>ATRASADO</strong>, suma{' '}
              <strong>RD$200 pesos dominicanos fijos de mora</strong> y <strong>BLOQUEA el celular</strong> vía MDM. Al registrar el pago se <strong>DESBLOQUEA automáticamente</strong>.
            </span>
          </div>
        </div>

        {/* Contenido Tabla de Cuotas */}
      <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <th className="py-3 px-3">Cuota #</th>
                <th className="py-3 px-3">Vencimiento</th>
                <th className="py-3 px-3">Monto Base</th>
                <th className="py-3 px-3">Estado</th>
                <th className="py-3 px-3">Mora Fija</th>
                <th className="py-3 px-3">Total a Pagar</th>
                <th className="py-3 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {client.installments.map((inst) => {
                const isOverdue = inst.status === 'ATRASADO';
                const isPaid = inst.status === 'PAGADO';
                const isDue = inst.status === 'VENCIDO';

                return (
                  <tr
                    key={inst.id}
                    className={`transition-colors ${
                      isOverdue ? 'bg-rose-50/70 font-medium' : isDue ? 'bg-amber-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3.5 px-3 font-semibold text-slate-900 dark:text-slate-100">Cuota #{inst.number}</td>
                    <td className="py-3.5 px-3 text-slate-600 dark:text-slate-400 font-mono text-xs">
                      {inst.dueDate}
                      {inst.paidDate && (
                        <div className="text-[11px] text-emerald-600 font-sans">
                          Pagada: {inst.paidDate}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-slate-700 dark:text-slate-300 font-medium">
                      RD${inst.amount.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-3">
                      {isOverdue && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-rose-100 text-rose-800 dark:text-rose-200 border border-rose-300 rounded-full text-xs font-semibold">
                          <AlertTriangle className="w-3 h-3" />
                          <span>ATRASADO (+3 DÍAS)</span>
                        </span>
                      )}
                      {isDue && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-amber-100 text-amber-800 dark:text-amber-200 border border-amber-300 rounded-full text-xs font-semibold">
                          <Clock className="w-3 h-3" />
                          <span>VENCIDO (0-2 DÍAS)</span>
                        </span>
                      )}
                      {inst.status === 'PENDIENTE' && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-blue-100 text-blue-800 dark:text-blue-200 border border-blue-300 rounded-full text-xs font-medium">
                          <Clock className="w-3 h-3" />
                          <span>PENDIENTE</span>
                        </span>
                      )}
                      {isPaid && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:text-emerald-200 border border-emerald-300 rounded-full text-xs font-semibold">
                          <CheckCircle className="w-3 h-3" />
                          <span>PAGADO {inst.paymentRef ? `(${inst.paymentRef})` : ''}</span>
                        </span>
                      )}
                      {!isPaid && (inst.paidAmount || 0) > 0 && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-indigo-100 text-indigo-800 dark:text-indigo-200 border border-indigo-300 rounded-full text-xs font-semibold">
                          <DollarSign className="w-3 h-3" />
                          <span>
                            ABONADO RD${(inst.paidAmount || 0).toLocaleString()} — falta RD$
                            {Math.max(0, inst.totalAmount - (inst.paidAmount || 0)).toLocaleString()}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      {inst.penaltyAmount > 0 ? (
                        <span className="text-rose-600 font-bold">
                          +RD${inst.penaltyAmount.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">RD$0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                      RD${inst.totalAmount.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      {!isPaid ? (
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => onOpenPayment(client.id, inst.id)}
                            className="bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>
                              {(inst.paidAmount || 0) > 0 ? 'Registrar Abono' : 'Registrar Pago'}{' '}
                              {isOverdue && '& Desbloquear'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Pago Completado</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
    </ModalShell>
  );
};
