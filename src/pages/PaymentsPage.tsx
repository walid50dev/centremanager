import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  GraduationCap,
  Wallet,
  RefreshCw,
  History,
  UserPlus,
} from 'lucide-react';
import Badge from '../components/ui/Badge';
import WhatsAppLink from '../components/ui/WhatsAppLink';
import Button from '../components/ui/Button';
import MonthPicker from '../components/ui/MonthPicker';
import EmptyState from '../components/ui/EmptyState';
import PaymentModal from '../components/payments/PaymentModal';
import TeacherSettlementsTab from '../components/payments/TeacherSettlementsTab';
import StudentPaymentHistory from '../components/payments/StudentPaymentHistory';
import { toast } from '../components/ui/Toast';
import { LATE_PAYMENTS_EVENT } from '../stores/appStore';
import { invoicesApi } from '../services/invoices';
import { currentPeriod } from '../services/payments';
import { cn, formatCurrency, formatDateTime, formatPhone } from '../utils/format';
import { methodLabel, monthLabel } from '../utils/billing';
import type { InvoiceAlert, PaymentAlerts } from '../types';

type TabKey = 'collections' | 'teachers' | 'history';
type SectionKey = 'late' | 'upcoming' | 'current';

const EMPTY_ALERTS: PaymentAlerts = { late: [], upcoming: [], current: [] };

/** Colour theme of a collapsible section. */
const SECTION_STYLES: Record<
  SectionKey,
  { dot: string; header: string; icon: typeof AlertTriangle }
> = {
  late: { dot: 'bg-destructive', header: 'text-destructive', icon: AlertTriangle },
  upcoming: { dot: 'bg-warning', header: 'text-warning', icon: CalendarClock },
  current: { dot: 'bg-success', header: 'text-success', icon: CheckCircle2 },
};

/** Payments page — the primary place where money is recorded. */
export function PaymentsPage() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabKey>('collections');
  const [period, setPeriod] = useState(currentPeriod);
  const { month, year } = period;
  const [alerts, setAlerts] = useState<PaymentAlerts>(EMPTY_ALERTS);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    late: true,
    upcoming: true,
    current: true,
  });
  const [payingStudent, setPayingStudent] = useState<number | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await invoicesApi.alerts(month, year));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const created = await invoicesApi.generateMonthly(month, year);
      if (created > 0) {
        toast.success(t('payments.generateSuccess', { count: created }));
        // New invoices can be overdue immediately: refresh the sidebar badge.
        window.dispatchEvent(new CustomEvent(LATE_PAYMENTS_EVENT));
      } else {
        toast.info(t('payments.generateNone'));
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const startPayment = (studentId: number | null) => {
    setPayingStudent(studentId);
    setPaymentOpen(true);
  };

  const sections: Array<{
    key: SectionKey;
    labelKey: string;
    emptyKey: string;
    emptyHintKey: string;
    rows: InvoiceAlert[];
  }> = [
    {
      key: 'late',
      labelKey: 'payments.late',
      emptyKey: 'payments.lateEmpty',
      emptyHintKey: 'payments.lateEmptyHint',
      rows: alerts.late,
    },
    {
      key: 'upcoming',
      labelKey: 'payments.upcoming',
      emptyKey: 'payments.upcomingEmpty',
      emptyHintKey: 'payments.upcomingEmptyHint',
      rows: alerts.upcoming,
    },
    {
      key: 'current',
      labelKey: 'payments.current',
      emptyKey: 'payments.currentEmpty',
      emptyHintKey: 'payments.currentEmptyHint',
      rows: alerts.current,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 text-foreground">
          {t('pages.payments.title')}
          {tab === 'collections' && <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[13px] font-medium text-primary">
            {monthLabel(t, month)} {year}
          </span>}
        </h1>

        {tab === 'collections' && <div className="flex flex-wrap items-center gap-2">
          <MonthPicker value={period} onChange={setPeriod} label={t('dashboard.period')} testId="payments-period" />
          <Button
            variant="secondary"
            size="icon"
            onClick={() => void load()}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          {/* Phase 12: opens the wizard on its first step, where a student can
              be searched — or created — before any invoice exists. */}
          <Button
            variant="secondary"
            leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => startPayment(null)}
            data-testid="payments-new"
          >
            {t('payments.newPayment')}
          </Button>
          <Button
            leftIcon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void generate()}
            loading={generating}
            data-testid="payments-generate"
          >
            {t('payments.generateInvoices')}
          </Button>
        </div>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border" role="tablist" aria-label={t('pages.payments.title')}>
        {(
          [
            { key: 'collections', label: t('payments.tabCollections'), icon: Wallet },
            { key: 'teachers', label: t('payments.tabTeacherSettlements'), icon: GraduationCap },
            { key: 'history', label: t('payments.historyTab'), icon: History },
          ] as Array<{ key: TabKey; label: string; icon: typeof Wallet }>
        ).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-btn font-medium transition-colors',
              tab === entry.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-foreground',
            )}
          >
            <entry.icon className="h-4 w-4" aria-hidden="true" />
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'teachers' ? (
        <TeacherSettlementsTab />
      ) : tab === 'history' ? (
        <StudentPaymentHistory onChanged={() => void load()} />
      ) : loading ? (
        <div className="space-y-3">
          {sections.map((section) => (
            <div key={section.key} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => {
            const theme = SECTION_STYLES[section.key];
            const Icon = theme.icon;
            const expanded = open[section.key];
            return (
              <div
                key={section.key}
                className="overflow-hidden rounded-lg border border-border bg-white"
                data-testid={`section-${section.key}`}
              >
                <button
                  type="button"
                  onClick={() => setOpen((state) => ({ ...state, [section.key]: !state[section.key] }))}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-background"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted rtl:rotate-180" aria-hidden="true" />
                  )}
                  <span className={cn('h-2 w-2 rounded-full', theme.dot)} aria-hidden="true" />
                  <span className={cn('text-btn font-semibold', theme.header)}>{t(section.labelKey)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-muted">
                    {t('payments.students', { count: section.rows.length })}
                  </span>
                  <Icon className={cn('ms-auto h-4 w-4', theme.header)} aria-hidden="true" />
                </button>

                {expanded ? (
                  section.rows.length === 0 ? (
                    <div className="border-t border-border">
                      <EmptyState
                        title={
                          <span className={section.key === 'late' ? 'text-success' : undefined}>
                            {t(section.emptyKey)}
                          </span>
                        }
                        description={t(section.emptyHintKey)}
                        className="py-8"
                      />
                    </div>
                  ) : section.key === 'current' ? (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full min-w-[600px] text-[13px]" data-testid="payments-current">
                        <thead className="bg-background text-label text-muted">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-3 text-start font-medium">{t('payments.name')}</th>
                            <th className="whitespace-nowrap px-4 py-3 text-end font-medium">{t('payments.amountPaid')}</th>
                            <th className="whitespace-nowrap px-4 py-3 text-start font-medium">{t('payments.paymentDate')}</th>
                            <th className="whitespace-nowrap px-4 py-3 text-start font-medium">{t('payments.method')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row) => (
                            <tr key={row.student_id} className="border-t border-border">
                              <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{row.student_name}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-end tabular-nums text-success">
                                {formatCurrency(row.total_paid_cents)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {row.last_payment_date ? formatDateTime(row.last_payment_date) : '—'}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {row.last_payment_method ? methodLabel(t, row.last_payment_method) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full min-w-[1050px] text-[13px]" data-testid={`payments-${section.key}`}>
                        <thead className="bg-background text-label text-muted"><tr>
                          <th className="min-w-[180px] whitespace-nowrap px-4 py-3 text-start font-medium">{t('students.columns.name')}</th>
                          <th className="min-w-[300px] whitespace-nowrap px-4 py-3 text-start font-medium">{t('students.studentContact')}</th>
                          <th className="min-w-[140px] whitespace-nowrap px-4 py-3 text-start font-medium">{t('payments.groups')}</th>
                          <th className="min-w-[140px] whitespace-nowrap px-4 py-3 text-start font-medium">{t('payments.period')}</th>
                          <th className="min-w-[130px] whitespace-nowrap px-4 py-3 text-end font-medium">{t('payments.amountDue')}</th>
                          <th className="min-w-[200px] whitespace-nowrap px-4 py-3 text-end font-medium">{t('common.actions')}</th>
                        </tr></thead>
                        <tbody>{section.rows.map(row => <tr key={row.student_id} className="border-t border-border">
                          <td className="px-4 py-3"><div className="flex items-center gap-3 whitespace-nowrap"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{row.student_name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join('').toUpperCase()}</span><span className="font-medium text-foreground">{row.student_name}</span></div></td>
                          <td className="px-4 py-3"><div className="flex flex-nowrap items-center gap-2 whitespace-nowrap"><span className="whitespace-nowrap tabular-nums" dir="ltr" data-testid={`late-student-phone-${row.student_id}`}>{row.student_phone ? formatPhone(row.student_phone) : '—'}</span>{section.key === 'late' && <><WhatsAppLink compact label={t('students.student_phone')} testId={`late-whatsapp-${row.student_id}`} phone={row.student_phone} message={t('students.studentReminder', { name: row.student_name, groups: row.groups || t('students.noGroup'), amount: formatCurrency(row.total_due_cents) })} /><WhatsAppLink label={t('students.whatsappGuardian')} testId={`late-guardian-whatsapp-${row.student_id}`} phone={row.guardian_phone} message={t('students.reminder', { name: row.student_name, groups: row.groups || t('students.noGroup'), amount: formatCurrency(row.total_due_cents) })} /></>}</div></td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted">{row.groups || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted">{monthLabel(t, month)} {year}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-end font-semibold tabular-nums">{formatCurrency(row.total_due_cents)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-end"><Button size="sm" data-testid="payment-collect" onClick={() => startPayment(row.student_id)}>{t('payments.recordPayment')}</Button></td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </div>
            );
          })}

          <p className="text-[12px] text-muted">
            <Badge variant="muted">{monthLabel(t, month)}</Badge>{' '}
            {t('payments.summary', {
              count: alerts.late.length + alerts.upcoming.length + alerts.current.length,
            })}
          </p>
        </div>
      )}

      <PaymentModal
        open={paymentOpen}
        studentId={payingStudent}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

export default PaymentsPage;
