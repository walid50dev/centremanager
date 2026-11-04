import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CalendarDays, Plus, UserRound, Wallet } from 'lucide-react';
import Button from '../components/ui/Button';
import TrashButton from '../components/ui/TrashButton';
import ViewButton from '../components/ui/ViewButton';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import GroupModal from '../components/groups/GroupModal';
import ImportButton from '../components/year-import/ImportButton';
import GroupDetailModal from '../components/groups/GroupDetailModal';
import { toast } from '../components/ui/Toast';
import { groupsApi, occupancyTone } from '../services/groups';
import { cn, formatCurrency } from '../utils/format';
import { groupSchedule, groupTitle } from '../utils/schedule';
import type { Group } from '../types';

const toneClasses = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const;

const toneText = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

/** Groups grid, filtered by school year. */
export function GroupsPage() {
  const { t } = useTranslation();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await groupsApi.list();
      setGroups(list);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalEnrolled = useMemo(
    () => groups.reduce((sum, group) => sum + group.enrolled_count, 0),
    [groups],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-h1 text-foreground">
          {t('groups.title')}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[13px] font-medium text-primary">
            {groups.length}
          </span>
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <ImportButton kind="groups" onImported={() => void load()} />
          <Button
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t('groups.new')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card animate-pulse space-y-3 p-5">
              <div className="h-4 w-2/3 rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
              <div className="h-3 w-1/3 rounded bg-slate-100" />
              <div className="h-2 w-full rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
            title={t('groups.noGroups')}
            description={t('groups.noGroupsHint')}
            action={
              <Button
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                {t('groups.new')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const tone = occupancyTone(group.enrolled_count, group.capacity);
            const ratio = Math.min(
              100,
              Math.round((group.enrolled_count / Math.max(1, group.capacity)) * 100),
            );
            return (
              <Card
                key={group.id}
                className="cursor-pointer p-5 transition-shadow hover:shadow-md"
                role="button"
                tabIndex={0}
                onClick={() => setDetailId(group.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailId(group.id);
                  }
                }}
                data-testid={`group-card-${group.id}`}
              >
                <div className="flex justify-end gap-1">
                  <ViewButton name={groupTitle(t, group)} testId={`view-group-${group.id}`} onView={() => setDetailId(group.id)} />
                  <TrashButton type="group" id={group.id} onDeleted={() => void load()} />
                </div>
                <p dir="auto" className="text-body font-semibold text-foreground">
                  {groupTitle(t, group)}
                  {group.branch_name ? <span className="text-muted"> {group.branch_name}</span> : null}
                </p>

                <div className="mt-3 space-y-1.5 text-[13px] text-muted">
                  <p className="flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {group.teacher_name ?? t('groups.noTeacher')}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {groupSchedule(t, group)}
                    {group.room ? <span className="text-muted"> · {group.room}</span> : null}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                    <Wallet className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    {formatCurrency(group.monthly_fee_cents)}
                    <span className="text-muted">{t('groups.perMonth')}</span>
                  </span>
                  <span className={cn('text-[13px] font-semibold', toneText[tone])}>
                    {group.enrolled_count}/{group.capacity}
                  </span>
                </div>

                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full transition-all', toneClasses[tone])}
                    style={{ width: `${ratio}%` }}
                    data-testid={`capacity-bar-${group.id}`}
                    data-tone={tone}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {groups.length > 0 ? (
        <p className="text-[13px] text-muted">
          {t('groups.summary', { groups: groups.length, students: totalEnrolled })}
        </p>
      ) : null}

      <GroupModal
        open={formOpen}
        group={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />

      <GroupDetailModal
        open={detailId !== null}
        groupId={detailId}
        onClose={() => setDetailId(null)}
        onRefresh={() => void load()}
      />
    </div>
  );
}

export default GroupsPage;
