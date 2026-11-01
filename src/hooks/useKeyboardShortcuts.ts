import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useAuthStore } from '../stores/authStore';

/** Event the Students page listens for to focus its search field. */
export const FOCUS_SEARCH_EVENT = 'focus-search';

/**
 * App-wide keyboard shortcuts (Phase 8).
 *
 * - `Ctrl/⌘ + K` → focus the students search (the page listens for the event).
 * - `Ctrl/⌘ + L` → lock the session. The browser would focus the address bar,
 *   which is useless inside a desktop window, so the default is prevented.
 * - `Escape` → close the modal on top of the stack (see `appStore.modalStack`).
 *
 * Registered once, from `App.tsx`.
 */
export function useKeyboardShortcuts(): void {
  const lock = useAuthStore((state) => state.lock);
  const closeTopModal = useAppStore((state) => state.closeTopModal);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const withModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (withModifier && key === 'k') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
        return;
      }

      if (withModifier && key === 'l') {
        event.preventDefault();
        lock();
        return;
      }

      if (event.key === 'Escape') {
        // Only swallow the key when a modal was actually closed.
        if (closeTopModal()) event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lock, closeTopModal]);
}

export default useKeyboardShortcuts;
