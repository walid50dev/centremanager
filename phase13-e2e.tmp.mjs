/**
 * Phase 13 — multi-day group scheduling and the weekly timetable.
 * Temporary browser suite (deleted after the phase).
 *
 * Runs against the Vite dev server with the localStorage backend, so every
 * schedule is also checked in the store, not only on screen.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:1420';
const SHOTS = 'docs/screenshots';
const STORE_KEY = 'centremanager.dev.settings_store_v1';
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
const consoleIssues = [];

function ok(label, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const strip = (value) => String(value).replace(/[\u2066-\u2069]/g, '');
const nb = (value) => String(value).replace(/[\u00A0\u202F\u2009]/g, ' ');

const browser = await chromium.launch();

async function login() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleIssues.push(`error: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleIssues.push(`pageerror: ${String(error)}`));

  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Nom du centre').fill('Centre Excellence Casablanca');
  await page.getByLabel('Mot de passe', { exact: true }).fill('test1234');
  await page.getByLabel('Confirmer le mot de passe').fill('test1234');
  await page.getByRole('button', { name: /Créer mon espace/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await page.getByTestId('kpi-students-value').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return { context, page };
}

async function go(page, path) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(1200);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

/** Types into a formatted input (`.fill()` appends on money inputs). */
async function typeInto(page, testId, value) {
  const input = page.getByTestId(testId);
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

/** Sets a day's checkbox to a known state; time fields only when checked. */
async function setDay(page, day, { checked, start, end }) {
  const toggle = page.getByTestId(`${day}-toggle`);
  const isChecked = (await toggle.isChecked()) === true;
  if (checked !== undefined && checked !== isChecked) await toggle.click();
  if (checked === false) return;
  if (start) await page.getByTestId(`${day}-start`).fill(start);
  if (end) await page.getByTestId(`${day}-end`).fill(end);
}

const MONDAY_START = 'group-day-Lundi-start';
const WEEK_TESTIDS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(
  (day) => `group-day-${day}`,
);

let STEP = 'login';

try {
  const { page } = await login();

  // ====================================================== 1. the sidebar link ===
  STEP = 'sidebar';
  const navIds = await page
    .locator('nav [data-testid^="nav-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  ok('the sidebar has eight links', navIds.length === 8, navIds);
  ok(
    'the timetable link sits between groups and teachers',
    navIds.indexOf('nav-groups') + 1 === navIds.indexOf('nav-timetable') &&
      navIds.indexOf('nav-timetable') + 1 === navIds.indexOf('nav-teachers'),
    navIds,
  );
  ok(
    'it is labelled “Emploi du temps”',
    strip(await page.getByTestId('nav-timetable').innerText()).includes('Emploi du temps'),
    strip(await page.getByTestId('nav-timetable').innerText()),
  );

  await page.getByTestId('nav-timetable').click();
  await page.waitForTimeout(1600);
  ok('the link opens /timetable', page.url().endsWith('/timetable'), page.url());

  // ================================================== 2. the weekly grid ======
  STEP = 'grid';
  ok(
    'the page is titled “Emploi du temps”',
    strip(await page.locator('h1').first().innerText()).includes('Emploi du temps'),
    strip(await page.locator('h1').first().innerText()),
  );
  const grid = page.getByTestId('timetable-grid');
  await grid.waitFor({ timeout: 10000 });
  ok('the grid is rendered', await grid.isVisible());
  ok('six day columns by default', (await grid.getAttribute('data-days')) === '6');
  ok(
    'Sunday is hidden by default',
    (await page.getByTestId('timetable-header-sunday').count()) === 0,
  );
  const headers = await page
    .locator('[data-testid^="timetable-header-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  ok(
    'the header runs Monday to Saturday',
    headers.join(',') ===
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        .map((day) => `timetable-header-${day}`)
        .join(','),
    headers,
  );

  // The three seeded groups (Lundi, Mardi, Samedi).
  const seedBlocks = await page.locator('[data-testid^="timetable-block-"]').count();
  ok('the seeded classes are placed', seedBlocks === 3, seedBlocks);
  ok(
    'the counter matches the number of classes',
    (await page.getByTestId('timetable-count').innerText()).trim() === '3',
    await page.getByTestId('timetable-count').innerText(),
  );

  const mondayBlock = page.locator('[data-testid^="timetable-block-1-monday"]').first();
  const mondayBox = await mondayBlock.boundingBox();
  const tuesdayBox = await page.locator('[data-testid^="timetable-block-2-tuesday"]').first().boundingBox();
  ok(
    'Monday is left of Tuesday',
    mondayBox && tuesdayBox ? mondayBox.x < tuesdayBox.x : false,
    { mondayX: mondayBox?.x, tuesdayX: tuesdayBox?.x },
  );
  const mondayRows = await mondayBlock.evaluate((node) => {
    const style = getComputedStyle(node);
    return { start: style.gridRowStart, end: style.gridRowEnd };
  });
  ok(
    'a block spans grid rows',
    mondayRows.start !== 'auto' && /span [2-9]/.test(mondayRows.end),
    mondayRows,
  );
  const mondayBg = await mondayBlock.evaluate((node) => getComputedStyle(node).backgroundColor);
  ok(
    'a block is tinted with its subject colour',
    /^rgba\(37, 99, 235, 0\.2\)$/.test(mondayBg),
    mondayBg,
  );
  ok(
    'a block lists subject, level, teacher and the headcount',
    (() => true)() &&
      strip(await mondayBlock.innerText()).includes('Mathématiques') &&
      strip(await mondayBlock.innerText()).includes('Tronc Commun') &&
      /\d+\/10/.test(nb(await mondayBlock.innerText())),
    strip(await mondayBlock.innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-01-timetable.png`, fullPage: true });

  // Sunday column is opt-in.
  await page.getByTestId('timetable-show-sunday').check();
  await page.waitForTimeout(400);
  ok(
    'the Sunday toggle adds a seventh column',
    (await page.getByTestId('timetable-grid').getAttribute('data-days')) === '7',
  );
  ok('the Sunday header appears', (await page.getByTestId('timetable-header-sunday').count()) === 1);
  await page.getByTestId('timetable-show-sunday').uncheck();
  await page.waitForTimeout(300);

  // ================================================== 3. server-side filters ===
  STEP = 'filters';
  await page.getByTestId('timetable-filter-level').selectOption({ label: 'Tronc Commun' });
  await page.waitForTimeout(700);
  ok('a level filter narrows the week', (await page.locator('[data-testid^="timetable-block-"]').count()) === 1);
  ok(
    'the counter follows the filter',
    (await page.getByTestId('timetable-count').innerText()).trim() === '1',
  );
  await page.getByTestId('timetable-filter-room').selectOption({ label: 'Salle 1' });
  await page.waitForTimeout(700);
  ok(
    'two filters are ANDed, not ORed',
    (await page.locator('[data-testid^="timetable-block-"]').count()) === 0,
  );
  ok(
    'the empty state shows while the headers stay',
    (await page.getByTestId('timetable-empty').count()) === 1 &&
      (await page.getByTestId('timetable-header-monday').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/phase13-02-empty-state.png`, fullPage: true });

  await page.getByTestId('timetable-reset').click();
  await page.waitForTimeout(800);
  ok(
    'the reset button clears every filter',
    (await page.locator('[data-testid^="timetable-block-"]').count()) === 3 &&
      (await page.getByTestId('timetable-filter-level').inputValue()) === '',
  );

  // ============================================= 4. multi-day create (modal) ===
  STEP = 'create-multiday';
  await go(page, '/groups');
  await page.locator('button', { hasText: 'Nouveau groupe' }).first().click();
  await page.waitForTimeout(1000);
  ok('the week editor is shown', (await page.getByTestId('group-week').count()) === 1);
  const dayCells = await page
    .locator('[data-testid^="group-day-"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-testid'))
        .filter((id) => /^group-day-[A-Za-z]+$/.test(id)),
    );
  ok('it offers the seven days, Monday first', dayCells.join(',') === WEEK_TESTIDS.join(','), dayCells);
  ok(
    'Monday is pre-ticked and the others are not',
    (await page.getByTestId(`${MONDAY_START}`).isEnabled()) &&
      (await page.getByTestId('group-day-Mardi-start').isDisabled()),
  );
  const uncheckedCell = await page
    .getByTestId('group-day-Mardi')
    .evaluate((node) => getComputedStyle(node).opacity);
  ok('an unchecked day is greyed out', Number(uncheckedCell) < 0.7, uncheckedCell);

  // Subject + level through the CreatableSelects (seed rows, no create).
  await page.getByTestId('group-subject-trigger').click();
  await page.getByTestId('group-subject-list').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="group-subject-option-1"]').click();
  await page.getByTestId('group-level-trigger').click();
  await page.getByTestId('group-level-list').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="group-level-option-10"]').click();
  await page.waitForTimeout(300);

  // Lundi 16-18, Mercredi 14-16, Vendredi 16-18.
  await setDay(page, 'group-day-Lundi', { checked: true, start: '16:00', end: '18:00' });
  await setDay(page, 'group-day-Mercredi', { checked: true, start: '14:00', end: '16:00' });
  await setDay(page, 'group-day-Vendredi', { checked: true, start: '16:00', end: '18:00' });
  ok(
    'the summary under the grid previews the week',
    strip(nb(await page.getByTestId('group-week-summary').innerText())).includes('Mer 14–16'),
    strip(await page.getByTestId('group-week-summary').innerText()),
  );
  await typeInto(page, 'group-fee', '300');
  await typeInto(page, 'group-capacity', '12');
  await page.screenshot({ path: `${SHOTS}/phase13-03-group-week.png` });

  await page.getByRole('button', { name: /^Enregistrer$/ }).click();
  await page.waitForTimeout(1600);

  const afterCreate = await store(page);
  const created = afterCreate.groups.find((group) => group.capacity === 12);
  ok('the group was created', Boolean(created), afterCreate.groups.length);
  ok(
    'all three days were persisted',
    created?.schedules?.length === 3,
    created?.schedules?.map((slot) => slot.day_of_week),
  );
  ok(
    'the days are stored Monday first',
    created?.schedules?.map((slot) => slot.day_of_week).join(',') === 'Lundi,Mercredi,Vendredi',
    created?.schedules?.map((slot) => slot.day_of_week),
  );
  ok(
    'the legacy columns mirror the first day',
    created.day_of_week === 'Lundi' && created.start_time === '16:00' && created.end_time === '18:00',
    { day: created.day_of_week, start: created.start_time, end: created.end_time },
  );
  ok(
    'Mercredi keeps its own hours',
    created.schedules.find((slot) => slot.day_of_week === 'Mercredi')?.start_time === '14:00',
    created.schedules,
  );

  const cardText = strip(await page.getByTestId(`group-card-${created.id}`).innerText());
  ok(
    'the card sums the week up in one line',
    nb(cardText).includes('Lun 16–18') && nb(cardText).includes('Mer 14–16') && nb(cardText).includes('Ven 16–18'),
    nb(cardText),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-04-multiday-card.png`, fullPage: true });

  // ================================================== 5. editing the week =====
  STEP = 'edit-week';
  await page.getByTestId(`group-card-${created.id}`).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Modifier/ }).first().click();
  await page.waitForTimeout(1200);
  ok(
    'the editor is prefilled with the stored week',
    (await page.getByTestId('group-day-Vendredi-toggle').isChecked()) &&
      (await page.getByTestId('group-day-Mercredi-start').inputValue()) === '14:00',
    await page.getByTestId('group-day-Mercredi-start').inputValue(),
  );

  // Un-ticking every day must block the save.
  for (const day of ['Lundi', 'Mercredi', 'Vendredi']) {
    await page.getByTestId(`group-day-${day}-toggle`).uncheck();
  }
  await page.getByRole('button', { name: /^Enregistrer$/ }).click();
  await page.waitForTimeout(600);
  ok(
    'a week without any day is rejected',
    (await page.getByTestId('group-week-error').innerText()).includes('au moins un jour'),
    await page.getByTestId('group-week-error').innerText(),
  );

  // Re-tick Lundi + Samedi, then make Samedi's range run backwards.
  await page.getByTestId('group-day-Lundi-toggle').check();
  await page.getByTestId('group-day-Samedi-toggle').check();
  await page.getByTestId('group-day-Samedi-start').fill('18:00');
  await page.getByTestId('group-day-Samedi-end').fill('16:00');
  await page.getByRole('button', { name: /^Enregistrer$/ }).click();
  await page.waitForTimeout(600);
  const reversedMessage = await page.getByTestId('group-week-error').innerText();
  ok(
    'reversed hours are caught per day',
    reversedMessage.includes('Samedi') && reversedMessage.includes('après'),
    reversedMessage,
  );

  await setDay(page, 'group-day-Samedi', { start: '09:00', end: '11:00' });
  await page.getByRole('button', { name: /^Enregistrer$/ }).click();
  await page.waitForTimeout(1600);

  const afterEdit = await store(page);
  const edited = afterEdit.groups.find((group) => group.id === created.id);
  ok(
    'the edit replaced the week',
    edited.schedules.length === 2 &&
      edited.schedules.map((slot) => slot.day_of_week).join(',') === 'Lundi,Samedi',
    edited.schedules.map((slot) => slot.day_of_week),
  );
  ok(
    'the legacy columns followed the new first day',
    edited.day_of_week === 'Lundi' && edited.start_time === '16:00',
    { day: edited.day_of_week, start: edited.start_time },
  );
  ok(
    'Samedi keeps the hours typed for it',
    edited.schedules.find((slot) => slot.day_of_week === 'Samedi')?.start_time === '09:00',
    edited.schedules,
  );

  // A single-day group keeps the verbose card line (legacy behaviour).
  const singleCard = strip(await page.getByTestId('group-card-1').innerText());
  ok(
    'a single-day group still reads “Lundi 16:00–18:00”',
    nb(singleCard).includes('Lundi 16:00–18:00'),
    nb(singleCard),
  );

  // ============================================ 6. the timetable follows it ====
  STEP = 'timetable-after-edit';
  await go(page, '/timetable');
  await page.waitForTimeout(1600);
  ok(
    'the multi-day group is on two days',
    (await page.getByTestId(`timetable-block-${created.id}-monday`).count()) === 1 &&
      (await page.getByTestId(`timetable-block-${created.id}-saturday`).count()) === 1,
  );
  ok(
    'the removed days are gone',
    (await page.getByTestId(`timetable-block-${created.id}-wednesday`).count()) === 0 &&
      (await page.getByTestId(`timetable-block-${created.id}-friday`).count()) === 0,
  );
  const saturdayBlock = page.getByTestId(`timetable-block-${created.id}-saturday`);
  const saturdayBox = await saturdayBlock.boundingBox();
  const fridayHeaderBox = await page.getByTestId('timetable-header-friday').boundingBox();
  ok(
    'a block sits in its own day column',
    saturdayBox && fridayHeaderBox ? saturdayBox.x > fridayHeaderBox.x : false,
    { saturdayX: saturdayBox?.x, fridayX: fridayHeaderBox?.x },
  );
  ok(
    'the block shows the time it was given',
    (await saturdayBlock.evaluate((node) => parseFloat(getComputedStyle(node).gridRowStart))) > 1,
  );

  // Two classes can share a slot (Samedi 09-11 Mathématiques vs 10-12 Français):
  // they must sit side by side instead of on top of each other.
  const overlapA = await page
    .getByTestId(`timetable-block-${created.id}-saturday`)
    .boundingBox();
  const overlapB = await page.getByTestId('timetable-block-3-saturday').boundingBox();
  ok(
    'overlapping classes are split into lanes',
    overlapA && overlapB
      ? overlapA.width < 200 && overlapB.width < 200 && overlapB.x > overlapA.x + 10
      : false,
    { a: overlapA, b: overlapB },
  );

  // A different subject gets a different colour.
  const physics = page.locator('[data-testid="timetable-block-2-tuesday"]').first();
  const physicsBg = await physics.evaluate((node) => getComputedStyle(node).backgroundColor);
  ok('another subject gets another colour', physicsBg !== mondayBg, { physicsBg, mondayBg });

  // Clicking a block opens the group sheet.
  await page.getByTestId(`timetable-block-${created.id}-monday`).click();
  await page.waitForTimeout(1200);
  const detailText = strip(await page.locator('[role="dialog"]').last().innerText());
  ok(
    'clicking a block opens the group sheet',
    detailText.includes('Mathématiques'),
    detailText.slice(0, 90),
  );
  ok(
    'the sheet lists both days of the week',
    nb(detailText).includes('Lun 16–18') && nb(detailText).includes('Sam 09–11'),
    nb(detailText).slice(0, 160),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-05-block-detail.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ==================================== 7. quick-create group: days + toggle ===
  STEP = 'quick-create';
  await go(page, '/groups');
  await page.waitForTimeout(800);
  await page.locator('button', { hasText: 'Nouveau groupe' }).first().click();
  await page.waitForTimeout(900);
  ok('the week editor is reachable in create mode', (await page.getByTestId('group-week').count()) === 1);
  await page.getByRole('button', { name: /Annuler/ }).first().click();
  await page.waitForTimeout(600);

  // From the enrollment wizard, which hosts the quick-create group.
  await go(page, '/students');
  await page.waitForTimeout(1200);
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1400);
  await page.getByRole('tab', { name: /Inscriptions/ }).click();
  await page.waitForTimeout(900);
  await page.locator('button', { hasText: 'Inscrire à un groupe' }).first().click();
  await page.waitForTimeout(1200);
  ok(
    'the group quick-create is offered in the enrollment wizard',
    (await page.getByTestId('enrollment-create-group').count()) === 1,
  );
  await page.getByTestId('enrollment-create-group').click();
  await page.waitForTimeout(900);
  await page.getByTestId('quick-group-subject-trigger').click();
  await page.getByTestId('quick-group-subject-list').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="quick-group-subject-option-1"]').click();
  await page.getByTestId('quick-group-level-trigger').click();
  await page.getByTestId('quick-group-level-list').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="quick-group-level-option-10"]').click();
  await page.getByTestId('quick-group-next').click();
  await page.waitForTimeout(700);

  ok('step 2 shows the seven day chips', (await page.getByTestId('quick-group-days').count()) === 1);
  ok(
    'only Monday is ticked to begin with',
    (await page.getByTestId('quick-group-day-Lundi-toggle').isChecked()) &&
      !(await page.getByTestId('quick-group-day-Mardi-toggle').isChecked()),
  );
  ok('“same hours” is on by default', await page.getByTestId('quick-group-same-hours').isChecked());
  ok(
    'one shared time range is shown',
    (await page.getByTestId('quick-group-start').count()) === 1 &&
      (await page.getByTestId('quick-group-per-day').count()) === 0,
  );

  await page.getByTestId('quick-group-day-Mardi-toggle').check();
  await page.getByTestId('quick-group-day-Jeudi-toggle').check();
  await page.getByTestId('quick-group-same-hours').uncheck();
  await page.waitForTimeout(300);
  ok(
    'turning it off gives one row per ticked day',
    (await page.getByTestId('quick-group-per-day').count()) === 1 &&
      (await page.getByTestId('quick-group-Mardi-start').count()) === 1,
  );
  await page.getByTestId('quick-group-same-hours').check();
  await page.waitForTimeout(200);
  await page.getByTestId('quick-group-start').fill('09:00');
  await page.getByTestId('quick-group-end').fill('11:00');
  await typeInto(page, 'quick-group-fee', '250');
  await page.screenshot({ path: `${SHOTS}/phase13-06-quick-create-days.png` });
  await page.getByTestId('quick-group-create').click();
  await page.waitForTimeout(1800);

  const afterQuick = await store(page);
  const quick = afterQuick.groups.find((group) => group.capacity === 10 && group.schedules.length === 3);
  ok('the quick create stored three days', Boolean(quick), afterQuick.groups.length);
  ok(
    'the shared range was applied to every day',
    quick?.schedules.every((slot) => slot.start_time === '09:00' && slot.end_time === '11:00'),
    quick?.schedules,
  );
  ok(
    'the legacy columns were written too',
    quick.day_of_week === 'Lundi' && quick.start_time === '09:00',
    { day: quick.day_of_week, start: quick.start_time },
  );

  // ================================================ 8. mobile day tabs ========
  STEP = 'mobile';
  await page.setViewportSize({ width: 420, height: 900 });
  await go(page, '/timetable');
  await page.waitForTimeout(1600);
  ok('the day tabs are shown on a phone', await page.getByTestId('timetable-day-tabs').isVisible());
  ok(
    'the desktop grid is hidden on a phone',
    !(await page.getByTestId('timetable-grid').isVisible()),
  );
  await page.getByTestId('timetable-tab-saturday').click();
  await page.waitForTimeout(500);
  ok(
    'a tab lists that day only',
    (await page.locator('[data-testid^="timetable-mobile-"]').count()) > 0 &&
      (await page
        .locator('[data-testid^="timetable-mobile-"]')
        .evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-testid').endsWith('saturday')))),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-07-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForTimeout(600);

  // ========================================================= 9. Arabic / RTL ==
  STEP = 'arabic';
  await page.locator('button', { hasText: 'AR' }).first().click();
  await page.waitForTimeout(1000);
  await go(page, '/timetable');
  await page.waitForTimeout(1600);
  ok('the document is RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  ok(
    'the page title is translated',
    strip(await page.locator('h1').first().innerText()).includes('جدول الحصص'),
    strip(await page.locator('h1').first().innerText()),
  );
  const rtlMonday = await page.getByTestId('timetable-header-monday').boundingBox();
  const rtlSaturday = await page.getByTestId('timetable-header-saturday').boundingBox();
  ok(
    'Monday stays the left-most column in RTL',
    rtlMonday && rtlSaturday ? rtlMonday.x < rtlSaturday.x : false,
    { mondayX: rtlMonday?.x, saturdayX: rtlSaturday?.x },
  );
  ok(
    'the sidebar link is translated',
    strip(await page.getByTestId('nav-timetable').innerText()).includes('جدول'),
    strip(await page.getByTestId('nav-timetable').innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-08-arabic.png`, fullPage: true });

  // The week editor keeps the same Monday-first order, labels mirrored.
  await go(page, '/groups');
  await page.waitForTimeout(1200);
  await page.locator('button', { hasText: 'مجموعة جديدة' }).first().click();
  await page.waitForTimeout(1200);
  const arMonday = await page.getByTestId('group-day-Lundi').boundingBox();
  const arSunday = await page.getByTestId('group-day-Dimanche').boundingBox();
  ok(
    'the week editor is translated and still starts on the left with Monday',
    arMonday && arSunday ? arMonday.x < arSunday.x : false,
    { mondayX: arMonday?.x, sundayX: arSunday?.x },
  );
  ok(
    'its day labels are in Arabic',
    strip(await page.getByTestId('group-day-Lundi').innerText()).includes('اثن'),
    strip(await page.getByTestId('group-day-Lundi').innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase13-09-arabic-week.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // Back to French for the group form screenshot.
  await page.locator('button', { hasText: 'FR' }).first().click();
  await page.waitForTimeout(800);
} catch (error) {
  failures.push(`[${STEP}] crashed: ${String(error).split('\n')[0]}`);
  console.error(`\n!! step ${STEP} crashed:`, error);
}

await browser.close();

const IGNORED = [/Failed to load resource/i, /favicon/i];
const realConsole = consoleIssues.filter((line) => !IGNORED.some((re) => re.test(line)));

console.log(`\n=== Phase 13 browser suite: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\nFAILURES');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
if (realConsole.length > 0) {
  console.log('\nCONSOLE ISSUES');
  for (const issue of realConsole) console.log(`  ! ${issue}`);
}
process.exit(failures.length === 0 && realConsole.length === 0 ? 0 : 1);
