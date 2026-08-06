import React from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

/**
 * Botón canónico (F5: ícono + texto siempre). Único componente Button del sistema.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={`${VARIANT_CLASS[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className ?? ''}`}
  >
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    {children}
  </button>
);