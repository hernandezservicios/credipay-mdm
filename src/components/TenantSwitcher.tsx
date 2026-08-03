import React, { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, CheckCircle2 } from 'lucide-react';
import type { TenantRow } from '../services/api';

interface TenantSwitcherProps {
  tenants: TenantRow[];
  activeTenantId: number | null;
  isGlobal: boolean;
  onSwitch: (tenantId: number) => void;
  onReload: () => void;
}

export const TenantSwitcher: React.FC<TenantSwitcherProps> = ({
  tenants,
  activeTenantId,
  isGlobal,
  onSwitch,
  onReload,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const active = tenants.find((t) => t.id === activeTenantId) ?? null;

  if (!isGlobal) return null;

  const handleSwitch = async (tenantId: number) => {
    if (tenantId === activeTenantId) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await onSwitch(tenantId);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        onClick={() => {
          setOpen(!open);
          if (!tenants.length) onReload();
        }}
        className="flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 transition-colors max-w-[220px]"
        title="Empresa activa — solo Super Admin global"
      >
        <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
        <span className="truncate font-semibold">
          {active ? active.name : 'Plataforma (sin empresa)'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 py-1.5">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
            Empresas disponibles
          </div>
          {tenants.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-400">
              No hay empresas cargadas.
            </div>
          )}
          {tenants.map((t) => (
            <button
              key={t.id}
              onClick={() => void handleSwitch(t.id)}
              disabled={loading}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-slate-800 ${
                t.id === activeTenantId ? 'bg-slate-800/60' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block font-semibold text-slate-200 truncate">{t.name}</span>
                <span className="block text-[10px] text-slate-500">{t.slug}</span>
              </span>
              {t.id === activeTenantId ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    t.status === 'ACTIVE' || t.status === 'TRIAL'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-amber-950 text-amber-400'
                  }`}
                >
                  {t.status}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};