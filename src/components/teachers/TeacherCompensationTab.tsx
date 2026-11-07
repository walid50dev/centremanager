import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins, Receipt } from 'lucide-react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import SettlementModal from './SettlementModal';
import { toast } from '../ui/Toast';
import { teacherPaymentsApi } from '../../services/teachers';
import { formatCurrency, formatDate } from '../../utils/format';
import { methodLabel } from '../../utils/billing';
import type { TeacherPayment } from '../../types';

export interface TeacherCompensationTabProps {
  teacherId: number;
  teacherName: string;
}

/** Payments for the active school year, independent of configured estimates. */
export function TeacherCompensationTab({ teacherId, teacherName }: TeacherCompensationTabProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TeacherPayment[]>([]);
  const [unattributed, setUnattributed] = useState<TeacherPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const [yearPayments, historicalPayments] = await Promise.all([teacherPaymentsApi.list(teacherId), teacherPaymentsApi.unattributed(teacherId)]);
      setRows(yearPayments); setUnattributed(historicalPayments);
    }
    catch (err) { setError(true); toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [teacherId]);
  useEffect(() => { void load(); }, [load]);
  const total = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-h2 text-foreground">{t('teachers.payment.history')}</h3><p className="text-[13px] text-muted">{t('teachers.payment.activeYear')}</p></div>
      <Button onClick={() => setModalOpen(true)} leftIcon={<HandCoins className="h-4 w-4" aria-hidden="true" />} data-testid="comp-settle">{t('teachers.payment.record')}</Button>
    </div>
    {loading ? <div className="h-32 animate-pulse rounded-lg bg-slate-100" /> : error ? <Card>{t('common.error')}</Card> : <>
      <p className="text-[13px] font-semibold" data-testid="teacher-paid-total">{t('teachers.payment.total')}: {formatCurrency(total)}</p>
      {rows.length === 0 ? <Card><EmptyState icon={<Receipt className="h-5 w-5" aria-hidden="true" />} title={t('teachers.payment.empty')} description={t('teachers.payment.emptyHint')} /></Card> :
        <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-[13px]" data-testid="teacher-settlements">
          <thead className="bg-background text-label text-muted"><tr>
            <th className="px-4 py-2.5 text-start">{t('teachers.settlement.date')}</th><th className="px-4 py-2.5 text-end">{t('teachers.settlement.amount')}</th><th className="px-4 py-2.5 text-start">{t('teachers.settlement.method')}</th><th className="px-4 py-2.5 text-start">{t('teachers.settlement.notes')}</th>
          </tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-border" data-testid={`teacher-payment-${row.id}`}>
            <td className="px-4 py-2.5 text-muted">{formatDate(row.payment_date)}</td><td className="px-4 py-2.5 text-end font-medium tabular-nums text-success">{formatCurrency(row.amount_cents)}</td><td className="px-4 py-2.5 text-muted">{methodLabel(t, row.payment_method)}</td><td className="px-4 py-2.5 text-muted">{row.notes ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>}
      {unattributed.length > 0 && <details className="rounded-lg border border-warning/40 bg-warning/5 p-3" data-testid="teacher-unattributed">
        <summary className="cursor-pointer text-[13px] font-medium">{t('teachers.payment.unattributed', { count: unattributed.length })}</summary>
        <p className="mt-1 text-[12px] text-muted">{t('teachers.payment.unattributedHint')}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-[13px]"><thead><tr>
          <th className="px-3 py-2 text-start">{t('teachers.settlement.date')}</th><th className="px-3 py-2 text-end">{t('teachers.settlement.amount')}</th><th className="px-3 py-2 text-start">{t('teachers.settlement.method')}</th><th className="px-3 py-2 text-start">{t('teachers.settlement.notes')}</th>
        </tr></thead><tbody>{unattributed.map(row => <tr key={row.id} className="border-t border-border"><td className="px-3 py-2">{formatDate(row.payment_date) || '—'}</td><td className="px-3 py-2 text-end">{formatCurrency(row.amount_cents)}</td><td className="px-3 py-2">{methodLabel(t,row.payment_method)}</td><td className="px-3 py-2">{row.notes ?? '—'}</td></tr>)}</tbody></table></div>
      </details>}
    </>}
    <SettlementModal open={modalOpen} teacherId={teacherId} teacherName={teacherName} onClose={() => setModalOpen(false)} onSaved={() => void load()} />
  </div>;
}
export default TeacherCompensationTab;
