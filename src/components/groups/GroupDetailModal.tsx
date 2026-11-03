import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Pencil, Trash2, UserPlus, UserRound } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import { toast } from '../ui/Toast';
import EnrollmentModal from '../enrollments/EnrollmentModal';
import GroupModal from './GroupModal';
import { groupsApi, occupancyTone } from '../../services/groups';
import { enrollmentsApi } from '../../services/enrollments';
import { cn, formatCurrency, formatDate, formatPhone } from '../../utils/format';
import { groupSchedule, groupTitle } from '../../utils/schedule';
import type { GroupDetail } from '../../types';

export interface GroupDetailModalProps {
  open: boolean;
  groupId: number | null;
  onClose: () => void;
  /** Called after an edit or a removal so the grid can refresh. */
  onRefresh: () => void;
}

const toneClasses = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const;

/** Group sheet: schedule, money for the current month, enrolled students. */
export function GroupDetailModal({ open, groupId, onClose, onRefresh }: GroupDetailModalProps) {
  const { t } = useTranslation();

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [toRemove, setToRemove] = useState<{ id: number; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      setDetail(await groupsApi.detail(groupId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleRemove = useCallback(async () => {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await enrollmentsApi.end(toRemove.id);
      toast.success(t('enrollment.toast.ended'));
      setToRemove(null);
      await load();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
    }
  }, [toRemove, load, onRefresh, t]);

  const group = detail?.group;
  const summary = detail?.financial_summary;
  const collectedRatio =
    summary && summary.theoretical_total_cents > 0
      ? summary.collected_total_cents / summary.theoretical_total_cents
      : 0;
  const collectedTone =
    collectedRatio >= 0.9 ? 'success' : collectedRatio >= 0.5 ? 'warning' : 'destructive';
  const capacityTone = group ? occupancyTone(group.enrolled_count, group.capacity) : 'success';

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title={
          group ? (
            <span className="flex flex-wrap items-center gap-2">
              {groupTitle(t, group)}
              {group.branch_name ? <span className="text-muted">· {group.branch_name}</span> : null}
              <Badge variant={group.enrolled_count >= group.capacity ? 'destructive' : 'success'}>
                {group.enrolled_count}/{group.capacity}
              </Badge>
            </span>
          ) : (
            t('groups.detail.title')
          )
        }
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        {loading && !detail ? (
          <div className="py-10 text-center text-muted">{t('common.loading')}</div>
        ) : null}

        {group && summary ? (
          <div className="space-y-5">
            {/* -- schedule & money ------------------------------------- */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <dl className="card grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[13px]">
                <div>
                  <dt className="text-muted">{t('groups.teacher')}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {group.teacher_name ?? t('groups.noTeacher')}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t('groups.day')}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {groupSchedule(t, group)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t('groups.room')}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{group.room ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('groups.monthlyFee')}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {formatCurrency(group.monthly_fee_cents)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted">{t('groups.capacity')}</dt>
                  <dd className="mt-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn('h-full rounded-full transition-all', toneClasses[capacityTone])}
                        style={{
                          width: `${Math.min(100, (group.enrolled_count / Math.max(1, group.capacity)) * 100)}%`,
                        }}
                        data-testid="group-capacity-bar"
                      />
                    </div>
                    <span className="mt-1 inline-block text-[12px] text-muted">
                      {t('groups.enrolledOf', { enrolled: group.enrolled_count, capacity: group.capacity })}
                    </span>
                  </dd>
                </div>
              </dl>

              <div className="card space-y-2 p-4" data-testid="financial-summary">
                <p className="flex items-center gap-1.5 text-label text-muted">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('groups.detail.financial')} —{' '}
                  {t(`common.months.${summary.month}`)} {summary.year}
                </p>
                <p className="text-[13px] text-foreground">
                  {t('groups.detail.theoretical')}:{' '}
                  <span className="font-semibold">{formatCurrency(summary.theoretical_total_cents)}</span>{' '}
                  <span className="text-muted">
                    ({t('groups.detail.breakdown', {
                      count: summary.active_enrollments,
                      fee: formatCurrency(summary.monthly_fee_cents),
                    })})
                  </span>
                </p>
                <p className="text-[13px] text-foreground">
                  {t('groups.detail.collected')}:{' '}
                  <span
                    className={cn(
                      'font-semibold',
                      collectedTone === 'success'
                        ? 'text-success'
                        : collectedTone === 'warning'
                          ? 'text-warning'
                          : 'text-destructive',
                    )}
                  >
                    {formatCurrency(summary.collected_total_cents)}
                  </span>
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full transition-all', toneClasses[collectedTone])}
                    style={{ width: `${Math.min(100, Math.round(collectedRatio * 100))}%` }}
                    data-testid="collected-bar"
                  />
                </div>
              </div>
            </div>

            {/* -- actions ---------------------------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-h2 text-foreground">{t('groups.detail.students')}</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => setEditOpen(true)}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  size="sm"
                  leftIcon={<UserPlus className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => setEnrollOpen(true)}
                >
                  {t('groups.detail.addStudent')}
                </Button>
              </div>
            </div>

            {detail.students.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
                  title={t('groups.detail.noStudents')}
                  description={t('groups.detail.noStudentsHint')}
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-background text-label text-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-start font-medium">{t('students.name')}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t('students.phone')}</th>
                      <th className="px-4 py-2.5 text-start font-medium">
                        {t('groups.detail.startDate')}
                      </th>
                      <th className="px-4 py-2.5 text-end font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.students.map((student) => (
                      <tr key={student.enrollment_id} className="border-t border-border">
                        <td className="px-4 py-2.5 font-medium text-foreground">{student.student_name}</td>
                        <td className="px-4 py-2.5 text-muted" dir="ltr">
                          {formatPhone(student.student_phone)}
                        </td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(student.start_date)}</td>
                        <td className="px-4 py-2.5 text-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/5"
                            leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() =>
                              setToRemove({
                                id: student.enrollment_id,
                                name: student.student_name,
                              })
                            }
                          >
                            {t('groups.detail.removeStudent')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <GroupModal
        open={editOpen}
        group={group ?? null}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          void load();
          onRefresh();
        }}
      />

      <EnrollmentModal
        open={enrollOpen}
        mode="from_group"
        groupId={groupId}
        onClose={() => setEnrollOpen(false)}
        onSaved={() => {
          void load();
          onRefresh();
        }}
      />

      <ConfirmDialog
        open={toRemove !== null}
        title={t('groups.detail.removeStudent')}
        message={t('groups.detail.confirmRemove', { name: toRemove?.name ?? '' })}
        confirmLabel={t('groups.detail.removeStudent')}
        cancelLabel={t('common.cancel')}
        loading={removing}
        onConfirm={() => void handleRemove()}
        onClose={() => setToRemove(null)}
      />
    </>
  );
}

export default GroupDetailModal;
