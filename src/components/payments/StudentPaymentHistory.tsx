import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';
import { toast } from '../ui/Toast';
import ReceiptPreviewModal from './ReceiptPreviewModal';
import { paymentsApi } from '../../services/payments';
import { LATE_PAYMENTS_EVENT } from '../../stores/appStore';
import { formatCurrency, formatDate } from '../../utils/format';
import { methodLabel, periodLabel } from '../../utils/billing';
import type { PaymentRow } from '../../types';

export default function StudentPaymentHistory({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await paymentsApi.history({ page, limit: 20 }); if (page > Math.max(1, Math.ceil(data.total / 20))) { setPage(Math.max(1, Math.ceil(data.total / 20))); return; } setRows(data.data); setTotal(data.total); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  const openReceipt = async (row: PaymentRow) => {
    setBusy(true);
    try { setReceipt(await paymentsApi.createReceipt(row.id)); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await paymentsApi.remove(deleting.id); setDeleting(null); toast.success(t('payments.deleted'));
      window.dispatchEvent(new CustomEvent(LATE_PAYMENTS_EVENT)); onChanged();
      if (page > 1 && rows.length === 1) setPage(page - 1); else await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    {loading ? <div className="h-28 animate-pulse rounded-lg bg-slate-100" /> : !rows.length ? <div className="rounded-lg border border-border bg-white"><EmptyState title={t('student.noPayments')} description={t('student.noPaymentsHint')} /></div> : <div className="overflow-x-auto rounded-lg border border-border bg-white"><table className="w-full min-w-[1050px] text-sm" data-testid="payments-history"><thead className="bg-background text-muted"><tr>{['student.paymentDate','students.columns.name','student.group','students.paidMonth','student.amount','student.paymentMethod','common.actions'].map(key => <th key={key} className="whitespace-nowrap px-4 py-3 text-start font-medium">{t(key)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-border"><td className="whitespace-nowrap px-4 py-3">{formatDate(row.created_at)}</td><td className="whitespace-nowrap px-4 py-3 font-medium">{row.student_name}</td><td className="whitespace-nowrap px-4 py-3">{row.invoice_kind === 'enrollment_fee' ? t('students.enrollment_fee') : row.group_name || '—'}</td><td className="whitespace-nowrap px-4 py-3">{row.invoice_kind === 'enrollment_fee' ? row.school_year_label || '—' : row.period_month && row.period_year ? periodLabel(t, row.period_month, row.period_year) : '—'}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatCurrency(row.amount_cents)}</td><td className="whitespace-nowrap px-4 py-3">{methodLabel(t, row.payment_method)}</td><td className="whitespace-nowrap px-4 py-3"><div className="flex items-center gap-2"><Button variant="secondary" size="sm" data-testid={`history-receipt-${row.id}`} disabled={busy} leftIcon={<Printer className="h-4 w-4" />} onClick={() => void openReceipt(row)}>{t('payments.printReceipt')}</Button><Button variant="ghost" size="icon" data-testid={`history-delete-${row.id}`} aria-label={t('payments.deletePayment')} title={t('payments.deletePayment')} disabled={busy} onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}</tbody></table></div>}
    {total > 20 && <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('students.pagination.previous')}</Button><span className="text-sm">{t('students.pagination.page', { page, total: Math.ceil(total / 20) })}</span><Button size="sm" variant="secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>{t('students.pagination.next')}</Button></div>}
    {receipt !== null && <ReceiptPreviewModal receiptId={receipt} onClose={() => setReceipt(null)} />}
    <ConfirmDialog open={!!deleting} title={t('payments.deletePayment')} message={t('payments.confirmDeletePayment')} confirmLabel={t('payments.deletePayment')} cancelLabel={t('common.cancel')} loading={busy} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />
  </div>;
}
