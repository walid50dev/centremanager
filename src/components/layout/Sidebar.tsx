import { useEffect, useState } from 'react';
import { trashApi, TRASH_CHANGED } from '../../services/trash';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Calendar,
  GraduationCap,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Users,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { cn } from '../../utils/format';
import ConfirmDialog from '../ui/ConfirmDialog';
import { toast } from '../ui/Toast';

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'sidebar.dashboard', icon: LayoutDashboard, end: true },
  { to: '/students', labelKey: 'sidebar.students', icon: Users },
  { to: '/groups', labelKey: 'sidebar.groups', icon: BookOpen },
  // Phase 13 — the week at a glance, next to the groups it is built from.
  { to: '/timetable', labelKey: 'sidebar.timetable', icon: Calendar },
  { to: '/teachers', labelKey: 'sidebar.teachers', icon: GraduationCap },
  { to: '/payments', labelKey: 'sidebar.payments', icon: Wallet },
  // Phase 11 — the monthly charges, right after the money that comes in.
  { to: '/expenses', labelKey: 'sidebar.expenses', icon: Receipt },
  { to: '/trash', labelKey: 'nav.trash', icon: Trash2 },
  { to: '/settings', labelKey: 'sidebar.settings', icon: Settings },
];

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const [trashCount, setTrashCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { void trashApi.list().then(items => { if (active) setTrashCount(items.length); }).catch(() => {}); };
    window.addEventListener(TRASH_CHANGED, refresh);
    void trashApi.purge().then(refresh).catch(refresh);
    return () => { active = false; window.removeEventListener(TRASH_CHANGED, refresh); };
  }, []);
  const latePaymentCount = useAppStore((state) => state.latePaymentCount);
  const years = useAppStore(state => state.schoolYears);
  const activeYear = useAppStore(state => state.activeSchoolYear);
  const switchYear = useAppStore(state => state.switchSchoolYear);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const selectedYear = years.find(year => year.id === pendingYear);
  const confirmSwitch = async () => {
    if (!pendingYear || switching) return;
    setSwitching(true);
    try { await switchYear(pendingYear); setPendingYear(null); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setSwitching(false); }
  };

  return (
    <aside
      className={cn(
        'flex h-screen shrink-0 flex-col border-e border-border bg-white transition-[width] duration-200',
        // Below `lg` the labels are hidden and the rail stays icon-only, so a
        // narrow window (or a phone) keeps a usable content area.
        sidebarOpen ? 'w-[72px] lg:w-[250px]' : 'w-[72px]',
      )}
      aria-label={t('app.name')}
    >
      {/* Logo / app name */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[15px] font-semibold text-white">
          C
        </span>
        {sidebarOpen && (
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-btn font-semibold text-foreground">{t('app.name')}</p>
            <p className="truncate text-[11px] text-muted">{t('app.tagline')}</p>
          </div>
        )}
      </div>

      <div className="border-b border-border px-2 py-2">
        <label className="sr-only" htmlFor="sidebar-school-year">{t('settings.schoolYear.activeYear')}</label>
        <select id="sidebar-school-year" data-testid="sidebar-school-year" value={activeYear?.id ?? ''}
          onChange={event => { const id = Number(event.target.value); if (id && id !== activeYear?.id) setPendingYear(id); }}
          disabled={switching || !activeYear} className="w-full rounded border border-border bg-white px-1 py-2 text-[12px] font-semibold text-foreground">
          {!activeYear && <option value="">{t('settings.schoolYear.none')}</option>}
          {years.map(year => <option key={year.id} value={year.id}>{year.is_active ? '🟢 ' : ''}{year.label}</option>)}
        </select>
        {activeYear && sidebarOpen && <span className="mt-1 hidden items-center gap-1 text-[10px] font-medium text-emerald-700 lg:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />{t('settings.schoolYear.active')}</span>}
      </div>
      <ConfirmDialog open={pendingYear !== null} title={t('schoolYearSwitch.title')}
        message={t('schoolYearSwitch.message', { year: selectedYear?.label ?? '' })}
        confirmLabel={t('schoolYearSwitch.confirm')} cancelLabel={t('common.cancel')} destructive={false}
        loading={switching} onClose={() => { if (!switching) setPendingYear(null); }} onConfirm={() => void confirmSwitch()} />
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  title={sidebarOpen ? undefined : t(item.labelKey)}
                  data-testid={`nav-${item.to === '/' ? 'dashboard' : item.to.slice(1)}`}
                  className={({ isActive }) =>
                    cn(
                      'flex h-10 items-center gap-3 rounded-md px-3 text-btn transition-colors',
                      isActive
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted hover:bg-background hover:text-foreground',
                      !sidebarOpen ? 'justify-center px-0' : 'max-lg:justify-center max-lg:px-0',
                    )
                  }
                >
                  <span className="relative flex shrink-0 items-center justify-center">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {item.to === '/trash' && trashCount > 0 ? <span data-testid="sidebar-trash-badge" aria-label={`${trashCount} ${t('trash.title')}`} className="absolute -top-1.5 end-0 flex h-[15px] min-w-[15px] translate-x-1/2 items-center justify-center rounded-full bg-destructive px-1 text-[9px] text-white rtl:-translate-x-1/2">{trashCount > 99 ? '99+' : trashCount}</span> : null}
                    {item.to === '/payments' && latePaymentCount > 0 ? (
                      <span
                        data-testid="sidebar-late-badge"
                        title={t('sidebar.latePayments')}
                        aria-label={`${latePaymentCount} ${t('sidebar.latePayments')}`}
                        className="badge-alert absolute -top-1.5 end-0 flex h-[15px] min-w-[15px] translate-x-1/2 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white rtl:-translate-x-1/2"
                      >
                        {latePaymentCount > 9 ? '9+' : latePaymentCount}
                      </span>
                    ) : null}
                  </span>
                  {sidebarOpen && (
                    <span className="hidden truncate lg:inline">{t(item.labelKey)}</span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: collapse toggle */}
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          className={cn(
            'flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-muted transition-colors hover:bg-background hover:text-foreground',
            !sidebarOpen ? 'justify-center px-0' : 'max-lg:justify-center max-lg:px-0',
          )}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          )}
          {sidebarOpen && <span className="hidden lg:inline">{t('sidebar.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
