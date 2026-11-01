import { useEffect, useState } from 'react';
import {
  LOCK_TIMEOUT_STORAGE_KEY,
  hydrateLockTimeout,
  readLockTimeout,
} from '../utils/lockTimeout';

/**
 * Current idle-lock timeout in minutes (0 = disabled).
 *
 * Re-reads the value when localStorage changes in another window, and
 * hydrates it from the database on first use.
 */
export function useLockTimeout(): number {
  const [minutes, setMinutes] = useState<number>(() => readLockTimeout());

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LOCK_TIMEOUT_STORAGE_KEY) {
        setMinutes(readLockTimeout());
      }
    };

    window.addEventListener('storage', handleStorage);
    void hydrateLockTimeout().then(() => setMinutes(readLockTimeout()));

    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return minutes;
}

export default useLockTimeout;
