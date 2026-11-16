import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/format';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Accessible name; also used when `content` is a string. */
  label?: string;
  className?: string;
  delay?: number;
}

/**
 * Rich hover card, portaled so overflow-auto ancestors cannot clip it.
 * Keyboard focus on the wrapped control also reveals it.
 */
export function Tooltip({ content, children, label, className, delay = 80 }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const compact = typeof content === 'string';

  const show = () => {
    clear();
    timer.current = window.setTimeout(() => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = compact ? 200 : 260;
      const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8);
      const above = box.top > 180;
      setPos({ top: above ? box.top - 8 : box.bottom + 8, left, above });
      setOpen(true);
    }, delay);
  };

  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => () => clear(), []);

  if (!content) return <>{children}</>;

  return (
    <>
      <div
        ref={triggerRef}
        className={cn(compact ? 'inline-flex' : 'h-full w-full', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </div>
      {open && pos
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              aria-label={label}
              style={{
                top: pos.top,
                left: pos.left,
                width: compact ? undefined : 260,
                maxWidth: 260,
              }}
              className={cn(
                'pointer-events-none fixed z-[80] border border-slate-200/80 bg-white/95 text-[12px] leading-5 text-foreground backdrop-blur-md',
                compact
                  ? 'w-max rounded-lg px-2.5 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.12)]'
                  : 'rounded-xl p-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)]',
                pos.above && '-translate-y-full',
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default Tooltip;
