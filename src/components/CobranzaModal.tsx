import React, { useRef, useState } from 'react';
import { HandCoins, ShieldCheck, Calculator, CheckCircle2, KeyRound } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { Button } from './ui/Button';
import {
  apiPayLoan,
  apiSimulateLoanPayment,
  errorMessage,
  type LoanPaymentResult,
  type PayMethod,
  type SimulatePaymentResult,
} from '../services/api';
import { BUCKET_LABEL, BANKS, PAYMENT_METHODS } from '../constants';
import { formatCurrencyRD } from '../utils/formatters';

type Notify = (text: string, type: 'INFO' | 'LOCK' | 'UNLOCK') => void;

interface CobranzaModalProps {
  loan: { id: number; creditNumber: string; clientName: string; outstanding: number };
  onClose: () => void;
  onSuccess: () => void;
  onNotify?: Notify;
}

/**
 * Cobro unificado por préstamo (F11): POST /loans/:id/pay/simulate -> POST /loans/:id/pay.
 * Cero lógica financiera en React (F10): la distribución la decide el backend.
 * Idempotencia R13: la misma key se reutiliza si el cobro se reintenta.
 */
export const CobranzaModal: React.FC<CobranzaModalProps> = ({ loan, onClose, onSuccess, onNotify }) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('EFECTIVO');
  const [bank, setBank] = useState('');
  const [received, setReceived] = useState('');
  const [simulation, setSimulation] = useState<SimulatePaymentResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const keyRef = useRef<string>('');

  const amountNum = Number(amount);
  const busy = phase === 'busy';
  const done = phase === 'done';
  const needsBank = method === 'TRANSFERENCIA' || method === 'DEPOSITO';

  const runSimulate = async () => {
    if (!(amountNum > 0) || busy) return;
    setSimulating(true);
    setSimulation(null);
    try {
      const res = await apiSimulateLoanPayment(loan.id, amountNum);
      setSimulation(res.data);
      setReceived(String(res.data.totalAllocated || amountNum));
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
    } finally {
      setSimulating(false);
    }
  };

  const confirmPay = async () => {
    if (!simulation || busy || done) return;
    setPhase('busy');
    if (!keyRef.current) keyRef.current = `pay-${crypto.randomUUID()}`;
    try {
      const res = await apiPayLoan(loan.id, {
        amount: simulation.amount,
        method,
        bank: needsBank ? bank : undefined,
        received: Number(received) || simulation.amount,
        idempotencyKey: keyRef.current,
      });
      const result: LoanPaymentResult = res.data;
      setPhase('done');
      onNotify?.(
        result.duplicate
          ? `Pago duplicado evitado: recibo #${result.paymentId} (misma llave).`
          : `Cobro registrado: recibo #${result.paymentId} por ${formatCurrencyRD(result.amountApplied)}.`,
        result.unlock?.success ? 'UNLOCK' : 'INFO'
      );
      onSuccess();
    } catch (err) {
      onNotify?.(errorMessage(err), 'INFO');
      setPhase('idle');
    }
  };

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title="Cobrar préstamo"
      subtitle={`${loan.creditNumber} · ${loan.clientName}`}
      size="lg"
      footer={
        done ? (
          <Button onClick={onClose}>Cerrar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={confirmPay} disabled={!simulation || busy} loading={busy}>
              <ShieldCheck className="h-4 w-4" />
              Confirmar cobro
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="field-label">Saldo pendiente</label>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {formatCurrencyRD(loan.outstanding)}
            </p>
          </div>
          <div>
            <label className="field-label">Monto a cobrar</label>
            <input
              type="number"
              className="input-field"
              value={amount}
              min="0"
              placeholder="0.00"
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Método</label>
            <select
              className="select-field"
              value={method}
              disabled={busy}
              onChange={(e) => setMethod(e.target.value as PayMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {needsBank && (
          <div>
            <label className="field-label">Banco</label>
            <select className="select-field" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">— Seleccionar banco —</option>
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={runSimulate} loading={simulating} disabled={!(amountNum > 0) || busy || done}>
            <Calculator className="h-4 w-4" />
            Simular distribución
          </Button>
          {done && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Cobro aplicado
            </span>
          )}
        </div>

        {simulation && !done && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Distribución propuesta</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aplicado{' '}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrencyRD(simulation.totalAllocated)}
                </span>
                {simulation.remainder > 0 && (
                  <>
                    {' '}
                    · Excedente{' '}
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {formatCurrencyRD(simulation.remainder)}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    <th className="py-2 px-3">Cuota</th>
                    <th className="py-2 px-3">Concepto</th>
                    <th className="py-2 px-3 text-right">Importe</th>
                    <th className="py-2 px-3 text-right">Resta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {simulation.lines.map((l, idx) => (
                    <tr key={`${l.installmentId}-${idx}`}>
                      <td className="py-2 px-3 font-mono">#{l.installmentNumber}</td>
                      <td className="py-2 px-3">
                        {BUCKET_LABEL[(l.bucket as keyof typeof BUCKET_LABEL) ?? 'principal'] ?? l.bucket}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">{formatCurrencyRD(l.allocated)}</td>
                      <td className="py-2 px-3 text-right">{formatCurrencyRD(l.remainingAfter)}</td>
                    </tr>
                  ))}
                  {simulation.lines.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-400">
                        El monto no alcanza para cubrir ninguna cuota pendiente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <KeyRound className="h-3.5 w-3.5" />
              Llave de idempotencia generada automáticamente: reintentos no duplican el cobro (R13).
            </div>
          </div>
        )}

        {done && (
          <div className="rounded-xl border border-emerald-300 dark:border-emerald-600/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 flex items-start gap-3">
            <HandCoins className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200">
              El recibo quedó registrado y la cartera se actualiza. Si el dispositivo estaba en
              mora, se intentó el desbloqueo automático.
            </p>
          </div>
        )}
      </div>
    </ModalShell>
  );
};