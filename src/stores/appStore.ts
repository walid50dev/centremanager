import { create } from 'zustand';
import i18n, { LANGUAGE_STORAGE_KEY, type Language } from '../i18n';
import { invoicesApi } from '../services/invoices';
import { schoolYearsApi } from '../services/settings';
import type { SchoolYear } from '../types';

/**
 * Closers of the currently open modals, keyed by instance id.
 *
 * Kept outside the store on purpose: the stack order lives in React state (so
 * the sidebar and Escape handlers can react to it) while the callbacks stay in
 * a plain map, which avoids re-rendering every consumer on each render.
 */
const modalClosers = new Map<string, () => void>();

interface AppState {
  /** UI language: French (default, LTR) or Arabic (RTL). */
  language: Language;
  /** Sidebar collapsed state (desktop). */
  sidebarOpen: boolean;
  /** Ids of the open modals, the **last** one is on top. */
  modalStack: string[];
  /** Late invoices of the current period, shown as a badge on Payments. */
  latePaymentCount: number;
  activeSchoolYear: SchoolYear | null;
  schoolYears: SchoolYear[];
  loadSchoolYears: () => Promise<void>;
  switchSchoolYear: (id: number) => Promise<void>;

  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  /** Applies direction, <html lang> and i18next language for the given lang. */
  applyLanguage: (lang: Language) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  /** Called by `Modal` when it opens; `close` is what Escape should run. */
  registerModal: (id: string, close: () => void) => void;
  unregisterModal: (id: string) => void;
  /** Escape → close the modal on top of the stack, if any. */
  closeTopModal: () => boolean;
  /** True when `id` is the modal Escape would close. */
  isTopModal: (id: string) => boolean;

  setLatePaymentCount: (count: number) => void;
  /** Re-read the late invoices of the current month (best effort, silent). */
  refreshLatePaymentCount: () => Promise<void>;
}

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'fr' || stored === 'ar') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'fr';
}

/** Side effects of switching language: DOM attributes, i18next, persistence. */
function syncLanguage(lang: Language) {
  const root = document.documentElement;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  root.lang = lang;
  // Tailwind logical utilities + the CSS rules in index.css both key off these.
  root.classList.toggle('rtl', lang === 'ar');
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* localStorage unavailable */
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  language: readStoredLanguage(),
  sidebarOpen: true,
  modalStack: [],
  latePaymentCount: 0,
  activeSchoolYear: null,
  schoolYears: [],
  loadSchoolYears: async () => {
    const [years, active] = await Promise.all([schoolYearsApi.list(), schoolYearsApi.active()]);
    set({ schoolYears: years, activeSchoolYear: active });
  },
  switchSchoolYear: async (id) => {
    await schoolYearsApi.switch(id);
    await get().loadSchoolYears();
    void get().refreshLatePaymentCount();
  },

  applyLanguage: (lang) => {
    syncLanguage(lang);
    set({ language: lang });
  },

  setLanguage: (lang) => {
    syncLanguage(lang);
    set({ language: lang });
  },

  toggleLanguage: () => get().setLanguage(get().language === 'fr' ? 'ar' : 'fr'),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  registerModal: (id, close) => {
    modalClosers.set(id, close);
    set((state) => ({
      modalStack: state.modalStack.includes(id) ? state.modalStack : [...state.modalStack, id],
    }));
  },

  unregisterModal: (id) => {
    modalClosers.delete(id);
    set((state) => ({ modalStack: state.modalStack.filter((entry) => entry !== id) }));
  },

  isTopModal: (id) => {
    const stack = get().modalStack;
    return stack.length > 0 && stack[stack.length - 1] === id;
  },

  closeTopModal: () => {
    const stack = get().modalStack;
    const id = stack[stack.length - 1];
    if (!id) return false;
    const close = modalClosers.get(id);
    // The modal unregisters itself in its own cleanup.
    close?.();
    return true;
  },

  setLatePaymentCount: (count) => set({ latePaymentCount: count }),

  refreshLatePaymentCount: async () => {
    try {
      // Every overdue invoice, whatever its period: the monthly alerts of the
      // Payments page are month-scoped, the badge is not.
      const count = await invoicesApi.latePaymentCount();
      set({ latePaymentCount: count });
    } catch {
      // A badge is not worth an error toast: keep the previous value.
    }
  },
}));

/** Fire-and-forget refresh used by mutations that can change the count. */
export function refreshLatePayments(): void {
  void useAppStore.getState().refreshLatePaymentCount();
}

/** Event other screens dispatch after a payment so the badge follows. */
export const LATE_PAYMENTS_EVENT = 'late-payments:refresh';

export default useAppStore;
