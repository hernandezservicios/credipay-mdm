import React from 'react';
import {
  BarChart3,
  Smartphone,
  CheckCircle2,
  Clock,
  PieChart,
  Award,
  ArrowUpRight
} from 'lucide-react';
import { ClientCredit } from '../types';
import { FIXED_PENALTY_AMOUNT } from '../constants';
import { formatCurrencyRD } from '../utils/formatters';

interface AnalyticsViewProps {
  clients: ClientCredit[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ clients }) => {
  const getClientStatus = (c: ClientCredit): 'AL_DIA' | 'VENCIDO' | 'ATRASADO' | 'PAGADO' => {
    const overdue = c.installments.some(i => i.status === 'ATRASADO');
    if (overdue) return 'ATRASADO';
    const due = c.installments.some(i => i.status === 'VENCIDO');
    if (due) return 'VENCIDO';
    const allPaid = c.installments.every(i => i.status === 'PAGADO');
    if (allPaid && c.installments.length > 0) return 'PAGADO';
    return 'AL_DIA';
  };

  // Conteo por estado
  const total = clients.length || 1;
  const alDiaCount = clients.filter(c => getClientStatus(c) === 'AL_DIA').length;
  const vencidoCount = clients.filter(c => getClientStatus(c) === 'VENCIDO').length;
  const atrasadoCount = clients.filter(c => getClientStatus(c) === 'ATRASADO').length;
  const pagadoCount = clients.filter(c => getClientStatus(c) === 'PAGADO').length;

  const alDiaPct = Math.round((alDiaCount / total) * 100);
  const vencidoPct = Math.round((vencidoCount / total) * 100);
  const atrasadoPct = Math.round((atrasadoCount / total) * 100);
  const pagadoPct = Math.round((pagadoCount / total) * 100);

  // Marcas más financiadas
  const brandStats = [
    { brand: 'Samsung Galaxy (A15, A25, A55)', count: 48, percentage: 42, color: 'bg-indigo-600', risk: 'Bajo (2.1% mora)' },
    { brand: 'Xiaomi Redmi (Note 13, 13C)', count: 31, percentage: 27, color: 'bg-emerald-600', risk: 'Bajo (3.4% mora)' },
    { brand: 'Motorola Moto (G24, G84)', count: 18, percentage: 16, color: 'bg-amber-500', risk: 'Medio (5.8% mora)' },
    { brand: 'Tecno Spark & Infinix Note', count: 17, percentage: 15, color: 'bg-rose-500', risk: 'Bajo (4.0% mora)' },
  ];

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 dark:text-indigo-200">
              KPIS MDM EN VIVO
            </span>
            <span className="text-xs text-slate-400">• Vista Stitch Estadísticas & Rendimiento</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            Estadísticas & Efectividad del Bloqueo CrediPay MDM
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Análisis de recuperación posterior a bloqueo de pantalla, mora en RD$ y comportamiento de pago por marca
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl flex items-center space-x-1.5">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            <span>Tasa Efectividad Bloqueo: <strong>91.4%</strong></span>
          </span>
        </div>
      </div>

      {/* Tarjetas de Recuperación MDM */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Recuperación post-bloqueo (24h)</span>
              <Award className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-3xl font-black text-white mt-3">78.6%</p>
            <p className="text-xs text-emerald-400 mt-1 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5 mr-1" />
              Pagan o reportan en las primeras 24 horas tras el bloqueo
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700/60 flex justify-between text-xs text-slate-400">
            <span>Promedio mora fija: {formatCurrencyRD(FIXED_PENALTY_AMOUNT)}</span>
            <span className="text-emerald-400 font-semibold">Alto Impacto</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Recuperación post-bloqueo (48h)</span>
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-slate-100 mt-3">91.4%</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Cartera regularizada dentro del segundo día de bloqueo MDM
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Desbloqueo automático:</span>
            <span className="font-bold text-slate-800 dark:text-slate-100">&lt; 3 segundos</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Tiempo Medio de Desbloqueo</span>
              <Clock className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-slate-100 mt-3">14.2 hrs</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Tiempo transcurrido desde orden LOCK hasta pago y UNLOCK
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Mora cobrada en 100% casos:</span>
            <span className="font-bold text-amber-600">+{formatCurrencyRD(FIXED_PENALTY_AMOUNT)} / cuota</span>
          </div>
        </div>
      </div>

      {/* Gráficos y Barras de Estado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Distribución por Estado */}
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Distribución de Cartera por Estado (Stitch)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Clasificación automática del motor de 4 estados MDM
              </p>
            </div>
            <PieChart className="w-5 h-5 text-slate-400" />
          </div>

          <div className="space-y-4 text-xs">
            {/* Al día */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="flex items-center text-emerald-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-50 dark:bg-emerald-500/100 mr-2"></span>
                  Al Día (Sin atraso)
                </span>
                <span className="text-slate-900 dark:text-slate-100">{alDiaCount} clientes ({alDiaPct}%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-emerald-50 dark:bg-emerald-500/100 h-full rounded-full" style={{ width: `${alDiaPct}%` }}></div>
              </div>
            </div>

            {/* Vencido 0-2 días */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="flex items-center text-amber-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-50 dark:bg-amber-500/100 mr-2"></span>
                  Vencido (0 a 2 días - Período de gracia)
                </span>
                <span className="text-slate-900 dark:text-slate-100">{vencidoCount} clientes ({vencidoPct}%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-amber-50 dark:bg-amber-500/100 h-full rounded-full" style={{ width: `${vencidoPct}%` }}></div>
              </div>
            </div>

            {/* Atrasado +3 días */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="flex items-center text-rose-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-50 dark:bg-rose-500/100 mr-2"></span>
                  Atrasado (+3 días, +{formatCurrencyRD(FIXED_PENALTY_AMOUNT)} mora & Bloqueado MDM)
                </span>
                <span className="text-slate-900 dark:text-slate-100">{atrasadoCount} clientes ({atrasadoPct}%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-rose-600 h-full rounded-full" style={{ width: `${atrasadoPct}%` }}></div>
              </div>
            </div>

            {/* Pagado / Finalizado */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="flex items-center text-indigo-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-50 dark:bg-indigo-500/100 mr-2"></span>
                  Crédito Finalizado (Equipo Liberado)
                </span>
                <span className="text-slate-900 dark:text-slate-100">{pagadoCount} clientes ({pagadoPct}%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${pagadoPct}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Marcas más Financiadas */}
        <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Parque por Marcas de Celulares & Riesgo de Mora
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Desglose en Pesos Dominicanos (RD$) por fabricante de smartphone
              </p>
            </div>
            <Smartphone className="w-5 h-5 text-slate-400" />
          </div>

          <div className="space-y-4 text-xs">
            {brandStats.map((item, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-800 dark:text-slate-100">{item.brand}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {item.percentage}% <span className="text-[11px] font-normal">({item.risk})</span>
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div className={`${item.color} h-full rounded-full`} style={{ width: `${item.percentage}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
