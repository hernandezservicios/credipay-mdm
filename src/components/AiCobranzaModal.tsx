import React, { useState } from 'react';
import { ClientCredit } from '../types';
import { MessageSquare, Copy, Check, Send, ShieldAlert } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { formatCurrencyRD } from '../utils/formatters';
import { getOverdueConfig, overdueGraceDays } from '../utils/overdue';

interface AiCobranzaModalProps {
  client: ClientCredit | null;
  onClose: () => void;
}

export const AiCobranzaModal: React.FC<AiCobranzaModalProps> = ({ client, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<'RESPETUOSO' | 'ALERTA_BLOQUEO' | 'CONFIRMACION_PAGO'>('RESPETUOSO');

  if (!client) return null;

  const isLocked = client.device.mdmStatus === 'LOCKED';
  const overdueInstallments = client.installments.filter((i) => i.status === 'ATRASADO');
  const totalPenalty = overdueInstallments.reduce((sum, i) => sum + i.penaltyAmount, 0);

  const overdueConfig = getOverdueConfig();
  const moraText =
    overdueConfig.type === 'FIXED'
      ? `una mora de ${formatCurrencyRD(overdueConfig.fixed_amount)}`
      : `un ${overdueConfig.percentage_rate}% de mora`;
  const moraAmt = totalPenalty || overdueConfig.fixed_amount;

  // Generador inteligente de mensaje para WhatsApp según el tono y estado
  const generateMessage = (): string => {
    if (tone === 'ALERTA_BLOQUEO' || (isLocked && tone === 'RESPETUOSO')) {
      return `🔴 AVISO DE SISTEMA CREDIPAY MDM - CRÉDITO DE CELULAR\n\nEstimado(a) *${client.fullName}*,\nLe informamos que su cuota mensual de *${client.device.model}* ha superado los ${overdueGraceDays()} días después de la fecha de pago, cambiando a estado *ATRASADO*.\n\n🔒 *Estado del Equipo:* BLOQUEADO (MDM)\n💵 *Monto de Cuota:* ${formatCurrencyRD(client.monthlyInstallmentAmount)}\n⚠️ *Mora aplicada:* ${formatCurrencyRD(moraAmt)}\n👉 *Total para Desbloquear:* ${formatCurrencyRD(client.monthlyInstallmentAmount + moraAmt)}\n\nTan pronto realice su pago por WhatsApp o en nuestras tiendas, el sistema ejecutará el *desbloqueo de pantalla automáticamente en segundos*. ¡Contáctenos para apoyarle!`;
    }

    if (tone === 'CONFIRMACION_PAGO') {
      return `🟢 NOTIFICACIÓN DE PAGO & DESBLOQUEO CREDIPAY MDM\n\n¡Hola *${client.fullName}*! Hemos recibido exitosamente su pago de crédito para el *${client.device.model}*.\n\n🔓 *Estado del Celular:* OPERATIVO / DESBLOQUEADO\n✅ Gracias por mantener su crédito al día. Próxima cuota según el calendario programado.`;
    }

    // Respetuoso / Recordatorio amigable
    return `Hola *${client.fullName}*, le saludamos de su financiamiento de celular *${client.device.model}* 📱 con credito.-MDM.\n\nLe recordamos que su cuota mensual de *${formatCurrencyRD(client.monthlyInstallmentAmount)}* está por vencer. Recuerde que el sistema aplica un bloqueo de pantalla automático y ${moraText} tras cumplir ${overdueGraceDays()} días de vencido.\n\nPara pagar o reportar su depósito, escríbanos por aquí. ¡Que tenga un excelente día! ✨`;
  };

  const messageText = generateMessage();

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openWhatsApp = () => {
    const cleanPhone = client.phone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
    window.open(url, '_blank');
  };

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      size="lg"
      headerVariant="dark"
      ariaLabel="Asistente de Cobranza & Notificaciones WhatsApp"
      title={
        <span className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white shrink-0">
            <MessageSquare className="w-6 h-6" />
          </div>
          <span className="text-lg">Asistente de Cobranza & Notificaciones WhatsApp</span>
        </span>
      }
      subtitle={
        <span className="text-slate-300">
          Cliente: {client.fullName} | {client.phone}
        </span>
      }
    >
      <div className="space-y-4">
          {/* Tonos / Tipos de Mensajes */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">Seleccionar Tipo de Comunicación:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTone('RESPETUOSO')}
                className={`p-2.5 rounded-lg border text-center font-medium transition-colors ${
                  tone === 'RESPETUOSO'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                1. Recordatorio Amigable
              </button>
              <button
                type="button"
                onClick={() => setTone('ALERTA_BLOQUEO')}
                className={`p-2.5 rounded-lg border text-center font-medium transition-colors ${
                  tone === 'ALERTA_BLOQUEO'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                2. Alerta Bloqueo & Mora
              </button>
              <button
                type="button"
                onClick={() => setTone('CONFIRMACION_PAGO')}
                className={`p-2.5 rounded-lg border text-center font-medium transition-colors ${
                  tone === 'CONFIRMACION_PAGO'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                3. Recibo & Desbloqueo
              </button>
            </div>
          </div>

          {/* Vista previa del mensaje */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Mensaje generado (listo para enviar):</span>
              <span className="text-[10px] text-slate-400">Formato WhatsApp (.md compatible)</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 font-mono text-xs whitespace-pre-wrap text-slate-800 dark:text-slate-100 leading-relaxed max-h-60 overflow-y-auto">
              {messageText}
            </div>
          </div>

          {/* Estado de riesgo */}
          <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-900 dark:text-amber-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {isLocked
                  ? 'Este equipo está actualmente BLOQUEADO por MDM. Al pagar se enviará la orden de desbloqueo.'
                  : 'El cliente está informado de la regla de bloqueo al tercer día de mora.'}
              </span>
            </div>
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-semibold rounded-lg flex items-center space-x-1.5 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
              <span>{copied ? '¡Copiado!' : 'Copiar Texto'}</span>
            </button>

            <div className="flex space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:text-slate-100 rounded-lg font-medium transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={openWhatsApp}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white font-semibold rounded-lg shadow-xs flex items-center space-x-1.5 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Abrir Chat en WhatsApp</span>
              </button>
            </div>
          </div>
      </div>
    </ModalShell>
  );
};
