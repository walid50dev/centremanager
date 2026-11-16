import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const VIEWPORT_MARGIN = 8;

export interface PopupRect {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  zIndex: number;
  placement: 'above' | 'below';
}

/**
 * Positions a portal popup against a trigger, flipping above when needed
 * and stacking just over the nearest modal.
 */
export function useAnchoredPopup(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  maxHeight = 280,
  minWidth?: number,
): PopupRect | null {
  const [rect, setRect] = useState<PopupRect | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom - VIEWPORT_MARGIN;
    const spaceAbove = box.top - VIEWPORT_MARGIN;
    const placeAbove = spaceBelow < Math.min(maxHeight, 180) && spaceAbove > spaceBelow;
    const available = Math.max(96, placeAbove ? spaceAbove : spaceBelow);
    const height = Math.min(maxHeight, available);
    const width = Math.min(
      Math.max(box.width, minWidth ?? box.width),
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, box.left),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const modal = trigger.closest<HTMLElement>('[data-modal-z]');
    const zIndex = modal ? Number(modal.dataset.modalZ) + 5 : 70;
    setRect({
      // Pin to the trigger edge so a short list does not float away when flipped.
      top: placeAbove ? undefined : box.bottom + 6,
      bottom: placeAbove ? window.innerHeight - box.top + 6 : undefined,
      left,
      width,
      maxHeight: height,
      zIndex,
      placement: placeAbove ? 'above' : 'below',
    });
  }, [maxHeight, minWidth, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    measure();
    const onScrollOrResize = () => measure();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [measure, open]);

  return rect;
}

export default useAnchoredPopup;
