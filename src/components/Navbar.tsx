import React from 'react';
import { Smartphone, Lock, ShieldCheck, Settings, Plus, RefreshCw, Cpu, Users, Database, Activity, Menu } from 'lucide-react';

export type MainViewTab = 'CLIENTS' | 'DEVICES' | 'FINANCE' | 'ANALYTICS' | 'LOGS';

interface NavbarProps {
  onOpenNewCredit: () => void;
  onOpenApiConfig: () => void;
  autoEngineActive: boolean;
  onToggleAutoEngine: () => void;
  onRunEngineNow: () => void;
  mdmConfigEnabled: boolean;
  onSyncInovaGuard?: () => void;
  activeTab?: MainViewTab;
  onSelectTab?: (tab: MainViewTab) => void;
  onToggleMobileSidebar?: () => void;
  onOpenHostingerSql?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenNewCredit,
  onOpenApiConfig,
  autoEngineActive,
  onToggleAutoEngine,
  onRunEngineNow,
  mdmConfigEnabled,
  onSyncInovaGuard,
  activeTab = 'CLIENTS',
  onSelectTab,
  onToggleMobileSidebar,
  onOpenHostingerSql,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Título & Toggle de Sidebar móvil */}
          <div className="flex items-center space-x-3">
            {onToggleMobileSidebar && (
              <button
                onClick={onToggleMobileSidebar}
                className="lg:hidden p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title="Abrir menú de vistas (Sidebar)"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">CrediPay MDM</span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 rounded">
                  PROD v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Créditos, Cuotas & Bloqueo Automático MDM de Celulares (RD$)
              </p>
            </div>
          </div>

          {/* Acciones del encabezado */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Estado del motor automático de monitoreo de cuotas */}
            <div className="hidden xl:flex items-center bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
              <div
                className="flex items-center space-x-2 text-slate-300"
                title="Monitoreo que verifica las fechas de cuotas y aplica mora de $200 + Bloqueo automático a los 3 días de atraso"
              >
                <Cpu className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span className="font-medium">
                  Motor MDM: <span className="text-emerald-400 font-bold">Activo</span>
                </span>
              </div>
              <span className="text-slate-600 mx-2">|</span>
              <button
                onClick={onRunEngineNow}
                className="flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 font-medium"
                title="Ejecutar evaluación de estados ahora"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Evaluar</span>
              </button>
            </div>

            {/* Botón de Sincronización automática con InovaGuard */}
            {onSyncInovaGuard && (
              <button
                onClick={onSyncInovaGuard}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-indigo-700/60 bg-indigo-950/80 text-indigo-300 hover:bg-indigo-900 transition-colors shadow-xs"
                title="Sincronizar dispositivos y estados desde InovaGuard API (/devices)"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Sync InovaGuard</span>
              </button>
            )}

            {/* Botón Esquema MySQL Hostinger DDL */}
            {onOpenHostingerSql && (
              <button
                onClick={onOpenHostingerSql}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 transition-colors shadow-xs"
                title="Ver Esquema MySQL (DDL) y Backend Node.js para Hostinger"
              >
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline">MySQL Hostinger</span>
              </button>
            )}

            {/* Configurar API MDM (Inyección de API externa) */}
            <button
              onClick={onOpenApiConfig}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                mdmConfigEnabled
                  ? 'bg-slate-800 border-emerald-600/40 text-emerald-400 hover:bg-slate-700'
                  : 'bg-slate-800 border-amber-600/40 text-amber-400 hover:bg-slate-700'
              }`}
              title="Configurar Endpoint API para Bloqueo/Desbloqueo (Inyección API)"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">API MDM</span>
              <span className={`w-2 h-2 rounded-full ${mdmConfigEnabled ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </button>

            {/* Botón Nuevo Crédito */}
            <button
              onClick={onOpenNewCredit}
              className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3.5 py-2 rounded-lg text-xs shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Préstamo</span>
            </button>
          </div>
        </div>

      </div>
    </header>
  );
};
