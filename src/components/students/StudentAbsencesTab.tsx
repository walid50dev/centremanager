import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { absencesApi, type Absence } from '../../services/absences';
import { enrollmentsApi, todayIso } from '../../services/enrollments';
import { groupsApi } from '../../services/groups';
import { formatDate } from '../../utils/format';

export default function StudentAbsencesTab({ studentId }: { studentId: number }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Absence[]>([]);
  const [groups, setGroups] = useState<Array<{ value: number; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState('');
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [justified, setJustified] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Absence | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [absences, enrollments, allGroups] = await Promise.all([absencesApi.list(studentId), enrollmentsApi.forStudent(studentId), groupsApi.list()]);
      setRows(absences);
      const enrolledIds = new Set(enrollments.map(e => e.group_id));
      setGroups(allGroups.filter(g => enrolledIds.has(g.id)).map(g => ({ value: g.id, label: g.name || `${g.subject_name} — ${g.level_name}` })));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    setShowErrors(true);
    if (!group || !date) return;
    setBusy(true);
    try {
      await absencesApi.add({ student_id: studentId, group_id: Number(group), absence_date: date, reason: reason.trim() || null, is_justified: justified });
      setOpen(false); toast.success(t('attendance.added')); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try { await absencesApi.remove(toDelete.id); setToDelete(null); toast.success(t('attendance.deleted')); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-h2">{t('students.tabAttendance')}</h2><Button data-testid="absence-add" disabled={loading || groups.length === 0} leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setGroup(''); setDate(todayIso()); setReason(''); setJustified(false); setShowErrors(false); setOpen(true); }}>{t('attendance.add')}</Button></div>
    {loading ? <div className="h-20 animate-pulse rounded bg-slate-100" /> : rows.length === 0 ? <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title={t('attendance.empty')} description={groups.length ? t('attendance.emptyHint') : t('attendance.noGroup')} /></Card> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[650px] text-sm" data-testid="student-absences"><thead className="bg-background text-muted"><tr>{['attendance.date','student.group','attendance.justified','attendance.reason','common.actions'].map(key => <th key={key} className="px-4 py-3 text-start font-medium">{t(key)}</th>)}</tr></thead><tbody>{rows.map(row => <tr className="border-t border-border" key={row.id}><td className="whitespace-nowrap px-4 py-3">{formatDate(row.absence_date)}</td><td className="px-4 py-3">{row.group_name}</td><td className="px-4 py-3"><Badge variant={row.is_justified ? 'success' : 'muted'}>{t(row.is_justified ? 'attendance.yes' : 'attendance.no')}</Badge></td><td className="px-4 py-3">{row.reason || '—'}</td><td className="px-4 py-3"><Button variant="ghost" size="icon" data-testid={`absence-delete-${row.id}`} aria-label={t('attendance.delete')} title={t('attendance.delete')} onClick={() => setToDelete(row)}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={() => setOpen(false)} title={t('attendance.add')} size="md" footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel')}</Button><Button data-testid="absence-save" onClick={() => void add()} loading={busy}>{t('common.save')}</Button></>}>
      <div className="space-y-4"><Select label={t('student.group')} required placeholder="—" data-testid="absence-group" options={groups} value={group} onChange={e => setGroup(e.target.value)} error={showErrors && !group ? t('common.required') : undefined} /><Input type="date" required label={t('attendance.date')} data-testid="absence-date" value={date} onChange={e => setDate(e.target.value)} error={showErrors && !date ? t('common.required') : undefined} /><Textarea label={t('attendance.reason')} data-testid="absence-reason" value={reason} onChange={e => setReason(e.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="absence-justified" checked={justified} onChange={e => setJustified(e.target.checked)} />{t('attendance.justified')}</label></div>
    </Modal>
    <ConfirmDialog open={!!toDelete} title={t('attendance.delete')} message={t('attendance.confirmDelete')} confirmLabel={t('attendance.delete')} cancelLabel={t('common.cancel')} loading={busy} onClose={() => setToDelete(null)} onConfirm={() => void remove()} />
  </div>;
}
