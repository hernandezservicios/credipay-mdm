import React, { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, ShieldCheck, DollarSign, MessageSquare, ChevronDown, KeyRound, Trash2 } from 'lucide-react';
import { MobileDevice } from '../types';

interface MdmActionDropdownProps {
  device: MobileDevice;
  clientId: string;
  clientName: string;
  onLockDevice: (clientId: string, reason: string) => void;
  onUnlockDevice: (clientId: string, reason: string) => void;
  onCheckStatus: (clientId: string) => void;
  onOpenInstallments: () => void;
  onOpenAiCobranza: () => void;
  onGenerateUnlockCode?: (clientId: string) => void;
  onRemoveDevice?: (clientId: string) => void;
}

export const MdmActionDropdown: React.FC<MdmActionDropdownProps> = ({
  device,
  clientId,
  clientName,
  onLockDevice,
  onUnlockDevice,
  onCheckStatus,
  onOpenInstallments,
  onOpenAiCobranza,
  onGenerateUnlockCode,
  onRemoveDevice,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const isLocked = device.mdmStatus === 'LOCKED';

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-between px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-300 dark:border-slate-600 shadow-xs"
      >
        <span>Acciones MDM</span>
        <ChevronDown className="w-3.5 h-3.5 ml-1.5 text-slate-500 dark:text-slate-400" />
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-1 w-64 rounded-xl shadow-lg bg-white ring-1 ring-black ring-opacity-5 divide-y divide-slate-100 z-50">
          {/* Bloqueo y Desbloqueo MDM */}
          <div className="py-1.5">
            <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Control de Dispositivo MDM ({device.unlockCode ? `InovaGuard ID: ${device.unlockCode}` : 'Generic'})
            </div>
            {isLocked ? (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onUnlockDevice(clientId, 'Desbloqueo manual por operador');
                }}
                className="w-full text-left px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/10 flex items-center space-x-2 font-medium"
              >
                <Unlock className="w-4 h-4 text-emerald-600" />
                <span>Desbloquear Dispositivo (Unlock)</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onLockDevice(clientId, 'Bloqueo manual ordenado por operador');
                }}
                className="w-full text-left px-3 py-2 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20 dark:bg-rose-500/10 flex items-center space-x-2 font-medium"
              >
                <Lock className="w-4 h-4 text-rose-600" />
                <span>Bloquear Dispositivo (Lock MDM)</span>
              </button>
            )}

            {onGenerateUnlockCode && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onGenerateUnlockCode(clientId);
                }}
                className="w-full text-left px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/10 flex items-center space-x-2 font-medium"
              >
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <span>Generar Código Unlock Offline</span>
              </button>
            )}

            <button
              onClick={() => {
                setIsOpen(false);
                onCheckStatus(clientId);
              }}
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-500/20 dark:bg-slate-500/10 flex items-center space-x-2"
            >
              <ShieldCheck className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Verificar Conexión / Sync API</span>
            </button>

            {onRemoveDevice && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onRemoveDevice(clientId);
                }}
                className="w-full text-left px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/20 dark:bg-rose-500/10 flex items-center space-x-2"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
                <span>Desvincular Dispositivo (Remove)</span>
              </button>
            )}
          </div>

          {/* Cuotas y Cobranza */}
          <div className="py-1.5">
            <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Cuotas & Comunicación
            </div>
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenInstallments();
              }}
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-500/20 dark:bg-slate-500/10 flex items-center space-x-2"
            >
              <DollarSign className="w-4 h-4 text-amber-600" />
              <span>Ver Cuotas / Pagar & Aplicar Mora</span>
            </button>

            <button
              onClick={() => {
                setIsOpen(false);
                onOpenAiCobranza();
              }}
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-500/20 dark:bg-slate-500/10 flex items-center space-x-2"
            >
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              <span>Mensaje Cobranza WhatsApp / Aviso</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

