import { useCallback, useEffect, useState } from 'react';

export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 30_000;

export interface LoginAttemptsState {
  /** Failures since the last success (reset when the lockout ends). */
  failures: number;
  /** Attempts left before the temporary lockout kicks in. */
  remainingAttempts: number;
  /** True while the 30 s cooldown is running. */
  isLockedOut: boolean;
  /** Seconds left in the cooldown, for the visible countdown. */
  secondsRemaining: number;
  /** Register a failed attempt (starts the cooldown on the Nth failure). */
  registerFailure: () => void;
  /** Reset after a successful verification. */
  reset: () => void;
}

/**
 * Three failed verifications lock the form for 30 seconds, with a visible
 * countdown. The counter is local to the form (per spec) and resets on
 * success or when the cooldown expires.
 */
export function useLoginAttempts(
  maxAttempts = MAX_LOGIN_ATTEMPTS,
  lockoutMs = LOCKOUT_DURATION_MS,
): LoginAttemptsState {
  const [failures, setFailures] = useState(0);
  const [lockoutEnd, setLockoutEnd] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Countdown ticker.
  useEffect(() => {
    if (lockoutEnd === null) {
      setSecondsRemaining(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutEnd - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        setLockoutEnd(null);
        setFailures(0);
      }
    };

    tick();
    const handle = window.setInterval(tick, 250);
    return () => window.clearInterval(handle);
  }, [lockoutEnd]);

  // Start the cooldown once the threshold is reached.
  useEffect(() => {
    if (failures >= maxAttempts) {
      setFailures(0);
      setLockoutEnd(Date.now() + lockoutMs);
    }
  }, [failures, maxAttempts, lockoutMs]);

  const registerFailure = useCallback(() => {
    setFailures((previous) => previous + 1);
  }, []);

  const reset = useCallback(() => {
    setFailures(0);
    setLockoutEnd(null);
  }, []);

  return {
    failures,
    remainingAttempts: Math.max(0, maxAttempts - failures),
    isLockedOut: lockoutEnd !== null,
    secondsRemaining,
    registerFailure,
    reset,
  };
}

export default useLoginAttempts;
