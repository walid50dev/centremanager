// Run: node tests/receipt-settings-ui.mjs
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { act, useState } = React;
const { createRoot } = await import('react-dom/client');
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  await server.ssrLoadModule('/src/i18n/index.ts');
  const { default: CenterSection } = await server.ssrLoadModule('/src/components/settings/CenterSection.tsx');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const initial = await devInvoke('cmd_get_all_settings');
  function Wrapper() {
    const [settings, setSettings] = useState(initial);
    return React.createElement(CenterSection, { settings, updateLocal: patch => setSettings(current => ({ ...current, ...patch })) });
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Wrapper)); });
  const upload = document.querySelector('input[type="file"]');
  assert.equal(upload.accept, 'image/png,image/jpeg,image/svg+xml');
  const file = new dom.window.File(['sample'], 'logo.png', { type: 'image/png' });
  Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
  await act(async () => { upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 180)); });
  const image = document.querySelector('img[alt="Aperçu du logo"]');
  assert.ok(image); assert.match(image.getAttribute('src'), /^data:image\/png;base64,/);
  assert.equal((await devInvoke('cmd_get_centre_info')).logo, image.getAttribute('src'));
  const old = image.getAttribute('src');
  Object.defineProperty(upload, 'files', { configurable: true, value: [new dom.window.File([new Uint8Array(500 * 1024 + 1)], 'big.png', { type: 'image/png' })] });
  await act(async () => { upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 100)); });
  assert.equal((await devInvoke('cmd_get_centre_info')).logo, old, 'oversized image rejected');
  // Model browser canvas rasterisation for an SVG; the persisted image must
  // be a PDF-compatible PNG rather than an SVG data URL.
  globalThis.Image = class {
    naturalWidth = 120; naturalHeight = 60;
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,YWJj';
  Object.defineProperty(upload, 'files', { configurable: true, value: [new dom.window.File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' })] });
  await act(async () => { upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 180)); });
  assert.equal((await devInvoke('cmd_get_centre_info')).logo, 'data:image/png;base64,YWJj');
  const remove = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Supprimer le logo'));
  assert.ok(remove);
  await act(async () => { remove.click(); await new Promise(r => setTimeout(r, 150)); });
  assert.equal((await devInvoke('cmd_get_centre_info')).logo, null);
  assert.equal(document.querySelector('img[alt="Aperçu du logo"]'), null);
  await act(async () => { root.unmount(); });
  console.log('Centre settings UI: PNG upload, preview, size limit, SVG conversion and removal passed');
} finally { await server.close(); dom.window.close(); }
