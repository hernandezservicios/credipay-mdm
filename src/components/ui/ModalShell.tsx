import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_MAP: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-4xl',
  full: 'max-w-5xl',
};

let lockCount = 0;

function lockScroll(): void {
  if (lockCount === 0) document.body.style.overflow = 'hidden';
  lockCount++;
}

function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = '';
}

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: ModalSize;
  zIndex?: string;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  headerVariant?: 'default' | 'dark';
  headerClassName?: string;
  footer?: React.ReactNode;
  ariaLabel?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'md',
  zIndex = 'z-50',
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  headerVariant = 'default',
  headerClassName,
  footer,
  ariaLabel,
  initialFocusRef,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    lockScroll();
    window.addEventListener('keydown', handleKeyDown, true);
    const target = initialFocusRef?.current ?? panelRef.current;
    const raf = requestAnimationFrame(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (target && typeof target.focus === 'function') {
        target.focus();
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKeyDown, true);
      unlockScroll();
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen, handleKeyDown, initialFocusRef]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex overflow-y-auto bg-slate-950/50 backdrop-blur-[2px]`}
      role="presentation"
    >
      <div
        className="m-auto flex w-full items-center justify-center p-4 sm:p-6"
        onClick={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
          tabIndex={-1}
          className={`relative w-full ${SIZE_MAP[size]} max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl focus:outline-none`}
        >
          {(title || showCloseButton) && (
            <div
              className={`flex items-start justify-between gap-3 px-6 py-4 border-b sticky top-0 z-10 ${
                headerVariant === 'dark'
                  ? 'bg-slate-900 border-slate-800'
                  : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
              } ${headerClassName ?? ''}`}
            >
              <div className="min-w-0">
                {title && (
                  <h2
                    className={`text-base font-bold leading-snug ${
                      headerVariant === 'dark'
                        ? 'text-white'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p
                    className={`text-xs mt-0.5 ${
                      headerVariant === 'dark'
                        ? 'text-slate-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
              {showCloseButton && (
                <button
                  onClick={onClose}
                  aria-label="Cerrar"
                  className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-colors focus:outline-none focus:ring-2 ${
                    headerVariant === 'dark'
                      ? 'text-slate-400 hover:text-white hover:bg-slate-800 focus:ring-slate-400/60'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800 focus:ring-slate-400/60'
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div className="px-6 py-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-b-2xl">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
