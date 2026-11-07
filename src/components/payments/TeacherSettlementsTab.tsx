import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, HandCoins } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import SettlementModal from '../teachers/SettlementModal';
import { toast } from '../ui/Toast';
import { teacherPaymentsApi, teachersApi } from '../../services/teachers';
import { formatCurrency } from '../../utils/format';
import type { Teacher } from '../../types';

/** Directory and manually recorded payments for the active academic year. */
export function TeacherSettlementsTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ teacher: Teacher; total: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Teacher | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const teachers = await teachersApi.list();
      const next = await Promise.all(teachers.map(async teacher => ({ teacher, total:(await teacherPaymentsApi.list(teacher.id)).reduce((sum, row) => sum + row.amount_cents, 0) })));
      setRows(next);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="h-32 animate-pulse rounded-lg bg-slate-100" />;
  if (!rows.length) return <Card><EmptyState icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />} title={t('teachers.noTeachers')} description={t('teachers.noTeachersHint')} /></Card>;
  return <div className="space-y-3">
    <p className="text-[13px] text-muted">{t('teachers.payment.activeYear')}</p>
    <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-[13px]" data-testid="teacher-summary">
      <thead className="bg-background text-label text-muted"><tr><th className="px-4 py-2.5 text-start">{t('payments.teacherSummary.teacher')}</th><th className="px-4 py-2.5 text-end">{t('teachers.payment.total')}</th><th className="px-4 py-2.5 text-end">{t('common.actions')}</th></tr></thead>
      <tbody>{rows.map(({teacher,total}) => <tr key={teacher.id} className="border-t border-border"><td className="px-4 py-2.5 font-medium"><Link className="text-primary hover:underline" to={`/teachers/${teacher.id}`}>{teacher.full_name}</Link></td><td className="px-4 py-2.5 text-end tabular-nums">{formatCurrency(total)}</td><td className="px-4 py-2.5 text-end"><Button size="sm" onClick={() => setTarget(teacher)} leftIcon={<HandCoins className="h-3.5 w-3.5" aria-hidden="true" />}>{t('teachers.payment.record')}</Button></td></tr>)}</tbody>
    </table></div>
    {target && <SettlementModal open teacherId={target.id} teacherName={target.full_name} onClose={() => setTarget(null)} onSaved={() => void load()} />}
  </div>;
}
export default TeacherSettlementsTab;
