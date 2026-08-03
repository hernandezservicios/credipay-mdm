import React from 'react';
import {
  Users,
  Smartphone,
  Activity,
  Plus,
  RefreshCw,
  Cpu,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  Unlock,
  AlertTriangle,
  ExternalLink,
  DollarSign,
  BarChart3,
  CreditCard,
  BrainCircuit,
} from 'lucide-react';
import { MainViewTab } from './Navbar';

interface SidebarProps {
  activeTab: MainViewTab;
  onSelectTab: (tab: MainViewTab) => void;
  clientsCount: number;
  devicesCount?: number;
  logsCount: number;
  autoEngineActive: boolean;
  onToggleAutoEngine: () => void;
  onRunEngineNow: () => void;
  onOpenNewCredit: () => void;
  onOpenApiConfig: () => void;
  onSyncInovaGuard?: () => void;
  mdmConfigEnabled: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  clientsCount,
  devicesCount = 0,
  logsCount,
  autoEngineActive,
  onToggleAutoEngine,
  onRunEngineNow,
  onOpenNewCredit,
  onOpenApiConfig,
  onSyncInovaGuard,
  mdmConfigEnabled,
  isCollapsed,
  onToggleCollapse,
  isOpenMobile,
  onCloseMobile,
}) => {
  const navItems = [
    {
      id: 'CLIENTS' as MainViewTab,
      label: 'Créditos & Cobranza',
      description: 'Cartera, cuotas y mora',
      icon: Users,
      badge: clientsCount,
      badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    },
    {
      id: 'DEVICES' as MainViewTab,
      label: 'Parque Dispositivos',
      description: 'Consola InovaGuard MDM',
      icon: Smartphone,
      badge: 'LIVE',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    },
    {
      id: 'FINANCE' as MainViewTab,
      label: 'Caja & Flujo Cobros',
      description: 'Conciliación RD$ & abonos',
      icon: DollarSign,
      badge: 'RD$',
      badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    },
    {
      id: 'ANALYTICS' as MainViewTab,
      label: 'Estadísticas & KPIs',
      description: 'Tasa recuperación & mora',
      icon: BarChart3,
      badge: '91.4%',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    },
    {
      id: 'LOGS' as MainViewTab,
      label: 'Auditoría & Logs',
      description: 'Historial comandos REST',
      icon: Activity,
      badge: logsCount,
      badgeColor: 'bg-slate-700 text-slate-300',
    },
    {
      id: 'BILLING' as MainViewTab,
      label: 'Suscripción & Planes',
      description: 'Plan, uso y facturación',
      icon: CreditCard,
      badge: 'SaaS',
      badgeColor: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
    },
    {
      id: 'COLLECTIONS' as MainViewTab,
      label: 'Cobranza Inteligente IA',
      description: 'Motor automático y recordatorios',
      icon: BrainCircuit,
      badge: 'IA',
      badgeColor: 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30',
    },
  ];

  return (
    <>
      {/* Fondo Backdrop para móvil */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Contenedor del Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 lg:top-16 z-50 lg:z-20 h-screen lg:h-[calc(100vh-4rem)] bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col justify-between transition-all duration-200 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-72'
        } ${
          isOpenMobile
            ? 'translate-x-0 left-0 shadow-2xl'
            : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Cabecera / Pestañas de Vistas */}
        <div className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
          {/* Título del Panel */}
          <div className="flex items-center justify-between px-2">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Menú de Navegación
              </span>
            )}
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex items-center justify-center w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors ml-auto"
              title={isCollapsed ? 'Expandir panel' : 'Colapsar panel'}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronLeft className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Vistas Principales */}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-900/30 font-bold'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                  title={isCollapsed ? item.label : undefined}
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'bg-slate-800 text-slate-400 group-hover:text-white group-hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    {!isCollapsed && (
                      <div className="text-left truncate">
                        <div className="leading-snug truncate">{item.label}</div>
                        <div className="text-[10px] text-slate-400 font-normal truncate">
                          {item.description}
                        </div>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ml-2 shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : item.badgeColor
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Línea divisoria */}
          <div className="border-t border-slate-800/80 pt-4">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-2">
                Acciones Operativas
              </span>
            )}

            <div className="space-y-1.5">
              {/* Botón Nuevo Crédito */}
              <button
                onClick={() => {
                  onOpenNewCredit();
                  onCloseMobile();
                }}
                className={`w-full flex items-center px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-sm group ${
                  isCollapsed ? 'justify-center' : 'space-x-3'
                }`}
                title="Añadir Nuevo Cliente & Crédito"
              >
                <Plus className="w-4 h-4 shrink-0" />
                {!isCollapsed && <span>Nuevo Crédito / Cliente</span>}
              </button>

              {/* Botón Sync InovaGuard */}
              {onSyncInovaGuard && (
                <button
                  onClick={() => {
                    onSyncInovaGuard();
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 text-indigo-300 hover:text-white font-medium text-xs transition-all border border-indigo-900/40 group ${
                    isCollapsed ? 'justify-center' : 'space-x-3'
                  }`}
                  title="Sincronizar Dispositivos InovaGuard"
                >
                  <RefreshCw className="w-4 h-4 shrink-0 text-indigo-400" />
                  {!isCollapsed && (
                    <span className="truncate">Sincronizar InovaGuard</span>
                  )}
                </button>
              )}

              {/* Evaluar Moras (3 Días) */}
              <button
                onClick={() => {
                  onRunEngineNow();
                  onCloseMobile();
                }}
                className={`w-full flex items-center px-3 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white text-xs transition-all ${
                  isCollapsed ? 'justify-center' : 'space-x-3'
                }`}
                title="Evaluar 3 días de atraso y aplicar mora/bloqueo"
              >
                <Cpu className="w-4 h-4 shrink-0 text-amber-400" />
                {!isCollapsed && <span>Evaluar Atrasos (3 Días)</span>}
              </button>
            </div>
          </div>
        </div>

        {/* Pie del Sidebar: Estado Conexión & Credenciales */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <button
            onClick={() => {
              onOpenApiConfig();
              onCloseMobile();
            }}
            className={`w-full flex items-center rounded-xl p-2.5 hover:bg-slate-800 transition-colors text-left group ${
              isCollapsed ? 'justify-center' : 'justify-between'
            }`}
            title="Configuración y Credenciales InovaGuard MDM"
          >
            <div className="flex items-center space-x-2.5 truncate">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  mdmConfigEnabled
                    ? 'bg-indigo-950 text-indigo-400 border border-indigo-800/60'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <KeyRound className="w-4 h-4" />
              </div>
              {!isCollapsed && (
                <div className="truncate">
                  <div className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                    API InovaGuard
                  </div>
                  <div className="text-[10px] text-emerald-400 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                    <span>Bearer Token OK</span>
                  </div>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <Settings className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
};
