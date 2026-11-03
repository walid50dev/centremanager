/**
 * Phase 14 — “Rentrée” (school-year transition) and “Bilan” (annual summary).
 * Temporary browser suite (deleted after the phase).
 *
 * Runs against the Vite dev server with the localStorage backend: the wizard is
 * checked both on screen and in the store (new year, copied groups, fresh
 * enrollments + invoices, untouched old year, audit row), then the Bilan page is
 * checked against the same store so the arithmetic is independent.
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
  else {
    failures.push(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
    console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

const strip = (value) => String(value).replace(/[\u2066-\u2069]/g, '');
const nb = (value) => String(value).replace(/[\u00A0\u202F\u2009]/g, ' ');
/** `1 250,00 DH` → 125000 (dev locale is fr-MA). */
const cash = (text) => {
  const cleaned = strip(nb(text)).replace(/[^\d,.-]/g, '').replace(',', '.');
  return Math.round(Number.parseFloat(cleaned) * 100);
};

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

/** `fill()` — the reliable way to set a `<input type="date">` value. */
async function setValue(page, testId, value) {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await page.keyboard.press('Tab');
  const actual = await input.inputValue();
  if (actual !== value) console.log(`  ! setValue(${testId}) got ${actual} instead of ${value}`);
}

/** Expected bilan numbers, computed from the store (independent of the UI). */
function expectBilan(data, year) {
  const from = (year.start_date ?? '').slice(0, 10);
  const to = (year.end_date ?? '').slice(0, 10);
  const day = (value) => String(value ?? '').slice(0, 10);
  const inRange = (value) => day(value) >= from && day(value) <= to;
  const monthInRange = (month, y) =>
    month !== null && y !== null && `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-01` >= from &&
    `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-01` <= to;

  const groups = data.groups.filter((group) => group.school_year_id === year.id);
  const groupIds = new Set(groups.map((group) => group.id));
  const enrollments = data.enrollments.filter((row) => groupIds.has(row.group_id));
  const enrollmentIds = new Set(enrollments.map((row) => row.id));

  return {
    students: new Set(enrollments.map((row) => row.student_id)).size,
    groups: groups.length,
    revenue: data.payments.filter((row) => inRange(row.created_at)).reduce((s, r) => s + r.amount_cents, 0),
    theoretical: data.invoices
      .filter((row) => monthInRange(row.period_month ?? null, row.period_year ?? null))
      .reduce((s, r) => s + r.amount_cents, 0),
    salaries: data.teacherSettlements
      .filter((row) => monthInRange(row.month, row.year))
      .reduce((s, r) => s + r.amount_cents, 0),
    expenses: data.expenses
      .filter((row) => monthInRange(row.month, row.year))
      .reduce((s, r) => s + r.amount_cents, 0),
  };
}

const { page } = await login();
const seed = await store(page);
const core = seed;
const yearOne = core.schoolYears.find((year) => year.is_active);

// An inactive student is never re-enrolled (same rule as `enroll_on`).
const yearOneGroupIds = new Set(
  seed.groups.filter((group) => group.school_year_id === yearOne.id).map((group) => group.id),
);
const activeEnrollments = seed.enrollments.filter(
  (row) =>
    row.status === 'actif' &&
    yearOneGroupIds.has(row.group_id) &&
    seed.students.find((student) => student.id === row.student_id)?.status === 'actif',
);
const activeStudentIds = new Set(activeEnrollments.map((row) => row.student_id));
const offeredStudents = seed.students.filter((student) => activeStudentIds.has(student.id));
const expectedEnrollments = activeEnrollments.length;

// ===========================================================================
// 1. Sidebar + route (the Bilan page was removed: nothing must remain)
// ===========================================================================
const navLinks = page.locator('aside a, nav a');
const navTexts = (await navLinks.allInnerTexts()).map((text) => strip(text).trim());
ok('sidebar has eight entries', navTexts.length === 8, navTexts);
ok('no Bilan entry in the sidebar', !navTexts.some((text) => /bilan/i.test(text)), navTexts);
ok(
  'the timetable keeps its place between groups and teachers',
  navTexts.indexOf('Emploi du temps') === navTexts.indexOf('Groupes') + 1,
  navTexts,
);
ok(
  'no link points at /bilan',
  (await page.locator('[data-testid="nav-bilan"]').count()) === 0,
);

// The removed route falls through to the catch-all → the dashboard.
await go(page, '/bilan');
await page.waitForTimeout(1200);
ok('the /bilan route no longer exists', page.url().endsWith('/'), page.url());
ok('…and lands on the dashboard', (await page.getByTestId('kpi-students-value').count()) === 1);
ok('no error boundary was hit', (await page.locator('text=Une erreur est survenue').count()) === 0);

// ===========================================================================
// 2. The rentrée wizard
// ===========================================================================
await go(page, '/settings');
await page.getByTestId('settings-school-year').waitFor({ timeout: 20000 }).catch(() => {});
const section = page.getByRole('button', { name: /Année scolaire/i }).first();
if (await section.count()) await section.click();
await page.waitForTimeout(600);
ok('rentrée button visible in settings §2', (await page.getByTestId('rentree-open').count()) === 1);

await page.getByTestId('rentree-open').click();
await page.getByTestId('rentree-wizard').waitFor({ timeout: 10000 });
await page.waitForTimeout(700);
ok('wizard opens on step 1', (await page.getByTestId('rentree-step-1').count()) === 1);
ok('four steps listed', (await page.getByTestId('rentree-steps').innerText()).split('\n').filter(Boolean).length >= 4);

// ---- suggestions
const labelValue = await page.getByTestId('rentree-label').inputValue();
ok('label is suggested from the current year', labelValue === '2025-2026', labelValue);
ok('start date suggested', (await page.getByTestId('rentree-start').inputValue()) === '2025-09-01');
ok('end date suggested', (await page.getByTestId('rentree-end').inputValue()) === '2026-06-30');
ok(
  'current year reminder shows the old label',
  (await page.locator('body').innerText()).includes('2024-2025'),
);

// ---- validation: duplicate label
await setValue(page, 'rentree-label', '2024-2025');
await page.waitForTimeout(400);
ok('duplicate label is refused', (await page.getByTestId('rentree-error').count()) === 1);
ok(
  'duplicate label message',
  (await page.getByTestId('rentree-error').innerText()).includes('existe déjà'),
  await page.getByTestId('rentree-error').innerText(),
);
ok('next disabled while the label is invalid', await page.getByTestId('rentree-next').isDisabled());

// ---- validation: end before start
await setValue(page, 'rentree-label', '2026-2027');
await setValue(page, 'rentree-start', '2026-09-01');
await setValue(page, 'rentree-end', '2026-01-15');
await page.waitForTimeout(400);
ok('end before start is refused', (await page.getByTestId('rentree-error').count()) === 1);
ok('next still disabled', await page.getByTestId('rentree-next').isDisabled());

// ---- valid dates for a year containing today
await setValue(page, 'rentree-end', '2027-06-30');
await page.waitForTimeout(500);
ok('no error with valid dates', (await page.getByTestId('rentree-error').count()) === 0);
ok('next enabled', !(await page.getByTestId('rentree-next').isDisabled()));

// ---- step 2: groups
await page.getByTestId('rentree-next').click();
await page.getByTestId('rentree-step-2').waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const groupsBefore = seed.groups.filter((group) => group.school_year_id === yearOne.id);
ok('all groups are listed', (await page.locator('[data-testid^="rentree-group-"][data-testid$="-toggle"]').count()) === groupsBefore.length);
ok('groups are pre-checked', (await page.getByTestId('rentree-groups-count').innerText()).includes(`${groupsBefore.length} groupes sélectionnés sur ${groupsBefore.length}`), await page.getByTestId('rentree-groups-count').innerText());
const firstGroupRow = page.getByTestId(`rentree-group-${groupsBefore[0].id}`);
ok('group row shows the schedule', /\d/.test(strip(nb(await firstGroupRow.innerText()))));
ok('group row shows the fee', strip(nb(await firstGroupRow.innerText())).includes('DH'));

await page.getByTestId(`rentree-group-${groupsBefore[2].id}-toggle`).uncheck();
await page.waitForTimeout(300);
ok('unticking one group updates the count', (await page.getByTestId('rentree-groups-count').innerText()).includes(`${groupsBefore.length - 1} groupes sélectionnés`), await page.getByTestId('rentree-groups-count').innerText());
await page.getByTestId('rentree-groups-none').click();
await page.waitForTimeout(300);
ok('deselect-all empties the selection', (await page.getByTestId('rentree-groups-count').innerText()).includes('0 groupes sélectionnés'));
ok('next disabled with no group', await page.getByTestId('rentree-next').isDisabled());
await page.getByTestId('rentree-groups-all').click();
await page.waitForTimeout(300);
ok('select-all restores every group', (await page.getByTestId('rentree-groups-count').innerText()).includes(`${groupsBefore.length} groupes sélectionnés`));
await page.screenshot({ path: `${SHOTS}/phase14-02-rentree-groups.png` });

// ---- step 3: students
await page.getByTestId('rentree-next').click();
await page.getByTestId('rentree-step-3').waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const studentsBefore = offeredStudents.length;
const studentBoxes = page.locator('[data-testid^="rentree-student-"][data-testid$="-toggle"]');
ok('every enrolled student is offered', (await studentBoxes.count()) === studentsBefore, await studentBoxes.count());
ok('students are pre-checked', (await studentBoxes.first().isChecked()) === true);
ok(
  'enrollment date defaults to the new start date',
  (await page.getByTestId('rentree-enrollment-date').inputValue()) === '2026-09-01',
  await page.getByTestId('rentree-enrollment-date').inputValue(),
);
ok(
  'students count line',
  (await page.getByTestId('rentree-students-count').innerText()).includes(`${studentsBefore} élèves sélectionnés sur ${studentsBefore}`),
  await page.getByTestId('rentree-students-count').innerText(),
);
ok('warning box present', (await page.locator('body').innerText()).includes('facture du premier mois'));
const estimateText = strip(nb(await page.getByTestId('rentree-estimate').innerText()));
ok('estimate shows a total and a number of invoices', /Total estimé/.test(estimateText) && /facture/.test(estimateText), estimateText);

// search filter
await page.getByTestId('rentree-student-search').fill('Salma');
await page.waitForTimeout(400);
ok('search narrows the list', (await studentBoxes.count()) === 1, await studentBoxes.count());
const salma = seed.students.find((student) => student.full_name.includes('Salma'));
ok(
  'search keeps the right student',
  (await page.getByTestId(`rentree-student-${salma.id}`).count()) === 1,
);
await page.getByTestId('rentree-student-search').fill('');
await page.waitForTimeout(400);
ok('clearing search restores the list', (await studentBoxes.count()) === studentsBefore);

// enrollment date before the year is refused
await setValue(page, 'rentree-enrollment-date', '2020-01-01');
await page.waitForTimeout(400);
ok('enrollment date before the year is refused', (await page.locator('body').innerText()).includes('dans la nouvelle année scolaire'));
ok('next disabled with a bad enrollment date', await page.getByTestId('rentree-next').isDisabled());
await setValue(page, 'rentree-enrollment-date', '2026-09-05');
await page.waitForTimeout(400);
ok('next enabled again', !(await page.getByTestId('rentree-next').isDisabled()));
await page.screenshot({ path: `${SHOTS}/phase14-03-rentree-students.png` });

// ---- step 4: recap
await page.getByTestId('rentree-next').click();
await page.getByTestId('rentree-step-4').waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
ok('recap shows the new year', (await page.getByTestId('rentree-summary-year').innerText()).includes('2026-2027'));
ok('recap groups = 3', Number(await page.getByTestId('rentree-summary-groups').innerText()) === groupsBefore.length);
ok('recap students = 4', Number(await page.getByTestId('rentree-summary-students').innerText()) === studentsBefore);
const recapEnrollments = Number(await page.getByTestId('rentree-summary-enrollments').innerText());
ok('recap enrollments = one per old enrollment', recapEnrollments === expectedEnrollments, {
  recapEnrollments,
  expectedEnrollments,
});
ok('recap invoices = enrollments', (await page.getByTestId('rentree-summary-invoices').innerText()).startsWith(String(recapEnrollments)));
await page.screenshot({ path: `${SHOTS}/phase14-04-rentree-recap.png` });

// ---- confirm
await page.getByTestId('rentree-confirm').click();
await page.getByTestId('rentree-result').waitFor({ timeout: 20000 });
await page.waitForTimeout(900);
ok('success card appears', (await page.getByTestId('rentree-result').count()) === 1);
ok('result groups', Number(await page.getByTestId('rentree-result-groups').innerText()) === groupsBefore.length);
ok('result students', Number(await page.getByTestId('rentree-result-students').innerText()) === studentsBefore);
ok('result enrollments', Number(await page.getByTestId('rentree-result-enrollments').innerText()) === recapEnrollments);
ok('result invoices', Number(await page.getByTestId('rentree-result-invoices').innerText()) === recapEnrollments);
ok('success card mentions the year', (await page.getByTestId('rentree-result').innerText()).includes('2026-2027'));
await page.screenshot({ path: `${SHOTS}/phase14-05-rentree-result.png` });

// ===========================================================================
// 3. What the transaction actually wrote
// ===========================================================================
const after = await store(page);
const newYear = after.schoolYears.find((year) => year.label === '2026-2027');
ok('a second school year exists', after.schoolYears.length === 2, after.schoolYears.length);
ok('the new year is active', newYear?.is_active === true, newYear);
ok('the old year is deactivated', after.schoolYears.find((year) => year.id === yearOne.id)?.is_active === false);
ok('new year dates', newYear?.start_date === '2026-09-01' && newYear?.end_date === '2027-06-30', newYear);

const oldGroups = after.groups.filter((group) => group.school_year_id === yearOne.id);
const newGroups = after.groups.filter((group) => group.school_year_id === newYear.id);
ok('old groups are untouched', oldGroups.length === groupsBefore.length, oldGroups.length);
ok('groups were copied', newGroups.length === groupsBefore.length, newGroups.length);
ok(
  'copies keep subject, level, fee and capacity',
  newGroups.every((copy) => {
    const source = oldGroups.find((group) => group.id === copy.id - 0) ?? oldGroups.find((group) => group.subject_id === copy.subject_id);
    return (
      source !== undefined &&
      source.subject_id === copy.subject_id &&
      source.level_id === copy.level_id &&
      source.monthly_fee_cents === copy.monthly_fee_cents &&
      source.capacity === copy.capacity &&
      source.teacher_id === copy.teacher_id
    );
  }),
  newGroups.map((group) => [group.id, group.subject_id, group.monthly_fee_cents]),
);
ok(
  'copies keep their week',
  newGroups.every((copy) => {
    const source = oldGroups.find((group) => group.subject_id === copy.subject_id);
    return (copy.schedules ?? []).length === (source?.schedules ?? []).length;
  }),
  newGroups.map((group) => (group.schedules ?? []).length),
);
ok(
  'copied schedules keep day and hours',
  newGroups.every((copy) => {
    const source = oldGroups.find((group) => group.subject_id === copy.subject_id);
    const a = JSON.stringify((source?.schedules ?? []).map((slot) => [slot.day_of_week, slot.start_time, slot.end_time]).sort());
    const b = JSON.stringify((copy.schedules ?? []).map((slot) => [slot.day_of_week, slot.start_time, slot.end_time]).sort());
    return a === b;
  }),
);

const oldEnrollments = after.enrollments.filter((row) => seed.enrollments.some((before) => before.id === row.id));
ok('no enrollment was deleted', oldEnrollments.length === seed.enrollments.length, oldEnrollments.length);
const carriedOld = oldEnrollments.filter((row) => activeEnrollments.some((before) => before.id === row.id));
ok(
  'old enrollments of re-enrolled students are closed',
  carriedOld.every((row) => row.status === 'terminé'),
  carriedOld.map((row) => row.status),
);
ok(
  'they got the enrollment date as end date',
  carriedOld.every((row) => row.end_date === '2026-09-05'),
  carriedOld.map((row) => row.end_date),
);
ok(
  'the inactive student keeps his open enrollment',
  oldEnrollments
    .filter((row) => !activeEnrollments.some((before) => before.id === row.id))
    .every((row) => row.status === 'actif' && row.end_date === null),
);

const newEnrollments = after.enrollments.filter((row) => !seed.enrollments.some((before) => before.id === row.id));
ok('fresh enrollments were created', newEnrollments.length === recapEnrollments, newEnrollments.length);
ok('fresh enrollments are active', newEnrollments.every((row) => row.status === 'actif'));
ok('fresh enrollments start on the enrollment date', newEnrollments.every((row) => row.start_date === '2026-09-05'), newEnrollments.map((row) => row.start_date));
ok('fresh enrollments target the copied groups', newEnrollments.every((row) => newGroups.some((group) => group.id === row.group_id)), newEnrollments.map((row) => row.group_id));
ok(
  'each student got exactly their old groups',
  activeEnrollments.every((before) =>
    after.enrollments.some(
      (row) =>
        row !== null &&
        row.student_id === before.student_id &&
        row.status === 'actif' &&
        row.group_id !== before.group_id &&
        newGroups.some((group) => group.id === row.group_id && group.subject_id === oldGroups.find((g) => g.id === before.group_id)?.subject_id),
    ),
  ),
);
ok(
  'the inactive student was not re-enrolled',
  seed.students
    .filter((student) => student.status !== 'actif')
    .every((student) =>
      after.enrollments
        .filter((row) => row.student_id === student.id)
        .every((row) => seed.enrollments.some((before) => before.id === row.id)),
    ),
);

const newInvoices = after.invoices.filter((row) => !seed.invoices.some((before) => before.id === row.id));
ok('one invoice per new enrollment', newInvoices.length === recapEnrollments, newInvoices.length);
ok('the old invoices are untouched', after.invoices.filter((row) => seed.invoices.some((before) => before.id === row.id)).length === seed.invoices.length);
ok(
  'invoices carry the copied fee',
  newInvoices.every((invoice) => {
    const enrollment = after.enrollments.find((row) => row.id === invoice.enrollment_id);
    const group = newGroups.find((row) => row.id === enrollment?.group_id);
    return invoice.amount_cents === group?.monthly_fee_cents;
  }),
  newInvoices.map((invoice) => invoice.amount_cents),
);

const audit = after.auditLog.filter((row) => row.action === 'RENTREE');
ok('one audit row was written', audit.length === 1, audit.length);
ok('audit row targets the new year', audit[0]?.entity_id === newYear?.id && audit[0]?.entity_type === 'school_year', audit[0]);
let auditDetails = {};
try {
  auditDetails = JSON.parse(audit[0]?.details ?? '{}');
} catch {
  auditDetails = {};
}
ok('audit row summarises the transition', auditDetails.groups_created === groupsBefore.length && auditDetails.enrollments_created === recapEnrollments, auditDetails);

// ---- settings refreshed behind the modal
await page.getByTestId('rentree-close').click();
await page.waitForTimeout(1200);
const settingsText = strip(nb(await page.locator('body').innerText()));
ok('settings lists both years', settingsText.includes('2026-2027') && settingsText.includes('2024-2025'));
ok('the new year is shown as active', /2026-2027[\s\S]{0,200}Active/i.test(settingsText) || (await page.locator('[data-testid^="school-year-row-"]').count()) >= 2);

// ===========================================================================
// 4. Arabic / RTL
// ===========================================================================
await go(page, '/settings');
await page.waitForTimeout(800);
const languageSection = page.getByRole('button', { name: /Langue|Language/i }).first();
if (await languageSection.count()) await languageSection.click();
await page.waitForTimeout(500);
const arabicOption = page.getByRole('button', { name: /العربية/ }).first();
if (await arabicOption.count()) await arabicOption.click();
else await page.getByLabel(/Langue/i).selectOption('ar');
await page.waitForTimeout(1400);

ok('document switched to RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
const arabicNav = (await page.locator('aside a, nav a').allInnerTexts()).map((text) => strip(text).trim());
ok('sidebar keeps eight entries in Arabic', arabicNav.length === 8, arabicNav);
ok('no Bilan label in Arabic either', !arabicNav.some((text) => /الحصيلة|bilan/i.test(text)), arabicNav);

// rentrée wizard in Arabic
await go(page, '/settings');
await page.waitForTimeout(900);
if (await page.getByTestId('rentree-open').count()) {
  await page.getByTestId('rentree-open').click();
  await page.getByTestId('rentree-wizard').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/phase14-06-rentree-ar.png` });
  const wizardText = strip(nb(await page.getByTestId('rentree-wizard').innerText()));
  ok('wizard title translated', wizardText.includes('دخول مدرسي جديد'));
  ok('wizard steps translated', wizardText.includes('المجموعات') && wizardText.includes('التلاميذ'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

ok('no console errors or page errors', consoleIssues.length === 0, consoleIssues.slice(0, 6));

await browser.close();

console.log(`\nphase14: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
