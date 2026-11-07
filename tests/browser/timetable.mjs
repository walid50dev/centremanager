// Start Vite, then run: node tests/browser/timetable.mjs
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH and PLAYWRIGHT_NO_SANDBOX are optional.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const launch = { headless:true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') launch.args = ['--no-sandbox'];
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport:{ width:1440, height:900 }, locale:'fr-FR' });
const page = await context.newPage();
const testId = id => page.getByTestId(id);
try {
  await page.goto(process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420');
  await page.evaluate(async () => {
    const { authApi } = await import('/src/services/auth.ts');
    await authApi.setup('Centre test', 'admin123');
    const { devInvoke } = await import('/src/services/settingsDevBackend.ts');
    await devInvoke('cmd_get_groups', {});
    const key = 'centremanager.dev.settings_store_v1';
    const store = JSON.parse(localStorage.getItem(key));
    const template = store.groups[0];
    store.subjects.find(s => s.id === template.subject_id).name = 'Matière au nom volontairement très long pour tester la troncature';
    const slot = (id, day, start, end) => ({ ...template, id, room:'A1', day_of_week:day, start_time:start, end_time:end, schedules:[{id, day_of_week:day, start_time:start, end_time:end}] });
    store.groups = [slot(101,'Lundi','18:15','19:15'), slot(102,'Lundi','19:30','21:30'), slot(103,'Lundi','20:45','21:00'),
      ...Array.from({ length:5 }, (_,i) => slot(200+i,'Mardi','19:30','21:30')),
      {...template, id:300, day_of_week:'', start_time:'', end_time:'', schedules:[]}];
    localStorage.setItem(key, JSON.stringify(store));
  });
  await page.reload();
  await page.locator('input[type=password]').fill('admin123');
  await page.locator('form button[type=submit]').click();
  await testId('nav-timetable').click();
  await testId('timetable-block-102-monday').waitFor();
  const measure = id => testId(`timetable-block-${id}-monday`).evaluate(el => {
    const lane = el.parentElement;
    const day = lane.parentElement.parentElement;
    const time = el.querySelector('.timetable-lane-time');
    const name = el.querySelector('.timetable-lane-name');
    const bounds = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
    return { lane:bounds(lane), day:bounds(day), button:bounds(el), time:bounds(time), name:bounds(name), text:time.textContent,
      timeScroll:time.scrollWidth, timeClient:time.clientWidth, nameScroll:name.scrollWidth, nameClient:name.clientWidth,
      nameDisplay:getComputedStyle(name).display, timeDisplay:getComputedStyle(time).display };
  });
  const a = await measure(101), b = await measure(102), c = await measure(103);
  for (const [value, top] of [[a,15],[b,90],[c,165]]) assert.ok(Math.abs(value.lane.y-value.day.y-top) < 0.1, `minute offset ${top}`);
  assert.equal(b.lane.h, 120, 'two hours at 60px/hour');
  assert.equal(c.lane.h, 15, '15 minutes retain exact height');
  assert.ok(Math.abs(b.lane.right - c.lane.x) < 0.1, 'overlapping cards occupy separate adjacent lanes');
  assert.equal(b.text, '19:30 – 21:30');
  assert.ok(b.timeScroll <= b.timeClient && b.time.right <= b.button.right && b.time.bottom <= b.button.bottom, 'full range fits inside the long-name card');
  assert.ok(b.nameScroll > b.nameClient, 'long name truncates');
  assert.equal(c.nameDisplay, 'none');
  assert.equal(c.timeDisplay, 'block');
  assert.ok(c.time.right <= c.button.right && c.time.bottom <= c.button.bottom && c.time.y >= c.button.y, 'compact 15-minute card shows its whole range');
  assert.equal(await testId('timetable-block-300-monday').count(), 0);
  assert.equal(await testId('timetable-count').textContent(), '8');
  for (let i=0; i<5; i++) {
    const block = testId(`timetable-block-${200+i}-tuesday`);
    await block.scrollIntoViewIfNeeded();
    const info = await block.evaluate(el => { const t = el.querySelector('.timetable-lane-time'); const r = t.getBoundingClientRect(), b = el.getBoundingClientRect(); return { time:t.textContent, fits:t.scrollWidth <= t.clientWidth && r.right <= b.right && r.bottom <= b.bottom, lanes:el.parentElement.dataset.laneCount }; });
    assert.equal(info.time, '19:30 – 21:30'); assert.equal(info.fits, true); assert.equal(info.lanes, '5');
  }
  if (process.env.TIMETABLE_TEST_SCREENSHOT) await page.screenshot({path:process.env.TIMETABLE_TEST_SCREENSHOT});
  await page.setViewportSize({ width:320, height:812 });
  const mobile = testId('timetable-mobile-102-monday');
  await mobile.scrollIntoViewIfNeeded();
  const mobileMetrics = await mobile.evaluate(el => { const t=el.querySelector('[dir=ltr]'); const r=t.getBoundingClientRect(), b=el.getBoundingClientRect(); return {text:t.textContent.trim(), fits:t.scrollWidth<=t.clientWidth && r.left>=b.left && r.right<=b.right}; });
  assert.equal(mobileMetrics.text, '19:30 – 21:30'); assert.equal(mobileMetrics.fits, true);
  await page.getByRole('button', { name:'العربية', exact:true }).click();
  const rtlRange = await mobile.evaluate(el => { const t=el.querySelector('[dir=ltr]'); return { text:t.textContent.trim(), direction:getComputedStyle(t).direction, fits:t.scrollWidth<=t.clientWidth }; });
  assert.deepEqual(rtlRange, { text:'19:30 – 21:30', direction:'ltr', fits:true });
  await testId('timetable-tab-tuesday').click();
  assert.equal(await testId('timetable-mobile-204-tuesday').count(), 1);
  console.log('Browser timetable: minute geometry, 15-minute card, long title, five lanes, unscheduled group and mobile passed.');
} finally { await browser.close(); }
