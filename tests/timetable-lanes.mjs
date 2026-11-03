// Run with: node tests/timetable-lanes.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { assignTimetableLanes } = await server.ssrLoadModule('/src/utils/timetableLanes.ts');
  const slot = (group_id, start_time, end_time) => ({ group_id, start_time, end_time });
  const a = slot(1, '08:00', '10:00'), b = slot(2, '09:00', '11:00'), c = slot(3, '10:00', '12:00');
  let result = assignTimetableLanes([c, b, a]);
  assert.deepEqual(result.map(x => [x.entry.group_id, x.laneIndex, x.laneCount]), [[1, 0, 2], [2, 1, 2], [3, 0, 2]], 'connected overlap cluster and reusable lane');
  result = assignTimetableLanes([slot(4, '14:00', '16:00'), a]);
  assert.deepEqual(result.map(x => x.laneCount), [1, 1], 'disconnected clusters use full width');
  result = assignTimetableLanes([a, slot(4, '10:00', '11:00')]);
  assert.deepEqual(result.map(x => x.laneCount), [1, 1], 'touching endpoints do not overlap');
  result = assignTimetableLanes([a, b, c, slot(4, '15:00', '16:00')]);
  assert.deepEqual(result.map(x => x.laneCount), [2, 2, 2, 1], 'afternoon isolated from morning cluster');
  result = assignTimetableLanes([a, b, slot(9, '09:15', '09:45')]);
  assert.deepEqual(result.map(x => x.laneCount), [3, 3, 3], 'three simultaneous groups use thirds');
  result = assignTimetableLanes(Array.from({ length: 5 }, (_, i) => slot(i + 1, '08:00', '10:00')));
  assert.deepEqual(result.map(x => x.laneIndex), [0, 1, 2, 3, 4]);
  assert.ok(result.every(x => x.laneCount === 5));
  result = assignTimetableLanes([slot(1, '08:00', '17:00'), slot(2, '09:00', '10:00'), slot(3, '10:00', '11:00'), slot(4, '10:30', '12:00')]);
  assert.deepEqual(result.map(x => [x.laneIndex, x.laneCount]), [[0, 3], [1, 3], [1, 3], [2, 3]]);
  // For every pair of overlapping intervals, assert the lanes differ; no input is lost.
  let seed = 12345;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const time = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  for (let run = 0; run < 100; run++) {
    const rows = Array.from({ length: 40 }, (_, i) => { const start = Math.floor(random() * 600); return slot(i, time(start), time(start + 1 + Math.floor(random() * 120))); });
    const placed = assignTimetableLanes(rows);
    assert.equal(placed.length, rows.length);
    const minutes = v => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const x = placed[i], y = placed[j];
      if (minutes(x.entry.start_time) < minutes(y.entry.end_time) && minutes(y.entry.start_time) < minutes(x.entry.end_time)) assert.notEqual(x.laneIndex, y.laneIndex);
    }
  }
  console.log('Timetable lanes: connected clusters, boundaries, reuse, 5 lanes and randomized overlaps passed');
} finally { await server.close(); }
