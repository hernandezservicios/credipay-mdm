import React from 'react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  label?: string;
  className?: string;
}

/** Indicador de carga canónico. */
export const Spinner: React.FC<SpinnerProps> = ({ label = 'Cargando…', className }) => (
  <div className={`flex items-center justify-center py-12 text-slate-400 ${className ?? ''}`}>
    <Loader2 className="h-6 w-6 animate-spin mr-2" />
    <span className="text-sm">{label}</span>
  </div>
);