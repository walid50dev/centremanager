import { create } from 'zustand';
import { authApi } from '../services/auth';

/**
 * Single-admin session state (V1).
 *
 * Security model:
 * - The password hash lives only in SQLite (Argon2id); this store never holds
 *   a credential, only "is someone authenticated / is the screen locked".
 * - `isAuthenticated` is deliberately **not** persisted: closing the app
 *   always requires the password again.
 * - `isSetup` *is* persisted so a refresh cannot flash the setup screen, but
 *   `bootstrap()` always re-checks the database, which stays the source of
 *   truth.
 */
export const IS_SETUP_STORAGE_KEY = 'centremanager.is_setup';

interface AuthState {
  isAuthenticated: boolean;
  isLocked: boolean;
  /** false = first launch, show the setup screen. */
  isSetup: boolean;
  centerName: string;
  /** true once the database has been consulted (prevents UI flashing). */
  initialized: boolean;
  /** Ask the backend whether setup is done and fetch the centre name. */
  bootstrap: () => Promise<void>;
  login: () => void;
  logout: () => void;
  lock: () => void;
  unlock: () => void;
  setSetupDone: () => void;
  setCenterName: (name: string) => void;
}

function readStoredSetup(): boolean {
  try {
    // Optimistic default: assume configured until the DB says otherwise.
    return localStorage.getItem(IS_SETUP_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function persistSetup(isSetup: boolean): void {
  try {
    localStorage.setItem(IS_SETUP_STORAGE_KEY, String(isSetup));
  } catch {
    /* localStorage unavailable */
  }
}

// React StrictMode mounts effects twice; share one bootstrap promise.
let bootstrapPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLocked: false,
  isSetup: readStoredSetup(),
  centerName: 'CentreManager',
  initialized: false,

  bootstrap: () => {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      let isSetup = readStoredSetup();
      let centerName = 'CentreManager';

      try {
        isSetup = await authApi.checkSetup();
        centerName = await authApi.getCenterName();
        persistSetup(isSetup);
      } catch (error) {
        // Backend unreachable (browser preview / transient error): fall back to
        // the persisted flag instead of locking the user out of the UI.
        console.warn('[auth] vérification de la configuration impossible :', error);
      }

      set({ isSetup, centerName, initialized: true });
    })();

    return bootstrapPromise;
  },

  login: () => set({ isAuthenticated: true, isLocked: false }),

  logout: () => set({ isAuthenticated: false, isLocked: false }),

  /** Manual or idle lock: keeps the session, hides the UI behind the overlay. */
  lock: () =>
    set((state) => (state.isAuthenticated ? { isLocked: true } : { isLocked: false })),

  unlock: () => set({ isLocked: false }),

  setSetupDone: () => {
    persistSetup(true);
    set({ isSetup: true });
  },

  setCenterName: (name) => set({ centerName: name.trim() || 'CentreManager' }),
}));

export default useAuthStore;
