#!/usr/bin/env node
/**
 * Fails when a `t('some.key')` used in the app has no entry in fr.json or ar.json.
 *
 * Missing keys do not throw at runtime: i18next renders the raw key, so a typo
 * shows up as `students.searchPlaceholder` inside a form. This check catches
 * that at build time. Plural keys are handled: a lookup of `x.y` is satisfied by
 * `x.y_one` / `x.y_other` (and the four extra Arabic CLDR forms).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function flatten(node, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.add(path);
  }
  return out;
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const locale = (lang) =>
  flatten(JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${lang}.json`), 'utf8')));

const has = (keys, key) =>
  keys.has(key) || PLURAL_SUFFIXES.some((suffix) => keys.has(`${key}_${suffix}`));

const used = new Map();
for (const file of sourceFiles(join(ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
    if (!used.has(match[1])) used.set(match[1], file.replace(ROOT, ''));
  }
}

let failed = false;
for (const lang of ['fr', 'ar']) {
  const keys = locale(lang);
  const missing = [...used.keys()].filter((key) => !has(keys, key)).sort();
  if (missing.length === 0) {
    console.log(`${lang}: ${used.size} keys used, all present`);
    continue;
  }
  failed = true;
  console.error(`${lang}: ${missing.length} missing key(s)`);
  for (const key of missing) console.error(`  - ${key}  (${used.get(key)})`);
}

if (failed) process.exit(1);
