#!/usr/bin/env node
/**
 * install-phase14.mjs — installs Phase 14 (Rentrée + Bilan) into an existing
 * CentreManager tree, whatever its git history looks like.
 *
 *     node phase14-repair/install-phase14.mjs [root] [--dry-run] [--no-verify]
 *
 * Why this is not `git apply`:
 *
 *   The `phase14-frontend.patch` is a *context* patch built against v1.4.0. A
 *   working tree that is “v1.1.0 HEAD + Phases 10–13 uncommitted” has no such
 *   baseline, and any local edit makes the context hunks fail. This installer
 *   never relies on context: for every file it either
 *
 *     • recognises the exact v1.4.0 content (sha1) and writes the v1.5.0 file,
 *     • or **inserts** the Phase 14 pieces at semantic anchors while keeping
 *       everything already in the file (comments, routes, imports, code),
 *     • or refuses that single file, restores it untouched and says why.
 *
 *   Translations are always merged key by key — existing strings are never
 *   replaced. A full backup of `src/` and `src-tauri/src/` is taken first.
 *
 * Exit codes: 0 = Phase 14 installed and verified, 1 = something was skipped
 * (details printed), 2 = usage/precondition error.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERIFY = !args.includes('--no-verify');
// Phase 14 shipped with a Bilan page, which was removed on request. By default
// the installer ends with `remove-bilan.mjs`, so a fresh install matches the
// current app; pass --keep-bilan to get the 1.5.0-as-first-shipped state.
const KEEP_BILAN = args.includes('--keep-bilan');
const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? process.cwd());
const PAYLOAD = join(dirname(new URL(import.meta.url).pathname), 'payload');
const CHECKER = join(dirname(new URL(import.meta.url).pathname), 'check-phase14.mjs');

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const payload = (rel) => readFileSync(join(PAYLOAD, rel), 'utf8');
const write = (rel, text) => {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

/** sha1 of the v1.4.0 content of every file Phase 14 changed. */
const BASELINE = {
  'src/App.tsx': 'ee31001f7e8342564e50bb18cab13b8a2d212d52',
  'src/components/layout/Sidebar.tsx': '1462672a5e20915140bad1f60f46d9142e1384a7',
  'src/components/settings/SchoolYearSection.tsx': 'ff4230739bc9983df38b256926c7adda7ea33a67',
  'src/services/settingsDevBackend.ts': '6e20ca0019d9a270c5029d18bc05333545d78d81',
  'src/types/index.ts': '8f0cab6d9ec4e8700c9401cb449dc8eec477c0c6',
  'src/i18n/fr.json': '17b1457c30be5e5761df05beb4b028201b2b2d0c',
  'src/i18n/ar.json': '74a096daaf4f0b061261270161429485de3765ff',
  'src-tauri/src/commands/mod.rs': 'e8eb2bd630718a56229a18d6a93deb1589177f7c',
  'src-tauri/src/main.rs': '05173a0f67e18ba67e2a84f1fe0237423657939b',
  'src-tauri/src/commands/enrollments.rs': 'f243339f2130bc9dcfe94c09bda753519d34c08e',
};

/** Files Phase 14 adds (never overwritten if already present and identical). */
const NEW_FILES = [
  'src/pages/BilanPage.tsx',
  'src/components/settings/RentreeWizardModal.tsx',
  'src/services/schoolYear.ts',
  'src-tauri/src/commands/rentree.rs',
  'src-tauri/src/commands/bilan.rs',
];

/** Strings that prove a file already carries its Phase 14 changes. */
const APPLIED = {
  'src/App.tsx': 'path="/bilan"',
  'src/components/layout/Sidebar.tsx': "labelKey: 'sidebar.bilan'",
  'src/components/settings/SchoolYearSection.tsx': ['rentree-open', 'school-year-new'],
  'src/services/settingsDevBackend.ts': 'cmd_execute_rentree',
  'src/types/index.ts': 'RentreePreview',
  'src-tauri/src/commands/mod.rs': 'pub mod bilan;',
  'src-tauri/src/main.rs': 'commands::bilan::cmd_get_bilan',
  'src-tauri/src/commands/enrollments.rs': 'pub(crate) fn enroll_on(',
};

const report = [];
const record = (file, status, detail = '') => {
  report.push({ file, status, detail });
  const icon = { written: '✔', patched: '✔', merged: '✔', present: '✔', skipped: '✖', failed: '✖' }[status] ?? '·';
  console.log(`  ${icon} ${file} — ${status}${detail ? ` (${detail})` : ''}`);
};

// ---------------------------------------------------------------------------
// 0. preconditions + backup
// ---------------------------------------------------------------------------
console.log(`\nCentreManager — Phase 14 installer\nroot: ${root}${DRY ? '  [dry run]' : ''}\n`);

for (const required of ['package.json', 'src/App.tsx', 'src-tauri/src/main.rs', 'src-tauri/src/commands/mod.rs']) {
  if (!existsSync(join(root, required))) {
    console.error(`Not a CentreManager tree: ${required} is missing.`);
    process.exit(2);
  }
}
if (!existsSync(PAYLOAD)) {
  console.error(`Payload folder missing next to this script: ${PAYLOAD}`);
  process.exit(2);
}

let backupDir = null;
if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backupDir = join(root, `phase14-backup-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const dir of ['src', 'src-tauri/src']) {
    cpSync(join(root, dir), join(backupDir, dir), { recursive: true });
  }
  // package.json / Cargo.toml / tauri.conf.json are copied too: the version bump
  // and any dependency touch can be rolled back separately.
  for (const file of ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json']) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(backupDir, file));
  }
  console.log(`Backup: ${backupDir}\n`);
  console.log(`Restore with:  cp -r "${backupDir}/src" "${backupDir}/src-tauri" "${backupDir}/package.json" "${root}/"\n`);
}

// ---------------------------------------------------------------------------
// 1. new files
// ---------------------------------------------------------------------------
console.log('1. New files');
for (const rel of NEW_FILES) {
  const current = read(rel);
  const wanted = payload(rel);
  if (current === wanted) {
    record(rel, 'present');
    continue;
  }
  if (current !== null) {
    // A different file is already there: keep it, it is not ours to overwrite.
    record(rel, 'skipped', 'already exists with different content — left untouched');
    continue;
  }
  if (!DRY) write(rel, wanted);
  record(rel, 'written');
}

// ---------------------------------------------------------------------------
// 2. small files: exact baseline or anchors
// ---------------------------------------------------------------------------
console.log('\n2. Patched files');

/** Extracts a slice of the payload between two markers (both included/excluded per flags). */
function slice(from, startMarker, endMarker, { includeStart = true, includeEnd = false } = {}) {
  const start = from.indexOf(startMarker);
  if (start < 0) throw new Error(`payload marker not found: ${startMarker}`);
  const end = from.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`payload end marker not found: ${endMarker}`);
  return from.slice(includeStart ? start : start + startMarker.length, includeEnd ? end + endMarker.length : end);
}

/** Inserts `text` before the first occurrence of `anchor`; returns null if absent. */
function insertBefore(text, anchor, block) {
  const index = text.indexOf(anchor);
  if (index < 0) return null;
  return text.slice(0, index) + block + text.slice(index);
}

/** Inserts `block` on its own line after the line containing `anchor`. */
function insertAfterLine(text, anchor, block) {
  const index = text.indexOf(anchor);
  if (index < 0) return null;
  const lineEnd = text.indexOf('\n', index);
  if (lineEnd < 0) return null;
  return text.slice(0, lineEnd + 1) + block + text.slice(lineEnd + 1);
}

/**
 * Inserts `attribute` **inside** the JSX tag that contains `anchor`.
 *
 * The `>` of an arrow function (`onClick={() => …}`) is not a tag close, so it
 * is skipped; when the line has no tag close at all (one attribute per line),
 * `null` is returned and the caller falls back to a line insertion.
 */
function insertAttribute(text, anchor, attribute) {
  const index = text.indexOf(anchor);
  if (index < 0) return null;
  const lineEnd = text.indexOf('\n', index);
  const rest = text.slice(index, lineEnd < 0 ? text.length : lineEnd);
  let closing = -1;
  for (let at = 0; at < rest.length; at += 1) {
    if (rest[at] === '>' && rest[at - 1] !== '=') closing = at;
  }
  if (closing < 0) return null;
  const at = index + closing;
  return `${text.slice(0, at)} ${attribute}${text.slice(at)}`;
}

function replaceOnce(text, search, replacement) {
  const index = text.indexOf(search);
  if (index < 0) return null;
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

// -- src/App.tsx -------------------------------------------------------------
function patchApp(current) {
  const wanted = payload('src/App.tsx');
  const importLine = slice(wanted, 'import BilanPage', '\n', { includeEnd: true });
  const routeBlock = slice(
    wanted,
    '          {/* Phase 14 — the annual summary, right after the dashboard. */}',
    '          <Route\n            path="/students"',
  );
  let next = current;
  // The two halves are independent: a tree can already import the page (the
  // reported symptom) while missing the route, or the other way round.
  if (!next.includes("from './pages/BilanPage'")) {
    const withImport = insertAfterLine(next, "from './pages/DashboardPage'", importLine);
    if (withImport === null) return null;
    next = withImport;
  }
  if (!next.includes('path="/bilan"')) {
    const withRoute = insertBefore(next, '          <Route\n            path="/students"', routeBlock);
    if (withRoute === null) return null;
    next = withRoute;
  }
  return next === current ? null : next;
}

// -- src/components/layout/Sidebar.tsx --------------------------------------
function patchSidebar(current) {
  const wanted = payload('src/components/layout/Sidebar.tsx');
  const navBlock = slice(wanted, "  // Phase 14 — the annual summary", "  { to: '/students'");
  let next = current;
  if (!next.includes('BarChart3')) {
    const withIcon = replaceOnce(next, 'import {\n', 'import {\n  BarChart3,\n');
    if (withIcon === null) return null;
    next = withIcon;
  }
  if (!next.includes("labelKey: 'sidebar.bilan'")) {
    const withNav = insertBefore(next, "  { to: '/students', labelKey: 'sidebar.students'", navBlock);
    if (withNav === null) return null;
    next = withNav;
  }
  return next === current ? null : next;
}

// -- src/components/settings/SchoolYearSection.tsx --------------------------
function patchSchoolYearSection(current) {
  const wanted = payload('src/components/settings/SchoolYearSection.tsx');

  const importLine = "import RentreeWizardModal from './RentreeWizardModal';\n";
  const buttonBlock = slice(
    wanted,
    '          {/* Phase 14 — the annual transition: copy groups, re-enroll, fresh',
    '          <ul className="mt-4 divide-y divide-border rounded-md border border-border">',
  );
  const modalBlock = slice(wanted, '      <RentreeWizardModal', '    </SettingsSection>');

  let next = current;

  // import + icon
  if (!next.includes("from './RentreeWizardModal'")) {
    const withImport = insertAfterLine(next, "from './SettingsSection'", importLine);
    if (withImport === null) return null;
    next = withImport;
  }
  if (!next.includes('Rocket')) {
    const lucideLine = next.match(/import \{([^}]+)\} from 'lucide-react';/);
    if (!lucideLine) return null;
    const names = lucideLine[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    names.push('Rocket');
    names.sort((a, b) => a.localeCompare(b));
    next = next.replace(
      lucideLine[0],
      `import { ${names.join(', ')} } from 'lucide-react';`,
    );
  }

  // state
  if (!next.includes('rentreeOpen')) {
    const withState = insertAfterLine(
      next,
      'const [activatingId, setActivatingId] = useState<number | null>(null);',
      '  const [rentreeOpen, setRentreeOpen] = useState(false);\n',
    );
    if (withState === null) return null;
    next = withState;
  }

  // button card + list anchor
  if (!next.includes('rentree-open')) {
    const withButton = insertBefore(
      next,
      '          <ul className="mt-4 divide-y divide-border rounded-md border border-border">',
      buttonBlock,
    );
    if (withButton === null) return null;
    next = withButton;
  }

  // the year form's test hooks (added with Phase 14, used by the browser suite)
  // Heal an attribute that a previous run may have left inside the children.
  next = next.replace(/\n\s*data-testid="school-year-create"(?=\n\s*\{t\('settings\.schoolYear\.create'\))/, '');
  next = next.replace(/\n\s*data-testid="school-year-new"(?=\n\s*\{t\('settings\.schoolYear\.new'\))/, '');

  const hooks = [
    ['school-year-new', 'onClick={() => setFormOpen(true)}', 'data-testid="school-year-new"'],
    ['school-year-form', '<div className="rounded-md border border-border bg-background p-4">', null],
    ['school-year-label', 'value={label}', 'data-testid="school-year-label"'],
    ['school-year-start', 'value={startDate}', 'data-testid="school-year-start"'],
    ['school-year-end', 'value={endDate}', 'data-testid="school-year-end"'],
    ['school-year-create', 'onClick={handleCreate}', 'data-testid="school-year-create"'],
  ];
  for (const [id, anchor, attribute] of hooks) {
    if (next.includes(`"${id}"`)) continue;
    if (attribute === null) {
      // attribute goes inside the existing opening tag
      const replaced = replaceOnce(
        next,
        anchor,
        '<div\n                className="rounded-md border border-border bg-background p-4"\n                data-testid="school-year-form"\n              >',
      );
      if (replaced !== null) next = replaced;
      continue;
    }
    const inline = insertAttribute(next, anchor, attribute);
    const inserted = inline ?? insertAfterLine(next, anchor, `                    ${attribute}\n`);
    if (inserted !== null) next = inserted;
  }

  // modal before the closing tag
  if (!next.includes('<RentreeWizardModal')) {
    const withModal = insertBefore(next, '    </SettingsSection>', modalBlock);
    if (withModal === null) return null;
    next = withModal;
  }

  return next === current ? null : next;
}

// -- src/types/index.ts ------------------------------------------------------
function patchTypes(current) {
  if (current.includes('RentreePreview')) return null;
  if (!current.includes('export interface SchoolYear')) return null;
  const wanted = payload('src/types/index.ts');
  const block = slice(wanted, '// ---------------------------------------------------------------------------\n// Phase 14 — Rentrée (school year transition) & Bilan (annual summary)');
  return `${current.trimEnd()}\n\n${block}`;
}

// -- src/services/settingsDevBackend.ts ------------------------------------
function patchDevBackend(current) {
  const wanted = payload('src/services/settingsDevBackend.ts');

  const typeNames = [
    'BilanData',
    'MonthlyBreakdown',
    'RentreeGroupSummary',
    'RentreeInput',
    'RentreePreview',
    'RentreeResult',
    'RentreeStudentSummary',
    'RentreeTeacherSummary',
    'TopGroup',
    'TopStudent',
  ];
  const helperBlock = slice(
    wanted,
    '// ---------------------------------------------------------------------------\n// Phase 14 — annual summary (mirror of `commands/bilan.rs`)',
    'export async function devInvoke(',
  );
  const caseBlock = slice(
    wanted,
    '    // -- Rentrée & Bilan (Phase 14) ----------------------------------------',
    '    // -- Weekly timetable (Phase 13)',
  );

  let next = current;

  // 1. the payload types, inserted into the `import type { … }` block
  const typeImport = next.match(/import type \{([\s\S]*?)\} from '\.\.\/types';/);
  if (!typeImport) return null;
  const missing = typeNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(typeImport[1]));
  if (missing.length > 0) {
    const existing = typeImport[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const merged = [...existing, ...missing].sort((a, b) => a.localeCompare(b));
    const rebuilt = `import type {\n${merged.map((name) => `  ${name},`).join('\n')}\n} from '../types';`;
    next = next.replace(typeImport[0], rebuilt);
  }

  // 2. the audit log accepts a school-year entity
  if (!next.includes("'school_year'")) {
    const widened = replaceOnce(
      next,
      "entityType: 'student' | 'group' | 'enrollment' | 'teacher' | 'expense' = 'student',",
      "entityType: 'student' | 'group' | 'enrollment' | 'teacher' | 'expense' | 'school_year' = 'student',",
    );
    if (widened === null) return null;
    next = widened;
  }

  // 3. the bilan helper, right before devInvoke
  if (!next.includes('function computeBilan(')) {
    const withHelper = insertBefore(next, 'export async function devInvoke(', helperBlock);
    if (withHelper === null) return null;
    next = withHelper;
  }

  // 4. the three cases, at the head of the *devInvoke* switch. Anchoring on the
  //    function first matters: the file contains several `switch` blocks, and
  //    the first `case '` of the module belongs to another one.
  if (!next.includes("case 'cmd_get_rentree_preview'")) {
  const devStart = next.indexOf('export async function devInvoke(');
  if (devStart < 0) return null;
  const switchStart = next.indexOf('switch (', devStart);
  if (switchStart < 0) return null;
  const firstCase = next.indexOf("    case '", switchStart);
  if (firstCase < 0) return null;
  next = next.slice(0, firstCase) + caseBlock + next.slice(firstCase);
  }

  return next === current ? null : next;
}

// -- src-tauri/src/commands/mod.rs -----------------------------------------
function patchCommandsMod(current) {
  let next = current;
  for (const [name, anchor] of [
    ['bilan', 'pub mod auth;'],
    ['rentree', 'pub mod payments;'],
  ]) {
    if (new RegExp(`^\\s*pub mod ${name};`, 'm').test(next)) continue;
    const inserted = insertAfterLine(next, anchor, `pub mod ${name};\n`);
    if (inserted === null) {
      const appended = `${next.trimEnd()}\npub mod ${name};\n`;
      next = appended;
    } else {
      next = inserted;
    }
  }
  return next;
}

// -- src-tauri/src/main.rs -------------------------------------------------
function patchMainRs(current) {
  if (current.includes('commands::bilan::cmd_get_bilan')) return current;
  const start = current.indexOf('tauri::generate_handler![');
  if (start < 0) return null;
  const open = current.indexOf('[', start);
  let depth = 0;
  let close = -1;
  for (let index = open; index < current.length; index += 1) {
    const char = current[index];
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return null;
  const lineStart = current.lastIndexOf('\n', close) + 1;
  if (lineStart <= open) return null;
  const block =
    '            // School year transition & annual summary (Phase 14)\n' +
    '            commands::rentree::cmd_get_rentree_preview,\n' +
    '            commands::rentree::cmd_execute_rentree,\n' +
    '            commands::bilan::cmd_get_bilan,\n';
  return current.slice(0, lineStart) + block + current.slice(lineStart);
}

// -- src-tauri/src/commands/enrollments.rs ---------------------------------
function patchEnrollments(current) {
  return replaceOnce(current, '\nfn enroll_on(', '\npub(crate) fn enroll_on(');
}

const PATCHERS = {
  'src/App.tsx': patchApp,
  'src/components/layout/Sidebar.tsx': patchSidebar,
  'src/components/settings/SchoolYearSection.tsx': patchSchoolYearSection,
  'src/services/settingsDevBackend.ts': patchDevBackend,
  'src/types/index.ts': patchTypes,
  'src-tauri/src/commands/mod.rs': patchCommandsMod,
  'src-tauri/src/main.rs': patchMainRs,
  'src-tauri/src/commands/enrollments.rs': patchEnrollments,
};

for (const [rel, patcher] of Object.entries(PATCHERS)) {
  const current = read(rel);
  if (current === null) {
    record(rel, 'failed', 'file not found in this tree');
    continue;
  }
  const wanted = payload(rel);
  const markers = [].concat(APPLIED[rel] ?? []);
  if (current === wanted) {
    record(rel, 'present');
    continue;
  }
  // Exact known baseline → the shipped file is the right answer, byte for byte.
  if (BASELINE[rel] && sha1(current) === BASELINE[rel]) {
    if (!DRY) write(rel, wanted);
    record(rel, 'written', 'matched the v1.4.0 baseline');
    continue;
  }
  // Otherwise: semantic insertion, keeping every local edit. The patchers are
  // piece-wise and idempotent, so they always run — that is also what heals a
  // file an earlier run left half-patched.
  const patched = patcher(current);
  if (!patched || patched === current) {
    if (markers.length > 0 && markers.every((marker) => current.includes(marker))) {
      record(rel, 'present');
    } else {
      record(rel, 'skipped', 'an anchor was not found — file left untouched');
    }
    continue;
  }
  if (!DRY) write(rel, patched);
  record(rel, 'patched', 'inserted at anchors, local content preserved');
}

// ---------------------------------------------------------------------------
// 3. translations — merged, never overwritten
// ---------------------------------------------------------------------------
console.log('\n3. Translations (merged, existing strings kept)');

const lookup = (dict, dotted) =>
  dotted.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), dict);

function mergeMissing(target, source) {
  let added = 0;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      added += mergeMissing(target[key], value);
      continue;
    }
    if (typeof target[key] !== 'string') {
      target[key] = value;
      added += 1;
    }
  }
  return added;
}

for (const lang of ['fr', 'ar']) {
  const rel = `src/i18n/${lang}.json`;
  const current = read(rel);
  if (current === null) {
    record(rel, 'failed', 'file not found');
    continue;
  }
  let data;
  try {
    data = JSON.parse(current);
  } catch (error) {
    record(rel, 'failed', `invalid JSON — ${error.message}`);
    continue;
  }
  const wanted = JSON.parse(payload(rel));
  // Carry each Phase 14 block over, keeping any key that is already translated.
  let added = 0;
  for (const block of ['bilan', 'rentree']) {
    if (wanted[block]) {
      data[block] = data[block] ?? {};
      added += mergeMissing(data[block], wanted[block]);
    }
  }
  data.sidebar = data.sidebar ?? {};
  if (typeof data.sidebar.bilan !== 'string') {
    data.sidebar.bilan = wanted.sidebar.bilan;
    added += 1;
  }
  data.settings = data.settings ?? {};
  data.settings.schoolYear = data.settings.schoolYear ?? {};
  if (typeof data.settings.schoolYear.exists !== 'string') {
    data.settings.schoolYear.exists = wanted.settings.schoolYear.exists;
    added += 1;
  }
  if (added === 0) {
    record(rel, 'present', 'all keys already there');
    continue;
  }
  if (!DRY) write(rel, `${JSON.stringify(data, null, 2)}\n`);
  record(rel, 'merged', `${added} keys added`);
}

// ---------------------------------------------------------------------------
// 4. version bump
// ---------------------------------------------------------------------------
console.log('\n4. Version');
const VERSION = '1.5.0';
const bump = (rel, pattern) => {
  const current = read(rel);
  if (current === null) return record(rel, 'failed', 'not found');
  if (current.includes(`${pattern}${VERSION}`)) return record(rel, 'present');
  const next = current.replace(
    new RegExp(`${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]+\\.[0-9]+\\.[0-9]+`),
    `${pattern}${VERSION}`,
  );
  if (next === current) return record(rel, 'skipped', 'version pattern not found');
  if (!DRY) write(rel, next);
  record(rel, 'patched', VERSION);
};
bump('package.json', '"version": "');
bump('src-tauri/tauri.conf.json', '"version": "');
bump('src-tauri/Cargo.toml', 'version = "');

// ---------------------------------------------------------------------------
// 5. the Bilan page was removed from the app: undo it right after installing
// ---------------------------------------------------------------------------
if (!KEEP_BILAN) {
  console.log('\n5. Removing the Bilan page (kept in the app only until 1.5.0)');
  const remover = join(dirname(new URL(import.meta.url).pathname), 'remove-bilan.mjs');
  if (!existsSync(remover)) {
    console.log('  note  remove-bilan.mjs not found next to this script — Bilan left in place');
  } else {
    try {
      const output = execFileSync(process.execPath, [remover, root, ...(DRY ? ['--dry-run'] : [])], {
        encoding: 'utf8',
      });
      for (const line of output.split('\n')) if (line.trim().startsWith('✔')) console.log(line);
    } catch (error) {
      console.log('  ✖ remove-bilan.mjs failed:');
      console.log(String(error.stdout ?? '').split('\n').slice(-12).join('\n'));
      process.exitCode = 1;
    }
  }
} else {
  console.log('\n5. Bilan kept (--keep-bilan)');
}

// ---------------------------------------------------------------------------
// 6. verification
// ---------------------------------------------------------------------------
let failed = report.filter((row) => row.status === 'failed' || row.status === 'skipped');

if (VERIFY && !DRY) {
  console.log('\n6. Verification');
  try {
    const output = execFileSync(process.execPath, [CHECKER, root], { encoding: 'utf8' });
    console.log(output);
    failed = failed.filter((row) => row.status === 'failed');
  } catch (error) {
    console.log(error.stdout ?? '');
    console.log('  ✖ check-phase14.mjs reported problems (see above)');
    process.exitCode = 1;
  }

  // TypeScript, when the dependencies are installed.
  if (existsSync(join(root, 'node_modules/.bin/tsc'))) {
    try {
      execFileSync(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], { cwd: root, encoding: 'utf8' });
      console.log('  ✔ tsc --noEmit: clean\n');
    } catch (error) {
      console.log('  ✖ tsc --noEmit failed:');
      console.log(String(error.stdout ?? '').split('\n').slice(0, 20).join('\n'));
      process.exitCode = 1;
    }
  } else {
    console.log('  note  node_modules absent — run `npm install && npx tsc --noEmit` afterwards\n');
  }
}

const skipped = report.filter((row) => row.status === 'skipped');
const written = report.filter((row) => ['written', 'patched', 'merged'].includes(row.status));

console.log(`${'-'.repeat(64)}`);
console.log(`${written.length} file(s) modified, ${report.filter((r) => r.status === 'present').length} already up to date, ${skipped.length} skipped`);
if (skipped.length > 0) {
  console.log('\nSkipped — these need a look:');
  for (const row of skipped) console.log(`  • ${row.file} — ${row.detail}`);
}
if (!DRY) {
  console.log('\nNext:');
  console.log('  npx tsc --noEmit');
  console.log('  npm run check:i18n');
  console.log('  npm run build');
  console.log('  cd src-tauri && cargo check && cargo test');
  console.log('  rm -rf node_modules/.vite   # Vite caches failed resolutions');
  if (backupDir) console.log(`\nRollback: cp -r "${backupDir}/src" "${backupDir}/src-tauri" "${root}/"`);
}
process.exit(process.exitCode === 1 || skipped.length > 0 ? 1 : 0);
