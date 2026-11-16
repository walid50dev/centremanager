import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Loader2, RotateCcw } from 'lucide-react';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Select from '../components/ui/Select';
import Tooltip from '../components/ui/Tooltip';
import GroupDetailModal from '../components/groups/GroupDetailModal';
import TimetableEditor from '../components/groups/TimetableEditor';
import { toast } from '../components/ui/Toast';
import { schedulesApi } from '../services/schedules';
import { levelsApi, subjectsApi } from '../services/settings';
import { teachersApi } from '../services/teachers';
import { cn, formatCurrency } from '../utils/format';
import {
  DAY_KEYS,
  WEEK_DAYS,
  dayLabel,
  groupTitle,
  minutesOf,
  shortDayLabel,
  subjectColor,
  subjectTint,
} from '../utils/schedule';
import { assignTimetableLanes, type TimetableLane } from '../utils/timetableLanes';
import type { Level, Subject, Teacher, TimetableEntry, TimetableFilters } from '../types';

type WeekDay = (typeof WEEK_DAYS)[number];

/** Row set: Sunday is hidden by default (most centres do not teach it). */
const WEEKDAY_COLUMNS: WeekDay[] = WEEK_DAYS.slice(0, 6);
const SUNDAY: WeekDay = WEEK_DAYS[6];

/** One hour column width, in pixels. */
const HOUR_PX = 128;
/** Minimum height of a day row when there is no overlap. */
const LANE_PX = 88;
const DAY_LABEL_PX = 108;

const EMPTY_FILTERS: TimetableFilters = {
  level_id: null,
  subject_id: null,
  teacher_id: null,
  room: null,
};

type FilterKey = keyof TimetableFilters;

/** Ignore incomplete legacy rows rather than rendering them at midnight. */
function isScheduledEntry(entry: TimetableEntry): boolean {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return WEEK_DAYS.some((day) => day === entry.day_of_week)
    && typeof entry.start_time === 'string' && time.test(entry.start_time)
    && typeof entry.end_time === 'string' && (time.test(entry.end_time) || entry.end_time === '24:00')
    && minutesOf(entry.end_time) > minutesOf(entry.start_time);
}

function isToday(day: WeekDay): boolean {
  return WEEK_DAYS[(new Date().getDay() + 6) % 7] === day;
}

export interface TimetablePageProps {
  /** Rendered by the router; unused, but keeps the page testable in isolation. */
  initialFilters?: Partial<TimetableFilters>;
}

/**
 * Weekly timetable (`/timetable`).
 *
 * Hours run left → right; days run top → bottom. Event width is proportional
 * to duration; overlapping classes stack vertically inside the day row.
 */
export function TimetablePage({ initialFilters }: TimetablePageProps = {}) {
  const { t } = useTranslation();

  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [filters, setFilters] = useState<TimetableFilters>({ ...EMPTY_FILTERS, ...initialFilters });
  const [loading, setLoading] = useState(true);
  const [showSunday, setShowSunday] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [activeDay, setActiveDay] = useState<WeekDay>('Lundi');

  // Filter option sources.
  const [levels, setLevels] = useState<Level[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);

  // Reference data for the four filter dropdowns, once.
  useEffect(() => {
    let active = true;
    Promise.all([
      levelsApi.list(),
      subjectsApi.list(),
      teachersApi.list(),
      schedulesApi.rooms(),
    ])
      .then(([levelRows, subjectRows, teacherRows, roomRows]) => {
        if (!active) return;
        setLevels(levelRows);
        setSubjects(subjectRows);
        setTeachers(teacherRows);
        setRooms(roomRows);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  // One fetch, refetched (debounced) whenever a filter changes.
  const firstLoad = useRef(true);
  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const rows = await schedulesApi.timetable(filters);
        if (active) setEntries(rows.filter(isScheduledEntry));
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
        firstLoad.current = false;
      }
    };
    const timer = window.setTimeout(run, firstLoad.current ? 0 : 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters]);

  const setFilter = useCallback((key: FilterKey, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: value === '' ? null : key === 'room' ? value : Number(value),
    }));
  }, []);

  const resetFilters = useCallback(() => setFilters({ ...EMPTY_FILTERS }), []);

  const filtered = useMemo(() => filters && Object.values(filters).some((v) => v !== null), [filters]);

  /** Rows actually rendered. */
  const days = useMemo(
    () => (showSunday ? [...WEEKDAY_COLUMNS, SUNDAY] : [...WEEKDAY_COLUMNS]),
    [showSunday],
  );

  /** Hour grid: from the earliest start to the latest end. */
  const grid = useMemo(() => {
    const starts = entries.map((entry) => minutesOf(entry.start_time));
    const ends = entries.map((entry) => minutesOf(entry.end_time));
    const minMinutes = starts.length > 0 ? Math.min(...starts) : 8 * 60;
    const maxMinutes = ends.length > 0 ? Math.max(...ends) : 18 * 60;
    const startHour = Math.floor(minMinutes / 60);
    const endHour = Math.max(startHour + 1, Math.ceil(maxMinutes / 60));
    const hours: number[] = [];
    for (let hour = startHour; hour < endHour; hour += 1) hours.push(hour);
    return { startHour, endHour, hours };
  }, [entries]);

  const refresh = useCallback(async () => {
    try {
      setEntries((await schedulesApi.timetable(filters)).filter(isScheduledEntry));
      setRooms(await schedulesApi.rooms());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [filters]);

  const loadGroups = useCallback(() => {
    // The detail modal calls this after an edit: keep the grid truthful.
    void refresh();
  }, [refresh]);

  const byDay = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    days.forEach((day) => map.set(day, []));
    entries.forEach((entry) => {
      if (!map.has(entry.day_of_week)) return;
      map.get(entry.day_of_week)?.push(entry);
    });
    return map;
  }, [days, entries]);

  const lanesByDay = useMemo(() => {
    const map = new Map<string, TimetableLane[]>();
    byDay.forEach((dayEntries, day) => map.set(day, assignTimetableLanes(dayEntries)));
    return map;
  }, [byDay]);

  const dayHeights = days.map((day) => {
    const lanes = lanesByDay.get(day) ?? [];
    const maxLanes = Math.max(1, ...lanes.map((lane) => lane.laneCount));
    return maxLanes * LANE_PX;
  });

  const gridMinWidth = DAY_LABEL_PX + grid.hours.length * HOUR_PX;
  const totalClasses = entries.length;
  const rangeMinutes = (grid.endHour - grid.startHour) * 60;

  const filtersBar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="timetable-filters">
      <div className="w-[168px]">
        <Select
          aria-label={t('timetable.filters.level')}
          value={filters.level_id === null ? '' : String(filters.level_id)}
          onChange={(event) => setFilter('level_id', event.target.value)}
          placeholder={t('timetable.filters.level')}
          options={levels.map((level) => ({ value: level.id, label: level.name }))}
          data-testid="timetable-filter-level"
        />
      </div>
      <div className="w-[176px]">
        <Select
          aria-label={t('timetable.filters.subject')}
          value={filters.subject_id === null ? '' : String(filters.subject_id)}
          onChange={(event) => setFilter('subject_id', event.target.value)}
          placeholder={t('timetable.filters.subject')}
          options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
          data-testid="timetable-filter-subject"
        />
      </div>
      <div className="w-[188px]">
        <Select
          aria-label={t('timetable.filters.teacher')}
          value={filters.teacher_id === null ? '' : String(filters.teacher_id)}
          onChange={(event) => setFilter('teacher_id', event.target.value)}
          placeholder={t('timetable.filters.teacher')}
          options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.full_name }))}
          data-testid="timetable-filter-teacher"
        />
      </div>
      <div className="w-[148px]">
        <Select
          aria-label={t('timetable.filters.room')}
          value={filters.room ?? ''}
          onChange={(event) => setFilter('room', event.target.value)}
          placeholder={t('timetable.filters.room')}
          options={rooms.map((room) => ({ value: room, label: room }))}
          data-testid="timetable-filter-room"
        />
      </div>
      <Button
        variant="secondary"
        leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
        onClick={resetFilters}
        disabled={!filtered}
        data-testid="timetable-reset"
      >
        {t('timetable.filters.reset')}
      </Button>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={showSunday}
          onChange={(event) => setShowSunday(event.target.checked)}
          data-testid="timetable-show-sunday"
        />
        <span
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
            showSunday ? 'border-primary bg-primary' : 'border-slate-200 bg-slate-200',
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              'h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
              showSunday ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5',
            )}
          />
        </span>
        {t('timetable.showSunday')}
      </label>
    </div>
  );

  /** One precisely positioned block; clicking it opens the group sheet. */
  const block = (lane: TimetableLane, rowHeight: number) => {
    const { entry, laneIndex, laneCount } = lane;
    const color = subjectColor(entry.subject_name);
    const groupName = groupTitle(t, entry) + (entry.branch_name ? ` · ${entry.branch_name}` : '');
    const tooltipLines = [
      `${t('timetable.tooltipGroup')}: ${groupName}`,
      `${t('groups.subject')}: ${entry.subject_name}`,
      `${t('groups.teacher')}: ${entry.teacher_name ?? t('groups.noTeacher')}`,
      `${t('groups.room')}: ${entry.room || '—'}`,
      `${dayLabel(t, entry.day_of_week)} ${entry.start_time}–${entry.end_time}`,
      `${t('groups.enrolled')}: ${entry.enrolled_count}/${entry.capacity}`,
    ];
    const tooltip = tooltipLines.join('\n');
    const startOffset = minutesOf(entry.start_time) - grid.startHour * 60;
    const duration = minutesOf(entry.end_time) - minutesOf(entry.start_time);
    const left = (startOffset / rangeMinutes) * 100;
    const width = Math.max((duration / rangeMinutes) * 100, 1.4);
    const top = (laneIndex / laneCount) * rowHeight;
    const height = rowHeight / laneCount;

    return (
      <div
        key={`${entry.group_id}-${entry.day_of_week}-${entry.start_time}`}
        className="timetable-lane absolute"
        style={{
          top: top + 4,
          height: Math.max(height - 8, 28),
          left: `${left}%`,
          width: `${width}%`,
          containerType: 'size',
        }}
        data-lane-index={laneIndex}
        data-lane-count={laneCount}
      >
        <Tooltip
          label={tooltip}
          content={
            <div className="space-y-1">
              <p className="font-semibold text-foreground" dir="auto">{groupName}</p>
              <p className="text-muted">{entry.subject_name}</p>
              <p className="tabular-nums" dir="ltr">{entry.start_time} – {entry.end_time}</p>
              <p className="text-muted" dir="auto">
                {entry.teacher_name ?? t('groups.noTeacher')}
                {entry.room ? ` · ${entry.room}` : ''}
              </p>
              <p className="text-muted">{t('groups.enrolled')}: {entry.enrolled_count}/{entry.capacity}</p>
            </div>
          }
        >
          <button
            type="button"
            onClick={() => setDetailId(entry.group_id)}
            aria-label={tooltip}
            data-testid={`timetable-block-${entry.group_id}-${DAY_KEYS[entry.day_of_week]}`}
            data-subject={entry.subject_name}
            style={{ backgroundColor: subjectTint(color), borderColor: color, color }}
            className={cn(
              'timetable-card flex h-full w-full overflow-hidden rounded-xl border border-s-[3px] text-start',
              'shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-md',
              'focus:outline-none focus:ring-2 focus:ring-primary/40',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1">
              <span className="flex items-start justify-between gap-2">
                <span className="timetable-lane-name min-w-0 truncate text-[12px] font-semibold leading-tight" dir="auto">
                  {groupName}
                </span>
                <span
                  className="timetable-lane-time shrink-0 whitespace-nowrap text-[11px] font-semibold leading-tight tabular-nums"
                  dir="ltr"
                  data-testid={`timetable-time-${entry.group_id}-${DAY_KEYS[entry.day_of_week]}`}
                >
                  {entry.start_time} – {entry.end_time}
                </span>
              </span>
              <span className="timetable-lane-details w-full truncate text-[10px] leading-tight opacity-90" dir="auto">
                {entry.subject_name}
                {entry.room ? ` · ${entry.room}` : ''}
              </span>
              {entry.teacher_name ? (
                <span className="timetable-lane-details w-full truncate text-[10px] leading-tight opacity-80" dir="auto">
                  {entry.teacher_name}
                </span>
              ) : null}
            </span>
          </button>
        </Tooltip>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-h1 text-foreground">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('timetable.title')}
            <span
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[13px] font-medium text-primary"
              data-testid="timetable-count"
            >
              {totalClasses}
            </span>
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">{t('timetable.description')}</p>
        </div>
        <Button onClick={() => setEditorOpen(true)} data-testid="timetable-manage">{t('timetable.manage')}</Button>
      </div>

      {filtersBar}

      {/* -------------------------------------------------------------- grid */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('timetable.loading')}
          </div>
        ) : null}

        <div dir="ltr" className={cn('overflow-x-auto max-sm:hidden', loading && 'hidden')}>
          {/* `dir="ltr"` on purpose: hours always run 08:00 → evening, in both languages. */}
          <div
            dir="ltr"
            className="relative grid"
            style={{
              minWidth: gridMinWidth,
              gridTemplateColumns: `${DAY_LABEL_PX}px repeat(${grid.hours.length}, ${HOUR_PX}px)`,
              gridTemplateRows: `44px ${dayHeights.map((height) => `${height}px`).join(' ')}`,
            }}
            data-testid="timetable-grid"
            data-days={days.length}
            data-hours={grid.hours.length}
          >
            {/* sticky corner */}
            <div className="sticky start-0 top-0 z-20 border-b border-slate-200/80 bg-white" aria-hidden="true" />

            {/* sticky hour header */}
            {grid.hours.map((hour, index) => (
              <div
                key={`header-${hour}`}
                className="sticky top-0 z-10 flex items-center border-b border-s border-slate-200/80 bg-white/95 px-2 text-[11px] font-semibold tabular-nums text-muted backdrop-blur"
                style={{ gridColumn: index + 2, gridRow: 1 }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}

            {/* hour stripes behind every day row */}
            {grid.hours.map((hour, index) => (
              <div
                key={`stripe-${hour}`}
                className={cn('border-s border-slate-100', index % 2 === 0 ? 'bg-slate-50/50' : 'bg-white')}
                style={{ gridColumn: index + 2, gridRow: `2 / span ${days.length}` }}
                aria-hidden="true"
              />
            ))}

            {days.map((day, dayIndex) => {
              const today = isToday(day);
              return (
                <div
                  key={`label-${day}`}
                  className={cn(
                    'sticky start-0 z-10 flex items-center border-b border-e border-slate-200/80 bg-white px-3',
                    today && 'bg-primary/[0.04]',
                  )}
                  style={{ gridColumn: 1, gridRow: dayIndex + 2 }}
                  data-testid={`timetable-header-${DAY_KEYS[day]}`}
                >
                  <span className="flex flex-col">
                    <span
                      dir="auto"
                      title={dayLabel(t, day)}
                      className={cn('text-[12px] font-semibold', today ? 'text-primary' : 'text-foreground')}
                    >
                      {shortDayLabel(t, day)}
                    </span>
                    <span className="text-[10px] text-muted">{byDay.get(day)?.length ?? 0}</span>
                  </span>
                </div>
              );
            })}

            {days.map((day, dayIndex) => (
              <div
                key={`row-${day}`}
                className={cn(
                  'relative min-w-0 border-b border-slate-200/70',
                  isToday(day) && 'bg-primary/[0.03]',
                )}
                style={{
                  gridColumn: `2 / span ${grid.hours.length}`,
                  gridRow: dayIndex + 2,
                }}
                data-testid={`timetable-day-column-${DAY_KEYS[day]}`}
              >
                <div className="absolute inset-0" style={{ height: dayHeights[dayIndex] }}>
                  {(lanesByDay.get(day) ?? []).map((lane) => block(lane, dayHeights[dayIndex]))}
                </div>
              </div>
            ))}

            {totalClasses === 0 ? (
              <div
                className="pointer-events-none flex items-center justify-center"
                style={{ gridColumn: `1 / span ${grid.hours.length + 1}`, gridRow: `2 / span ${days.length}` }}
              >
                <div className="pointer-events-auto rounded-2xl border border-dashed border-slate-200 bg-white/95 px-5 py-4 text-center shadow-card">
                  <p className="text-[14px] font-medium text-foreground" data-testid="timetable-empty">
                    {t('timetable.empty')}
                  </p>
                  <p className="mt-1 max-w-[280px] text-[12px] text-muted">
                    {t('timetable.emptyHint')}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Mobile: one day at a time, selected with tabs. */}
        <div className={cn('mt-1 sm:hidden', loading && 'hidden')}>
          <div
            dir="ltr"
            className="mb-3 flex flex-wrap gap-1.5"
            data-testid="timetable-day-tabs"
          >
            {days.map((day) => {
              const count = byDay.get(day)?.length ?? 0;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setActiveDay(day)}
                  data-testid={`timetable-tab-${DAY_KEYS[day]}`}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    activeDay === day
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted',
                  )}
                >
                  {shortDayLabel(t, day)}
                  {count > 0 ? <span className="ms-1 opacity-70">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {(byDay.get(activeDay) ?? []).map((entry) => {
              const color = subjectColor(entry.subject_name);
              return (
                <button
                  key={`m-${entry.group_id}-${entry.start_time}`}
                  type="button"
                  onClick={() => setDetailId(entry.group_id)}
                  style={{ borderColor: color, backgroundColor: subjectTint(color), color }}
                  className="flex w-full flex-col gap-0.5 rounded-xl border border-s-4 p-2.5 text-start"
                  data-testid={`timetable-mobile-${entry.group_id}-${DAY_KEYS[entry.day_of_week]}`}
                >
                  <span className="flex w-full min-w-0 items-center justify-between gap-2 text-[12px] font-semibold">
                    <span className="min-w-0 truncate" dir="auto">{groupTitle(t, entry)}</span>
                    <span className="shrink-0 whitespace-nowrap font-normal tabular-nums opacity-80" dir="ltr">
                      {entry.start_time} – {entry.end_time}
                    </span>
                  </span>
                  <span className="text-[11px] opacity-90" dir="auto">
                    {entry.level_name}
                    {entry.branch_name ? ` · ${entry.branch_name}` : ''} ·{' '}
                    {entry.teacher_name ?? t('groups.noTeacher')}
                  </span>
                  <span className="text-[11px] opacity-90">
                    {entry.room ? `${entry.room} · ` : ''}
                    {entry.enrolled_count}/{entry.capacity} ·{' '}
                    {formatCurrency(entry.monthly_fee_cents)}
                  </span>
                </button>
              );
            })}
          </div>

          {(byDay.get(activeDay) ?? []).length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
              title={t('timetable.empty')}
              description={t('timetable.emptyHint')}
            />
          ) : null}
        </div>
      </div>

      {editorOpen && <TimetableEditor onClose={() => setEditorOpen(false)} onSaved={loadGroups} />}
      <GroupDetailModal
        open={detailId !== null}
        groupId={detailId}
        onClose={() => setDetailId(null)}
        onRefresh={loadGroups}
      />
    </div>
  );
}

export default TimetablePage;
