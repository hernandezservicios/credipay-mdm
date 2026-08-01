import React, { useState } from 'react';
import { ClientCredit, InstallmentStatus } from '../types';
import { Smartphone, Lock, Unlock, AlertTriangle, CheckCircle, Clock, Search, Filter, Calendar } from 'lucide-react';
import { MdmActionDropdown } from './MdmActionDropdown';

interface ClientListProps {
  clients: ClientCredit[];
  filterStatus: 'ALL' | 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO';
  onSelectClientForInstallments: (client: ClientCredit) => void;
  onSelectClientForAi: (client: ClientCredit) => void;
  onLockDevice: (clientId: string, reason: string) => void;
  onUnlockDevice: (clientId: string, reason: string) => void;
  onCheckStatus: (clientId: string) => void;
  onFilterChange: (status: 'ALL' | 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO') => void;
  onGenerateUnlockCode?: (clientId: string) => void;
  onRemoveDevice?: (clientId: string) => void;
}

export const ClientList: React.FC<ClientListProps> = ({
  clients,
  filterStatus,
  onSelectClientForInstallments,
  onSelectClientForAi,
  onLockDevice,
  onUnlockDevice,
  onCheckStatus,
  onFilterChange,
  onGenerateUnlockCode,
  onRemoveDevice,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Helper para determinar el estado general de las cuotas del cliente
  const getClientOverallStatus = (client: ClientCredit): {
    status: InstallmentStatus;
    label: string;
    badgeClass: string;
    overdueInstallmentsCount: number;
    penaltyTotal: number;
  } => {
    const overdue = client.installments.filter((i) => i.status === 'ATRASADO');
    const due = client.installments.filter((i) => i.status === 'VENCIDO');
    const pending = client.installments.filter((i) => i.status === 'PENDIENTE');
    const paid = client.installments.filter((i) => i.status === 'PAGADO');

    if (overdue.length > 0) {
      const penalty = overdue.reduce((sum, item) => sum + item.penaltyAmount, 0);
      return {
        status: 'ATRASADO',
        label: `Atrasado (${overdue.length} cuotas >3 días) - Mora RD$${penalty}`,
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        overdueInstallmentsCount: overdue.length,
        penaltyTotal: penalty,
      };
    }
    if (due.length > 0) {
      return {
        status: 'VENCIDO',
        label: 'Vencido hoy/reciente (Día 0-2)',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        overdueInstallmentsCount: 0,
        penaltyTotal: 0,
      };
    }
    if (pending.length > 0) {
      return {
        status: 'PENDIENTE',
        label: 'Al día (Cuotas pendientes)',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
        overdueInstallmentsCount: 0,
        penaltyTotal: 0,
      };
    }
    return {
      status: 'PAGADO',
      label: 'Crédito Completado / Pagado',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      overdueInstallmentsCount: 0,
      penaltyTotal: 0,
    };
  };

  const filteredClients = clients.filter((client) => {
    const overall = getClientOverallStatus(client);
    const matchesFilter =
      filterStatus === 'ALL' ||
      (filterStatus === 'ATRASADO' && (overall.status === 'ATRASADO' || client.device.mdmStatus === 'LOCKED')) ||
      overall.status === filterStatus;

    const query = searchQuery.toLowerCase();
    const matchesSearch =
      client.fullName.toLowerCase().includes(query) ||
      client.cedulaOrId.toLowerCase().includes(query) ||
      client.device.model.toLowerCase().includes(query) ||
      client.device.imei.includes(query) ||
      client.phone.includes(query);

    return matchesFilter && matchesSearch;
  });

  return (
    <div>
      {/* Barra de Búsqueda y Filtros por Estado */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Input de búsqueda */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por cliente, cédula, modelo de celular o IMEI..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-colors"
          />
        </div>

        {/* Filtros rápidos de estado */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: 'Todos', color: 'slate' },
              { id: 'PENDIENTE', label: 'Pendiente', color: 'blue' },
              { id: 'VENCIDO', label: 'Vencido (0-2 d)', color: 'amber' },
              { id: 'ATRASADO', label: 'Atrasado (+3 d / Mora RD$200)', color: 'rose' },
              { id: 'PAGADO', label: 'Pagado', color: 'emerald' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => onFilterChange(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filterStatus === item.id
                  ? item.id === 'ATRASADO'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Clientes */}
      {filteredClients.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
          <Smartphone className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="font-medium text-sm">No se encontraron clientes para este filtro o búsqueda.</p>
          <p className="text-xs text-slate-400 mt-1">Prueba cambiando los criterios de búsqueda.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredClients.map((client) => {
            const overall = getClientOverallStatus(client);
            const isLocked = client.device.mdmStatus === 'LOCKED';

            return (
              <div
                key={client.id}
                className={`bg-white border rounded-xl p-5 shadow-sm transition-all hover:shadow-md ${
                  isLocked ? 'border-l-4 border-l-rose-600 border-rose-200/80' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Info del Cliente y Celular */}
                  <div className="flex items-start space-x-4">
                    <img
                      src={client.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
                      alt={client.fullName}
                      className="w-12 h-12 rounded-full object-cover border border-slate-200 shadow-xs shrink-0"
                    />

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-slate-900 text-sm">{client.fullName}</h3>
                        <span className="text-xs text-slate-500 font-mono">({client.cedulaOrId})</span>

                        {/* Estado MDM del Celular */}
                        {isLocked ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-600 text-white shadow-xs">
                            <Lock className="w-3 h-3" />
                            <span>CELULAR BLOQUEADO (MDM LOCK)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <Unlock className="w-3 h-3 text-emerald-600" />
                            <span>DESBLOQUEADO</span>
                          </span>
                        )}

                        {client.device.inovaguardId && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            InovaGuard #{client.device.inovaguardId}
                          </span>
                        )}

                        {client.device.lastUnlockCode && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Unlock Code: {client.device.lastUnlockCode}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="flex items-center space-x-1">
                          <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-medium">{client.device.model}</span>
                        </span>
                        <span>IMEI: <strong className="font-mono text-slate-800">{client.device.imei}</strong></span>
                        <span>Tel: {client.phone}</span>
                      </div>

                      {/* Estado de las cuotas y moras */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${overall.badgeClass}`}
                        >
                          {overall.label}
                        </span>

                        <span className="text-xs text-slate-500">
                          Cuotas mes: <strong>RD${client.monthlyInstallmentAmount.toLocaleString()}</strong> ({client.installments.filter(i => i.status === 'PAGADO').length}/{client.totalInstallmentsCount} pagadas)
                        </span>

                        {client.notes && (
                          <span className="text-xs text-slate-400 italic">
                            • {client.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Botones de acción derecha */}
                  <div className="flex items-center space-x-2 self-end lg:self-center shrink-0">
                    <button
                      onClick={() => onSelectClientForInstallments(client)}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors shadow-xs"
                    >
                      Ver Cuotas & Cobrar
                    </button>

                    <MdmActionDropdown
                      device={client.device}
                      clientId={client.id}
                      clientName={client.fullName}
                      onLockDevice={onLockDevice}
                      onUnlockDevice={onUnlockDevice}
                      onCheckStatus={onCheckStatus}
                      onOpenInstallments={() => onSelectClientForInstallments(client)}
                      onOpenAiCobranza={() => onSelectClientForAi(client)}
                      onGenerateUnlockCode={onGenerateUnlockCode}
                      onRemoveDevice={onRemoveDevice}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
