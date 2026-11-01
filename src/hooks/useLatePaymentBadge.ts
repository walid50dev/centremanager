import { useEffect } from 'react';
import { LATE_PAYMENTS_EVENT, useAppStore } from '../stores/appStore';

/** How often the sidebar badge re-reads the late invoices. */
export const LATE_PAYMENTS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps `appStore.latePaymentCount` fresh.
 *
 * Mounted once by the app shell: one read on mount, then every five minutes,
 * plus an immediate refresh whenever a screen announces a change through the
 * `late-payments:refresh` event (recording a payment, generating invoices…).
 */
export function useLatePaymentBadge(): void {
  const refresh = useAppStore((state) => state.refreshLatePaymentCount);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => void refresh(), LATE_PAYMENTS_INTERVAL_MS);
    const onRefresh = () => void refresh();
    window.addEventListener(LATE_PAYMENTS_EVENT, onRefresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(LATE_PAYMENTS_EVENT, onRefresh);
    };
  }, [refresh]);
}

export default useLatePaymentBadge;
