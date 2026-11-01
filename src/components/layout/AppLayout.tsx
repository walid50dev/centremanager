import { Outlet } from 'react-router-dom';
import LockScreen from '../auth/LockScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useLatePaymentBadge } from '../../hooks/useLatePaymentBadge';
import { useLockTimeout } from '../../hooks/useLockTimeout';
import { useAppStore } from '../../stores/appStore';
import { useAuthStore } from '../../stores/authStore';
import Header from './Header';
import Sidebar from './Sidebar';

/**
 * Application shell: sidebar (250px) + main column (header + routed page).
 * In Arabic the wrapper is `dir="rtl"`, which flips the flex row so the
 * sidebar sits on the right — no extra CSS required.
 */
export function AppLayout() {
  const language = useAppStore((state) => state.language);
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLocked = useAuthStore((state) => state.isLocked);
  const lock = useAuthStore((state) => state.lock);
  const lockTimeoutMinutes = useLockTimeout();

  // Auto-lock after N idle minutes (0 = disabled). The overlay keeps the
  // routed page mounted, so unlocking returns to the same screen.
  useIdleTimer(lockTimeoutMinutes, lock, isAuthenticated && !isLocked);

  // Late-invoice count behind the red badge on the Payments link.
  useLatePaymentBadge();

  return (
    <div dir={dir} className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto px-6 py-5">
          <Outlet />
        </main>
      </div>

      {isLocked && <LockScreen />}
    </div>
  );
}

export default AppLayout;
