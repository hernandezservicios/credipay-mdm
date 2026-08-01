import React, { useState } from 'react';
import { ClientCredit } from '../types';
import { X, MessageSquare, Copy, Check, Send, Sparkles, ShieldAlert, CheckCircle } from 'lucide-react';

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
  const dueInstallments = client.installments.filter((i) => i.status === 'VENCIDO');
  const totalPenalty = overdueInstallments.reduce((sum, i) => sum + i.penaltyAmount, 0);

  // Generador inteligente de mensaje para WhatsApp según el tono y estado
  const generateMessage = (): string => {
    if (tone === 'ALERTA_BLOQUEO' || (isLocked && tone === 'RESPETUOSO')) {
      return `🔴 AVISO DE SISTEMA CREDIPAY MDM - CRÉDITO DE CELULAR\n\nEstimado(a) *${client.fullName}*,\nLe informamos que su cuota mensual de *${client.device.model}* ha superado los 3 días después de la fecha de pago, cambiando a estado *ATRASADO*.\n\n🔒 *Estado del Equipo:* BLOQUEADO (MDM)\n💵 *Monto de Cuota:* RD$${client.monthlyInstallmentAmount.toLocaleString()}\n⚠️ *Mora fija aplicada:* RD$${totalPenalty || 200}\n👉 *Total para Desbloquear:* RD$${(client.monthlyInstallmentAmount + (totalPenalty || 200)).toLocaleString()}\n\nTan pronto realice su pago por WhatsApp o en nuestras tiendas, el sistema ejecutará el *desbloqueo de pantalla automáticamente en segundos*. ¡Contáctenos para apoyarle!`;
    }

    if (tone === 'CONFIRMACION_PAGO') {
      return `🟢 CONFIRMACIÓN DE PAGO & DESBLOQUEO CREDIPAY MDM\n\n¡Hola *${client.fullName}*! Hemos recibido exitosamente su pago de crédito para el *${client.device.model}*.\n\n🔓 *Estado del Celular:* OPERATIVO / DESBLOQUEADO\n✅ Gracias por mantener su crédito al día. Su próxima cuota vence según el calendario programado.`;
    }

    // Respetuoso / Recordatorio amigable
    return `Hola *${client.fullName}*, le saludamos de su financiamiento de celular *${client.device.model}* 📱 con CrediPay MDM.\n\nLe recordamos que su cuota mensual de *RD$${client.monthlyInstallmentAmount.toLocaleString()}* está en fecha de vencimiento. Recuerde que el sistema aplica un bloqueo de pantalla automático y RD$200 de mora fija tras cumplir 3 días de vencido.\n\nPara pagar o reportar su depósito, escríbanos por aquí. ¡Que tenga un excelente día! ✨`;
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Asistente de Cobranza & Notificaciones WhatsApp</h2>
              <p className="text-xs text-slate-300">
                Cliente: {client.fullName} | {client.phone}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tonos / Tipos de Mensajes */}
          <div>
            <label className="block font-semibold text-slate-700 mb-2">Seleccionar Tipo de Comunicación:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTone('RESPETUOSO')}
                className={`p-2.5 rounded-lg border text-center font-medium transition-colors ${
                  tone === 'RESPETUOSO'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
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
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
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
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                3. Recibo & Desbloqueo
              </button>
            </div>
          </div>

          {/* Vista previa del mensaje */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-slate-700">Mensaje generado (listo para enviar):</span>
              <span className="text-[10px] text-slate-400">Formato WhatsApp (.md compatible)</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-xs whitespace-pre-wrap text-slate-800 leading-relaxed max-h-60 overflow-y-auto">
              {messageText}
            </div>
          </div>

          {/* Estado de riesgo */}
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex items-center justify-between">
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
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg flex items-center space-x-1.5 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-500" />}
              <span>{copied ? '¡Copiado!' : 'Copiar Texto'}</span>
            </button>

            <div className="flex space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-medium transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={openWhatsApp}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-xs flex items-center space-x-1.5 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Abrir Chat en WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
