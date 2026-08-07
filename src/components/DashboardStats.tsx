import React from 'react';
import { SystemMetrics } from '../types';
import { Smartphone, Lock, AlertTriangle, DollarSign, Cpu } from 'lucide-react';
import { formatCurrencyRD } from '../utils/formatters';

interface DashboardStatsProps {
  metrics: SystemMetrics;
  onRunEngine: () => void;
  onOpenInstallmentsFilter: (filter: 'ALL' | 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO') => void;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  metrics,
  onRunEngine,
  onOpenInstallmentsFilter,
}) => {
  return (
    <div className="mb-8">
      {/* Barra superior del motor y resumen de reglas de negocio */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-500/100/10 border border-emerald-500/20 text-emerald-400 rounded-lg">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">
              Motor de Bloqueo MDM Automático y Control de Mora (Server-Side)
            </h2>
            <p className="text-xs text-slate-300">
              Configurable: <span className="font-medium text-amber-300">vencimiento = VENCIDO</span> |{' '}
              <span className="font-medium text-rose-300">mora según configuración (tipo, % o monto, días de gracia) +BLOQUEO MDM automático</span> |{' '}
              <span className="font-medium text-emerald-300">Pago = DESBLOQUEO MDM automático</span>.
            </p>
          </div>
        </div>

        <button
          onClick={onRunEngine}
          className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors shadow-sm self-stretch md:self-auto justify-center"
        >
          <Cpu className="w-4 h-4" />
          <span>Ejecutar Motor de Mora Ahora</span>
        </button>
      </div>

      {/* Tarjetas de estadísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Clientes y Créditos */}
        <div
          onClick={() => onOpenInstallmentsFilter('ALL')}
          className="bg-white border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:border-slate-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Créditos Activos
            </span>
            <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{metrics.activeCredits}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{metrics.totalClients} clientes</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Celulares en financiamiento</p>
        </div>

        {/* Celulares Bloqueados MDM */}
        <div
          onClick={() => onOpenInstallmentsFilter('ATRASADO')}
          className="bg-white border border-rose-200 rounded-xl p-5 shadow-sm hover:border-rose-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-600">
              Dispositivos Bloqueados
            </span>
            <div className="p-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg">
              <Lock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-rose-600">{metrics.lockedDevicesCount}</span>
            <span className="text-xs font-medium text-rose-600">MDM Lock</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {metrics.lockedDevicesCount > 0
              ? 'Desbloqueo automático tras pago'
              : 'Todos los celulares operando normal'}
          </p>
        </div>

        {/* Cuotas Atrasadas con mora configurada */}
        <div
          onClick={() => onOpenInstallmentsFilter('ATRASADO')}
          className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm hover:border-amber-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Cuotas Atrasadas
            </span>
            <div className="p-2 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-amber-700">{metrics.overdueCount}</span>
            <span className="text-xs font-semibold text-amber-600">Mora Configurada</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Vencidas según configuración de la empresa</p>
        </div>

        {/* Recaudado en el Mes */}
        <div
          onClick={() => onOpenInstallmentsFilter('PAGADO')}
          className="bg-white border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:border-slate-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Total Recaudado
            </span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatCurrencyRD(metrics.totalCollectedThisMonth)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">RD$ (DOP)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Incluye cuotas base y moras cobradas</p>
        </div>
      </div>
    </div>
  );
};
