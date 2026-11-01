import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import CompensationConfigCard from './CompensationConfigCard';
import { formatDate } from '../../utils/format';
import type { TeacherDetail } from '../../types';

export interface TeacherInfoTabProps {
  detail: TeacherDetail;
  onChanged: () => void;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-foreground">{children}</dd>
    </div>
  );
}

/** Tab 1 of the teacher sheet: identity, subjects and payroll configuration. */
export function TeacherInfoTab({ detail, onChanged }: TeacherInfoTabProps) {
  const { t } = useTranslation();
  const { teacher } = detail;
  const subjectNames = teacher.subjects ? teacher.subjects.split(', ') : [];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <InfoRow label={t('teachers.name')}>{teacher.full_name}</InfoRow>
          <InfoRow label={t('teachers.phone')}>
            {teacher.phone ? (
              <a href={`tel:${teacher.phone}`} className="text-primary hover:underline" dir="ltr">
                {teacher.phone}
              </a>
            ) : (
              '—'
            )}
          </InfoRow>
          <InfoRow label={t('teachers.email')}>
            {teacher.email ? (
              <a href={`mailto:${teacher.email}`} className="text-primary hover:underline" dir="ltr">
                {teacher.email}
              </a>
            ) : (
              '—'
            )}
          </InfoRow>
          <InfoRow label={t('teachers.notes')}>{teacher.notes ?? '—'}</InfoRow>
          <InfoRow label={t('teachers.created')}>{formatDate(teacher.created_at)}</InfoRow>
          <InfoRow label={t('teachers.updated')}>{formatDate(teacher.updated_at)}</InfoRow>
        </dl>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-label text-muted">{t('teachers.subjects')}</p>
          {subjectNames.length === 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {t('teachers.noSubjectsAssigned')}
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="teacher-subjects">
              {subjectNames.map((name) => (
                <Badge key={name} variant="primary">
                  {name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <CompensationConfigCard
        teacherId={teacher.id}
        groups={detail.groups}
        config={detail.compensation_config}
        onSaved={onChanged}
      />
    </div>
  );
}

export default TeacherInfoTab;
