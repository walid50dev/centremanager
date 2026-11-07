import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  Gem,
  GraduationCap,
  HandCoins,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import MonthPicker from '../components/ui/MonthPicker';
import Card, { CardHeader } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import KpiCard from '../components/dashboard/KpiCard';
import { toast } from '../components/ui/Toast';
import { dashboardApi } from '../services/dashboard';
import { teacherPaymentsApi, teachersApi } from '../services/teachers';
import {
  computeTrend,
  currentPeriod,
  longDate,
  rateBubbleClass,
  rateLabel,
  rateTextClass,
  alertTiming,
  SEVERITY_DOT,
  SEVERITY_TEXT,
} from '../utils/dashboard';
import { methodLabel, monthLabel } from '../utils/billing';
import { cn, formatCurrency, formatDate } from '../utils/format';
import type { AlertItem, DashboardKPIs, RecentPayment, Teacher } from '../types';

/**
 * Colours of the net-income card.
 *
 * Green when the centre made money, red when it lost some, amber on the exact
 * break-even — the specification's three states.
 */
const NET_TONE = {
  positive: { value: 'text-success', icon: 'bg-success/10 text-success' },
  negative: { value: 'text-destructive', icon: 'bg-destructive/10 text-destructive' },
  zero: { value: 'text-warning', icon: 'bg-warning/10 text-warning' },
} as const;

/** `positive` / `negative` / `zero` — also exposed as `data-net` for tests. */
function netTone(cents: number): 'positive' | 'negative' | 'zero' {
  if (cents > 0) return 'positive';
  if (cents < 0) return 'negative';
  return 'zero';
}

/** `Bénéfice du mois` / `Perte du mois` / `Équilibre`. */
function netLabel(
  translate: (key: string, options?: Record<string, unknown>) => string,
  cents: number,
): string {
  const tone = netTone(cents);
  if (tone === 'positive') return translate('dashboard.kpi.netPositive');
  if (tone === 'negative') return translate('dashboard.kpi.netNegative');
  return translate('dashboard.kpi.netZero');
}

/**
 * Home page (Phase 7).
 *
 * Six KPI cards for the selected month (Phase 11 adds **Total Net** =
 * revenue − expenses − payroll), the échéances of the week, the last payments,
 * and the teacher payroll of the month.
 *
 * All four sources are fetched in parallel; a failing source only empties its
 * own section (one toast explains it) instead of blanking the whole page.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const language = i18n.language === 'ar' ? 'ar' : 'fr';

  const [period, setPeriod] = useState(currentPeriod);
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [teachers, setTeachers] = useState<Array<{ teacher: Teacher; total: number }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      dashboardApi.kpis(period.month, period.year),
      dashboardApi.alerts(),
      dashboardApi.recentPayments(10),
      teachersApi.list().then(async teachers => Promise.all(teachers.map(async teacher => ({
        teacher,
        total: (await teacherPaymentsApi.list(teacher.id))
          .filter(payment => payment.payment_date.startsWith(`${period.year}-${String(period.month).padStart(2, '0')}`))
          .reduce((sum, payment) => sum + payment.amount_cents, 0),
      })))),
    ]);

    const [kpiResult, alertResult, paymentResult, teacherResult] = results;
    if (kpiResult.status === 'fulfilled') setKpis(kpiResult.value);
    if (alertResult.status === 'fulfilled') setAlerts(alertResult.value);
    if (paymentResult.status === 'fulfilled') setPayments(paymentResult.value);
    if (teacherResult.status === 'fulfilled') setTeachers(teacherResult.value);
    setLoading(false);

    const failure = results.find((result) => result.status === 'rejected');
    if (failure && failure.status === 'rejected') {
      toast.error(
        `${i18n.t('dashboard.loadError')} ${
          failure.reason instanceof Error ? failure.reason.message : ''
        }`.trim(),
      );
    }
  }, [i18n, period.month, period.year]);

  useEffect(() => {
    void load();
  }, [load]);



  return (
    <div className="flex flex-col gap-5">
      {/* ---------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 text-foreground" data-testid="dashboard-greeting">
            {t('dashboard.greeting')}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted" data-testid="dashboard-date">
            {longDate(language)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <MonthPicker value={period} onChange={setPeriod} label={t('dashboard.period')} testId="dashboard-period" />
        </div>
      </div>

      {/* ------------------------------------------------------------------ KPIs */}
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="dashboard-kpis"
      >
        {loading && !kpis
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="p-4" data-testid="dashboard-kpi-skeleton">
                <div className="flex items-center gap-2">
                  <div className="skeleton h-8 w-8 rounded-full" />
                  <div className="skeleton h-3 w-20" />
                </div>
                <div className="skeleton mt-3 h-6 w-24" />
                <div className="skeleton mt-2 h-3 w-16" />
              </Card>
            ))
          : kpis && (
              <>
                <KpiCard
                  icon={Users}
                  label={t('dashboard.kpi.students')}
                  value={kpis.total_active_students}
                  iconClass="bg-primary/10 text-primary"
                  trend={computeTrend(kpis.total_active_students, kpis.prev_month_students)}
                  hint={t('dashboard.trend.vsPrevious')}
                  showTrendHint
                  testId="kpi-students"
                />
                <KpiCard
                  icon={Wallet}
                  label={t('dashboard.kpi.revenue')}
                  value={formatCurrency(kpis.monthly_revenue_cents)}
                  iconClass="bg-success/10 text-success"
                  trend={computeTrend(kpis.monthly_revenue_cents, kpis.prev_month_revenue_cents)}
                  hint={t('dashboard.trend.vsPrevious')}
                  showTrendHint
                  testId="kpi-revenue"
                />
                <KpiCard
                  icon={TrendingUp}
                  label={t('dashboard.kpi.collectionRate')}
                  value={<span dir="ltr">{rateLabel(kpis.collection_rate)}</span>}
                  iconClass={rateBubbleClass(kpis.collection_rate)}
                  valueClass={rateTextClass(kpis.collection_rate)}
                  hint={
                    kpis.theoretical_revenue_cents > 0
                      ? `${formatCurrency(kpis.monthly_revenue_cents)} / ${formatCurrency(
                          kpis.theoretical_revenue_cents,
                        )}`
                      : '—'
                  }
                  testId="kpi-rate"
                />
                <KpiCard
                  icon={BookOpen}
                  label={t('dashboard.kpi.groups')}
                  value={kpis.active_groups}
                  iconClass="bg-violet-100 text-violet-600"
                  testId="kpi-groups"
                />
                <KpiCard
                  icon={GraduationCap}
                  label={t('dashboard.kpi.teachers')}
                  value={kpis.active_teachers}
                  iconClass="bg-amber-100 text-amber-600"
                  testId="kpi-teachers"
                />
                {/* Phase 11 — the real profit: revenue − expenses − payroll. */}
                <KpiCard
                  icon={Gem}
                  label={t('dashboard.kpi.netIncome')}
                  value={
                    <span dir="ltr" data-net={netTone(kpis.net_income_cents)}>
                      {formatCurrency(kpis.net_income_cents)}
                    </span>
                  }
                  iconClass={NET_TONE[kpis.net_income_cents > 0 ? 'positive' : kpis.net_income_cents < 0 ? 'negative' : 'zero'].icon}
                  valueClass={
                    NET_TONE[kpis.net_income_cents > 0 ? 'positive' : kpis.net_income_cents < 0 ? 'negative' : 'zero'].value
                  }
                  trend={computeTrend(kpis.net_income_cents, kpis.prev_month_net_income_cents)}
                  hint={netLabel(t, kpis.net_income_cents)}
                  showTrendHint
                  tooltip={t('dashboard.kpi.netTooltip', {
                    revenue: formatCurrency(kpis.monthly_revenue_cents),
                    expenses: formatCurrency(kpis.total_expenses_cents),
                    compensation: formatCurrency(kpis.total_compensation_cents),
                  })}
                  testId="kpi-net"
                />
              </>
            )}
      </div>

      {/* ---------------------------------------------- alerts + last payments */}
      <div className="grid items-start gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3" data-testid="dashboard-alerts">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('dashboard.alerts.title')}
                {!loading && alerts.length > 0 && (
                  <Badge variant="muted" data-testid="dashboard-alerts-count">
                    {alerts.length}
                  </Badge>
                )}
              </span>
            }
            description={t('dashboard.alerts.subtitle')}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/payments')}
                rightIcon={<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
                data-testid="dashboard-alerts-see-all"
              >
                {t('dashboard.seeAll')}
              </Button>
            }
          />

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-3">
                  <div className="skeleton h-2.5 w-2.5 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-40" />
                    <div className="skeleton h-2.5 w-24" />
                  </div>
                  <div className="skeleton h-3 w-16" />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
              title={t('dashboard.alerts.empty')}
              description={t('dashboard.alerts.emptyHint')}
              className="py-10"
            />
          ) : (
            <div className="divide-y divide-border" data-testid="dashboard-alert-list">
              {alerts.map((alert, index) => {
                const timing = alertTiming(alert);
                return (
                  <button
                    key={`${alert.student_id}-${alert.due_date}-${index}`}
                    type="button"
                    onClick={() => navigate(`/students/${alert.student_id}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-background"
                    data-testid={`dashboard-alert-${index}`}
                    data-severity={alert.severity}
                  >
                    <span
                      className={cn(
                        'h-2.5 w-2.5 shrink-0 rounded-full',
                        SEVERITY_DOT[alert.severity],
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {alert.student_name}
                        {alert.group_name ? (
                          <span className="font-normal text-muted"> — {alert.group_name}</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[12px] text-muted">
                        {formatDate(alert.due_date)}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span
                        className={cn(
                          'block text-[13px] font-semibold tabular-nums',
                          SEVERITY_TEXT[alert.severity],
                        )}
                      >
                        {formatCurrency(alert.amount_cents)}
                      </span>
                      <span className={cn('block text-[12px]', SEVERITY_TEXT[alert.severity])}>
                        {t(timing.key, timing.values)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" data-testid="dashboard-payments">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-success" aria-hidden="true" />
                {t('dashboard.payments.title')}
              </span>
            }
            description={t('dashboard.payments.subtitle')}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/payments')}
                rightIcon={<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
                data-testid="dashboard-payments-see-all"
              >
                {t('dashboard.seeAll')}
              </Button>
            }
          />

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-3">
                  <div className="skeleton h-3 w-28 flex-1" />
                  <div className="skeleton h-3 w-14" />
                  <div className="skeleton h-3 w-10" />
                </div>
              ))}
            </div>
          ) : payments.length === 0 ? (
            <EmptyState
              icon={<HandCoins className="h-5 w-5" aria-hidden="true" />}
              title={t('dashboard.payments.empty')}
              description={t('dashboard.payments.emptyHint')}
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-border" data-testid="dashboard-payment-list">
              {payments.map((payment, index) => (
                <li
                  key={payment.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  data-testid={`dashboard-payment-${index}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {payment.student_name}
                    </span>
                    <span className="block text-[12px] text-muted">
                      {formatDate(payment.created_at)}
                    </span>
                  </span>
                  <Badge variant="muted" className="shrink-0">
                    {methodLabel(t, payment.payment_method)}
                  </Badge>
                  <span className="w-24 shrink-0 text-end text-[13px] font-semibold tabular-nums text-success">
                    {formatCurrency(payment.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --------------------------------------------------------- teacher payroll */}
      <Card data-testid="dashboard-teachers">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-amber-600" aria-hidden="true" />
              {t('teachers.payment.history')}

            </span>
          }
          description={`${t('teachers.payment.activeYear')} — ${monthLabel(t, period.month)} ${period.year}`}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/teachers')}
              rightIcon={<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
              data-testid="dashboard-teachers-see-all"
            >
              {t('dashboard.seeAll')}
            </Button>
          }
        />

        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-5 py-3">
                <div className="skeleton h-3 w-32 flex-1" />
                <div className="skeleton h-3 w-20" />
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-3 w-16" />
              </div>
            ))}
          </div>
        ) : teachers.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
            title={t('dashboard.teachers.empty')}
            description={t('dashboard.teachers.emptyHint')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="dashboard-teacher-table">
              <thead className="bg-background text-label text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-start font-medium">
                    {t('payments.teacherSummary.teacher')}
                  </th>
                  <th className="px-5 py-2.5 text-end font-medium">{t('teachers.payment.total')}</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map(({ teacher, total }) => (
                  <tr key={teacher.id} className="cursor-pointer border-t border-border hover:bg-background"
                    onClick={() => navigate(`/teachers/${teacher.id}`)} data-testid={`dashboard-teacher-${teacher.id}`}>
                    <td className="px-5 py-2.5 font-medium text-foreground">{teacher.full_name}</td>
                    <td className="px-5 py-2.5 text-end tabular-nums text-success">{formatCurrency(total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default DashboardPage;
