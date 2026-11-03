import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useDuplicates } from '../../hooks/useDuplicates';
import { studentsApi } from '../../services/students';
import { teachersApi } from '../../services/teachers';
import { formatDate, formatPhone } from '../../utils/format';
import type { DuplicateEntityType } from '../../services/duplicates';
import type { DuplicateMatch, Student, Teacher } from '../../types';

interface Props {
  open: boolean;
  type: DuplicateEntityType;
  id?: number | null;
  first: string;
  last: string;
  phone: string;
}

function DuplicateWarning({ item, type, onIgnore }: { item: DuplicateMatch; type: DuplicateEntityType; onIgnore: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Student | Teacher | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const showPreview = async () => {
    if (preview) { setPreview(null); return; }
    setLoading(true); setError(false);
    try {
      const data = type === 'student' ? (await studentsApi.detail(item.entity_id)).student : (await teachersApi.detail(item.entity_id)).teacher;
      setPreview(data);
    } catch { setError(true); }
    finally { setLoading(false); }
  };
  const name = item.phone ? `${item.full_name} — ${formatPhone(item.phone)}` : item.full_name;
  return <div className="rounded-md border border-warning/50 bg-warning/10 p-3" data-testid={`duplicate-${type}-${item.entity_id}`}>
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-body text-foreground">{t(`duplicates.warning_${item.match_type}`, { type: t(`duplicates.type_${type}`), name })}</p>
    </div>
    <div className="mt-2 flex flex-wrap gap-3 text-[13px]">
      <button type="button" onClick={onIgnore} className="font-medium text-foreground underline">{t('duplicates.ignore')}</button>
      <button type="button" onClick={() => void showPreview()} disabled={loading} className="font-medium text-primary underline" aria-expanded={Boolean(preview)}>{t('duplicates.view')}</button>
    </div>
    {error && <p className="mt-2 text-sm text-destructive">{t('duplicates.preview_error')}</p>}
    {preview && <div className="mt-3 space-y-1 border-t border-warning/30 pt-2 text-[13px]" data-testid={`duplicate-preview-${item.entity_id}`}>
      <p><strong>{type === 'student' ? t('students.name') : t('teachers.name')}:</strong> {preview.full_name}</p>
      <p><strong>{type === 'student' ? t('students.guardian_phone') : t('teachers.phone')}:</strong> {item.phone ? formatPhone(item.phone) : '—'}</p>
      {type === 'student' ? <>
        <p><strong>{t('students.guardian_name')}:</strong> {(preview as Student).guardian_name ?? '—'}</p>
        <p><strong>{t('students.level')}:</strong> {(preview as Student).level_name ?? '—'}</p>
        <p><strong>{t('students.school_name')}:</strong> {(preview as Student).school_name ?? '—'}</p>
        <p><strong>{t('students.birth_date')}:</strong> {(preview as Student).birth_date ? formatDate((preview as Student).birth_date) : '—'}</p>
      </> : <>
        <p><strong>{t('teachers.email')}:</strong> {(preview as Teacher).email ?? '—'}</p>
        <p><strong>{t('teachers.subjects')}:</strong> {(preview as Teacher).subjects || '—'}</p>
      </>}
      <a href={`/${type === 'student' ? 'students' : 'teachers'}/${item.entity_id}`} target="_blank" rel="noopener noreferrer" className="inline-block text-primary underline">{t('duplicates.open_record')}</a>
    </div>}
  </div>;
}

/** Advisory only: neither an outstanding check nor a match disables saving. */
export default function DuplicateWarnings({ open, type, id = null, first, last, phone }: Props) {
  const { t } = useTranslation();
  const { matches, error, ignore } = useDuplicates(open, type, id, first, last, phone);
  if (!open || (!matches.length && !error)) return null;
  return <div className="space-y-2 sm:col-span-2" aria-live="polite">
    {error && <p className="rounded border border-warning/40 bg-warning/10 p-3 text-[13px]">{t('duplicates.check_error')}</p>}
    {matches.map(item => <DuplicateWarning key={item.entity_id} item={item} type={type} onIgnore={() => ignore(item.entity_id)} />)}
  </div>;
}
