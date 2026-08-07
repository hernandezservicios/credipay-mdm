/**
 * Constantes compartidas del frontend (F9: cero hardcode).
 * No escribir valores mágicos dentro de los componentes; usarlos desde aquí.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PER_PAGE = 100;
export const SEARCH_DEBOUNCE_MS = 350;
export const TIMELINE_LIMIT = 200;

export type BucketKey = 'penalty' | 'interest' | 'principal' | 'future' | 'credit_balance';

export const BUCKET_LABEL: Record<BucketKey, string> = {
  penalty: 'Penalidad',
  interest: 'Interés',
  principal: 'Capital',
  future: 'Cuota futura',
  credit_balance: 'Saldo a favor',
};

/**
 * Tonalidades canónicas de estado (F6): un solo Badge, un solo mapa de colores.
 * tones: 'green' | 'rose' | 'amber' | 'sky' | 'indigo' | 'slate' | 'violet'
 */
export const STATUS_TONE: Record<string, string> = {
  PENDING: 'amber',
  APPROVED: 'sky',
  ACTIVE: 'green',
  PAID_OFF: 'slate',
  DEFAULTED: 'rose',
  REJECTED: 'rose',
  CANCELED: 'rose',
  REFINANCED: 'violet',
  RESTRUCTURED: 'indigo',
  // cuotas / estados de pago
  PENDIENTE: 'slate',
  VENCIDO: 'amber',
  ATRASADO: 'rose',
  PAGADO: 'green',
  CANCELADO: 'slate',
  COMPLETED: 'sky',
  FAILED: 'rose',
};

/** etiqueta humana por estado (por defecto el propio estado). */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  ACTIVE: 'Activo',
  PAID_OFF: 'Pagado',
  DEFAULTED: 'En Mora',
  REJECTED: 'Rechazado',
  CANCELED: 'Cancelado',
  REFINANCED: 'Refinanciado',
  RESTRUCTURED: 'Reestructurado',
  PENDIENTE: 'Pendiente',
  VENCIDO: 'Vencido',
  ATRASADO: 'Atrasado',
  PAGADO: 'Pagado',
  CANCELADO: 'Cancelado',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

export const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: 'EFECTIVO', label: 'Efectivo' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'TARJETA', label: 'Tarjeta Débito/Crédito' },
  { id: 'DEPOSITO', label: 'Depósito Bancario' },
];

export const BANKS: string[] = [
  'Banco Popular Dominicano',
  'Banreservas',
  'Banco BHD',
  'Caja Tienda Principal',
];

export type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED' | 'REJECTED' | 'CANCELED';