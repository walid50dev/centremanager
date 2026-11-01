import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { cn } from '../../utils/format';

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
  { to: '/teachers', labelKey: 'sidebar.teachers', icon: GraduationCap },
  { to: '/payments', labelKey: 'sidebar.payments', icon: Wallet },
  { to: '/settings', labelKey: 'sidebar.settings', icon: Settings },
];

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const latePaymentCount = useAppStore((state) => state.latePaymentCount);

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
