import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Users, Wallet } from 'lucide-react';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { formatCurrency } from '../../utils/format';
import type { TeacherGroup } from '../../types';

export interface TeacherGroupsTabProps {
  groups: TeacherGroup[];
}

/** Tab 2 of the teacher sheet: the active groups and their theoretical revenue. */
export function TeacherGroupsTab({ groups }: TeacherGroupsTabProps) {
  const { t } = useTranslation();

  const totals = useMemo(
    () =>
      groups.reduce(
        (acc, group) => ({
          students: acc.students + group.enrolled_count,
          theoretical: acc.theoretical + group.monthly_fee_cents * group.enrolled_count,
        }),
        { students: 0, theoretical: 0 },
      ),
    [groups],
  );

  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
          title={t('teachers.noGroups')}
          description={t('teachers.noGroupsHint')}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]" data-testid="teacher-groups">
          <thead className="bg-background text-label text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('teachers.group.subject')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('teachers.group.level')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('teachers.group.branch')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('teachers.group.schedule')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('teachers.group.students')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('teachers.group.fee')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.group_id} className="border-t border-border">
                <td className="px-4 py-2.5 font-medium text-foreground">{group.subject_name}</td>
                <td className="px-4 py-2.5 text-muted">{group.level_name}</td>
                <td className="px-4 py-2.5 text-muted">{group.branch_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-muted" dir="auto">
                  {group.day_of_week} {group.start_time}-{group.end_time}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums">{group.enrolled_count}</td>
                <td className="px-4 py-2.5 text-end font-medium tabular-nums">
                  {formatCurrency(group.monthly_fee_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="teacher-groups-summary">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span className="text-label">{t('teachers.summary.groups')}</span>
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums">{groups.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted">
            <Users className="h-4 w-4" aria-hidden="true" />
            <span className="text-label">{t('teachers.summary.students')}</span>
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums">{totals.students}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            <span className="text-label">{t('teachers.summary.theoretical')}</span>
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
            {formatCurrency(totals.theoretical)}
          </p>
        </Card>
      </div>
    </div>
  );
}

export default TeacherGroupsTab;
