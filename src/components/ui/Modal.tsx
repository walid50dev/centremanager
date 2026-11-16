import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { cn } from '../../utils/format';

/**
 * Opt-in layout for long forms. The default modal already pins the header and
 * footer; this export is kept so existing callers compile unchanged.
 */
export const scrollableModalClassName = '';

export type ModalSize = 'sm' | 'md' | 'lg' | 'wide' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  /**
   * Stacking level. Pages use the default 50; a quick-create modal opened on top
   * of a form passes 60, and one opened from *that* modal passes 70. The
   * backdrop darkens a little with each level so the depth is visible.
   */
  zIndex?: number;
  /** Extra hook for tests/screenshots (`data-testid` on the panel). */
  testId?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  wide: 'max-w-3xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  zIndex = 50,
  testId,
}: ModalProps) {
  const { t } = useTranslation();
  const id = useId();
  const registerModal = useAppStore((state) => state.registerModal);
  const unregisterModal = useAppStore((state) => state.unregisterModal);

  // Track stacked dialogs for other UI state; dismissal is explicit only.
  // The ref keeps the latest `onClose` without re-registering.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    registerModal(id, () => closeRef.current());
    return () => unregisterModal(id);
  }, [open, id, registerModal, unregisterModal]);

  // Lock body scroll while the dialog is open, and keep the panel mounted for
  // one animation frame so the exit transition can play.
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setClosing(false);
      setVisible(true);
      return;
    }
    if (!visible) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? `${id}-title` : undefined}
      aria-label={typeof title === 'string' ? title : undefined}
      data-modal-z={zIndex}
    >
      <div
        className="absolute inset-0 backdrop-blur-[3px]"
        // 40 % at z-50, +12 % per nesting level, capped at 75 %.
        style={{
          backgroundColor: `rgba(15, 23, 42, ${Math.min(0.75, 0.42 + Math.max(0, zIndex - 50) * 0.012)})`,
        }}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative z-10 flex max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden',
          'rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]',
          closing ? 'modal-exit' : 'modal-enter',
          sizeClasses[size],
          className,
        )}
        data-state={closing ? 'closing' : 'open'}
        data-testid={testId}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <div className="min-w-0">
            {title && (
              <h2 id={`${id}-title`} className="text-[18px] font-semibold tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-slate-100 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mx-6 h-px shrink-0 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 bg-slate-50/80 px-6 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
