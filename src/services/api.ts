import { invoke } from '@tauri-apps/api/core';

/**
 * Thin wrapper around Tauri's `invoke`.
 *
 * Every backend command returns `Result<T, String>` on the Rust side, so a
 * rejection here is always a human-readable message.
 */
export async function api<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    const message =
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : 'Une erreur inattendue est survenue.';
    throw new Error(message);
  }
}

/** True when the frontend is running inside the Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export default api;
