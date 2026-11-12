import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search, UserPlus, Users, Pencil } from 'lucide-react';
import Badge from '../components/ui/Badge';
import TrashButton from '../components/ui/TrashButton';
import ViewButton from '../components/ui/ViewButton';
import WhatsAppLink from '../components/ui/WhatsAppLink';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import StudentModal from '../components/students/StudentModal';
import ImportButton from '../components/year-import/ImportButton';
import Modal from '../components/ui/Modal';
import StudentDetailPage from './StudentDetailPage';
import { toast } from '../components/ui/Toast';
import { levelsApi } from '../services/settings';
import { studentsApi } from '../services/students';
import { enrollmentsApi, todayIso } from '../services/enrollments';
import { invoicesApi } from '../services/invoices';
import { groupsApi } from '../services/groups';
import { FOCUS_SEARCH_EVENT } from '../hooks/useKeyboardShortcuts';
import { useDebounce } from '../hooks/useDebounce';
import { cn, formatCurrency, formatPhone } from '../utils/format';
import type { Level, PaginatedStudents, Student } from '../types';

const PAGE_LIMIT = 20;

const EMPTY_PAGE: PaginatedStudents = { data: [], total: 0, page: 1, limit: PAGE_LIMIT };

/** Status filter values: '' = every status. */
type StatusFilter = '' | 'actif' | 'inactif';

export function StudentsPage() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [levelId, setLevelId] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('actif');
  const [page, setPage] = useState(1);

  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<PaginatedStudents>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const [money, setMoney] = useState<Record<number, { groups: string[]; amount: number; status: 'none' | 'paid' | 'late' | 'partial' }>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<Student | null>(null);
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
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const rows = await studentsApi.list({
        search: debouncedSearch,
        levelId: levelId ? Number(levelId) : null,
        status: status || null,
        page,
        limit: PAGE_LIMIT,
      });
      const groups = await groupsApi.list();
      const now = new Date(); const month = now.getMonth() + 1; const year = now.getFullYear();
      const summaries = await Promise.all(rows.data.map(async student => {
        const [enrollments, invoices] = await Promise.all([enrollmentsApi.forStudent(student.id), invoicesApi.forStudent(student.id)]);
        const active = enrollments.filter(e => e.status === 'actif' && groups.some(g => g.id === e.group_id && !g.deleted_at));
        const names = active.map(e => { const group = groups.find(g => g.id === e.group_id); return group?.name || `${e.subject_name} — ${e.level_name}`; });
        const current = invoices.filter(i => i.kind === 'invoice' && i.period_month === month && i.period_year === year && active.some(e => e.enrollment_id === i.enrollment_id) && i.status !== 'annulé');
        const amount = current.reduce((sum, invoice) => sum + invoice.remaining_cents, 0);
        const missing = active.some(e => !current.some(i => i.enrollment_id === e.enrollment_id));
        const status = current.some(i => i.remaining_cents > 0 && Boolean(i.due_date) && i.due_date < todayIso()) ? 'late' : amount > 0 && current.some(i => i.paid_amount_cents > 0) ? 'partial' : active.length > 0 && !missing && amount === 0 ? 'paid' : 'none';
        return [student.id, { groups: names, amount, status }] as const;
      }));
      if (sequence !== loadSequence.current) return;
      setMoney(Object.fromEntries(summaries));
      setResult(rows);
    } catch (error) {
      if (sequence === loadSequence.current) { toast.error(error instanceof Error ? error.message : t('common.error')); setResult(EMPTY_PAGE); }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Input
          ref={searchRef}
          containerClassName="sm:w-80 sm:max-w-full sm:flex-none"
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
          containerClassName="sm:w-[220px] sm:max-w-full sm:flex-none"
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
          containerClassName="sm:w-[180px] sm:max-w-full sm:flex-none"
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
          <table className="w-full min-w-[1100px] border-collapse text-body" data-testid="students-table">
            <thead className="bg-background">
              <tr>
                {[
                  ['students.columns.name', 'min-w-[180px]'],
                  ['students.columns.level', 'min-w-[120px]'],
                  ['students.guardian_column', 'min-w-[300px]'],
                  ['students.groupsColumn', 'min-w-[140px]'],
                  ['students.monthStatus', 'min-w-[120px]'],
                  ['students.statusColumn', 'min-w-[120px]'],
                  ['trash.actions', 'min-w-[100px]'],
                ].map(([key, width]) => (
                  <th key={key} scope="col" className={cn('border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted', width)}>{t(key)}</th>
                ))}
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
                    onClick={() => setViewing(student)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setViewing(student);
                      }
                    }}
                    tabIndex={0}
                    className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                  >
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{student.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span><span className="whitespace-nowrap font-medium text-foreground group-hover:underline">{student.full_name}</span></div></td>
                    <td className="px-4 py-3 text-foreground">{student.level_name ?? '—'}{student.branch_name ? ` — ${student.branch_name}` : ''}</td>
                    <td className="px-4 py-3"><div className="flex flex-nowrap items-center gap-2 whitespace-nowrap"><bdi>{student.guardian_name || '—'}</bdi><span dir="ltr" className="shrink-0 whitespace-nowrap tabular-nums" data-testid={`guardian-phone-text-${student.id}`}>{student.guardian_phone ? formatPhone(student.guardian_phone) : '—'}</span><WhatsAppLink compact label={t('students.guardian_phone')} testId={`guardian-whatsapp-${student.id}`} phone={student.guardian_phone} message={t('students.reminder', { name: student.full_name, groups: money[student.id]?.groups.join(', ') || t('students.noGroup'), amount: formatCurrency(money[student.id]?.amount ?? 0) })} /></div></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{money[student.id]?.groups.length ? money[student.id].groups.map((name, index) => <Badge key={`${name}-${index}`} variant="primary">{name}</Badge>) : '—'}</div></td>
                    <td className="px-4 py-3"><Badge variant={money[student.id]?.status === 'paid' ? 'success' : money[student.id]?.status === 'late' ? 'destructive' : money[student.id]?.status === 'partial' ? 'warning' : 'muted'}>{t(`students.monthStatuses.${money[student.id]?.status ?? 'none'}`)}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={student.status === 'actif' ? 'success' : 'muted'}>{student.status === 'actif' ? t('students.active') : t('students.inactive')}</Badge></td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      <ViewButton name={student.full_name} testId={`view-student-${student.id}`} onView={() => setViewing(student)} />
                      <span onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><Button variant="ghost" size="icon" title={t('students.edit')} aria-label={t('students.edit')} data-testid={`edit-student-${student.id}`} onClick={() => { setEditing(student); setModalOpen(true); }}><Pencil className="h-4 w-4" /></Button></span>
                      <TrashButton type="student" id={student.id} name={student.full_name} onDeleted={() => void load()} />
                    </div></td>
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

      <Modal open={viewing !== null} onClose={() => { setViewing(null); void load(); }} title={t('students.sheetTitle')} size="xl" zIndex={40} testId="student-sheet">
        {viewing && <StudentDetailPage studentIdOverride={viewing.id} onClose={() => { setViewing(null); void load(); }} />}
      </Modal>

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
