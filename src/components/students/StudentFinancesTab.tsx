import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, FileText, Receipt, Wallet } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import PaymentModal from '../payments/PaymentModal';
import ReceiptPreviewModal from '../payments/ReceiptPreviewModal';
import { toast } from '../ui/Toast';
import { invoicesApi } from '../../services/invoices';
import { paymentsApi } from '../../services/payments';
import { cn, formatCurrency, formatDate } from '../../utils/format';
import {
  isOverdue,
  methodLabel,
  periodLabel,
  statusMeta,
} from '../../utils/billing';
import type { PaymentRow, StudentInvoice } from '../../types';

export interface StudentFinancesTabProps {
  studentId: number;
  /** Called after a payment is recorded (refreshes the audit tab too). */
  onChanged?: () => void;
}

/** Tab 3 of the student sheet: invoices, balance and payment history. */
export function StudentFinancesTab({ studentId, onChanged }: StudentFinancesTabProps) {
  const { t } = useTranslation();

  const [invoices, setInvoices] = useState<StudentInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invoiceRows, history] = await Promise.all([
        invoicesApi.forStudent(studentId),
        paymentsApi.history({ studentId, page: historyPage, limit: 20 }),
      ]);
      setInvoices(invoiceRows);
      setPayments(history.data);
      setHistoryTotal(history.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [studentId, historyPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      invoices.reduce(
        (acc, invoice) => ({
          due: acc.due + invoice.amount_cents,
          paid: acc.paid + invoice.paid_amount_cents,
          remaining: acc.remaining + invoice.remaining_cents,
        }),
        { due: 0, paid: 0, remaining: 0 },
      ),
    [invoices],
  );

  const summary = [
    {
      key: 'due',
      label: t('student.totalDue'),
      value: totals.due,
      className: 'text-foreground',
      icon: FileText,
    },
    {
      key: 'paid',
      label: t('student.totalPaid'),
      value: totals.paid,
      className: 'text-success',
      icon: Wallet,
    },
    {
      key: 'remaining',
      label: t('student.remaining'),
      value: totals.remaining,
      className: totals.remaining > 0 ? 'text-destructive' : 'text-success',
      icon: CreditCard,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h2 text-foreground">{t('students.tabFinances')}</h2>
        <Button
          leftIcon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setPaymentOpen(true)}
        >
          {t('student.recordPayment')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.key} className="p-4" data-testid={`summary-${item.key}`}>
              <div className="flex items-center gap-2 text-muted">
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="text-label">{item.label}</span>
              </div>
              <p className={cn('mt-1 text-xl font-semibold tabular-nums', item.className)}>
                {formatCurrency(item.value)}
              </p>
            </Card>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            title={t('student.noInvoices')}
            description={t('student.noInvoicesHint')}
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]" data-testid="student-invoices">
            <thead className="bg-background text-label text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.invoice.period')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.invoice.group')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('student.invoice.amount')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('student.invoice.paid')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('student.invoice.remaining')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.invoice.status')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.invoice.dueDate')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const meta = statusMeta(invoice.status);
                const overdue = isOverdue(invoice.due_date, invoice.remaining_cents);
                return (
                  <tr key={invoice.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {invoice.kind === 'enrollment_fee' ? invoice.school_year_label : periodLabel(t, invoice.period_month, invoice.period_year)}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {invoice.kind === 'enrollment_fee' ? t('students.enrollment_fee') : <>{invoice.group_subject} — {invoice.group_level}{invoice.group_branch ? ` · ${invoice.group_branch}` : ''}</>}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">
                      {formatCurrency(invoice.amount_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums text-success">
                      {formatCurrency(invoice.paid_amount_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                      {formatCurrency(invoice.remaining_cents)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={meta.variant}>{t(meta.labelKey)}</Badge>

                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {formatDate(invoice.due_date)}
                      {overdue ? (
                        <span className="ms-1 text-destructive">({t('student.invoice.overdue')})</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-btn font-medium text-foreground">{t('student.paymentHistory')}</h3>
        {payments.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
              title={t('student.noPayments')}
              description={t('student.noPaymentsHint')}
            />
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]" data-testid="student-payments">
              <thead className="bg-background text-label text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('student.paymentDate')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-start font-medium">{t('students.paidMonth')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('student.group')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('student.amount')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('student.paymentMethod')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('student.notes')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('receipt.title')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const invoice = invoices.find(item => item.id === payment.invoice_id);
                  return <tr key={payment.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDate(payment.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{invoice ? invoice.kind === 'enrollment_fee' ? invoice.school_year_label : periodLabel(t, invoice.period_month, invoice.period_year) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{invoice ? invoice.kind === 'enrollment_fee' ? t('students.enrollment_fee') : invoice.group_name || `${invoice.group_subject} — ${invoice.group_level}` : '—'}</td>
                    <td className="px-4 py-2.5 text-end font-medium tabular-nums text-success">
                      {formatCurrency(payment.amount_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{methodLabel(t, payment.payment_method)}</td>
                    <td className="px-4 py-2.5 text-muted">{payment.notes ?? '—'}</td>
                    <td className="px-4 py-2.5"><Button size="sm" variant="secondary" disabled={receiptBusy !== null} data-testid={`student-receipt-${payment.id}`} onClick={() => {
                      setReceiptBusy(payment.id);
                      void paymentsApi.createReceipt(payment.id).then(setReceiptId).catch(error => toast.error(error instanceof Error ? error.message : String(error))).finally(() => setReceiptBusy(null));
                    }}>{t('students.viewReceipt')}</Button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyTotal > 20 && <div className="flex items-center justify-end gap-3"><Button size="sm" variant="secondary" disabled={historyPage <= 1} onClick={() => setHistoryPage(page => page - 1)}>{t('students.pagination.previous')}</Button><span className="text-sm text-muted">{t('students.pagination.page', { page: historyPage, total: Math.ceil(historyTotal / 20) })}</span><Button size="sm" variant="secondary" disabled={historyPage * 20 >= historyTotal} onClick={() => setHistoryPage(page => page + 1)}>{t('students.pagination.next')}</Button></div>}
      {receiptId !== null && <ReceiptPreviewModal receiptId={receiptId} onClose={() => setReceiptId(null)} />}
      <PaymentModal
        open={paymentOpen}
        studentId={studentId}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}

export default StudentFinancesTab;
