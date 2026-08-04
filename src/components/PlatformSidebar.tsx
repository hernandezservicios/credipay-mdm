import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Crown,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export type PortalTab = 'OVERVIEW' | 'TENANTS' | 'PLANS';

interface PlatformSidebarProps {
  activeTab: PortalTab;
  onSelectTab: (tab: PortalTab) => void;
  onOpenSecurity: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const PlatformSidebar: React.FC<PlatformSidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenSecurity,
  isCollapsed,
  onToggleCollapse,
  isOpenMobile,
  onCloseMobile,
}) => {
  const navItems = [
    {
      id: 'OVERVIEW' as PortalTab,
      label: 'Resumen',
      description: 'Estado global de la plataforma',
      icon: LayoutDashboard,
    },
    {
      id: 'TENANTS' as PortalTab,
      label: 'Empresas',
      description: 'Tenants, suscripciones y planes',
      icon: Building2,
    },
    {
      id: 'PLANS' as PortalTab,
      label: 'Planes & Catálogo',
      description: 'Catálogo de planes SaaS',
      icon: Crown,
    },
  ];

  return (
    <>
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 lg:top-16 z-50 lg:z-20 h-screen lg:h-[calc(100vh-4rem)] bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col justify-between transition-all duration-200 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-72'
        } ${
          isOpenMobile ? 'translate-x-0 left-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
          <div className="flex items-center justify-between px-2">
            {!isCollapsed && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Panel de Plataforma
                </span>
                <p className="text-[10px] text-indigo-300 mt-0.5">Portal Super Admin</p>
              </div>
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
                      <div className="text-left min-w-0">
                        <div className="font-semibold truncate">{item.label}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {item.description}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            <button
              onClick={() => {
                onOpenSecurity();
                onCloseMobile();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group text-slate-300 hover:bg-slate-800/80 hover:text-white"
              title={isCollapsed ? 'Seguridad & API keys' : undefined}
            >
              <div className="flex items-center space-x-3 truncate">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-800 text-slate-400 group-hover:text-white group-hover:bg-slate-700">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                {!isCollapsed && (
                  <div className="text-left min-w-0">
                    <div className="font-semibold truncate">Seguridad & API keys</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      2FA y llaves de integración
                    </div>
                  </div>
                )}
              </div>
            </button>
          </nav>
        </div>

        {!isCollapsed && (
          <div className="px-4 pb-4">
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-[10px] text-slate-400">
              Usa <span className="text-indigo-300 font-semibold">Entrar</span> en una empresa para
              operar su sistema de préstamos.
            </div>
          </div>
        )}
      </aside>
    </>
  );
};