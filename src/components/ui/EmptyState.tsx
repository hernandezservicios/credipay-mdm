import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Vacío canónico de listas (F2: misma identidad en toda pantalla vacía).
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'Sin resultados',
  message,
  icon,
  className,
}) => (
  <div className={`flex flex-col items-center justify-center py-12 text-center ${className ?? ''}`}>
    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
      {icon ?? <Inbox className="h-6 w-6" />}
    </div>
    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
    {message && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">{message}</p>}
  </div>
);