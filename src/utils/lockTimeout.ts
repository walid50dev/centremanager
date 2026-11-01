import { authApi } from '../services/auth';

/**
 * Idle auto-lock configuration.
 *
 * The value the UI obeys lives in `localStorage` (so it can be changed and
 * tested from the devtools console), and is mirrored into the `settings` table
 * (`lock_timeout_minutes`) so it survives a profile reset and will be editable
 * from the Phase 2 settings page.
 */
export const LOCK_TIMEOUT_STORAGE_KEY = 'lock_timeout_minutes';
export const DEFAULT_LOCK_TIMEOUT_MINUTES = 15;
/** Selectable values for the settings page; 0 = disabled. */
export const LOCK_TIMEOUT_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

/** Read the configured timeout, in minutes (0 = disabled). */
export function readLockTimeout(): number {
  try {
    const raw = localStorage.getItem(LOCK_TIMEOUT_STORAGE_KEY);
    if (raw === null) return DEFAULT_LOCK_TIMEOUT_MINUTES;

    // `parseFloat` (not parseInt) so sub-minute values such as "0.05" can be
    // used when testing the idle lock from the devtools console.
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LOCK_TIMEOUT_MINUTES;
    return parsed;
  } catch {
    return DEFAULT_LOCK_TIMEOUT_MINUTES;
  }
}

/**
 * Populate localStorage from the database the first time the app runs on a
 * profile where the value is missing. localStorage always wins afterwards.
 */
export async function hydrateLockTimeout(): Promise<void> {
  try {
    if (localStorage.getItem(LOCK_TIMEOUT_STORAGE_KEY) !== null) return;
    const minutes = await authApi.getLockTimeout();
    localStorage.setItem(LOCK_TIMEOUT_STORAGE_KEY, String(minutes));
  } catch {
    // Backend unavailable (browser preview / tests): keep the default.
  }
}

/** Persist a new timeout to localStorage and to the database. */
export async function writeLockTimeout(minutes: number): Promise<void> {
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.trunc(minutes) : DEFAULT_LOCK_TIMEOUT_MINUTES;
  try {
    localStorage.setItem(LOCK_TIMEOUT_STORAGE_KEY, String(safeMinutes));
  } catch {
    /* localStorage unavailable */
  }
  try {
    await authApi.setLockTimeout(safeMinutes);
  } catch {
    // Non-blocking: the local value still applies for this session.
  }
}
