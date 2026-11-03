#!/usr/bin/env node
/**
 * check-phase14.mjs — portable Phase 14 health check.
 *
 * Run it **inside any CentreManager checkout** to find out exactly what is
 * missing, before touching a single file:
 *
 *     node phase14-repair/check-phase14.mjs            # checks the current directory
 *     node phase14-repair/check-phase14.mjs ../my-app  # …or another one
 *
 * It uses only Node's standard library (no dependencies, nothing to install) and
 * verifies four things:
 *
 *   1. every file Phase 14 added or changed exists;
 *   2. every relative import under `src/` resolves to a real file (this is the
 *      exact check Vite performs when it says “Failed to resolve import”);
 *   3. the i18n keys the Phase 14 screens use are present in `fr.json` and
 *      `ar.json`, with the same shape;
 *   4. the three Rust commands are declared and registered.
 *
 * Exit code 0 = everything is in place, 1 = at least one FAIL was printed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());

let pass = 0;
const failures = [];
const notes = [];

const ok = (label, detail) => {
  pass += 1;
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
};
const ko = (label, detail) => {
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (text) => {
  notes.push(text);
  console.log(`  note  ${text}`);
};

console.log(`\nCentreManager — Phase 14 check\nroot: ${root}\n`);

// ---------------------------------------------------------------- 1. files
console.log('1. Phase 14 files');
const PHASE14_FILES = [
  // added by Phase 14 (the Bilan page was removed afterwards — see §5)
  'src/components/settings/RentreeWizardModal.tsx',
  'src/services/schoolYear.ts',
  'src-tauri/src/commands/rentree.rs',
  'src-tauri/src/commands/bilan.rs',
  // modified by Phase 14
  'src/App.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/settings/SchoolYearSection.tsx',
  'src/services/settingsDevBackend.ts',
  'src/types/index.ts',
  'src/i18n/fr.json',
  'src/i18n/ar.json',
  'src-tauri/src/commands/mod.rs',
  'src-tauri/src/main.rs',
];

for (const file of PHASE14_FILES) {
  const full = join(root, file);
  if (existsSync(full)) {
    const size = statSync(full).size;
    ok(file, `${size} bytes`);
  } else {
    ko(file, 'missing');
  }
}

// ------------------------------------------------------------- 2. imports
console.log('\n2. Relative imports under src/ (the check Vite performs)');
const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.json', '.css', '.svg'];

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

function resolves(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  // The specifier may already carry its extension (`./fr.json`).
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
let importCount = 0;
const brokenImports = [];

for (const file of collectFiles(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    importCount += 1;
    if (!resolves(file, specifier)) {
      brokenImports.push(`${file.replace(root + '/', '')} → ${specifier}`);
    }
  }
}

if (brokenImports.length === 0) {
  ok('every relative import resolves', `${importCount} imports checked`);
} else {
  ko('broken relative imports', `${brokenImports.length} of ${importCount}`);
  for (const broken of brokenImports) console.log(`         ${broken}`);
}

// ------------------------------------------------------------- 3. i18n keys
console.log('\n3. i18n (Phase 14 keys, fr + ar)');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const fr = readJson(join(root, 'src/i18n/fr.json'));
const ar = readJson(join(root, 'src/i18n/ar.json'));

const REQUIRED_KEYS = [
  'settings.schoolYear.exists',
  'rentree.title',
  'rentree.sectionHint',
  'rentree.step1',
  'rentree.step2',
  'rentree.step3',
  'rentree.step4',
  'rentree.confirm',
  'rentree.warning',
  'rentree.result.title',
];

const lookup = (dict, dotted) =>
  dotted.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), dict);

for (const [name, dict] of [['fr.json', fr], ['ar.json', ar]]) {
  if (!dict) {
    ko(`${name} readable`);
    continue;
  }
  const missing = REQUIRED_KEYS.filter((key) => typeof lookup(dict, key) !== 'string');
  if (missing.length === 0) {
    ok(`${name} has all ${REQUIRED_KEYS.length} Phase 14 keys`);
  } else {
    ko(`${name} is missing keys`, missing.join(', '));
  }
}

if (fr && ar) {
  const flat = (dict, prefix = '', out = []) => {
    for (const [key, value] of Object.entries(dict)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') flat(value, path, out);
      else out.push(path);
    }
    return out;
  };
  // Arabic legitimately carries more plural forms than French
  // (`_zero`, `_two`, `_few`, `_many`), so the comparison ignores the suffix.
  const base = (key) => key.replace(/_(zero|one|two|few|many|other)$/, '');
  const frKeys = new Set(flat(fr).map(base));
  const arKeys = new Set(flat(ar).map(base));
  const onlyFr = [...frKeys].filter((key) => !arKeys.has(key));
  const onlyAr = [...arKeys].filter((key) => !frKeys.has(key));
  if (onlyFr.length === 0 && onlyAr.length === 0) {
    ok('fr and ar have the same keys', `${frKeys.size} keys each`);
  } else {
    ko('fr / ar parity', `fr only: ${onlyFr.slice(0, 5).join(', ') || '-'} | ar only: ${onlyAr.slice(0, 5).join(', ') || '-'}`);
  }
}

// ------------------------------------------------------------- 4. Rust side
console.log('\n4. Rust wiring');
const modRs = existsSync(join(root, 'src-tauri/src/commands/mod.rs'))
  ? readFileSync(join(root, 'src-tauri/src/commands/mod.rs'), 'utf8')
  : '';
const mainRs = existsSync(join(root, 'src-tauri/src/main.rs'))
  ? readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8')
  : '';

for (const module of ['bilan', 'rentree']) {
  if (new RegExp(`^\\s*pub mod ${module};`, 'm').test(modRs)) ok(`commands/mod.rs declares ${module}`);
  else ko(`commands/mod.rs declares ${module}`, 'missing');
}

for (const command of [
  'commands::bilan::cmd_get_bilan',
  'commands::rentree::cmd_get_rentree_preview',
  'commands::rentree::cmd_execute_rentree',
]) {
  if (mainRs.includes(command)) ok(`main.rs registers ${command.split('::').pop()}`);
  else ko(`main.rs registers ${command.split('::').pop()}`, 'missing');
}

// The names the frontend actually calls — a mismatch here is the classic
// “command not found” bug.
const service = existsSync(join(root, 'src/services/schoolYear.ts'))
  ? readFileSync(join(root, 'src/services/schoolYear.ts'), 'utf8')
  : '';
for (const cmd of ['cmd_get_rentree_preview', 'cmd_execute_rentree']) {
  if (service.includes(cmd)) ok(`src/services/schoolYear.ts calls ${cmd}`);
  else ko(`src/services/schoolYear.ts calls ${cmd}`, 'missing');
}

// ------------------------------------- 5. Bilan removed, backend kept
console.log('\n5. Bilan (frontend removed, backend kept)');
const FORBIDDEN_FILES = ['src/pages/BilanPage.tsx'];
for (const file of FORBIDDEN_FILES) {
  if (!existsSync(join(root, file))) ok(`${file} is gone`);
  else ko(`${file} should not exist`);
}
for (const cmd of ['cmd_get_bilan']) {
  if (mainRs.includes(cmd)) ok(`backend keeps ${cmd} (unexposed)`);
  else note(`${cmd} is no longer registered — fine if the backend was pruned too`);
}
if (existsSync(join(root, 'src-tauri/src/commands/bilan.rs'))) ok('commands/bilan.rs kept');
else note('commands/bilan.rs absent — the backend was pruned too');

const forbiddenInFrontend = [
  ['src/App.tsx', 'path="/bilan"', 'no /bilan route'],
  ['src/components/layout/Sidebar.tsx', "labelKey: 'sidebar.bilan'", 'no Bilan menu entry'],
  ['src/services/schoolYear.ts', 'bilanApi', 'no bilanApi in the service'],
  ['src/types/index.ts', 'BilanData', 'no BilanData type'],
  ['src/services/settingsDevBackend.ts', 'cmd_get_bilan', 'no dev-backend mock'],
];
for (const [file, needle, label] of forbiddenInFrontend) {
  const content = existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '';
  if (!content.includes(needle)) ok(label);
  else ko(label, `${needle} is still in ${file}`);
}
for (const lang of ['fr', 'ar']) {
  const dict = lang === 'fr' ? fr : ar;
  if (!dict || !dict.bilan) ok(`${lang}.json has no bilan block`);
  else ko(`${lang}.json still carries a bilan block`, `${Object.keys(dict.bilan).length} keys`);
  if (!dict || !dict.sidebar || !dict.sidebar.bilan) ok(`${lang}.json has no sidebar.bilan`);
  else ko(`${lang}.json still carries sidebar.bilan`);
}

// ----------------------------------------------------------------- summary
console.log(`\n${'-'.repeat(60)}`);
console.log(`${pass} passed, ${failures.length} failed`);
if (notes.length) console.log(`\n${notes.join('\n')}`);
if (failures.length) {
  console.log('\nWhat to do:');
  console.log('  • missing files  → drop `phase14-repair/files/*` into place, or apply');
  console.log('                     `phase14-repair/phase14-frontend.patch` to a v1.4.0 tree');
  console.log('  • broken imports → the file names on the right of the arrow do not exist');
  console.log('  • missing keys   → copy the `rentree` block from the patch (`bilan` is gone)');
  process.exit(1);
}
console.log('\nPhase 14 is complete in this checkout.');
process.exit(0);
