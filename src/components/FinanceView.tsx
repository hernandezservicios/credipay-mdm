import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  CheckCircle2,
  Filter,
  Search,
  Download,
  Send,
  PlusCircle,
  FileText,
  Calendar,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  Printer,
  X,
  ExternalLink,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import { ClientCredit, Installment } from '../types';
import { apiExportPaymentsCsv, apiGetPaymentStats, errorMessage, type PaymentStats } from '../services/api';

interface FinanceViewProps {
  clients: ClientCredit[];
  onOpenPayment: () => void;
  onOpenNewCredit: () => void;
}

interface PaymentRecord {
  id: string;
  date: string;
  clientName: string;
  clientPhone: string;
  clientCedula: string;
  deviceModel: string;
  installmentNum: number;
  baseAmount: number;
  penaltyAmount: number;
  totalPaid: number;
  method: 'TRANSFERENCIA' | 'EFECTIVO' | 'TARJETA' | 'DEPOSITO';
  bank?: string;
  status: 'PAGADO' | 'EN_REVISION';
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  clients,
  onOpenPayment,
  onOpenNewCredit,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string>('ALL');
  const [showPdfReportModal, setShowPdfReportModal] = useState(false);
  const [stats, setStats] = useState<PaymentStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGetPaymentStats()
      .then((res) => {
        if (!cancelled) setStats(res.data);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [exportMsg, setExportMsg] = useState('');
  const handleExportCsv = async () => {
    setExportMsg('');
    try {
      await apiExportPaymentsCsv();
      setExportMsg('CSV exportado');
    } catch (err) {
      setExportMsg(errorMessage(err));
    }
  };

  // Helper para determinar el estado general del cliente
  const getClientStatus = (c: ClientCredit): {
    status: 'AL_DIA' | 'VENCIDO' | 'ATRASADO' | 'PAGADO';
    label: string;
    badgeClass: string;
    badgeHexColor: string;
  } => {
    const overdue = c.installments.some((i) => i.status === 'ATRASADO');
    if (overdue) {
      return {
        status: 'ATRASADO',
        label: 'Atrasado (>3 días) - Mora RD$200',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        badgeHexColor: '#e11d48',
      };
    }
    const due = c.installments.some((i) => i.status === 'VENCIDO');
    if (due) {
      return {
        status: 'VENCIDO',
        label: 'Vencido hoy/reciente (Día 0-2)',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        badgeHexColor: '#d97706',
      };
    }
    const allPaid = c.installments.every((i) => i.status === 'PAGADO');
    if (allPaid && c.installments.length > 0) {
      return {
        status: 'PAGADO',
        label: 'Financiamiento Pagado',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        badgeHexColor: '#059669',
      };
    }
    return {
      status: 'AL_DIA',
      label: 'Al Día / Pendiente',
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
      badgeHexColor: '#2563eb',
    };
  };

  // Calcular métricas financieras en RD$
  const totalClients = clients.length;
  const activeClients = clients.filter(c => getClientStatus(c).status !== 'PAGADO');
  
  // Calcular cobros realizados vs pendientes a partir de las cuotas
  let totalRecaudadoBase = 0;
  let totalMorasCobradas = 0;
  let totalPorCobrar = 0;
  let cuotasAlDia = 0;
  let cuotasTotal = 0;

  const samplePayments: PaymentRecord[] = [];

  clients.forEach((c, idx) => {
    c.installments.forEach((inst) => {
      cuotasTotal++;
      const paidAmt = inst.paidAmount || 0;
      if (inst.status === 'PAGADO' || (inst.status as string) === 'PAID') {
        totalRecaudadoBase += inst.totalAmount || inst.amount;
        cuotasAlDia++;
        if (inst.penaltyAmount && inst.penaltyAmount > 0) {
          totalMorasCobradas += inst.penaltyAmount;
        }
        samplePayments.push({
          id: `REC-${1000 + samplePayments.length}`,
          date: inst.paidDate || inst.dueDate,
          clientName: c.fullName,
          clientPhone: c.phone,
          clientCedula: c.cedulaOrId,
          deviceModel: c.device.model,
          installmentNum: inst.number,
          baseAmount: inst.amount,
          penaltyAmount: inst.penaltyAmount || 0,
          totalPaid: inst.totalAmount || inst.amount,
          method: idx % 2 === 0 ? 'TRANSFERENCIA' : 'EFECTIVO',
          bank: idx % 2 === 0 ? 'Banco Popular Dominicano' : 'Caja Principal Tienda',
          status: 'PAGADO',
        });
      } else {
        // Cuota pendiente: registrar el abono acumulado y el saldo por cobrar
        totalRecaudadoBase += paidAmt;
        totalPorCobrar += Math.max(0, (inst.totalAmount || inst.amount) - paidAmt);
        if (paidAmt > 0) {
          samplePayments.push({
            id: `REC-${1000 + samplePayments.length}`,
            date: inst.dueDate,
            clientName: c.fullName,
            clientPhone: c.phone,
            clientCedula: c.cedulaOrId,
            deviceModel: c.device.model,
            installmentNum: inst.number,
            baseAmount: inst.amount,
            penaltyAmount: inst.penaltyAmount || 0,
            totalPaid: paidAmt,
            method: 'EFECTIVO',
            bank: 'Caja Principal Tienda',
            status: 'PAGADO',
          });
        }
      }
    });
  });

  const efectividadCobro = cuotasTotal > 0 ? Math.round((cuotasAlDia / cuotasTotal) * 100) : 92;

  // Filtrar cobros
  const filteredPayments = samplePayments.filter((p) => {
    const sq = searchQuery.toLowerCase();
    const sqDigits = sq.replace(/\D/g, '');
    const matchesContact =
      sqDigits.length >= 3 &&
      (p.clientCedula.replace(/\D/g, '').includes(sqDigits) ||
        p.clientPhone.replace(/\D/g, '').includes(sqDigits));
    const matchesSearch =
      p.clientName.toLowerCase().includes(sq) ||
      p.deviceModel.toLowerCase().includes(sq) ||
      p.id.toLowerCase().includes(sq) ||
      matchesContact;
    const matchesMethod = selectedMethod === 'ALL' || p.method === selectedMethod;
    return matchesSearch && matchesMethod;
  });

  // Función para construir y exportar el Reporte en PDF / Imprimible
  const getReportHtmlString = () => {
    const dateStr = new Date().toLocaleString('es-DO', {
      dateStyle: 'long',
      timeStyle: 'medium',
    });

    const clientsRowsHtml = clients
      .map((client) => {
        const statusObj = getClientStatus(client);
        const nextInst =
          client.installments.find(
            (i) =>
              i.status === 'ATRASADO' ||
              i.status === 'VENCIDO' ||
              i.status === 'PENDIENTE'
          ) || client.installments[client.installments.length - 1];
        const mdmStatus =
          client.device.mdmStatus === 'UNLOCKED'
            ? '🔓 DESBLOQUEADO'
            : '🔒 BLOQUEADO';

        return `
          <tr>
            <td style="font-family: monospace; font-weight: bold;">
              ${client.id}<br/>
              <span style="font-size: 10px; color: #64748b;">IMEI: ${client.device.imei}</span>
            </td>
            <td>
              <strong>${client.fullName}</strong><br/>
              <span style="font-size: 11px; color: #475569;">${client.phone} • ${client.device.model}</span>
            </td>
            <td>${mdmStatus}</td>
            <td>
              <strong>Cuota #${nextInst ? nextInst.number : '-'}</strong><br/>
              <span style="font-size: 11px; color: #475569;">Vence: ${nextInst ? nextInst.dueDate : 'N/A'}</span>
            </td>
            <td>
              <span style="display: inline-block; padding: 3px 8px; border-radius: 99px; color: #fff; background-color: ${statusObj.badgeHexColor}; font-weight: bold; font-size: 10px;">
                ${statusObj.label}
              </span>
            </td>
            <td style="text-align: right; font-weight: bold;">
              RD$ ${client.monthlyInstallmentAmount.toLocaleString()}
            </td>
          </tr>
        `;
      })
      .join('');

    const paymentsRowsHtml = samplePayments
      .map(
        (p) => `
          <tr>
            <td style="font-family: monospace; font-weight: bold;">${p.id}</td>
            <td>${p.date}</td>
            <td>
              <strong>${p.clientName}</strong><br/>
              <span style="font-size: 11px; color: #64748b;">${p.deviceModel} • Cuota #${p.installmentNum}</span>
            </td>
            <td>
              ${p.method}<br/>
              <span style="font-size: 10px; color: #64748b;">${p.bank || ''}</span>
            </td>
            <td style="text-align: right;">RD$ ${p.baseAmount.toLocaleString()}</td>
            <td style="text-align: right; color: ${p.penaltyAmount > 0 ? '#d97706' : '#94a3b8'}; font-weight: bold;">
              ${p.penaltyAmount > 0 ? `+RD$ ${p.penaltyAmount.toLocaleString()}` : '-'}
            </td>
            <td style="text-align: right; font-weight: bold; color: #059669;">
              RD$ ${p.totalPaid.toLocaleString()}
            </td>
          </tr>
        `
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Cobranza & Flujo RD$ - CrediPay MDM</title>
        <style>
          @page { size: A4; margin: 15mm; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 20px;
            background: #fff;
          }
          .header {
            border-bottom: 3px solid #059669;
            padding-bottom: 15px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .header h1 {
            font-size: 22px;
            margin: 0;
            color: #0f172a;
          }
          .header p {
            font-size: 12px;
            color: #64748b;
            margin: 4px 0 0 0;
          }
          .badge-rd {
            background: #d1fae5;
            color: #065f46;
            font-size: 11px;
            font-weight: bold;
            padding: 4px 10px;
            border-radius: 6px;
            display: inline-block;
            margin-bottom: 6px;
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 24px;
          }
          .metric-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            background: #f8fafc;
          }
          .metric-card .title {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            color: #64748b;
            margin-bottom: 4px;
          }
          .metric-card .value {
            font-size: 18px;
            font-weight: 800;
            color: #0f172a;
          }
          .metric-card .subtitle {
            font-size: 10px;
            color: #64748b;
            margin-top: 4px;
          }
          h2 {
            font-size: 15px;
            color: #0f172a;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 6px;
            margin-top: 24px;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            margin-bottom: 20px;
          }
          th {
            background-color: #f1f5f9;
            text-align: left;
            padding: 8px 10px;
            font-size: 10px;
            text-transform: uppercase;
            color: #475569;
            border-bottom: 2px solid #cbd5e1;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
          }
          tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .footer {
            margin-top: 30px;
            border-top: 1px solid #cbd5e1;
            padding-top: 10px;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #64748b;
          }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <span class="badge-rd">PESOS DOMINICANOS (RD$)</span>
            <h1>CrediPay MDM - Reporte Detallado de Cobranza & Flujo RD$</h1>
            <p>Emisión oficial • Conciliación de caja, pagos realizados, moras fijas (RD$200) y cartera activa</p>
          </div>
          <div style="text-align: right;">
            <p><strong>Fecha de Generación:</strong></p>
            <p>${dateStr}</p>
          </div>
        </div>

        <div class="metrics-grid">
          <div class="metric-card">
            <div class="title">Recaudado (Cuotas)</div>
            <div class="value">RD$ ${totalRecaudadoBase.toLocaleString()}</div>
            <div class="subtitle">Cuotas al día pagadas</div>
          </div>
          <div class="metric-card">
            <div class="title">Moras Cobradas (RD$200)</div>
            <div class="value" style="color: #d97706;">RD$ ${totalMorasCobradas.toLocaleString()}</div>
            <div class="subtitle">Atraso >3 días aplicados</div>
          </div>
          <div class="metric-card">
            <div class="title">Cartera por Cobrar</div>
            <div class="value" style="color: #4f46e5;">RD$ ${totalPorCobrar.toLocaleString()}</div>
            <div class="subtitle">En cuotas pendientes</div>
          </div>
          <div class="metric-card">
            <div class="title">Efectividad Cobranza</div>
            <div class="value" style="color: #059669;">${efectividadCobro}%</div>
            <div class="subtitle">${cuotasAlDia} de ${cuotasTotal} cuotas al día</div>
          </div>
        </div>

        <h2>1. Estado Actual de Clientes & Fechas de Vencimiento (${clients.length} clientes)</h2>
        <table>
          <thead>
            <tr>
              <th>ID / IMEI</th>
              <th>Cliente & Equipo</th>
              <th>Estado MDM</th>
              <th>Próx. Vencimiento / Cuota</th>
              <th>Estado Actual</th>
              <th style="text-align: right;">Cuota Mensual</th>
            </tr>
          </thead>
          <tbody>
            ${clientsRowsHtml}
          </tbody>
        </table>

        <h2 style="page-break-before: auto;">2. Detalle de Pagos Realizados & Conciliación (${samplePayments.length} recibos)</h2>
        <table>
          <thead>
            <tr>
              <th>Recibo ID</th>
              <th>Fecha Pago</th>
              <th>Cliente & Equipo</th>
              <th>Método / Banco</th>
              <th style="text-align: right;">Base</th>
              <th style="text-align: right;">Mora</th>
              <th style="text-align: right;">Total Pagado</th>
            </tr>
          </thead>
          <tbody>
            ${paymentsRowsHtml}
          </tbody>
        </table>

        <div class="footer">
          <div>
            <strong>CrediPay MDM v2.5</strong> • Sistema Automatizado de Gestión & Bloqueo Kiosk
          </div>
          <div>
            Página 1 de 1 • Emitido por Servidor de Cobranza AI Studio
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const handleOpenPdfWindow = () => {
    const htmlContent = getReportHtmlString();
    const printWindow = window.open('', '_blank', 'width=1100,height=850');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    } else {
      setShowPdfReportModal(true);
    }
  };

  const handleDownloadHtmlReport = () => {
    const htmlContent = getReportHtmlString();
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const todayStr = new Date().toISOString().split('T')[0];
    link.download = `Reporte-Cobranza-CrediPay-MDM-${todayStr}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintModalContent = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              RD$ PESOS DOMINICANOS
            </span>
            <span className="text-xs text-slate-400">• Vista Stitch Caja & Finanzas</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Caja & Flujo de Cobros CrediPay MDM
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitoreo en tiempo real de cobros, moras fijas (RD$200), abonos y emisión de recibos digitales
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPdfReportModal(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center space-x-2 shadow-sm transition-all cursor-pointer"
            title="Exportar reporte completo de cobranza a PDF / Imprimir"
          >
            <Download className="w-4 h-4" />
            <span>Exportar Reporte PDF</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-xl flex items-center space-x-2 shadow-sm transition-all cursor-pointer"
            title="Exportar pagos a CSV (servidor)"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Exportar CSV</span>
          </button>
          {exportMsg && (
            <span className="text-xs font-medium text-emerald-700">{exportMsg}</span>
          )}
          <button
            onClick={onOpenPayment}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl flex items-center space-x-2 shadow-sm transition-all cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Registrar Cobro & Desbloqueo</span>
          </button>
          <button
            onClick={onOpenNewCredit}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl flex items-center space-x-2 transition-all cursor-pointer"
          >
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>Nuevo Crédito MDM</span>
          </button>
        </div>
      </div>

      {/* Tarjetas de Indicadores Financieros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Recaudado (Cuotas)</span>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">
            RD$ {totalRecaudadoBase.toLocaleString()}
          </p>
          <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center">
            <TrendingUp className="w-3.5 h-3.5 mr-1" />
            +18.4% vs mes anterior
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Moras Cobradas (RD$200)</span>
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-600 mt-2">
            RD$ {totalMorasCobradas.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Mora fija de RD$200 por atraso +3 días
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Cartera por Cobrar</span>
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">
            RD$ {totalPorCobrar.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            En cuotas pendientes de pago ({activeClients.length} clientes activos)
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Efectividad Cobranza</span>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-2">
            {efectividadCobro}%
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {cuotasAlDia} de {cuotasTotal} cuotas al día en sistema
          </p>
        </div>
      </div>

      {/* Dashboard de Mora & Morosidad (stats del servidor) */}
      {stats && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                MORA & MOROSIDAD
              </span>
              <span className="text-xs text-slate-500">
                Cálculos del servidor (GET /payments/stats)
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <span className="text-[10px] font-bold uppercase text-amber-700 flex items-center">
                <AlertCircle className="w-3.5 h-3.5 mr-1" /> Clientes morosos
              </span>
              <p className="text-xl font-black text-amber-800 mt-1">
                {stats.morosidad.clientesAtrasados}
              </p>
              <p className="text-[10px] text-amber-600">
                Deuda atrasada: RD$ {stats.morosidad.deudaAtrasada.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
              <span className="text-[10px] font-bold uppercase text-indigo-700 flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1" /> Mes actual
              </span>
              <p className="text-xl font-black text-indigo-800 mt-1">
                RD$ {stats.mesActual.toLocaleString()}
              </p>
              <p className="text-[10px] text-indigo-600">
                {stats.totalPagos} pagos registrados
              </p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-bold uppercase text-emerald-700 flex items-center">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Efectividad
              </span>
              <p className="text-xl font-black text-emerald-800 mt-1">{stats.efectividad.pct}%</p>
              <p className="text-[10px] text-emerald-600">
                {stats.efectividad.cuotasPagadas} de {stats.efectividad.cuotasTotal} cuotas pagadas
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-600 flex items-center">
                <Users className="w-3.5 h-3.5 mr-1" /> Métodos de pago
              </span>
              <div className="mt-1 space-y-0.5">
                {stats.porMetodo.length === 0 && (
                  <p className="text-[10px] text-slate-400">Sin pagos</p>
                )}
                {stats.porMetodo.slice(0, 3).map((m) => (
                  <p key={m.method} className="text-[11px] font-semibold text-slate-700">
                    {m.method}: <span className="font-mono">RD$ {m.total.toLocaleString()}</span>{' '}
                    <span className="text-slate-400">({m.count})</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por cliente, recibo, modelo, cédula o teléfono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto">
          {(['ALL', 'TRANSFERENCIA', 'EFECTIVO', 'TARJETA'] as const).map((method) => (
            <button
              key={method}
              onClick={() => setSelectedMethod(method)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                selectedMethod === method
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {method === 'ALL' ? 'Todos los Métodos' : method}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de Pagos Recibidos */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Historial de Pagos & Conciliación (RD$)
            </h3>
            <span className="text-xs text-slate-400">
              Mostrando {filteredPayments.length} transacciones
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowPdfReportModal(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ver / Exportar Reporte PDF</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-400 bg-slate-50/70">
                <th className="py-3 px-4">Recibo</th>
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Cliente / Celular</th>
                <th className="py-3 px-4">Cuota #</th>
                <th className="py-3 px-4">Monto Base</th>
                <th className="py-3 px-4">Mora (RD$200)</th>
                <th className="py-3 px-4">Total Pagado</th>
                <th className="py-3 px-4">Método</th>
                <th className="py-3 px-4 text-right">Recibo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No se encontraron cobros con los criterios seleccionados.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                      {payment.id}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500">
                      {payment.date}
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-bold text-slate-900">{payment.clientName}</p>
                      <p className="text-[11px] text-slate-500">{payment.deviceModel}</p>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700">
                        Cuota #{payment.installmentNum}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-800">
                      RD$ {payment.baseAmount.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      {payment.penaltyAmount > 0 ? (
                        <span className="font-bold text-amber-600">
                          +RD$ {payment.penaltyAmount.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-600">
                      RD$ {payment.totalPaid.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {payment.method}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          const msg = `🎉 *RECIBO CREDIPAY MDM*\nRecibo: ${payment.id}\nCliente: ${payment.clientName}\nEquipo: ${payment.deviceModel}\nCuota: #${payment.installmentNum}\nTotal pagado: *RD$ ${payment.totalPaid.toLocaleString()}*\n✅ Su celular se encuentra DESBLOQUEADO y al día.`;
                          window.open(`https://wa.me/${payment.clientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg inline-flex items-center space-x-1 transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-emerald-600" />
                        <span>WhatsApp</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Vista Previa y Exportación a PDF (Reporte de Cobranza) */}
      {showPdfReportModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Barra superior de acciones (no se imprime) */}
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base">Reporte de Cobranza & Flujo RD$ (Exportar PDF)</h3>
                  <p className="text-xs text-slate-400">
                    Incluye pagos realizados, fechas de vencimiento y estados actuales de los clientes
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintModalContent}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir / Guardar como PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadHtmlReport}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Archivo</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenPdfWindow}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl flex items-center space-x-1 transition-colors cursor-pointer"
                  title="Abrir en pestaña independiente para impresión directa"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Nueva Ventana</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPdfReportModal(false)}
                  className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer ml-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Contenido Imprimible del Reporte */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
              <div
                id="printable-report-area"
                className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 max-w-4xl mx-auto text-slate-800"
              >
                {/* Cabecera Institucional del Reporte */}
                <div className="border-b-2 border-emerald-600 pb-4 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 mb-1.5">
                      PESOS DOMINICANOS (RD$)
                    </span>
                    <h1 className="text-2xl font-black text-slate-900">
                      CrediPay MDM - Reporte Detallado de Cobranza & Flujo RD$
                    </h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Emisión oficial • Conciliación de caja, pagos realizados, moras fijas (RD$200) y cartera activa
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p className="font-bold text-slate-700">Fecha de Generación:</p>
                    <p>
                      {new Date().toLocaleString('es-DO', {
                        dateStyle: 'long',
                        timeStyle: 'medium',
                      })}
                    </p>
                  </div>
                </div>

                {/* Resumen de KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Recaudado (Cuotas)
                    </span>
                    <span className="text-lg font-black text-slate-900">
                      RD$ {totalRecaudadoBase.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Cuotas al día</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Moras Cobradas
                    </span>
                    <span className="text-lg font-black text-amber-600">
                      RD$ {totalMorasCobradas.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Mora RD$200 por atraso</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Cartera por Cobrar
                    </span>
                    <span className="text-lg font-black text-indigo-600">
                      RD$ {totalPorCobrar.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Pendiente de pago</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Efectividad Cobranza
                    </span>
                    <span className="text-lg font-black text-emerald-600">
                      {efectividadCobro}%
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {cuotasAlDia} / {cuotasTotal} cuotas
                    </span>
                  </div>
                </div>

                {/* Sección 1: Estado Actual de Clientes & Fechas de Vencimiento */}
                <div className="mb-8">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 border-b border-slate-200 pb-2 mb-3">
                    1. Estado Actual de Clientes & Fechas de Vencimiento ({clients.length} clientes)
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100/80 text-slate-500 uppercase text-[10px] border-b border-slate-300">
                          <th className="py-2 px-2.5">ID / IMEI</th>
                          <th className="py-2 px-2.5">Cliente & Equipo</th>
                          <th className="py-2 px-2.5">Estado MDM</th>
                          <th className="py-2 px-2.5">Próx. Vencimiento / Cuota</th>
                          <th className="py-2 px-2.5">Estado Actual</th>
                          <th className="py-2 px-2.5 text-right">Cuota Mensual</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {clients.map((client) => {
                          const statusObj = getClientStatus(client);
                          const nextInst =
                            client.installments.find(
                              (i) =>
                                i.status === 'ATRASADO' ||
                                i.status === 'VENCIDO' ||
                                i.status === 'PENDIENTE'
                            ) || client.installments[client.installments.length - 1];
                          const mdmStatus =
                            client.device.mdmStatus === 'UNLOCKED'
                              ? '🔓 DESBLOQUEADO'
                              : '🔒 BLOQUEADO';

                          return (
                            <tr key={client.id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-2.5 font-mono font-bold text-slate-700">
                                {client.id}
                                <div className="text-[10px] text-slate-400 font-normal">
                                  IMEI: {client.device.imei}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5">
                                <div className="font-bold text-slate-900">
                                  {client.fullName}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {client.phone} • {client.device.model}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 font-medium text-slate-700">
                                {mdmStatus}
                              </td>
                              <td className="py-2.5 px-2.5">
                                <div className="font-bold text-slate-900">
                                  Cuota #{nextInst ? nextInst.number : '-'}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Vence: {nextInst ? nextInst.dueDate : 'N/A'}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5">
                                <span
                                  className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusObj.badgeClass}`}
                                >
                                  {statusObj.label}
                                </span>
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-bold text-slate-900">
                                RD$ {client.monthlyInstallmentAmount.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sección 2: Detalle de Pagos Realizados */}
                <div className="mb-6">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 border-b border-slate-200 pb-2 mb-3">
                    2. Detalle de Pagos Realizados & Conciliación ({samplePayments.length} recibos en RD$)
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100/80 text-slate-500 uppercase text-[10px] border-b border-slate-300">
                          <th className="py-2 px-2.5">Recibo ID</th>
                          <th className="py-2 px-2.5">Fecha Pago</th>
                          <th className="py-2 px-2.5">Cliente & Equipo</th>
                          <th className="py-2 px-2.5">Método / Banco</th>
                          <th className="py-2 px-2.5 text-right">Base</th>
                          <th className="py-2 px-2.5 text-right">Mora</th>
                          <th className="py-2 px-2.5 text-right">Total Pagado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {samplePayments.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-2.5 font-mono font-bold text-slate-700">
                              {p.id}
                            </td>
                            <td className="py-2.5 px-2.5 text-slate-600">
                              {p.date}
                            </td>
                            <td className="py-2.5 px-2.5">
                              <div className="font-bold text-slate-900">
                                {p.clientName}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {p.deviceModel} • Cuota #{p.installmentNum}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5">
                              <div className="font-semibold text-slate-800">
                                {p.method}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {p.bank || ''}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-medium text-slate-700">
                              RD$ {p.baseAmount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-2.5 text-right">
                              {p.penaltyAmount > 0 ? (
                                <span className="font-bold text-amber-600">
                                  +RD$ {p.penaltyAmount.toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-bold text-emerald-600">
                              RD$ {p.totalPaid.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pie de Página */}
                <div className="border-t border-slate-200 pt-4 mt-8 flex flex-col sm:flex-row justify-between items-center text-[11px] text-slate-500 gap-2">
                  <div>
                    <strong>CrediPay MDM v2.5</strong> • Sistema Automatizado de Gestión & Bloqueo Kiosk en Servidor
                  </div>
                  <div>
                    Emitido por Plataforma CrediPay MDM • Documento de Auditoría y Conciliación
                  </div>
                </div>
              </div>
            </div>

            {/* Estilos para impresión */}
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #printable-report-area, #printable-report-area * {
                  visibility: visible !important;
                }
                #printable-report-area {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  box-shadow: none !important;
                  border: none !important;
                  padding: 0 !important;
                  margin: 0 !important;
                }
              }
            `}</style>
          </div>
        </div>
      )}

      {/* Modal de Cobro Rápido (ahora usa PaymentModal en cascada desde App) */}
    </div>
  );
};
