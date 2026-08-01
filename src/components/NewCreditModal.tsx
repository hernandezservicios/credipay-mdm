import React, { useState, useEffect } from 'react';
import { ClientCredit, MobileDevice, Installment } from '../types';
import { X, Smartphone, Plus, User, CreditCard, ShieldCheck, Link2, AlertCircle } from 'lucide-react';
import { useConfirm } from './ConfirmDialog';

export interface LoanDevicePreselection {
  brand: string;
  model: string;
  imei: string;
  serialNumber?: string;
  inovaguardId?: string;
  deviceName?: string;
}

interface NewCreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateCredit: (newClient: ClientCredit) => void;
  initialDevice?: LoanDevicePreselection | null;
}

export const NewCreditModal: React.FC<NewCreditModalProps> = ({
  isOpen,
  onClose,
  onCreateCredit,
  initialDevice,
}) => {
  const [fullName, setFullName] = useState('');
  const [cedulaOrId, setCedulaOrId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [brand, setBrand] = useState('Samsung');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [totalCreditAmount, setTotalCreditAmount] = useState(36000);
  const [monthlyInstallmentAmount, setMonthlyInstallmentAmount] = useState(3000);
  const [totalInstallmentsCount, setTotalInstallmentsCount] = useState(12);

  // Al abrir con un dispositivo del stock (Parque InovaGuard), precargar los datos del equipo
  useEffect(() => {
    if (isOpen && initialDevice) {
      setBrand(initialDevice.brand || 'Samsung');
      setModel(initialDevice.model || '');
      setImei(initialDevice.imei || '');
      setSerialNumber(initialDevice.serialNumber || '');
    }
  }, [isOpen, initialDevice]);

  const isDeviceLinked = !!initialDevice;
  const confirmDialog = useConfirm();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !model || !imei) {
      await confirmDialog({
        icon: <AlertCircle className="w-5 h-5" />,
        tone: 'amber',
        title: 'Campos Incompletos',
        message: 'Por favor completa el nombre del cliente, el modelo del celular y el IMEI antes de continuar.',
        confirmLabel: 'Entendido',
        confirmOnly: true,
      });
      return;
    }

    const clientId = 'CLI-' + Math.floor(100 + Math.random() * 900);
    const startDate = new Date().toISOString().split('T')[0];

    // Generar cuotas iniciales en estado PENDIENTE
    const installments: Installment[] = [];
    for (let i = 1; i <= totalInstallmentsCount; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() + i);
      installments.push({
        id: `INST-${clientId}-${i}`,
        clientId,
        number: i,
        amount: monthlyInstallmentAmount,
        dueDate: d.toISOString().split('T')[0],
        status: 'PENDIENTE',
        penaltyAmount: 0,
        totalAmount: monthlyInstallmentAmount,
      });
    }

    const device: MobileDevice = {
      id: 'DEV-' + Math.floor(100 + Math.random() * 900),
      brand,
      model,
      imei,
      serialNumber: serialNumber || 'SN-' + imei.slice(-6),
      mdmStatus: 'UNLOCKED',
      lastMdmSync: 'Hace unos instantes (Inscrito en MDM)',
      remoteLockSupported: true,
      ...(initialDevice?.inovaguardId
        ? {
            inovaguardId: initialDevice.inovaguardId,
            deviceName: initialDevice.deviceName,
          }
        : {}),
    };

    const newClient: ClientCredit = {
      id: clientId,
      fullName,
      cedulaOrId,
      phone,
      email,
      address: 'Dirección registrada en expediente',
      creditStartDate: startDate,
      totalCreditAmount,
      monthlyInstallmentAmount,
      totalInstallmentsCount,
      device,
      installments,
      notes: 'Crédito nuevo inscrito y listo para monitoreo automático de moras.',
    };

    const ok = await confirmDialog({
      icon: <Plus className="w-5 h-5" />,
      tone: 'emerald',
      title: 'Confirmar Nuevo Crédito',
      message: `¿CONFIRMAR el registro del nuevo crédito?\n\nCliente: ${fullName}\nCelular: ${brand} ${model} (IMEI ${imei})\nMonto: RD$${totalCreditAmount} en ${totalInstallmentsCount} cuotas de RD$${monthlyInstallmentAmount}\n\nEl cliente y el dispositivo quedarán inscritos en el monitoreo MDM.`,
      confirmLabel: 'Sí, Registrar Crédito',
    });
    if (!ok) return;

    onCreateCredit(newClient);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Nuevo Crédito & Inscripción CrediPay MDM (RD$)</h2>
              <p className="text-xs text-slate-300">
                Registra un cliente, celular y plan de cuotas monitoreadas en Pesos Dominicanos
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
          {/* Datos del cliente */}
          <div>
            <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center space-x-1.5 border-b pb-2">
              <User className="w-4 h-4 text-emerald-600" />
              <span>1. Datos del Cliente</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej: Laura Sofía Torres"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cédula / DNI *</label>
                <input
                  type="text"
                  required
                  value={cedulaOrId}
                  onChange={(e) => setCedulaOrId(e.target.value)}
                  placeholder="Ej: 001-9283741-2"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Teléfono (WhatsApp)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 809-555-0101"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@correo.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Datos del celular */}
          <div>
            <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center space-x-1.5 border-b pb-2">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <span>{isDeviceLinked ? '2. Dispositivo Vinculado del Stock MDM' : '2. Dispositivo a Financiar (MDM Inscrito)'}</span>
            </h3>

            {isDeviceLinked && (
              <div className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900 flex items-start space-x-2">
                <Link2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  Dispositivo vinculado desde <strong>Parque InovaGuard # {initialDevice.inovaguardId}</strong>{' '}
                  ({initialDevice.deviceName}). Los datos del equipo provienen del MDM y no pueden
                  modificarse; al crear el préstamo quedará asignado a este cliente.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Marca</label>
                <select
                  value={brand}
                  disabled={isDeviceLinked}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="Samsung">Samsung</option>
                  <option value="Apple">Apple (iPhone)</option>
                  <option value="Xiaomi">Xiaomi / Redmi</option>
                  <option value="Motorola">Motorola</option>
                  <option value="Realme">Realme</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Modelo exacto *</label>
                <input
                  type="text"
                  required
                  value={model}
                  disabled={isDeviceLinked}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Ej: Galaxy A55 5G 256GB"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IMEI del Equipo (15 dígitos) *</label>
                <input
                  type="text"
                  required
                  value={imei}
                  disabled={isDeviceLinked}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder="358920198234001"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Número de Serie (Opcional)</label>
                <input
                  type="text"
                  value={serialNumber}
                  disabled={isDeviceLinked}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="SN-XXXXX"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
            </div>
          </div>

          {/* Plan de cuotas */}
          <div>
            <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center space-x-1.5 border-b pb-2">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <span>3. Plan de Cuotas & Monitoreo</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Monto Total del Crédito</label>
                <input
                  type="number"
                  value={totalCreditAmount}
                  onChange={(e) => setTotalCreditAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cuotas Mensuales</label>
                <select
                  value={totalInstallmentsCount}
                  onChange={(e) => setTotalInstallmentsCount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                >
                  <option value={6}>6 Cuotas</option>
                  <option value={12}>12 Cuotas</option>
                  <option value={18}>18 Cuotas</option>
                  <option value={24}>24 Cuotas</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cuota Base (RD$/mes)</label>
                <input
                  type="number"
                  value={monthlyInstallmentAmount}
                  onChange={(e) => setMonthlyInstallmentAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Nota */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>
              Al crear el préstamo, el celular queda inscrito en el motor CrediPay MDM. Si una cuota pasa 3 días del vencimiento, se convertirá en <strong>ATRASADO</strong> (+RD$200 mora fija) y se enviará la orden de <strong>Bloqueo de pantalla</strong>.
            </span>
          </div>

          {/* Botones */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-xs transition-colors"
            >
              Registrar Cliente y Préstamo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
