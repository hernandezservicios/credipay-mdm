import React, { useState } from 'react';
import {
  BrainCircuit,
  PlayCircle,
  Send,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  MessageSquare,
  History,
  RefreshCw,
} from 'lucide-react';
import type {
  CollectionReminderRow,
  CollectionReminderType,
  CollectionRisk,
  CollectionRunRow,
  CollectionSummaryRow,
} from '../services/api';

const RISK_LABEL: Record<CollectionRisk, string> = {
  BAJO: 'Bajo',
  MEDIO: 'Medio',
  ALTO: 'Alto',
};

const RISK_CLASS: Record<CollectionRisk, string> = {
  BAJO: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  MEDIO: 'bg-amber-100 text-amber-700 border-amber-200',
  ALTO: 'bg-rose-100 text-rose-700 border-rose-200',
};

const TYPE_LABEL: Record<CollectionReminderType, string> = {
  RECORDATORIO: '📝 Recordatorio',
  ALERTA_BLOQUEO: '🔴 Alerta Bloqueo',
  CONFIRMACION_PAGO: '✅ Confirmación Pago',
};

const MINI_ICON = 'w-8 h-8 rounded-lg flex items-center justify-center';

function fmtMoney(n: number): string {
  return `RD$${n.toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
}

function fmtDate(value: string | number | null | undefined): string {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

export interface CollectionPermits {
  run: boolean;
  send: boolean;
}

interface CollectionsViewProps {
  summary: CollectionSummaryRow | null;
  reminders: CollectionReminderRow[];
  runs: CollectionRunRow[];
  loading: boolean;
  permits: CollectionPermits;
  onRun: () => void;
  onSend: (id: number) => void;
  onRefresh: () => void;
}

export const CollectionsView: React.FC<CollectionsViewProps> = ({
  summary,
  reminders,
  runs,
  loading,
  permits,
  onRun,
  onSend,
  onRefresh,
}) => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const s = summary;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-900 rounded-2xl p-5 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="w-11 h-11 rounded-xl bg-indigo-500/30 flex items-center justify-center">
            <BrainCircuit className="w-6 h-6 text-indigo-200" />
          </span>
          <div>
            <h2 className="font-bold text-lg">Cobranza Inteligente (IA)</h2>
            <p className="text-xs text-indigo-200">
              Motor automático que analiza cuotas vencidas/atrasadas, calcula el riesgo y redacta el
              recordatorio perfecto para WhatsApp.
            </p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-semibold text-xs flex items-center space-x-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {s && (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CollectionsCard
              icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
              accent="bg-amber-100"
              label="En riesgo (Atrasado)"
              value={String(s.installments.atrasado)}
              sub={`+${s.installments.vencido} vencidas · ${s.clientsAtRisk} clientes`}
            />
            <CollectionsCard
              icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
              accent="bg-rose-100"
              label="Monto adeudado"
              value={fmtMoney(s.overdueAmount)}
              sub="Cuotas vencidas y atrasadas"
            />
            <CollectionsCard
              icon={<ShieldAlert className="w-5 h-5 text-indigo-600" />}
              accent="bg-indigo-100"
              label="Riesgo ALTO (IA)"
              value={String(s.riskDistribution.ALTO)}
              sub={`Medio ${s.riskDistribution.MEDIO} · Bajo ${s.riskDistribution.BAJO}`}
            />
            <CollectionsCard
              icon={<MessageSquare className="w-5 h-5 text-emerald-600" />}
              accent="bg-emerald-100"
              label="Recordatorios"
              value={`${s.reminders.pending} pend. · ${s.reminders.sent} enviados`}
              sub={s.lastRun ? `Último motor: ${fmtDate(s.lastRun.finishedAt)}` : 'Sin ejecutar aún'}
            />
          </div>

          {/* Acción principal + reparto IA */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Ejecutar Motor de Cobranza Automática
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Analiza <b>{s.clientsAtRisk}</b> clientes en riesgo, calcula su scoring (0-100) y genera
                recordatorios personalizados listos para WhatsApp. Los duplicados pendientes se omiten.
              </p>
              <button
                onClick={onRun}
                disabled={!permits.run || loading}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                <PlayCircle className="w-5 h-5" />
                <span>{loading ? 'Procesando…' : 'Ejecutar Motor de Cobranza'}</span>
              </button>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 dark:border-slate-700 p-5">
              <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm mb-3">Distribución de Riesgo (IA)</div>
              <div className="space-y-2">
                {(['ALTO', 'MEDIO', 'BAJO'] as CollectionRisk[]).map((level) => {
                  const count = s.riskDistribution[level] ?? 0;
                  const max = Math.max(1, s.riskDistribution.ALTO + s.riskDistribution.MEDIO + s.riskDistribution.BAJO);
                  const pct = Math.round((count / max) * 100);
                  const color =
                    level === 'ALTO' ? 'bg-rose-500' : level === 'MEDIO' ? 'bg-amber-500' : 'bg-emerald-500';
                  return (
                    <div key={level}>
                      <div className="flex justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        <span>{RISK_LABEL[level]}</span>
                        <span>{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Recordatorios generados */}
      <div className="bg-white rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            Recordatorios generados por IA
          </h3>
          <span className="text-[11px] text-slate-400">{reminders.length} mostrados</span>
        </div>
        {reminders.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            Sin recordatorios aún. Ejecuta el motor de cobranza para generarlos automáticamente.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reminders.slice(0, 12).map((r) => {
              const open = expanded === r.id;
              return (
                <div key={r.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${RISK_CLASS[r.risk_level]}`}
                      >
                        {RISK_LABEL[r.risk_level]} · {r.risk_score}
                      </span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{r.full_name}</span>
                      <span className="text-[11px] text-slate-400">{TYPE_LABEL[r.reminder_type]}</span>
                      <span className="hidden sm:inline text-[11px] text-slate-400">
                        {r.device_model ?? '—'} · {r.phone}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          r.status === 'SENT'
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {r.status === 'SENT' ? 'Enviado' : 'Pendiente'}
                      </span>
                      <button
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="text-[11px] text-indigo-600 font-semibold hover:underline"
                      >
                        {open ? 'Cerrar' : 'Ver mensaje'}
                      </button>
                      {r.status !== 'SENT' && permits.send && (
                        <button
                          onClick={() => onSend(r.id)}
                          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-colors"
                        >
                          <Send className="w-3 h-3" />
                          <span>Marcar Enviado</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {open && (
                    <div className="mt-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 font-mono text-[11px] whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed max-h-52 overflow-y-auto">
                      {r.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial de corridas */}
      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center space-x-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">Historial del Motor</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {runs.slice(0, 8).map((run) => (
              <div key={run.id} className="px-5 py-2.5 flex items-center justify-between text-[11px]">
                <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                  <span className={run.status === 'COMPLETED' ? 'text-emerald-600' : 'text-rose-600'}>
                    {run.status === 'COMPLETED' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                  </span>
                  <span>
                    Corrida #{run.id} · {run.source === 'MANUAL' ? 'Manual' : run.source} · {run.totalReminders}{' '}
                    recordatorio(s) · {run.sentNow} enviado(s)
                  </span>
                </div>
                <span className="text-slate-400">{fmtDate(run.startedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function CollectionsCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <span className={`${MINI_ICON} ${accent} mb-2`}>{icon}</span>
      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}