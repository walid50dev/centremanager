// Run: node tests/i18n-check.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'centremanager-i18n-'));
const script = resolve('scripts/check-i18n.mjs');
const run = () => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
const write = (lang, value) => writeFileSync(join(root, 'src/i18n', `${lang}.json`), JSON.stringify(value));
try {
  mkdirSync(join(root, 'src/i18n'), { recursive: true });
  const en = { app:{ title:'ok', items_one:'one', items_other:'other' }, dynamic:{ first:'1', second:'2' }, joined:{ first:'1' }, structured:{ label:'x', hint:'y' }, relation:{ other:'x' }, indirect:{ label:'x' } };
  const ar = { ...en, app:{ ...en.app, items_zero:'0', items_two:'2', items_few:'few', items_many:'many' } };
  write('fr', en); write('ar', ar);
  writeFileSync(join(root, 'src/view.tsx'), "const label = 'indirect.label'; t(label); t('app.title'); t('app.items', {count: 2}); t(`dynamic.${value}`); t('joined.' + value); t('structured', {returnObjects:true}); t('relation.other');");
  let result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  const withOrphan = { ...en, unused:{ leaf:'unused' } };
  write('fr', withOrphan); write('ar', { ...ar, unused:{ leaf:'unused' } });
  result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /unused\.leaf/);
  write('fr', en); write('ar', { ...ar, app:{ ...ar.app, title:undefined } });
  result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /app\.title/);
  write('ar', { ...ar, app:{ ...ar.app, items_few:undefined } });
  result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /pluriel incomplet : app\.items/);
  write('ar', ar);
  writeFileSync(join(root, 'src/view.tsx'), "const label='indirect.label'; t(label); t(flag ? 'app.title' : 'missing.key'); t('app.items'); t(`dynamic.${value}`); t('joined.' + value); t('structured', {returnObjects:true}); t('relation.other');");
  result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /missing\.key/);
  console.log('i18n check: indirect and dynamic keys, Arabic plurals, orphan, missing lookup and parity passed');
} finally { rmSync(root, { recursive:true, force:true }); }
