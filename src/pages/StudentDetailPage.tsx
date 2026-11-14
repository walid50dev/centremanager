import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Info,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Wallet,
} from 'lucide-react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import WhatsAppLink from '../components/ui/WhatsAppLink';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import StudentModal from '../components/students/StudentModal';
import StudentEnrollmentsTab from '../components/enrollments/StudentEnrollmentsTab';
import StudentFinancesTab from '../components/students/StudentFinancesTab';
import StudentAbsencesTab from '../components/students/StudentAbsencesTab';
import { toast } from '../components/ui/Toast';
import { levelsApi } from '../services/settings';
import { studentsApi } from '../services/students';
import { cn, formatDate, formatDateTime, formatPhone } from '../utils/format';
import type { AuditEntry, Student, StudentDetail } from '../types';

type TabKey = 'info' | 'enrollments' | 'finances' | 'attendance';

const TABS: Array<{ key: TabKey; labelKey: string; icon: typeof Info }> = [
  { key: 'info', labelKey: 'students.tabInfo', icon: Info },
  { key: 'enrollments', labelKey: 'students.tabEnrollments', icon: BookOpen },
  { key: 'finances', labelKey: 'students.tabFinances', icon: Wallet },
  { key: 'attendance', labelKey: 'students.tabAttendance', icon: CalendarDays },
];

/** Coloured dot + label for an audit action. */
const ACTION_STYLES: Record<string, { dot: string; labelKey: string }> = {
  CREATE: { dot: 'bg-success', labelKey: 'students.history.created' },
  UPDATE: { dot: 'bg-primary', labelKey: 'students.history.updated' },
  STATUS_CHANGE: { dot: 'bg-warning', labelKey: 'students.history.statusChanged' },
};

/** Human-readable field names for the UPDATE/STATUS details JSON. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  full_name: 'students.name', first_name: 'students.first_name', last_name: 'students.last_name',
  birth_date: 'students.birth_date', phone: 'students.student_phone', guardian_phone: 'students.guardian_phone',
  guardian_name: 'students.guardian_name', guardian_relation: 'students.guardian_relation',
  secondary_contact_name: 'students.secondary_contact', secondary_contact_phone: 'students.secondary_phone',
  school_name: 'students.school_name', enrollment_date: 'students.enrollment_date',
  level_id: 'students.level', branch_id: 'students.branch', address: 'students.address', notes: 'students.notes',
  father_name: 'students.guardian_name', home_address: 'students.address', email: 'students.address',
  date_of_birth: 'students.birth_date', parent_phone: 'students.secondary_phone',
  status: 'students.status', from: 'students.history.from', to: 'students.history.to',
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-foreground">{children}</dd>
    </div>
  );
}

interface NameLookups {
  levels: Map<number, string>;
  branches: Map<number, string>;
}

/** Renders the JSON stored in `audit_log.details` as readable lines. */
function AuditDetails({ entry, lookups }: { entry: AuditEntry; lookups: NameLookups }) {
  const { t } = useTranslation();

  const lines = useMemo(() => {
    if (!entry.details) return [] as string[];
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.details);
    } catch {
      return [entry.details];
    }
    if (!parsed || typeof parsed !== 'object') return [String(parsed)];

    const label = (key: string): string =>
      FIELD_LABEL_KEYS[key] ? t(FIELD_LABEL_KEYS[key]) : key;
    const print = (value: unknown, key?: string): string => {
      if (value === null || value === undefined || value === '') return '—';
      if (typeof value === 'object') return JSON.stringify(value);
      if (key === 'level_id' && typeof value === 'number') {
        return lookups.levels.get(value) ?? `#${value}`;
      }
      if (key === 'branch_id' && typeof value === 'number') {
        return lookups.branches.get(value) ?? `#${value}`;
      }
      if (key === 'birth_date' || key === 'enrollment_date') return formatDate(String(value));
      return String(value);
    };

    const record = parsed as Record<string, unknown>;

    // STATUS_CHANGE -> { from, to }
    if (entry.action === 'STATUS_CHANGE' && 'from' in record && 'to' in record) {
      return [`${label('status')}: ${print(record.from)} → ${print(record.to)}`];
    }

    // UPDATE -> { field: { from, to } }
    const changes = Object.entries(record).filter(
      ([, value]) => value !== null && typeof value === 'object' && 'to' in (value as object),
    );
    if (changes.length > 0) {
      return changes.map(([key, value]) => {
        const change = value as { from?: unknown; to?: unknown };
        return `${label(key)}: ${print(change.from, key)} → ${print(change.to, key)}`;
      });
    }

    // CREATE -> flat snapshot (ids are already visible in the info tab)
    const order = ['full_name', 'guardian_name', 'birth_date', 'phone', 'address', 'notes'];
    return Object.entries(record)
      .filter(([key, value]) => !key.endsWith('_id') && value !== null && value !== '')
      .sort(([a], [b]) => {
        const index = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
        return index(a) - index(b) || a.localeCompare(b);
      })
      .map(([key, value]) => `${label(key)}: ${print(value, key)}`);
  }, [entry, t, lookups]);

  if (lines.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {lines.map((line, index) => (
        <li key={index} className="text-[12px] text-muted">
          {line}
        </li>
      ))}
    </ul>
  );
}

export function StudentDetailPage({ studentIdOverride, onClose }: { studentIdOverride?: number; onClose?: () => void } = {}) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const studentId = studentIdOverride ?? Number(id);
  const close = onClose ?? (() => navigate('/students'));

  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [lookups, setLookups] = useState<NameLookups>({ levels: new Map(), branches: new Map() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('info');
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(studentId)) {
      setError(t('students.notFound'));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await studentsApi.detail(studentId);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [studentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Level / branch names for the history diffs (ids alone mean nothing to a user).
  useEffect(() => {
    let active = true;
    Promise.all([levelsApi.list(), levelsApi.branches()])
      .then(([levels, branches]) => {
        if (!active) return;
        setLookups({
          levels: new Map(levels.map((level) => [level.id, level.name])),
          branches: new Map(branches.map((branch) => [branch.id, branch.name])),
        });
      })
      .catch(() => {
        /* fall back to #id rendering */
      });
    return () => {
      active = false;
    };
  }, []);

  const student: Student | null = detail?.student ?? null;
  const isActive = student?.status === 'actif';

  const toggleStatus = async () => {
    if (!student) return;
    setChangingStatus(true);
    try {
      const next = isActive ? 'inactif' : 'actif';
      await studentsApi.setStatus(student.id, next);
      toast.success(next === 'actif' ? t('students.toast.reactivated') : t('students.toast.deactivated'));
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

  if (error || !student || !detail) {
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          leftIcon={<ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
          className="self-start"
        >
          {t('students.back')}
        </Button>
        <Card>
          <EmptyState
            icon={<Info className="h-5 w-5" aria-hidden="true" />}
            title={t('students.notFound')}
            description={error ?? undefined}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {onClose ? <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{student.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span> : <Button variant="ghost" size="icon" onClick={close} aria-label={t('students.back')} title={t('students.back')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></Button>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate">{student.full_name}</h1>
              <Badge variant={isActive ? 'success' : 'muted'}>
                {isActive ? t('students.active') : t('students.inactive')}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              {student.level_name ?? t('students.noLevel')}
              {student.branch_name ? ` — ${student.branch_name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="student-sheet-actions">
          <WhatsAppLink label={t('students.whatsappStudent')} testId="sheet-whatsapp-student" phone={student.phone} />
          <WhatsAppLink label={t('students.whatsappGuardian')} testId="sheet-whatsapp-guardian" phone={student.guardian_phone} message={t('students.contactMessage', { name: student.full_name })} />
          <Button
            variant="primary"
            onClick={() => setModalOpen(true)}
            leftIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          >
            {t('students.edit')}
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
            {isActive ? t('students.deactivate') : t('students.reactivate')}
          </Button>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Tab panels */}
      {tab === 'info' && (
        <Card className="p-5">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <InfoRow label={t('students.name')}>{student.full_name}</InfoRow>
            <InfoRow label={t('students.level')}>{student.level_name ?? '—'} {student.branch_name ?? ''}</InfoRow>
            <InfoRow label={t('students.school_name')}>{student.school_name ?? '—'}</InfoRow>
            <InfoRow label={t('students.birth_date')}>{student.birth_date ? formatDate(student.birth_date) : '—'}</InfoRow>
            <InfoRow label={t('students.enrollment_date')}>{formatDate(student.enrollment_date)}</InfoRow>
            <InfoRow label={t('students.guardian_name')}>{student.guardian_name ?? '—'}</InfoRow>
            <InfoRow label={t('students.student_phone')}><span className="whitespace-nowrap" dir="ltr" data-testid="student-detail-phone">{student.phone ? formatPhone(student.phone) : '—'}</span></InfoRow>
            <InfoRow label={t('students.guardian_phone')}><span dir="ltr" className="whitespace-nowrap" data-testid="student-detail-guardian-phone">{student.guardian_phone ? formatPhone(student.guardian_phone) : '—'}</span></InfoRow>
            <InfoRow label={t('students.fatherName')}>{student.nom_pere || '—'}</InfoRow>
            <InfoRow label={t('students.motherName')}>{student.nom_mere || '—'}</InfoRow>
            <InfoRow label={t('students.guardianCin')}>{student.cin_tuteur || '—'}</InfoRow>
            <InfoRow label={t('students.guardian_relation')}>{student.guardian_relation ? t(`students.relation_${student.guardian_relation}`) : '—'}</InfoRow>
            <InfoRow label={t('students.secondary_contact')}>{student.secondary_contact_name ?? '—'}</InfoRow>
            <InfoRow label={t('students.secondary_phone')}><span dir="ltr" className="whitespace-nowrap" data-testid="student-detail-parent-phone">{student.secondary_contact_phone ? formatPhone(student.secondary_contact_phone) : '—'}</span></InfoRow>
            <InfoRow label={t('students.status')}>{student.status === 'actif' ? t('students.active') : t('students.inactive')}</InfoRow>
            <InfoRow label={t('students.address')}>{student.address ?? '—'}</InfoRow>
            <InfoRow label={t('students.notes')}>{student.notes ?? '—'}</InfoRow>
            <InfoRow label={t('students.created')}>{formatDate(student.created_at)}</InfoRow>
            <InfoRow label={t('students.updated')}>{formatDate(student.updated_at)}</InfoRow>
          </dl>
          <details className="mt-4 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-primary">{t('students.tabHistory')}</summary>
            {detail.audit_log.length === 0 ? <p className="mt-2 text-sm text-muted">{t('students.historyEmpty')}</p> : <ol className="mt-3 space-y-3">{detail.audit_log.map(entry => <li key={entry.id}><span className="text-sm font-medium">{t((ACTION_STYLES[entry.action] ?? { labelKey: 'students.history.other' }).labelKey)}</span><span className="ms-2 text-xs text-muted">{formatDateTime(entry.created_at)}</span><AuditDetails entry={entry} lookups={lookups} /></li>)}</ol>}
          </details>
        </Card>
      )}

      {tab === 'enrollments' && (
        <StudentEnrollmentsTab
          studentId={student.id}
          studentName={student.full_name}
          onChanged={() => void load()}
        />
      )}

      {tab === 'finances' && (
        <StudentFinancesTab studentId={student.id} onChanged={() => void load()} />
      )}

      {tab === 'attendance' && (
        <StudentAbsencesTab studentId={student.id} />
      )}

      <StudentModal
        open={modalOpen}
        student={student}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={isActive ? t('students.deactivate') : t('students.reactivate')}
        message={
          isActive
            ? t('students.confirmDeactivate', { name: student.full_name })
            : t('students.confirmReactivate', { name: student.full_name })
        }
        confirmLabel={isActive ? t('students.deactivate') : t('students.reactivate')}
        cancelLabel={t('common.cancel')}
        destructive={isActive}
        loading={changingStatus}
        onConfirm={() => void toggleStatus()}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default StudentDetailPage;
