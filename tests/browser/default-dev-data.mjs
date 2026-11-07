// Run with the default Vite dev server at :1420 and the opt-out server at :1421.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const opts = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') opts.args = ['--no-sandbox'];
const browser = await chromium.launch(opts);
const key = 'centremanager.dev.settings_store_v1';
const backup = 'centremanager.dev.pre-load-test-backup-v1';
const marker = 'centremanager.dev.load-test-applied-v1';
try {
  const page = await browser.newPage();
  const oldStore = JSON.stringify({ students: [{ id: 99, first_name: 'Ancien' }] });
  const digest = createHash('sha256').update('ancien1234').digest('hex');
  await page.addInitScript(({ key, oldStore, digest }) => {
    if (!sessionStorage.getItem('testInitialized')) {
      localStorage.setItem(key, oldStore);
      localStorage.setItem('centremanager.dev.mock_password_digest', digest);
      sessionStorage.setItem('testInitialized', '1');
    }
  }, { key, oldStore, digest });
  await page.goto('http://localhost:1420');
  await page.locator('input[type=password]').fill('ancien1234');
  await page.locator('form button[type=submit]').click();
  await page.getByTestId('kpi-students').getByText('200', { exact: true }).waitFor();
  assert.equal(await page.evaluate(k => localStorage.getItem(k), backup), oldStore);
  await page.evaluate(k => {
    const data = JSON.parse(localStorage.getItem(k));
    data.students[0].notes = 'Modification après chargement';
    localStorage.setItem(k, JSON.stringify(data));
  }, key);
  await page.reload();
  await page.locator('input[type=password]').fill('ancien1234');
  await page.locator('form button[type=submit]').click();
  await page.getByTestId('kpi-students').getByText('200', { exact: true }).waitFor();
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).students[0].notes, key), 'Modification après chargement');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), backup), oldStore);
  await page.close();
  const disabled = await browser.newPage();
  await disabled.goto('http://localhost:1421');
  await disabled.locator('input[type=password]').first().waitFor();
  assert.equal(await disabled.evaluate(k => localStorage.getItem(k), marker), null);
  assert.equal(await disabled.evaluate(k => localStorage.getItem(k), backup), null);
  assert.equal(await disabled.evaluate(() => localStorage.getItem('centremanager.dev.mock_password_digest')), null);
  console.log('Browser default: existing profile backed up, password preserved, edits survive reload; opt-out passed.');
} finally { await browser.close(); }
