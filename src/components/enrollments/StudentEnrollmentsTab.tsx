import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';
import { toast } from '../ui/Toast';
import EnrollmentModal from './EnrollmentModal';
import { enrollmentsApi } from '../../services/enrollments';
import { groupsApi } from '../../services/groups';
import { cn, formatCurrency, formatDate } from '../../utils/format';
import { groupSchedule } from '../../utils/schedule';
import type { Group, StudentEnrollment } from '../../types';

export interface StudentEnrollmentsTabProps {
  studentId: number;
  studentName: string;
  /** Called after an enrollment is created or ended (refreshes the audit tab too). */
  onChanged?: () => void;
}

/** Tab 2 of the student sheet: active + terminated enrollments. */
export function StudentEnrollmentsTab({
  studentId,
  studentName,
  onChanged,
}: StudentEnrollmentsTabProps) {
  const { t } = useTranslation();

  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [toEnd, setToEnd] = useState<StudentEnrollment | null>(null);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, groupRows] = await Promise.all([enrollmentsApi.forStudent(studentId), groupsApi.list()]);
      setEnrollments(rows);
      setGroups(groupRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === 'actif'),
    [enrollments],
  );
  const ended = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status !== 'actif'),
    [enrollments],
  );

  const handleEnd = useCallback(async () => {
    if (!toEnd) return;
    setEnding(true);
    try {
      await enrollmentsApi.end(toEnd.enrollment_id);
      toast.success(t('enrollment.toast.ended'));
      setToEnd(null);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setEnding(false);
    }
  }, [toEnd, load, onChanged, t]);

  const schedule = (enrollment: StudentEnrollment) => groupSchedule(t, enrollment);

  const groupLabel = (enrollment: StudentEnrollment) =>
    groups.find(group => group.id === enrollment.group_id)?.name || `${enrollment.level_name}${enrollment.branch_name ? ` · ${enrollment.branch_name}` : ''}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h2 text-foreground">
          {t('student.activeEnrollments')}
          {active.length > 0 ? (
            <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[13px] font-medium text-primary">
              {active.length}
            </span>
          ) : null}
        </h2>
        <Button
          size="sm"
          leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => setWizardOpen(true)}
        >
          {t('student.enrollToGroup')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
            title={t('student.noActiveEnrollments')}
            description={t('student.noActiveEnrollmentsHint')}
            action={
              <Button
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setWizardOpen(true)}
              >
                {t('student.enrollToGroup')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="detail-table-container overflow-hidden rounded-xl border border-border bg-white">
          <table className="detail-table detail-enrollments w-full text-[13px]" data-testid="active-enrollments">
            <thead className="bg-slate-50 text-label text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('groups.subject')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.group')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('groups.teacher')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.schedule')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('students.standardFee')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('students.personalFee')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('student.startDate')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((enrollment) => (
                <tr key={enrollment.enrollment_id} className="border-t border-border hover:bg-slate-50/50">
                  <td data-label={t('groups.subject')} className="px-4 py-2.5 font-medium text-foreground">{enrollment.subject_name}</td>
                  <td data-label={t('student.group')} className="px-4 py-2.5 text-muted"><Badge variant="primary" className="max-w-full whitespace-normal text-start leading-4 [overflow-wrap:anywhere]">{groupLabel(enrollment)}</Badge></td>
                  <td data-label={t('groups.teacher')} className="px-4 py-2.5 text-muted">
                    {enrollment.teacher_name ?? t('groups.noTeacher')}
                  </td>
                  <td data-label={t('student.schedule')} className="px-4 py-2.5 text-muted">{schedule(enrollment)}</td>
                  <td data-label={t('students.standardFee')} className="whitespace-nowrap px-4 py-2.5 text-end">{groups.find(group => group.id === enrollment.group_id) ? formatCurrency(groups.find(group => group.id === enrollment.group_id)!.monthly_fee_cents) : '—'}</td>
                  <td data-label={t('students.personalFee')} className={cn('whitespace-nowrap px-4 py-2.5 text-end font-semibold text-primary', groups.find(group => group.id === enrollment.group_id) && enrollment.monthly_fee_cents < groups.find(group => group.id === enrollment.group_id)!.monthly_fee_cents && 'font-semibold text-success')}>
                    <span className="inline-flex flex-col items-end gap-1"><span>{formatCurrency(enrollment.monthly_fee_cents)}</span>{groups.find(group => group.id === enrollment.group_id) && enrollment.monthly_fee_cents < groups.find(group => group.id === enrollment.group_id)!.monthly_fee_cents ? <Badge variant="success">{t('students.reducedFee')}</Badge> : null}</span>
                  </td>
                  <td data-label={t('student.startDate')} className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDate(enrollment.start_date)}</td>
                  <td data-label={t('common.actions')} className="px-4 py-2.5 text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/5"
                      leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setToEnd(enrollment)}
                    >
                      {t('student.endEnrollment')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ended.length > 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-foreground"
            onClick={() => setShowEnded((current) => !current)}
            aria-expanded={showEnded}
          >
            {showEnded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            )}
            {t('student.endedEnrollments')} ({ended.length})
          </button>

          {showEnded ? (
            <div className="detail-table-container overflow-hidden rounded-xl border border-border bg-white">
              <table className="detail-table w-full text-[13px]" data-testid="ended-enrollments">
                <thead className="bg-slate-50 text-label text-muted">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t('groups.subject')}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t('student.group')}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t('student.schedule')}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t('groups.monthlyFee')}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t('student.startDate')}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t('student.endDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ended.map((enrollment) => (
                    <tr key={enrollment.enrollment_id} className="border-t border-border text-muted">
                      <td data-label={t('groups.subject')} className="px-4 py-2.5">{enrollment.subject_name}</td>
                      <td data-label={t('student.group')} className="px-4 py-2.5"><Badge variant="primary" className="max-w-full whitespace-normal text-start leading-4 [overflow-wrap:anywhere]">{groupLabel(enrollment)}</Badge></td>
                      <td data-label={t('student.schedule')} className="px-4 py-2.5">{schedule(enrollment)}</td>
                      <td data-label={t('groups.monthlyFee')} className="px-4 py-2.5 text-end">
                        {formatCurrency(enrollment.monthly_fee_cents)}
                      </td>
                      <td data-label={t('student.startDate')} className="px-4 py-2.5">{formatDate(enrollment.start_date)}</td>
                      <td data-label={t('student.endDate')} className="px-4 py-2.5">
                        <span className={cn('inline-flex items-center gap-1.5')}>
                          {formatDate(enrollment.end_date)}
                          <Badge variant="muted">{t('student.ended')}</Badge>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <EnrollmentModal
        open={wizardOpen}
        mode="from_student"
        studentId={studentId}
        onClose={() => setWizardOpen(false)}
        onSaved={() => {
          void load();
          onChanged?.();
        }}
      />

      <ConfirmDialog
        open={toEnd !== null}
        title={t('student.endEnrollment')}
        message={t('student.confirmEndEnrollment', { name: studentName })}
        confirmLabel={t('student.endEnrollment')}
        cancelLabel={t('common.cancel')}
        loading={ending}
        onConfirm={() => void handleEnd()}
        onClose={() => setToEnd(null)}
      />
    </div>
  );
}

export default StudentEnrollmentsTab;
