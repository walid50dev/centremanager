import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import Badge from '../components/ui/Badge';
import TrashButton from '../components/ui/TrashButton';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import StudentModal from '../components/students/StudentModal';
import ImportButton from '../components/year-import/ImportButton';
import { toast } from '../components/ui/Toast';
import { levelsApi } from '../services/settings';
import { studentsApi } from '../services/students';
import { FOCUS_SEARCH_EVENT } from '../hooks/useKeyboardShortcuts';
import { useDebounce } from '../hooks/useDebounce';
import { cn, formatDate, formatPhone } from '../utils/format';
import type { Level, PaginatedStudents, Student } from '../types';

const PAGE_LIMIT = 20;

const EMPTY_PAGE: PaginatedStudents = { data: [], total: 0, page: 1, limit: PAGE_LIMIT };

/** Status filter values: '' = every status. */
type StatusFilter = '' | 'actif' | 'inactif';

export function StudentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [levelId, setLevelId] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('actif');
  const [page, setPage] = useState(1);

  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<PaginatedStudents>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Ctrl/⌘+K anywhere in the app focuses this field (see useKeyboardShortcuts).
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = () => {
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      input.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focusSearch);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focusSearch);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await studentsApi.list({
        search: debouncedSearch,
        levelId: levelId ? Number(levelId) : null,
        status: status || null,
        page,
        limit: PAGE_LIMIT,
      });
      setResult(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
      setResult(EMPTY_PAGE);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, levelId, status, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    levelsApi
      .list()
      .then((rows) => {
        if (active) setLevels(rows);
      })
      .catch(() => {
        /* filter simply stays limited to “all levels” */
      });
    return () => {
      active = false;
    };
  }, []);

  const levelOptions = useMemo(
    () => levels.map((level) => ({ value: level.id, label: level.name })),
    [levels],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('students.allStatuses') },
      { value: 'actif', label: t('students.filterActive') },
      { value: 'inactif', label: t('students.filterInactive') },
    ],
    [t],
  );

  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1;
  const lastRow = result.total === 0 ? 0 : Math.min(result.page * result.limit, result.total);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const onSaved = () => {
    setPage(1);
    void load();
  };

  const hasFilters = Boolean(debouncedSearch || levelId || status !== 'actif');

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1>{t('pages.students.title')}</h1>
          <Badge variant="primary" aria-label={t('students.count', { count: result.total })}>
            {result.total}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2"><ImportButton kind="students" onImported={onSaved} />
        <Button onClick={openCreate} leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>
          {t('students.new')}
        </Button></div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          ref={searchRef}
          containerClassName="sm:max-w-xs"
          data-testid="students-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('students.search')}
          aria-label={t('students.search')}
          leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
        />
        <Select
          containerClassName="sm:max-w-[220px]"
          value={levelId}
          options={levelOptions}
          placeholder={t('students.allLevels')}
          aria-label={t('students.allLevels')}
          onChange={(event) => {
            setLevelId(event.target.value);
            setPage(1);
          }}
        />
        <Select
          containerClassName="sm:max-w-[180px]"
          value={status}
          options={statusOptions}
          aria-label={t('students.statusFilter')}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            setPage(1);
          }}
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead className="bg-background">
              <tr>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.columns.name')}
                </th>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.columns.level')}
                </th>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.guardian_column')}
                </th>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.school_name')}
                </th>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.columns.status')}
                </th>
                <th scope="col" className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                  {t('students.enrollment_column')}
                </th><th scope="col" className="border-b border-border px-4 py-2.5 text-start text-muted">{t('trash.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="border-b border-border last:border-b-0">
                    {Array.from({ length: 7 }).map((__, cell) => (
                      <td key={`skeleton-${index}-${cell}`} className="px-4 py-3">
                        <span
                          className={cn(
                            'block h-3.5 animate-pulse rounded bg-slate-100',
                            cell === 0 ? 'w-40' : cell === 1 ? 'w-28' : 'w-24',
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading && result.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={<Users className="h-5 w-5" aria-hidden="true" />}
                      title={t('students.empty')}
                      description={
                        hasFilters ? t('students.emptyDescriptionFiltered') : t('students.emptyDescription')
                      }
                      action={
                        hasFilters ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSearch('');
                              setLevelId('');
                              setStatus('');
                              setPage(1);
                            }}
                          >
                            {t('students.clearFilters')}
                          </Button>
                        ) : (
                          <Button
                            onClick={openCreate}
                            leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                          >
                            {t('students.addFirst')}
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                result.data.map((student) => (
                  <tr
                    key={student.id}
                    onClick={() => navigate(`/students/${student.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/students/${student.id}`);
                      }
                    }}
                    tabIndex={0}
                    className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground group-hover:underline">
                        {student.full_name}
                      </span>

                    </td>
                    <td className="px-4 py-3 text-muted">
                      {student.level_name ? (
                        <span className="text-foreground">
                          {student.level_name}
                          {student.branch_name && (
                            <span className="text-muted"> — {student.branch_name}</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{student.guardian_name ?? '—'}<span className="block tabular-nums" dir="ltr">{formatPhone(student.phone)}</span></td>
                    <td className="px-4 py-3 text-muted">{student.school_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={student.status === 'actif' ? 'success' : 'destructive'}>
                        {student.status === 'actif' ? t('students.active') : t('students.inactive')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(student.enrollment_date)}</td>
                    <td className="px-4 py-3"><TrashButton type="student" id={student.id} name={student.full_name} onDeleted={() => void load()} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
        <p>
          {t('students.pagination.showing', {
            from: firstRow,
            to: lastRow,
            total: result.total,
          })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={result.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            leftIcon={<ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
          >
            {t('students.pagination.previous')}
          </Button>
          <span className="px-1">
            {t('students.pagination.page', { page: result.page, total: totalPages })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={result.page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            rightIcon={<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
          >
            {t('students.pagination.next')}
          </Button>
        </div>
      </div>

      <StudentModal
        open={modalOpen}
        student={editing}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}

export default StudentsPage;
