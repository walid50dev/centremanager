import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  Info,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import TeacherModal from '../components/teachers/TeacherModal';
import TeacherInfoTab from '../components/teachers/TeacherInfoTab';
import TeacherGroupsTab from '../components/teachers/TeacherGroupsTab';
import TeacherCompensationTab from '../components/teachers/TeacherCompensationTab';
import { toast } from '../components/ui/Toast';
import { teachersApi } from '../services/teachers';
import { cn } from '../utils/format';
import type { TeacherDetail } from '../types';

type TabKey = 'info' | 'groups' | 'compensation';

const TABS: Array<{ key: TabKey; labelKey: string; icon: typeof Info }> = [
  { key: 'info', labelKey: 'teachers.tabInfo', icon: Info },
  { key: 'groups', labelKey: 'teachers.tabGroups', icon: BookOpen },
  { key: 'compensation', labelKey: 'teachers.tabCompensation', icon: Calculator },
];

/** Teacher sheet — identity, groups, estimates and manual payments. */
export function TeacherDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const teacherId = Number(id);

  const [detail, setDetail] = useState<TeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('info');
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(teacherId)) {
      setError('Enseignant introuvable');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await teachersApi.detail(teacherId);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  const teacher = detail?.teacher ?? null;
  const isActive = teacher?.status === 'actif';

  const toggleStatus = async () => {
    if (!teacher) return;
    setChangingStatus(true);
    try {
      const next = isActive ? 'inactif' : 'actif';
      await teachersApi.setStatus(teacher.id, next);
      toast.success(
        next === 'actif' ? t('teachers.toast.reactivated') : t('teachers.toast.deactivated'),
      );
      setConfirmOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setChangingStatus(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  if (error || !teacher || !detail) {
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/teachers')}
          leftIcon={<ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
          className="self-start"
        >
          {t('teachers.back')}
        </Button>
        <Card>
          <EmptyState
            icon={<Info className="h-5 w-5" aria-hidden="true" />}
            title={t('teachers.notFound')}
            description={error ?? undefined}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/teachers')}
            aria-label={t('teachers.back')}
            title={t('teachers.back')}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate">{teacher.full_name}</h1>
              <Badge variant={isActive ? 'success' : 'destructive'}>
                {isActive ? t('teachers.active') : t('teachers.inactive')}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              {teacher.subjects || t('teachers.noSubjectsAssigned')} ·{' '}
              {t('teachers.groupCount', { count: teacher.group_count })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setModalOpen(true)}
            leftIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant={isActive ? 'secondary' : 'primary'}
            onClick={() => setConfirmOpen(true)}
            leftIcon={
              isActive ? (
                <ToggleLeft className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ToggleRight className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            {isActive ? t('teachers.deactivate') : t('teachers.reactivate')}
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map(({ key, labelKey, icon: Icon }) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors',
                selected ? 'text-primary' : 'text-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(labelKey)}
              {selected && (
                <span className="tab-indicator absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {tab === 'info' && <TeacherInfoTab detail={detail} onChanged={() => void load()} />}
      {tab === 'groups' && <TeacherGroupsTab groups={detail.groups} />}
      {tab === 'compensation' && (
        <TeacherCompensationTab
          teacherId={teacher.id}
          teacherName={teacher.full_name}
        />
      )}

      <TeacherModal
        open={modalOpen}
        teacher={detail}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={isActive ? t('teachers.deactivate') : t('teachers.reactivate')}
        message={
          isActive
            ? t('teachers.confirmDeactivate', { name: teacher.full_name })
            : t('teachers.confirmReactivate', { name: teacher.full_name })
        }
        confirmLabel={isActive ? t('teachers.deactivate') : t('teachers.reactivate')}
        cancelLabel={t('common.cancel')}
        destructive={isActive}
        loading={changingStatus}
        onConfirm={() => void toggleStatus()}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default TeacherDetailPage;
