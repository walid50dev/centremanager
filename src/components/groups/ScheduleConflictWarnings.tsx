import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { groupsApi } from '../../services/groups';
import { dayLabel } from '../../utils/schedule';
import type { ScheduleConflict, ScheduleConflictInput } from '../../types';

interface Props {
  open: boolean;
  groupId: number | null;
  teacherId: number | null;
  room: string;
  schoolYearId: number | null;
  schedules: ScheduleConflictInput[];
}

/** The check is advisory; failures and pending requests never prevent saving. */
export default function ScheduleConflictWarnings({ open, groupId, teacherId, room, schoolYearId, schedules }: Props) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [ignored, setIgnored] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setConflicts([]);
    setIgnored(false);
    setError(false);
    const valid = schedules.filter(slot => slot.day && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start_time) && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end_time) && slot.start_time < slot.end_time);
    if (!open || !schoolYearId || (!room.trim() && teacherId === null) || !valid.length) return () => { active = false; };
    const timer = window.setTimeout(() => {
      groupsApi.checkScheduleConflicts(groupId, teacherId, room, schoolYearId, valid)
        .then(result => { if (active) setConflicts(result); })
        .catch(() => { if (active) setError(true); });
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, groupId, teacherId, room, schoolYearId, schedules]);

  if (!open || ignored || (!error && conflicts.length === 0)) return null;
  return <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-foreground sm:col-span-2" aria-live="polite" data-testid="schedule-conflicts">
    {error ? <p>{t('conflicts.check_error')}</p> : <>
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />{t('conflicts.title')}</p>
      <ul className="mt-2 space-y-1">
        {conflicts.map((conflict, index) => <li key={index}>
          {t(`conflicts.${conflict.conflict_type}`, {
            room: conflict.room, teacher: conflict.teacher_name, day: dayLabel(t, conflict.day),
            start: conflict.start_time, end: conflict.end_time, group: conflict.group_name || t('groups.untitled'),
          })}
        </li>)}
      </ul>
      <button type="button" className="mt-2 font-medium underline" onClick={() => setIgnored(true)}>{t('conflicts.ignore')}</button>
    </>}
  </div>;
}
