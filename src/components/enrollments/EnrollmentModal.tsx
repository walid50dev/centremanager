import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ClipboardList,
  Info,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import Modal from '../ui/Modal';
import { toast } from '../ui/Toast';
import GroupModal from '../groups/GroupModal';
import StudentModal from '../students/StudentModal';
import { useDebounce } from '../../hooks/useDebounce';
import { groupsApi, occupancyTone } from '../../services/groups';
import { LATE_PAYMENTS_EVENT } from '../../stores/appStore';
import { enrollmentsApi, todayIso } from '../../services/enrollments';
import { studentsApi } from '../../services/students';
import { cn, formatCurrency, formatDate, formatPhone } from '../../utils/format';
import { groupSchedule } from '../../utils/schedule';
import type { EnrollmentInput, EnrolledStudent, Group, Student } from '../../types';

export interface EnrollmentModalProps {
  open: boolean;
  mode: 'from_student' | 'from_group';
  /** Required in `from_student` mode. */
  studentId?: number | null;
  /** Required in `from_group` mode. */
  groupId?: number | null;
  onClose: () => void;
  onSaved: () => void;
  zIndex?: number;
}

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ step: Step; key: string }> = [
  { step: 1, key: 'enrollment.step1' },
  { step: 2, key: 'enrollment.step2' },
  { step: 3, key: 'enrollment.step3' },
  { step: 4, key: 'enrollment.step4' },
];

const toneBar = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const;

/**
 * The enrollment wizard.
 *
 * `from_student` starts from the student and picks any number of groups;
 * `from_group` starts from the group and picks one student. Both share steps
 * 2-4: one start date per group (so "d9a wehda" and "ayam mkhtalfa" both
 * work), a summary and the confirmation which creates every invoice.
 */
export function EnrollmentModal({
  open,
  mode,
  studentId = null,
  groupId = null,
  onClose,
  onSaved,
  zIndex = 50,
}: EnrollmentModalProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // from_student
  const [student, setStudent] = useState<Student | null>(null);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);

  // from_group
  const [group, setGroup] = useState<Group | null>(null);
  const [enrolledIds, setEnrolledIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [results, setResults] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // quick-create (one per mode)
  const [quickGroup, setQuickGroup] = useState(false);
  const [quickStudent, setQuickStudent] = useState(false);

  // shared
  const [dates, setDates] = useState<Record<number, string>>({});
  const [fees, setFees] = useState<Record<number, number>>({});

  // Reset everything on open.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitting(false);
    setSearch('');
    setResults([]);
    setSelectedStudent(null);
    setSelectedGroupIds([]);
    setAvailableGroups([]);
    setDates({});
    setFees({});
    setQuickGroup(false);
    setQuickStudent(false);
  }, [open]);

  // Load whatever step 1 needs.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);

    const load = async () => {
      try {
        if (mode === 'from_student' && studentId) {
          const [groups, detail] = await Promise.all([
            enrollmentsApi.availableForStudent(studentId),
            studentsApi.detail(studentId),
          ]);
          if (!active) return;
          setAvailableGroups(groups);
          setStudent(detail.student);
        } else if (mode === 'from_group' && groupId) {
          const detail = await groupsApi.detail(groupId);
          if (!active) return;
          setGroup(detail.group);
          setEnrolledIds(detail.students.map((row: EnrolledStudent) => row.student_id));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [open, mode, studentId, groupId]);

  // Student search (from_group mode only).
  useEffect(() => {
    if (!open || mode !== 'from_group' || step !== 1) return;
    let active = true;
    studentsApi
      .list({ search: debouncedSearch, status: 'actif', limit: 20 })
      .then((page) => {
        if (!active) return;
        setResults(page.data.filter((row) => !enrolledIds.includes(row.id)));
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [open, mode, step, debouncedSearch, enrolledIds]);

  /**
   * The candidates of step 1 (`from_group`).
   *
   * A student created on the fly is selected but is not part of the current
   * search page, so it is pinned at the top: otherwise the wizard would *look*
   * empty while actually holding a selection.
   */
  const studentCandidates = useMemo(() => {
    if (!selectedStudent) return results;
    return results.some((row) => row.id === selectedStudent.id)
      ? results
      : [selectedStudent, ...results];
  }, [results, selectedStudent]);

  /** The groups this enrollment will cover, in selection order. */
  const selectedGroups = useMemo(() => {
    if (mode === 'from_group') return group ? [group] : [];
    return availableGroups.filter((entry) => selectedGroupIds.includes(entry.id));
  }, [mode, group, availableGroups, selectedGroupIds]);

  // Every selected group needs a start date; default them to today (this also
  // covers `from_group` mode, where no checkbox is toggled first).
  useEffect(() => {
    if (!open) return;
    setDates((current) => {
      const next = { ...current };
      let changed = false;
      for (const entry of selectedGroups) {
        if (!next[entry.id]) {
          next[entry.id] = todayIso();
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [open, selectedGroups]);

  const canContinue = useMemo(() => {
    if (step === 1) {
      return mode === 'from_group' ? selectedStudent !== null : selectedGroupIds.length > 0;
    }
    if (step === 2) {
      return selectedGroups.every((entry) => Boolean(dates[entry.id]) && Number.isSafeInteger(fees[entry.id] ?? entry.monthly_fee_cents) && (fees[entry.id] ?? entry.monthly_fee_cents) >= 0);
    }
    return true;
  }, [step, mode, selectedStudent, selectedGroupIds, selectedGroups, dates, fees]);

  const totalMonthly = selectedGroups.reduce((sum, entry) => sum + (fees[entry.id] ?? entry.monthly_fee_cents), 0);

  const toggleGroup = useCallback((entry: Group) => {
    setSelectedGroupIds((current) =>
      current.includes(entry.id)
        ? current.filter((id) => id !== entry.id)
        : [...current, entry.id],
    );
    setDates((current) => (current[entry.id] ? current : { ...current, [entry.id]: todayIso() }));
  }, []);

  const handleSubmit = useCallback(async () => {
    const targetStudentId = mode === 'from_student' ? studentId : selectedStudent?.id;
    if (!targetStudentId || selectedGroups.length === 0) return;

    const payload: EnrollmentInput[] = selectedGroups.map((entry) => ({
      student_id: targetStudentId,
      group_id: entry.id,
      start_date: dates[entry.id] ?? todayIso(),
      custom_monthly_fee_cents: fees[entry.id] ?? null,
    }));

    setSubmitting(true);
    try {
      const ids = await enrollmentsApi.enrollBatch(payload);
      toast.success(t('enrollment.toast.created', { count: ids.length }));
      const fee = ids.find(result => result.enrollment_fee_invoice_id !== null);
      if (fee) toast.info(t('enrollment.toast.feeCreated', { amount: formatCurrency(fee.enrollment_fee_amount_cents ?? 0) }));
      window.dispatchEvent(new CustomEvent(LATE_PAYMENTS_EVENT));
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [mode, studentId, selectedStudent, selectedGroups, dates, fees, onSaved, onClose, t]);

  const studentLabel = mode === 'from_student' ? (student?.full_name ?? '') : (selectedStudent?.full_name ?? '');

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      zIndex={zIndex}
      size="xl"
      testId="enrollment-modal"
      title={t('enrollment.title')}
      description={
        mode === 'from_student'
          ? t('enrollment.selectGroups')
          : t('enrollment.selectStudent')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          {step > 1 ? (
            <Button
              variant="secondary"
              onClick={() => setStep((current) => (current - 1) as Step)}
              disabled={submitting}
            >
              {t('common.previous')}
            </Button>
          ) : null}
          {step < 4 ? (
            <Button disabled={!canContinue} onClick={() => setStep((current) => (current + 1) as Step)}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              loading={submitting}
              disabled={!canContinue}
              leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void handleSubmit()}
            >
              {t('enrollment.confirm')}
            </Button>
          )}
        </>
      }
    >
      {/* -- step indicator -------------------------------------------- */}
      <ol className="mb-5 flex items-center gap-2" aria-label={t('enrollment.progress')}>
        {STEPS.map((entry, index) => {
          const isDone = step > entry.step;
          const isCurrent = step === entry.step;
          return (
            <li key={entry.step} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                  isCurrent
                    ? 'bg-primary text-white'
                    : isDone
                      ? 'bg-primary/10 text-primary'
                      : 'bg-slate-100 text-muted',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isDone ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : entry.step}
              </span>
              <span
                className={cn(
                  'truncate text-[12px]',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted',
                )}
              >
                {t(entry.key)}
              </span>
              {index < STEPS.length - 1 ? (
                <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* -- step 1: groups (from_student) ----------------------------- */}
      {step === 1 && mode === 'from_student' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted">
              {t('enrollment.studentLabel')}{' '}
              <span className="font-medium text-foreground">{studentLabel}</span>
            </p>
            {/* The group that does not exist yet: create it without leaving the
                wizard, then it is ticked straight away. The list stays a list —
                an enrollment can cover several groups — so the quick-create is a
                button here instead of a “+ Nouveau” row in a dropdown. */}
            <Button
              variant="secondary"
              leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => setQuickGroup(true)}
              disabled={zIndex >= 70}
              data-testid="enrollment-create-group"
            >
              {t('enrollment.newGroup')}
            </Button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-muted">{t('common.loading')}</div>
          ) : availableGroups.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
                title={t('enrollment.noGroupsAvailable')}
                description={t('enrollment.noGroupsAvailableHint')}
              />
            </div>
          ) : (
            <ul className="max-h-[46vh] space-y-2 overflow-y-auto pe-1">
              {availableGroups.map((entry) => {
                const isFull = entry.enrolled_count >= entry.capacity;
                const checked = selectedGroupIds.includes(entry.id);
                const tone = occupancyTone(entry.enrolled_count, entry.capacity);
                return (
                  <li key={entry.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-background',
                        isFull && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-primary"
                        checked={checked}
                        disabled={isFull}
                        onChange={() => toggleGroup(entry)}
                        aria-label={`${entry.subject_name} ${entry.level_name}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {entry.subject_name} — {entry.level_name}
                            {entry.branch_name ? ` · ${entry.branch_name}` : ''}
                          </span>
                          {isFull ? (
                            <Badge variant="destructive">{t('groups.full')}</Badge>
                          ) : (
                            <Badge variant="muted">
                              {t('groups.enrolledOf', {
                                enrolled: entry.enrolled_count,
                                capacity: entry.capacity,
                              })}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                          <span>{entry.teacher_name ?? t('groups.noTeacher')}</span>
                          <span>{groupSchedule(t, entry)}</span>
                          <span className="font-medium text-foreground">
                            {formatCurrency(entry.monthly_fee_cents)}
                          </span>
                        </span>
                        <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <span
                            className={cn('block h-full rounded-full', toneBar[tone])}
                            style={{
                              width: `${Math.min(100, (entry.enrolled_count / Math.max(1, entry.capacity)) * 100)}%`,
                            }}
                          />
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* -- step 1: student (from_group) ------------------------------ */}
      {step === 1 && mode === 'from_group' ? (
        <div className="space-y-3">
          {group ? (
            <p className="text-[13px] text-muted">
              {t('enrollment.groupLabel')}{' '}
              <span className="font-medium text-foreground">
                {group.subject_name} — {group.level_name}
                {group.branch_name ? ` · ${group.branch_name}` : ''}
              </span>
            </p>
          ) : null}

          <div className="flex items-end gap-2">
            <Input
              label={t('enrollment.searchStudent')}
              placeholder={t('students.search')}
              leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant="secondary"
              className="shrink-0"
              leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => setQuickStudent(true)}
              disabled={zIndex >= 70}
              data-testid="enrollment-create-student"
            >
              {t('enrollment.newStudent')}
            </Button>
          </div>

          {loading ? (
            <div className="py-6 text-center text-muted">{t('common.loading')}</div>
          ) : studentCandidates.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
                title={t('enrollment.noStudentsFound')}
                description={t('enrollment.noStudentsFoundHint')}
              />
            </div>
          ) : (
            <ul className="max-h-[40vh] space-y-2 overflow-y-auto pe-1" data-testid="enrollment-students">
              {studentCandidates.map((row) => (
                <li key={row.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                      selectedStudent?.id === row.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-background',
                    )}
                  >
                    <input
                      type="radio"
                      name="enrollment-student"
                      className="h-4 w-4 accent-primary"
                      checked={selectedStudent?.id === row.id}
                      onChange={() => setSelectedStudent(row)}
                      aria-label={row.full_name}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{row.full_name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
                        <span>{row.level_name ?? '—'}</span>
                        <span dir="ltr">{formatPhone(row.phone)}</span>
                      </span>
                    </span>
                    <Badge variant={row.status === 'actif' ? 'success' : 'muted'}>
                      {t(`students.${row.status === 'actif' ? 'active' : 'inactive'}`)}
                    </Badge>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* -- step 2: dates --------------------------------------------- */}
      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">{t('enrollment.datesHint')}</p>
          {selectedGroups.map(entry => {
            const selected = mode === 'from_student' ? student : selectedStudent;
            return selected?.level_id && entry.level_id && selected.level_id !== entry.level_id ? (
              <div key={entry.id} role="alert" data-testid={`level-warning-${entry.id}`} className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
                ⚠️ {t('enrollment.levelMismatch', { student: selected.level_name ?? '—', group: entry.level_name })}
              </div>
            ) : null;
          })}
          <div className="space-y-2">
            {selectedGroups.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_160px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {entry.subject_name} — {entry.level_name}
                    {entry.branch_name ? ` · ${entry.branch_name}` : ''}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {groupSchedule(t, entry)} · {formatCurrency(entry.monthly_fee_cents)}
                  </p>
                </div>
                <MoneyInput label={t('enrollment.customFee')} data-testid={`enrollment-fee-${entry.id}`}
                  valueCents={fees[entry.id] ?? entry.monthly_fee_cents}
                  onChange={value => setFees(current => ({ ...current, [entry.id]: value }))} />
                <Input
                  label={t('enrollment.startDate')}
                  type="date"
                  value={dates[entry.id] ?? todayIso()}
                  onChange={(event) =>
                    setDates((current) => ({ ...current, [entry.id]: event.target.value }))
                  }
                  leftIcon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
                />
              </div>
            ))}
          </div>
          <p className="flex items-start gap-2 rounded-md bg-primary/5 p-3 text-[12px] text-primary">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('enrollment.invoiceNotice')}
          </p>
        </div>
      ) : null}

      {/* -- step 3: summary ------------------------------------------- */}
      {step === 3 ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-background text-label text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('enrollment.group')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('enrollment.startDate')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('enrollment.monthlyFee')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroups.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">
                        {entry.subject_name} — {entry.level_name}
                      </span>
                      {entry.branch_name ? (
                        <span className="text-muted"> · {entry.branch_name}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDate(dates[entry.id] ?? todayIso())}</td>
                    <td className="px-4 py-2.5 text-end">{formatCurrency(fees[entry.id] ?? entry.monthly_fee_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-background">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-foreground" colSpan={2}>
                    {t('enrollment.totalMonthly')}
                  </td>
                  <td className="px-4 py-2.5 text-end font-semibold text-foreground">
                    {formatCurrency(totalMonthly)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t('enrollment.invoiceNotice')} {t('enrollment.prepaid')}
            </span>
          </p>
          <p className="text-[12px] text-muted">{t('enrollment.noProrata')}</p>
        </div>
      ) : null}

      {/* -- step 4: confirmation -------------------------------------- */}
      {step === 4 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border p-4">
            {/* The heading always describes the student: in `from_group` mode the
                fixed group is already listed in the rows below with its date. */}
            <p className="text-[13px] text-muted">{t('enrollment.studentLabel')}</p>
            <p className="text-body font-medium text-foreground">{studentLabel}</p>
            <ul className="mt-3 space-y-1 text-[13px] text-foreground">
              {selectedGroups.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span>
                    {entry.subject_name} — {entry.level_name}
                  </span>
                  <span className="text-muted">{formatDate(dates[entry.id] ?? todayIso())}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border pt-3 text-[13px] font-semibold text-foreground">
              {t('enrollment.totalMonthly')}: {formatCurrency(totalMonthly)}
            </p>
          </div>
          <p className="text-[12px] text-muted">{t('enrollment.confirmHint')}</p>
        </div>
      ) : null}
      </Modal>

      {quickGroup && open ? (
        <GroupModal
          open
          zIndex={zIndex + 10}
          onClose={() => setQuickGroup(false)}
          onSaved={() => {}}
          onCreated={(id) => {
            void groupsApi.detail(id).then(({ group: created }) => {
              setAvailableGroups(current => current.some(entry => entry.id === id) ? current : [created, ...current]);
              setSelectedGroupIds(current => current.includes(id) ? current : [...current, id]);
              setDates(current => current[id] ? current : { ...current, [id]: todayIso() });
              if (studentId) void enrollmentsApi.availableForStudent(studentId).then(groups => {
                setAvailableGroups(groups.some(group => group.id === id) ? groups : [created, ...groups]);
              }).catch(() => {});
            }).catch(error => toast.error(error instanceof Error ? error.message : String(error)));
          }}
        />
      ) : null}

      {quickStudent && open ? (
        <StudentModal
          open
          zIndex={zIndex + 10}
          onClose={() => setQuickStudent(false)}
          onSaved={() => {}}
          onCreated={({ id }) => {
            void studentsApi.detail(id).then(detail => setSelectedStudent(detail.student))
              .catch(error => toast.error(error instanceof Error ? error.message : String(error)));
          }}
        />
      ) : null}
    </>
  );
}

export default EnrollmentModal;
