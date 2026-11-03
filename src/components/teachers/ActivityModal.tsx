import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import NumberInput from '../ui/NumberInput';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { activitiesApi } from '../../services/teachers';
import { todayIsoDate } from '../../utils/billing';
import { cn } from '../../utils/format';
import { ACTIVITY_TYPES, type ActivityType } from '../../types';

export interface ActivityModalProps {
  open: boolean;
  teacherId: number;
  onClose: () => void;
  onSaved: () => void;
}

/** Log one activity (hours and/or sessions) for a teacher. */
export function ActivityModal({ open, teacherId, onClose, onSaved }: ActivityModalProps) {
  const { t } = useTranslation();

  const [date, setDate] = useState(todayIsoDate());
  const [type, setType] = useState<ActivityType>('cours');
  const [hours, setHours] = useState('');
  const [sessions, setSessions] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayIsoDate());
    setType('cours');
    setHours('');
    setSessions('');
    setNotes('');
    setSubmitting(false);
  }, [open]);

  const parsedHours = Number.parseFloat(hours);
  const parsedSessions = Number.parseInt(sessions, 10);
  const hasHours = Number.isFinite(parsedHours) && parsedHours > 0;
  const hasSessions = Number.isFinite(parsedSessions) && parsedSessions > 0;
  const valid = Boolean(date) && (hasHours || hasSessions);

  const error = useMemo(() => {
    if (!date) return t('teachers.validation.dateRequired');
    if (!hasHours && !hasSessions) return t('teachers.validation.hoursOrSessions');
    return undefined;
  }, [date, hasHours, hasSessions, t]);

  const submit = async () => {
    if (!valid) {
      toast.error(error ?? t('common.error'));
      return;
    }
    setSubmitting(true);
    try {
      await activitiesApi.record({
        teacher_id: teacherId,
        activity_date: date,
        activity_type: type,
        hours: hasHours ? parsedHours : null,
        sessions: hasSessions ? parsedSessions : null,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success(t('teachers.activity.toast'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('teachers.activity.add')}
        </span>
      }
      description={t('teachers.activity.description')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={submitting} disabled={!valid}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          type="date"
          label={t('teachers.activity.date')}
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />

        <Select
          label={t('teachers.activity.type')}
          value={type}
          onChange={(event) => setType(event.target.value as ActivityType)}
          options={ACTIVITY_TYPES.map((value) => ({
            value,
            label: t(`teachers.activity.${value}`),
          }))}
        />

        <NumberInput
          label={t('teachers.activity.hours')}
          data-testid="activity-hours"
          decimals={1}
          min={0}
          max={24}
          step={0.5}
          suffix={t('common.suffix.hours')}
          value={hours.trim() === '' ? Number.NaN : Number(hours)}
          onChange={(next) => setHours(Number.isFinite(next) && next > 0 ? String(next) : '')}
          placeholder="2"
          hint={t('teachers.activity.optional')}
        />

        <NumberInput
          label={t('teachers.activity.sessions')}
          data-testid="activity-sessions"
          decimals={0}
          min={0}
          max={99}
          step={1}
          value={sessions.trim() === '' ? Number.NaN : Number(sessions)}
          onChange={(next) => setSessions(Number.isFinite(next) && next > 0 ? String(next) : '')}
          placeholder="1"
          hint={t('teachers.activity.optional')}
        />

        <Textarea
          containerClassName="sm:col-span-2"
          label={t('teachers.activity.notes')}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('teachers.activity.notesPlaceholder')}
        />

        <p
          className={cn(
            'sm:col-span-2 text-[12px]',
            hasHours || hasSessions ? 'text-muted' : 'text-warning',
          )}
        >
          {t('teachers.activity.hint')}
        </p>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default ActivityModal;
