import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import ScheduleConflictWarnings from './ScheduleConflictWarnings';
import { toast } from '../ui/Toast';
import { groupsApi } from '../../services/groups';
import { groupTitle, scheduleSlots, WEEK_DAYS } from '../../utils/schedule';
import type { Group, GroupSchedule } from '../../types';

/** Manage a group's weekly slots without exposing scheduling in the group form. */
export default function TimetableEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [id, setId] = useState('');
  const [slots, setSlots] = useState<GroupSchedule[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; groupsApi.list().then(rows => { if (live) setGroups(rows); }).catch(e => toast.error(String(e))); return () => { live = false; }; }, []);
  const group = groups.find(row => String(row.id) === id);
  const choose = (value: string) => {
    setId(value);
    const selected = groups.find(row => String(row.id) === value);
    setSlots(selected ? scheduleSlots(selected).map(slot => ({ ...slot })) : []);
  };
  const update = (index: number, key: 'day_of_week' | 'start_time' | 'end_time' | 'room', value: string) =>
    setSlots(current => current.map((slot, i) => i === index ? { ...slot, [key]: value } : slot));
  const save = async () => {
    if (!group || !group.subject_id || !group.level_id || !group.school_year_id) return;
    if (slots.some(slot => !slot.day_of_week || !slot.start_time || !slot.end_time || slot.end_time <= slot.start_time) || new Set(slots.map(slot => slot.day_of_week)).size !== slots.length) {
      toast.error(t('timetable.invalidSlots')); return;
    }
    setBusy(true);
    try {
      // Re-read to avoid overwriting other group fields with stale list values.
      const current = (await groupsApi.detail(group.id)).group;
      if (!current.subject_id || !current.level_id || !current.school_year_id) throw new Error(t('common.error'));
      const first = slots[0];
      await groupsApi.update(current.id, { name: current.name, subject_id: current.subject_id, level_id: current.level_id,
        branch_id: current.branch_id, teacher_id: current.teacher_id, school_year_id: current.school_year_id,
        day_of_week: first?.day_of_week ?? '', start_time: first?.start_time ?? '', end_time: first?.end_time ?? '',
        schedules: slots.map(slot => ({...slot, room: slot.room ?? current.room ?? ''})), room: current.room, monthly_fee_cents: current.monthly_fee_cents, capacity: current.capacity });
      onSaved(); onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={t('timetable.manage')} size="lg" footer={<>
    <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
    <Button onClick={() => void save()} disabled={!group} loading={busy} data-testid="timetable-save">{t('common.save')}</Button>
  </>}>
    <div className="space-y-4">
      <Select label={t('groups.title')} value={id} onChange={e => choose(e.target.value)} placeholder={t('timetable.selectGroup')} options={groups.map(g => ({ value: g.id, label: groupTitle(t, g) }))} data-testid="timetable-group" />
      {group && <>
        {slots.map((slot, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end" data-testid="timetable-slot">
          <Select label={t('timetable.day')} value={slot.day_of_week} onChange={e => update(index, 'day_of_week', e.target.value)} options={WEEK_DAYS.map(day => ({value:day,label:t(`groups.dayNames.${day}`)}))} />
          <Input type="time" label={t('groups.startTime')} value={slot.start_time} onChange={e => update(index, 'start_time', e.target.value)} />
          <Input type="time" label={t('groups.endTime')} value={slot.end_time} onChange={e => update(index, 'end_time', e.target.value)} />
          <Input label={t('groups.room')} value={slot.room ?? group.room ?? ''} onChange={e => update(index, 'room', e.target.value)} data-testid="timetable-room" />
          <ScheduleConflictWarnings open groupId={group.id} teacherId={group.teacher_id} room={slot.room ?? group.room ?? ''} schoolYearId={group.school_year_id} schedules={[{day:slot.day_of_week,start_time:slot.start_time,end_time:slot.end_time}]} />
          <Button variant="secondary" onClick={() => setSlots(current => current.filter((_, i) => i !== index))}>{t('common.delete')}</Button>
        </div>)}
        <Button variant="secondary" onClick={() => setSlots(current => [...current, {id: 0, day_of_week: WEEK_DAYS.find(day => !current.some(slot => slot.day_of_week === day)) ?? 'Lundi', start_time:'16:00', end_time:'18:00', room:''}])} data-testid="timetable-add-slot">{t('timetable.addSlot')}</Button>
      </>}
    </div>
  </Modal>;
}
