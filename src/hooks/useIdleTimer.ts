import { useEffect, useRef } from 'react';

/** Events that count as user activity. */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Locks the session after `timeoutMinutes` without user activity.
 *
 * - `timeoutMinutes === 0` (or `enabled === false`) disables the timer.
 * - Any mouse/keyboard/scroll/touch event restarts the countdown.
 * - Listeners and timers are cleaned up on unmount or when the inputs change.
 *
 * @param timeoutMinutes Idle delay in minutes; 0 disables auto-lock.
 * @param onLock         Called once the delay elapses.
 * @param enabled        Usually `isAuthenticated && !isLocked`.
 */
export function useIdleTimer(timeoutMinutes: number, onLock: () => void, enabled = true): void {
  // Keep the latest callback without re-registering every listener.
  const onLockRef = useRef(onLock);
  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    if (!enabled || timeoutMinutes <= 0) return;

    const timeoutMs = timeoutMinutes * 60_000;
    let handle: number | undefined;
    let lastReset = 0;

    const schedule = () => {
      if (handle !== undefined) window.clearTimeout(handle);
      handle = window.setTimeout(() => {
        handle = undefined;
        onLockRef.current();
      }, timeoutMs);
    };

    const handleActivity = () => {
      const now = Date.now();
      // Throttle: `mousemove` fires dozens of times per second.
      if (now - lastReset < 1000) return;
      lastReset = now;
      schedule();
    };

    schedule();
    ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, handleActivity, { passive: true }),
    );

    return () => {
      if (handle !== undefined) window.clearTimeout(handle);
      ACTIVITY_EVENTS.forEach((eventName) =>
        window.removeEventListener(eventName, handleActivity),
      );
    };
  }, [timeoutMinutes, enabled]);
}

export default useIdleTimer;
