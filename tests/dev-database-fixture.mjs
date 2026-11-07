// Browser dev startup replaces the old dev store exactly once, with a backup.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const values=new Map();
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
globalThis.window={setTimeout};
const server=await createServer({optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {devInvoke:call}=await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const {applyBundledLoadTest}=await server.ssrLoadModule('/scripts/load-test-fixture.mjs');
  await call('cmd_get_all_settings');
  const key='centremanager.dev.settings_store_v1', old=values.get(key);
  values.set('centremanager.dev.mock_password_digest','existing-test-digest');
  assert.equal(await applyBundledLoadTest(),true);
  assert.equal(values.get('centremanager.dev.pre-load-test-backup-v1'),old);
  assert.equal(values.get('centremanager.dev.mock_password_digest'),'existing-test-digest');
  const data=JSON.parse(values.get(key));
  assert.equal(data.students.length,200); assert.equal(data.groups.length,14); assert.equal(data.teachers.length,6);
  assert.equal((await call('cmd_get_students',{})).total,200);
  // Reloading must never reset edits or replace the original backup.
  data.students[0].notes='Modification conservée'; values.set(key,JSON.stringify(data));
  assert.equal(await applyBundledLoadTest(),false);
  assert.equal(JSON.parse(values.get(key)).students[0].notes,'Modification conservée');
  assert.equal(values.get('centremanager.dev.pre-load-test-backup-v1'),old);
  // Failed marker writes must roll the store back rather than leave a partial reset.
  values.delete('centremanager.dev.load-test-applied-v1');
  const beforeFailure = values.get(key);
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => {
    if (k === 'centremanager.dev.load-test-applied-v1') throw new Error('quota');
    setItem(k, v);
  };
  await assert.rejects(applyBundledLoadTest(), /quota/);
  assert.equal(values.get(key), beforeFailure);
  globalThis.localStorage.setItem = setItem;
  window.__TAURI_INTERNALS__={}; await assert.rejects(applyBundledLoadTest(),/développement/); delete window.__TAURI_INTERNALS__;
  console.log('Default dev fixture: one-time apply, prior-data backup, auth preservation and restart persistence passed.');
} finally { await server.close(); }
