import type { TimetableEntry } from '../types';
import { minutesOf } from './schedule';

export interface TimetableLane {
  entry: TimetableEntry;
  laneIndex: number;
  laneCount: number;
}

/** Assign lanes for one day. Connected overlap clusters use their own width. */
export function assignTimetableLanes(entries: TimetableEntry[]): TimetableLane[] {
  const sorted = [...entries].sort((a, b) =>
    minutesOf(a.start_time) - minutesOf(b.start_time) ||
    minutesOf(b.end_time) - minutesOf(a.end_time) || a.group_id - b.group_id,
  );
  const result: TimetableLane[] = [];
  let cluster: Array<{ entry: TimetableEntry; laneIndex: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const finishCluster = () => {
    const laneCount = laneEnds.length;
    result.push(...cluster.map(({ entry, laneIndex }) => ({ entry, laneIndex, laneCount })));
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };
  for (const entry of sorted) {
    const start = minutesOf(entry.start_time);
    const end = minutesOf(entry.end_time);
    // Touching endpoints are not overlaps; a new cluster can use the full width.
    if (cluster.length && start >= clusterEnd) finishCluster();
    let laneIndex = laneEnds.findIndex(laneEnd => laneEnd <= start);
    if (laneIndex < 0) laneIndex = laneEnds.length;
    laneEnds[laneIndex] = end;
    cluster.push({ entry, laneIndex });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) finishCluster();
  return result;
}
