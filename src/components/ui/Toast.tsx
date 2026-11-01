import { useEffect } from 'react';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../utils/format';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastState {
  toasts: ToastMessage[];
  show: (message: string, options?: { title?: string; variant?: ToastVariant; duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Visible stack size — the oldest toast is dropped beyond that. */
export const MAX_VISIBLE_TOASTS = 3;

/** How long each variant stays on screen (`0` = until dismissed). */
export const TOAST_DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  error: 5000,
  info: 4000,
  // A warning asks for a decision, so it stays until the user closes it.
  warning: 0,
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, options = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const variant = options.variant ?? 'info';
    const toast: ToastMessage = {
      id,
      message,
      title: options.title,
      variant,
      duration: options.duration ?? TOAST_DURATIONS[variant],
    };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper: toast.success('Enregistré') */
export const toast = {
  success: (message: string, title?: string) => useToastStore.getState().show(message, { variant: 'success', title }),
  error: (message: string, title?: string) => useToastStore.getState().show(message, { variant: 'error', title }),
  // Warnings are never auto-dismissed: the user has to acknowledge them.
  warning: (message: string, title?: string) =>
    useToastStore.getState().show(message, { variant: 'warning', title, duration: 0 }),
  info: (message: string, title?: string) => useToastStore.getState().show(message, { variant: 'info', title }),
};

const variantStyles: Record<ToastVariant, { container: string; icon: typeof Info }> = {
  success: { container: 'border-success/30 bg-white text-success', icon: CheckCircle2 },
  error: { container: 'border-destructive/30 bg-white text-destructive', icon: XCircle },
  warning: { container: 'border-warning/30 bg-white text-warning', icon: AlertTriangle },
  info: { container: 'border-border bg-white text-foreground', icon: Info },
};

function ToastItem({ item }: { item: ToastMessage }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const { container, icon: Icon } = variantStyles[item.variant];

  useEffect(() => {
    if (item.duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, dismiss]);

  return (
    <div
      role="status"
      className={cn('flex w-80 items-start gap-3 rounded-lg border bg-white p-3 shadow-md', container)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {item.title && <p className="text-btn text-foreground">{item.title}</p>}
        <p className="text-[13px] leading-5 text-foreground/80">{item.message}</p>
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Fermer"
        className="rounded p-0.5 text-muted transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Mount once, at the root of the app. */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex flex-col gap-2">
      {toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastItem item={item} />
        </div>
      ))}
    </div>
  );
}

export default ToastViewport;
