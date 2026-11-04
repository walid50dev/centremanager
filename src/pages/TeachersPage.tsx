import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, Plus, Users } from 'lucide-react';
import Badge from '../components/ui/Badge';
import TrashButton from '../components/ui/TrashButton';
import ViewButton from '../components/ui/ViewButton';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import TeacherModal from '../components/teachers/TeacherModal';
import ImportButton from '../components/year-import/ImportButton';
import { toast } from '../components/ui/Toast';
import { teachersApi } from '../services/teachers';
import { modeBadge } from '../utils/compensation';
import { cn } from '../utils/format';
import type { Teacher } from '../types';

/** Teachers grid: name, subjects, group count and the payroll badge. */
export function TeachersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeachers(await teachersApi.list());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => teachers.filter((teacher) => teacher.status === 'actif').length,
    [teachers],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-h1 text-foreground">
          {t('teachers.title')}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[13px] font-medium text-primary">
            {teachers.length}
          </span>
        </h1>

        <div className="flex flex-wrap gap-2"><ImportButton kind="teachers" onImported={() => void load()} />
        <Button
          leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setFormOpen(true)}
          data-testid="teacher-new"
        >
          {t('teachers.new')}
        </Button></div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card animate-pulse space-y-3 p-5">
              <div className="h-4 w-2/3 rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
              <div className="h-3 w-1/3 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : teachers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
            title={t('teachers.noTeachers')}
            description={t('teachers.noTeachersHint')}
            action={
              <Button
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setFormOpen(true)}
              >
                {t('teachers.new')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teachers.map((teacher) => {
            const subjectNames = teacher.subjects ? teacher.subjects.split(', ') : [];
            const inactive = teacher.status !== 'actif';
            return (
              <Card
                key={teacher.id}
                className={cn(
                  'cursor-pointer p-5 transition-shadow hover:shadow-md',
                  inactive && 'opacity-70',
                )}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/teachers/${teacher.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/teachers/${teacher.id}`);
                  }
                }}
                data-testid={`teacher-card-${teacher.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p dir="auto" className="text-body font-semibold text-foreground">
                    {teacher.full_name}
                  </p>
                  <div className="flex items-center gap-1">
                    {inactive ? <Badge variant="destructive">{t('teachers.inactive')}</Badge> : null}
                    <ViewButton name={teacher.full_name} testId={`view-teacher-${teacher.id}`} onView={() => navigate(`/teachers/${teacher.id}`)} />
                    <TrashButton type="teacher" id={teacher.id} onDeleted={() => void load()} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {subjectNames.length === 0 ? (
                    <span className="text-[12px] text-muted">{t('teachers.noSubjectsAssigned')}</span>
                  ) : (
                    subjectNames.map((name) => (
                      <Badge key={name} variant="primary">
                        {name}
                      </Badge>
                    ))
                  )}
                </div>

                <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('teachers.groupCount', { count: teacher.group_count })}
                </p>

                <div className="mt-4 border-t border-border pt-3">
                  {teacher.compensation_mode ? (
                    <span className="text-[13px] font-medium text-foreground">
                      {modeBadge(t, teacher.compensation_mode, teacher.compensation_value_cents)}
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted">{t('teachers.notConfigured')}</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {teachers.length > 0 ? (
        <p className="text-[13px] text-muted">
          {t('teachers.summaryLine', { count: teachers.length, active: activeCount })}
        </p>
      ) : null}

      <TeacherModal
        open={formOpen}
        teacher={null}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

export default TeachersPage;
