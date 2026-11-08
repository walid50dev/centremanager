#!/usr/bin/env node
// Start `npm run dev` separately first. This script uses a fresh browser context.
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.SCREENSHOT_OUTPUT_DIR ? path.resolve(process.env.SCREENSHOT_OUTPUT_DIR) : path.join(root, 'screenshots');
await mkdir(output, { recursive: true });
const launch = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') launch.args = ['--no-sandbox'];
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const failures = [];
const modalsOnly = process.argv.includes('--modals-only');
async function capture(name) {
  // Embedded PDF viewers can keep a request open indefinitely.
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, name + '.png') });
  console.log('OK', name);
}
async function step(name, action) {
  try { await action(); await capture(name); }
  catch (error) { await rm(path.join(output, name + '.png'), { force: true }); failures.push(name); console.error('ÉCHEC', name, error.message); }
}
async function nav(name) { await page.getByTestId(`nav-${name}`).click(); }
async function closeDialog() { await page.getByRole('dialog').last().getByRole('button', { name: 'Fermer', exact: true }).first().click(); await page.waitForTimeout(250); }
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { const { seedScreenshots } = await import('/scripts/screenshot-fixture.mjs'); await seedScreenshots({ overwrite: true }); });
  await page.reload({ waitUntil: 'networkidle' });
  if (!modalsOnly) await step('01-login', async () => { await page.locator('input[type=password]').waitFor(); });
  else await page.locator('input[type=password]').waitFor();
  await page.locator('input[type=password]').fill('admin123');
  await page.locator('form button[type=submit]').click();
  await page.getByTestId('nav-dashboard').waitFor();
  if (!modalsOnly) {
  await step('02-dashboard', async () => {});
  await step('03-students-list', async () => { await nav('students'); await page.getByText('Salma El Mansouri').first().waitFor(); });
  await step('04-student-detail', async () => { await page.getByText('Salma El Mansouri').first().click(); await page.getByText('Salma El Mansouri').first().waitFor(); });
  await step('05-student-modal-add', async () => { await nav('students'); await page.getByRole('button', { name: /nouvel élève/i }).first().click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('06-groups-list', async () => { await nav('groups'); await page.getByTestId('group-card-1').waitFor(); });
  await step('07-group-modal-add', async () => { await page.getByRole('button', { name: /nouveau groupe/i }).first().click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('08-teachers-list', async () => { await nav('teachers'); await page.getByTestId('teacher-card-1').waitFor(); });
  await step('09-teacher-detail', async () => { await page.getByTestId('teacher-card-1').click(); await page.getByText('Prof. Amrani').first().waitFor(); });
  await step('10-teacher-modal-add', async () => { await nav('teachers'); await page.getByTestId('teacher-new').click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('11-payments', async () => { await nav('payments'); await page.getByTestId('payments-new').waitFor(); });
  await step('12-payment-modal', async () => { await page.getByTestId('payments-new').click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('13-expenses', async () => { await nav('expenses'); await page.getByTestId('expenses-table').waitFor(); });
  await step('14-expense-modal', async () => { await page.getByTestId('expense-new').click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('15-timetable', async () => { await nav('timetable'); await page.getByRole('heading').first().waitFor(); });
  await step('16-settings', async () => { await nav('settings'); await page.getByRole('heading').first().waitFor(); });
  await step('17-settings-school-year', async () => { await page.getByRole('button', { name: /année scolaire/i }).first().click(); await page.getByTestId('enrollment-fee-input').waitFor(); await page.getByRole('button', { name: /année scolaire/i }).first().evaluate(element => element.scrollIntoView({ block: 'start' })); });
  await step('18-trash', async () => { await nav('trash'); await page.getByText('Anciennes fournitures').waitFor(); });
  await step('19-import-students', async () => { await nav('students'); await page.getByTestId('import-students').click(); await page.getByRole('dialog').waitFor(); });
  await closeDialog();
  await step('20-receipt-pdf', async () => {
    await nav('payments'); await page.getByTestId('payments-new').click();
    await page.getByTestId('payment-student-trigger').click();
    await page.getByTestId('payment-student-option-3').click();
    await page.getByTestId('payment-invoices').locator('input[type=checkbox]').first().check();
    await page.getByTestId('payment-next').click(); await page.getByTestId('payment-next').click();
    await page.getByTestId('payment-confirm-print').click();
    await page.getByTestId('receipt-pdf-viewer').waitFor({ timeout: 30000 });
  });
  await closeDialog();
  await step('21-sidebar-year-switch', async () => { await page.getByTestId('sidebar-school-year').selectOption({ label: '2024-2025' }); await page.getByRole('dialog').waitFor(); });
  }
  const { captureModalScreens } = await import('./screenshot-modals.mjs');
  await captureModalScreens({ page, step, nav });
} finally { await browser.close(); }
if (failures.length) { console.error('Captures manquantes :', failures.join(', ')); process.exitCode = 1; }
