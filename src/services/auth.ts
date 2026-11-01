import { api, isTauri } from './api';

/**
 * Typed wrappers around the Rust auth commands
 * (`src-tauri/src/commands/auth.rs`).
 *
 * Arguments are sent in camelCase: Tauri maps them onto the snake_case Rust
 * parameters (`centerName` -> `center_name`, `oldPassword` -> `old_password`).
 *
 * The admin password hash never crosses the IPC boundary — the backend only
 * answers "setup done?", "password matches?" and the centre name.
 */
export interface AuthBackend {
  checkSetup(): Promise<boolean>;
  setup(centerName: string, password: string): Promise<void>;
  login(password: string): Promise<void>;
  verifyLockPassword(password: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  getCenterName(): Promise<string>;
  getLockTimeout(): Promise<number>;
  setLockTimeout(minutes: number): Promise<void>;
}

const tauriBackend: AuthBackend = {
  checkSetup: () => api<boolean>('cmd_check_setup'),
  setup: (centerName, password) => api<void>('cmd_setup', { centerName, password }),
  login: (password) => api<void>('cmd_login', { password }),
  verifyLockPassword: (password) => api<void>('cmd_verify_lock_password', { password }),
  changePassword: (oldPassword, newPassword) =>
    api<void>('cmd_change_password', { oldPassword, newPassword }),
  getCenterName: () => api<string>('cmd_get_center_name'),
  getLockTimeout: () => api<number>('cmd_get_lock_timeout'),
  setLockTimeout: (minutes) => api<void>('cmd_set_lock_timeout', { minutes }),
};

/* ---------------------------------------------------------------------------
 * Browser development fallback
 *
 * `npm run dev` opens the UI in a normal browser where the Tauri IPC does not
 * exist. So that the screens stay explorable, a *development-only* stub keeps
 * a SHA-256 digest in localStorage. It is never used inside the desktop app
 * (guarded by `import.meta.env.DEV && !isTauri()`) and it is not a substitute
 * for Argon2 authentication.
 * ------------------------------------------------------------------------- */

const DEV_STORAGE = {
  digest: 'centremanager.dev.mock_password_digest',
  centerName: 'centremanager.dev.mock_center_name',
  lockTimeout: 'centremanager.dev.mock_lock_timeout',
} as const;

const USE_DEV_FALLBACK = import.meta.env.DEV && !isTauri();

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const devBackend: AuthBackend = {
  async checkSetup() {
    await delay(60);
    return localStorage.getItem(DEV_STORAGE.digest) !== null;
  },
  async setup(centerName, password) {
    await delay(150);
    if (!centerName.trim()) throw new Error('Le nom du centre est obligatoire');
    if (password.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caractères');
    }
    localStorage.setItem(DEV_STORAGE.digest, await sha256(password));
    localStorage.setItem(DEV_STORAGE.centerName, centerName.trim());
    if (localStorage.getItem(DEV_STORAGE.lockTimeout) === null) {
      localStorage.setItem(DEV_STORAGE.lockTimeout, '15');
    }
  },
  async login(password) {
    await delay(150);
    const stored = localStorage.getItem(DEV_STORAGE.digest);
    if (!stored) throw new Error("Aucun mot de passe n'est configuré pour ce centre");
    if ((await sha256(password)) !== stored) throw new Error('Mot de passe incorrect');
  },
  async verifyLockPassword(password) {
    await this.login(password);
  },
  async changePassword(oldPassword, newPassword) {
    await delay(150);
    const stored = localStorage.getItem(DEV_STORAGE.digest);
    if (!stored) throw new Error("Aucun mot de passe n'est configuré pour ce centre");
    if ((await sha256(oldPassword)) !== stored) throw new Error('Ancien mot de passe incorrect');
    if (newPassword.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caractères');
    }
    localStorage.setItem(DEV_STORAGE.digest, await sha256(newPassword));
  },
  async getCenterName() {
    await delay(40);
    return localStorage.getItem(DEV_STORAGE.centerName) ?? 'CentreManager';
  },
  async getLockTimeout() {
    await delay(40);
    const raw = localStorage.getItem(DEV_STORAGE.lockTimeout);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? parsed : 15;
  },
  async setLockTimeout(minutes) {
    await delay(40);
    localStorage.setItem(DEV_STORAGE.lockTimeout, String(minutes));
  },
};

export const authApi: AuthBackend = USE_DEV_FALLBACK ? devBackend : tauriBackend;

/** True when the browser development fallback is active (dev builds only). */
export const usingDevAuthFallback = USE_DEV_FALLBACK;

export default authApi;
