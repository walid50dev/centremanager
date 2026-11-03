import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Loader2, RotateCcw } from 'lucide-react';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Select from '../components/ui/Select';
import GroupDetailModal from '../components/groups/GroupDetailModal';
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

/** Column set: Sunday is hidden by default (most centres do not teach it). */
const WEEKDAY_COLUMNS: WeekDay[] = WEEK_DAYS.slice(0, 6);
const SUNDAY: WeekDay = WEEK_DAYS[6];

/** One grid row is half an hour; this is its height in pixels. */
const ROW_MINUTES = 30;
const SLOT_PX = 20;

const EMPTY_FILTERS: TimetableFilters = {
  level_id: null,
  subject_id: null,
  teacher_id: null,
  room: null,
};

type FilterKey = keyof TimetableFilters;

export interface TimetablePageProps {
  /** Rendered by the router; unused, but keeps the page testable in isolation. */
  initialFilters?: Partial<TimetableFilters>;
}

/**
 * Weekly timetable (`/timetable`).
 *
 * One fetch returns every block of the week (filters are applied server-side),
 * so switching a filter never re-renders more than the grid. The hour rows are
 * derived from the data itself: from the earliest start to the latest end.
 */
export function TimetablePage({ initialFilters }: TimetablePageProps = {}) {
  const { t } = useTranslation();

  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [filters, setFilters] = useState<TimetableFilters>({ ...EMPTY_FILTERS, ...initialFilters });
  const [loading, setLoading] = useState(true);
  const [showSunday, setShowSunday] = useState(false);
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
        if (active) setEntries(rows);
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

  /** Columns actually rendered. */
  const days = useMemo(
    () => (showSunday ? [...WEEKDAY_COLUMNS, SUNDAY] : [...WEEKDAY_COLUMNS]),
    [showSunday],
  );

  /** Hour grid: from the earliest start to the latest end, in 30-minute rows. */
  const grid = useMemo(() => {
    const starts = entries.map((entry) => minutesOf(entry.start_time));
    const ends = entries.map((entry) => minutesOf(entry.end_time));
    const minMinutes = starts.length > 0 ? Math.min(...starts) : 8 * 60;
    const maxMinutes = ends.length > 0 ? Math.max(...ends) : 18 * 60;
    const startHour = Math.floor(minMinutes / 60);
    const endHour = Math.max(startHour + 1, Math.ceil(maxMinutes / 60));
    const hours: number[] = [];
    for (let hour = startHour; hour < endHour; hour += 1) hours.push(hour);
    return { startHour, endHour, hours, rows: (endHour - startHour) * (60 / ROW_MINUTES) };
  }, [entries]);

  const refresh = useCallback(async () => {
    try {
      setEntries(await schedulesApi.timetable(filters));
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

  const totalClasses = entries.length;

  const filtersBar = (
    <div className="flex flex-wrap items-end gap-2" data-testid="timetable-filters">
      <div className="w-[150px]">
        <Select
          aria-label={t('timetable.filters.level')}
          value={filters.level_id === null ? '' : String(filters.level_id)}
          onChange={(event) => setFilter('level_id', event.target.value)}
          placeholder={t('timetable.filters.level')}
          options={levels.map((level) => ({ value: level.id, label: level.name }))}
          data-testid="timetable-filter-level"
        />
      </div>
      <div className="w-[160px]">
        <Select
          aria-label={t('timetable.filters.subject')}
          value={filters.subject_id === null ? '' : String(filters.subject_id)}
          onChange={(event) => setFilter('subject_id', event.target.value)}
          placeholder={t('timetable.filters.subject')}
          options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
          data-testid="timetable-filter-subject"
        />
      </div>
      <div className="w-[170px]">
        <Select
          aria-label={t('timetable.filters.teacher')}
          value={filters.teacher_id === null ? '' : String(filters.teacher_id)}
          onChange={(event) => setFilter('teacher_id', event.target.value)}
          placeholder={t('timetable.filters.teacher')}
          options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.full_name }))}
          data-testid="timetable-filter-teacher"
        />
      </div>
      <div className="w-[130px]">
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
      <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={showSunday}
          onChange={(event) => setShowSunday(event.target.checked)}
          data-testid="timetable-show-sunday"
        />
        {t('timetable.showSunday')}
      </label>
    </div>
  );

  /** One precisely positioned block; clicking it opens the group sheet. */
  const block = ({ entry, laneIndex, laneCount }: TimetableLane) => {
    const color = subjectColor(entry.subject_name);
    const groupName = groupTitle(t, entry) + (entry.branch_name ? ` · ${entry.branch_name}` : '');
    const tooltip = [
      `${t('timetable.tooltipGroup')}: ${groupName}`,
      `${t('groups.subject')}: ${entry.subject_name}`,
      `${t('groups.teacher')}: ${entry.teacher_name ?? t('groups.noTeacher')}`,
      `${t('groups.room')}: ${entry.room || '—'}`,
      `${dayLabel(t, entry.day_of_week)} ${entry.start_time}–${entry.end_time}`,
      `${t('groups.enrolled')}: ${entry.enrolled_count}/${entry.capacity}`,
    ].join('\n');
    const top = (minutesOf(entry.start_time) - grid.startHour * 60) * SLOT_PX / ROW_MINUTES;
    const height = (minutesOf(entry.end_time) - minutesOf(entry.start_time)) * SLOT_PX / ROW_MINUTES;
    // Each cluster has its own width. Above four lanes, keep each lane at
    // least a quarter of the visible day column, allowing horizontal scroll.
    const clusterWidth = `max(100%, ${laneCount * 80}px, ${laneCount * 25}%)`;
    return (
      <div
        key={`${entry.group_id}-${entry.day_of_week}-${entry.start_time}`}
        className="pointer-events-none absolute inset-y-0 start-0"
        style={{ width: clusterWidth }}
      >
        <div
          className="timetable-lane absolute"
          style={{ top, height, left: `${laneIndex / laneCount * 100}%`, width: `${100 / laneCount}%`, containerType: 'inline-size' }}
          data-lane-index={laneIndex}
          data-lane-count={laneCount}
        >
          <button
            type="button"
            onClick={() => setDetailId(entry.group_id)}
            title={tooltip}
            aria-label={tooltip}
            data-testid={`timetable-block-${entry.group_id}-${DAY_KEYS[entry.day_of_week]}`}
            data-subject={entry.subject_name}
            style={{ backgroundColor: subjectTint(color), borderColor: color, color }}
            className={cn(
              'pointer-events-auto flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border border-s-4 p-1 text-start',
              'transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40',
            )}
          >
            <span className="w-full truncate text-[12px] font-semibold leading-tight" dir="auto">{groupName}</span>
            <span className="timetable-lane-details w-full truncate text-[10px] leading-tight opacity-90" dir="auto">{entry.subject_name}</span>
            {entry.room ? <span className="timetable-lane-details w-full truncate text-[10px] leading-tight opacity-80" dir="auto">{entry.room}</span> : null}
            {entry.teacher_name ? <span className="timetable-lane-details w-full truncate text-[10px] leading-tight opacity-80" dir="auto">{entry.teacher_name}</span> : null}
          </button>
        </div>
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
      </div>

      {filtersBar}

      {/* -------------------------------------------------------------- grid */}
      <div className="relative rounded-xl border border-border bg-white p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('timetable.loading')}
          </div>
        ) : null}

        {/* Tablet and up: the full week. Below `lg` it scrolls horizontally. */}
        <div className={cn('overflow-x-auto', loading && 'hidden')}>
          {/* `dir="ltr"` on purpose: in Arabic the labels are mirrored but Lundi
              stays the left-most column, so the week reads the same both ways. */}
          <div
            dir="ltr"
            className="relative grid min-w-[820px] gap-x-1"
            style={{
              gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
              gridTemplateRows: `36px repeat(${grid.rows}, ${SLOT_PX}px) 12px`,
            }}
            data-testid="timetable-grid"
            data-days={days.length}
            data-hours={grid.hours.length}
          >
            {/* sticky day header */}
            <div className="sticky top-0 z-10 bg-white" aria-hidden="true" />
            {days.map((day) => (
              <div
                key={day}
                className="sticky top-0 z-10 flex items-center justify-center border-b border-border bg-white text-[12px] font-semibold text-foreground"
                style={{ gridColumn: days.indexOf(day) + 2, gridRow: 1 }}
                data-testid={`timetable-header-${DAY_KEYS[day]}`}
              >
                <span dir="auto" title={dayLabel(t, day)}>
                  {shortDayLabel(t, day)}
                </span>
              </div>
            ))}

            {/* sticky time column: one label per hour, on the first half-hour row */}
            {grid.hours.map((hour, index) => (
              <div
                key={`label-${hour}`}
                className="sticky start-0 z-10 flex items-start justify-end bg-white pe-1.5 pt-0.5 text-[11px] text-muted"
                style={{
                  gridColumn: 1,
                  gridRow: `${index * (60 / ROW_MINUTES) + 2} / span ${60 / ROW_MINUTES}`,
                }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}

            {/* hour rules, one per hour across every day column */}
            {grid.hours.map((hour, index) => (
              <div key={`rule-${hour}`} className="contents">
                {days.map((day) => (
                  <div
                    key={`${day}-${hour}`}
                    className="border-t border-border/60"
                    style={{
                      gridColumn: days.indexOf(day) + 2,
                      gridRow: `${index * (60 / ROW_MINUTES) + 2} / span ${60 / ROW_MINUTES}`,
                    }}
                  />
                ))}
              </div>
            ))}

            {/* Each day scrolls independently when its overlap cluster is wide. */}
            {days.map((day, dayIndex) => (
              <div
                key={`column-${day}`}
                className="min-w-0 overflow-x-auto"
                style={{ gridColumn: dayIndex + 2, gridRow: `2 / span ${grid.rows + 1}` }}
                data-testid={`timetable-day-column-${DAY_KEYS[day]}`}
              >
                <div className="relative w-full" style={{ height: grid.rows * SLOT_PX }}>
                  {(lanesByDay.get(day) ?? []).map(block)}
                </div>
              </div>
            ))}

            {/* empty state sits over the grid, headers stay visible */}
            {totalClasses === 0 ? (
              <div
                className="pointer-events-none flex items-start justify-center pt-6"
                style={{ gridColumn: `1 / span ${days.length + 1}`, gridRow: `2 / span ${grid.rows}` }}
              >
                <div className="pointer-events-auto rounded-lg border border-dashed border-border bg-white/95 px-5 py-4 text-center">
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
        <div className="lg:hidden">
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
                  className="flex w-full flex-col gap-0.5 rounded-md border border-s-4 p-2 text-start"
                  data-testid={`timetable-mobile-${entry.group_id}-${DAY_KEYS[entry.day_of_week]}`}
                >
                  <span className="flex items-center justify-between text-[12px] font-semibold">
                    <span dir="auto">{entry.subject_name}</span>
                    <span className="font-normal opacity-80">
                      {entry.start_time}–{entry.end_time}
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
