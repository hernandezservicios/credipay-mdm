import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ModalShell } from './ui/ModalShell';

export type ConfirmTone = 'rose' | 'emerald' | 'indigo' | 'amber';

export interface ConfirmOptions {
  title: string;
  message: string;
  icon?: React.ReactNode;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmOnly?: boolean;
}

interface ConfirmDialogState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false)
);

export const useConfirm = () => useContext(ConfirmContext);

const TONE_STYLES: Record<
  ConfirmTone,
  { icon: string; button: string; focus: string }
> = {
  rose: {
    icon: 'bg-rose-100 text-rose-600 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    button: 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/20',
    focus: 'ring-rose-300',
  },
  emerald: {
    icon: 'bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    button: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20',
    focus: 'ring-emerald-300',
  },
  indigo: {
    icon: 'bg-indigo-100 text-indigo-600 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
    button: 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20',
    focus: 'ring-indigo-300',
  },
  amber: {
    icon: 'bg-amber-100 text-amber-600 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    button: 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/20',
    focus: 'ring-amber-300',
  },
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<ConfirmDialogState | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setDialog((current) => {
      if (current) current.resolve(result);
      return null;
    });
  }, []);

  // Cerrar con tecla Escape (y Enter en modo solo confirmar)
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
      if (e.key === 'Enter' && dialog.confirmOnly) {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, close]);

  // Enfocar el botón de confirmación para uso con teclado
  useEffect(() => {
    if (dialog && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [dialog]);

  if (!dialog) {
    return <ConfirmContext.Provider value={confirm}>{children}</ConfirmContext.Provider>;
  }

  const tone = TONE_STYLES[dialog.tone || 'indigo'];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {/* Diálogo de confirmación moderno y centrado */}
      <ModalShell
        isOpen={!!dialog}
        onClose={() => close(false)}
        title={dialog.title}
        size="sm"
        zIndex="z-[60]"
        headerVariant="dark"
        closeOnEscape={false}
        closeOnBackdrop={!dialog.confirmOnly}
        showCloseButton={!dialog.confirmOnly}
        initialFocusRef={confirmRef}
        ariaLabel="Diálogo de confirmación"
      >
        <div className="flex items-start gap-3.5">
          {dialog.icon && (
            <div
              className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${tone.icon}`}
            >
              {dialog.icon}
            </div>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
            {dialog.message}
          </p>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
          {!dialog.confirmOnly && (
            <button
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
            >
              {dialog.cancelLabel || 'Cancelar'}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-lg text-white text-xs font-bold shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${tone.button} ${tone.focus}`}
          >
            {dialog.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </ModalShell>
    </ConfirmContext.Provider>
  );
};
