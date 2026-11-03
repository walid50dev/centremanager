# Phase 14 repair kit

Everything needed to bring a CentreManager copy up to **v1.5.0 (Phase 14 — the rentrée)** when
the frontend did not make it across, and to prove afterwards that it is complete.

The target is the app **as it is now**: the rentrée wizard, and **no Bilan page**. The *Bilan*
feature shipped with 1.5.0 and was removed on request — the frontend is gone, the Rust command
`cmd_get_bilan` is deliberately kept (unused, unexposed). The kit follows that decision: the
installer installs Phase 14 and then strips the Bilan half automatically (§1), and a separate
script does the same on a tree that already has it (§1b).

```
phase14-repair/
├── install-phase14.mjs     ← THE tool: installs Phase 14 into a tree of any vintage,
│                             then removes the Bilan page (--keep-bilan to skip that)
├── remove-bilan.mjs        ← removes Bilan from a tree that already has it (idempotent)
├── check-phase14.mjs       portable verifier — no dependencies, exits 1 on failure
├── phase14-frontend.patch  src/ diff, v1.4.0 (8676b2c) → v1.5.0 (03bd2ec), Bilan included
├── payload/                the v1.5.0 files, at their repo paths (the installer's source)
│   └── src/pages/BilanPage.tsx   kept as the archive of the removed page (step 5 deletes it)
└── files/                  the two frontend files Phase 14 added/changed, in isolation
    ├── RentreeWizardModal.tsx     → src/components/settings/RentreeWizardModal.tsx
    └── schoolYear.ts              → src/services/schoolYear.ts
```

> **Already on 1.5.0 and only want Bilan gone?** `node phase14-repair/remove-bilan.mjs /path/to/project` — §1b.
>
> **Start here:** `node phase14-repair/install-phase14.mjs /path/to/project`
> It works on a tree whose HEAD is `be83606` (V1.1.0, Phase 9) with Phases 10–13
> uncommitted — no baseline, no patch context needed. It backs everything up first,
> keeps local edits, and verifies itself. Details in §1.

---

## 0. First, find out what is really missing

```bash
cd /path/to/your/centremanager
node phase14-repair/check-phase14.mjs          # or: node …/check-phase14.mjs /path/to/project
```

It prints one line per check and exits `1` if anything is wrong:

1. the 14 files Phase 14 added or changed (with byte sizes);
2. **every relative import under `src/`** — literally the resolution Vite performs when it
   reports *“Failed to resolve import”*, with the offending `file → specifier` pairs listed;
3. the `rentree.*` i18n keys in `fr.json` **and** `ar.json`, plus fr/ar parity;
4. the Rust side: `pub mod` declarations, the commands registered in `main.rs`, and the command
   names the frontend actually invokes;
5. **Bilan is really gone from the frontend** — no `BilanPage.tsx`, no `/bilan` route, no
   `sidebar.bilan`, no `bilanApi`, no `BilanData`, no `cmd_get_bilan` mock, no `bilan` block in
   either language — while the Rust command and `bilan.rs` are still there.

Expected output on a healthy checkout ends with `36 passed, 0 failed`.

---

## 1. The installer (works on any vintage)

```bash
node phase14-repair/install-phase14.mjs /path/to/centremanager            # repair (Bilan-free result)
node phase14-repair/install-phase14.mjs /path/to/centremanager --dry-run  # what it would do
node phase14-repair/install-phase14.mjs /path/to/centremanager --keep-bilan  # 1.5.0 as first shipped
```

It is **not** a patch. For every file it takes the first rule that applies:

| Situation | What it does |
| --- | --- |
| the file is one Phase 14 adds | writes it (or keeps an existing different one, untouched) |
| content is exactly the v1.4.0 version (sha1 match) | writes the v1.5.0 file, byte for byte |
| content differs (local edits, older or newer tree) | **inserts** the Phase 14 pieces at semantic anchors, preserving every existing line |
| an anchor is missing | leaves that file untouched and reports it — nothing is ever half-written |
| translations | **merges** keys; an existing `rentree.*` string is never replaced |
| step 5 | runs `remove-bilan.mjs` on the freshly installed tree, unless `--keep-bilan` |

Every run starts with a full copy of `src/`, `src-tauri/src/`, `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` into
`phase14-backup-<timestamp>/`, and prints the one-line rollback command. It is
idempotent: a second run reports `0 files modified, 18 already up to date`.

What it carries: the new files, the files to patch (`App.tsx` route,
`Sidebar.tsx` entry, `SchoolYearSection.tsx` button + modal + form hooks,
`settingsDevBackend.ts` types/cases/helper, `types/index.ts`, `commands/mod.rs`,
`main.rs` registrations, `enrollments.rs` → `pub(crate) fn enroll_on`), the
translations, and the version bump to 1.5.0 — then step 5 walks back the Bilan half
(the page, its route, its menu entry, `bilanApi`, the four types, the dev mock and
`bilan.*`), so what is left on disk is the app you are running today.

### 1b. Removing Bilan from a tree that already has it

```bash
node phase14-repair/remove-bilan.mjs /path/to/centremanager           # remove
node phase14-repair/remove-bilan.mjs /path/to/centremanager --dry-run # list only
```

Eight frontend files, nothing else: deletes `src/pages/BilanPage.tsx`, and cleans
`App.tsx` (import + route + its comment), `Sidebar.tsx` (entry + the now-unused `BarChart3`),
`schoolYear.ts` (`bilanApi` and the `BilanData` import, rentrée untouched),
`types/index.ts` (the four interfaces), `settingsDevBackend.ts` (the `cmd_get_bilan` case, the
`computeBilan` helper block, its imports, the section comment) and both `fr.json`/`ar.json`
(the `bilan` block, `sidebar.bilan`, and the `rentree.confirmHint` clause that pointed at it).

It backs `src/` and `src-tauri/src/` up into `pre-remove-bilan-<timestamp>/`, prints the rollback
line, is idempotent (second run: *nothing to remove*) and never touches `src-tauri/` — `bilan.rs`,
`cmd_get_bilan`, its six tests and the schema stay exactly where they are.

### Validated on a replica of the reported state (v1.5.0 era — historical)

These numbers are from the run that proved the installer against the tree described in the bug
report, when Phase 14 still included Bilan.

A replica was built the hard way — `git archive be83606` (V1.1.0 / Phase 9),
Phases 10–13 uncommitted on top (55 modified files), `App.tsx` already importing
`BilanPage` while the page did not exist (reproducing
`TS2307: Cannot find module './pages/BilanPage'`), plus deliberate local drift in
`Sidebar.tsx`, `SchoolYearSection.tsx` and `settingsDevBackend.ts` to defeat any
context patch. The installer ran once, from pristine:

| Gate | Result |
| --- | --- |
| `install-phase14.mjs` | 17 files modified, **0 skipped**, self-verification 26/26 |
| `check-phase14.mjs` | **26 passed, 0 failed** |
| `tsc --noEmit` | **clean** |
| `npm run check:i18n` | fr **778** / ar **778**, all present |
| `vite build` | ✓ 666.89 kB (183.26 kB gzip), CSS 42.10 kB |
| `cargo check` | ✓ finished, no errors |
| Browser suite Phase 14 | **85 passed, 0 failed** (Bilan assertions removed) |
| Browser suite Phase 13 / 12 / 11 / 10 | **67 / 75 / 64 / 68 passed, 0 failed** |
| local drift preserved | the three `// local:` edits still in place |
| deletions | none (`git status` shows no `D`) |

Re-validated against the Bilan-free target, twice:

| Run | Result |
| --- | --- |
| `remove-bilan.mjs` on `git archive 35629b6` (1.5.0 **with** Bilan) | 8 files modified; the seven cleaned files come out **byte-identical** to the shipped app, so `tsc` clean, i18n 753/753 and the same bundle hash `index-lQPGwD87.js` (653.92 kB) |
| `install-phase14.mjs` on `git archive 8676b2c` (v1.4.0, no Bilan at all) | 18 files modified / 0 skipped, then the auto-removal; `check-phase14` **36/0**, `tsc` clean, i18n 753/753, `vite build` 653.92 kB, and every touched frontend file identical to the shipped app (translations differ only in key *order*, same 753 keys) |

## 2. Repair by hand, in order of preference

### A. The repository is there and the commit is reachable (best)

```bash
git fetch --all
git log --oneline -3          # 03bd2ec (Phase 14, v1.5.0) should be in the list
git checkout 03bd2ec -- src/  # restores the whole Phase 14 frontend
node phase14-repair/check-phase14.mjs
```

### B. Apply the patch to a v1.4.0 tree

```bash
git apply --check phase14-repair/phase14-frontend.patch   # dry run, must be silent
git apply         phase14-repair/phase14-frontend.patch
```

The patch touches exactly these ten paths, 1 818 insertions:

```
src/App.tsx                                     src/i18n/ar.json
src/components/layout/Sidebar.tsx               src/i18n/fr.json
src/components/settings/RentreeWizardModal.tsx  src/pages/BilanPage.tsx
src/components/settings/SchoolYearSection.tsx   src/services/schoolYear.ts
src/services/settingsDevBackend.ts              src/types/index.ts
```

### C. Only the three new files were lost

```bash
cp phase14-repair/files/BilanPage.tsx            src/pages/
cp phase14-repair/files/RentreeWizardModal.tsx   src/components/settings/
cp phase14-repair/files/schoolYear.ts            src/services/
```

This is **not enough on its own**: `App.tsx` (the route), `Sidebar.tsx` (the second menu entry),
`SchoolYearSection.tsx` (the *Nouvelle rentrée* button), `types/index.ts` (the payloads),
`settingsDevBackend.ts` (the browser backend) and the two `i18n` files are also part of Phase 14.
Use case **A** or **B** unless the verifier tells you that only these three are missing.

---

## 3. Prove the repair

```bash
node phase14-repair/check-phase14.mjs     # 36 passed, 0 failed
npx tsc --noEmit                          # silent
npm run check:i18n                        # fr 753 / ar 753 keys used, all present
npm run build                             # ✓ 653.92 kB (180.61 kB gzip), CSS 41.68 kB
cd src-tauri && cargo test                # 190 passed, 0 failed — bilan.rs included
rm -rf node_modules/.vite && npm run dev  # Vite caches failed resolutions: always clear after a repair
```

Then check the two halves in the browser:

* **the rentrée** — *Paramètres → Année scolaire* shows **Nouvelle rentrée**; the wizard opens on
  step 1 with a suggested label, and steps 2–4 list the groups, the students and the recap;
* **no Bilan** — the sidebar has eight entries and no *Bilan*; `/bilan` redirects to the dashboard
  without an error boundary; the console stays empty.

In a Tauri window `src-tauri` must also be rebuilt (`npm run tauri dev`).

---

## 4. Why the snippet in the bug report must not be pasted in

Two reasons. The page **no longer exists** — pasting the snippet would re-add a feature that was
removed on request, without its route, its menu entry, its service call, its types or its
translations, so it would not even compile against this tree. And the proposed `BilanPage.tsx` was
written against a **different backend contract** than the one this project ships, so it would fail
at runtime even if it were wired in:

| The snippet expects | This project actually has |
| --- | --- |
| `invoke("list_school_years")` | `cmd_get_school_years` (`src-tauri/src/commands/school_years.rs`) |
| `invoke("get_bilan", { schoolYearId })` | `cmd_get_bilan` with the argument **`yearId`** |
| `BilanData { kpis, monthly, top_groups, top_students }` | `BilanData { year, total_students, total_groups, total_revenue_cents, total_theoretical_cents, collection_rate, total_compensation_cents, total_expenses_cents, net_income_cents, monthly_breakdown, top_groups, top_students }` |
| `kpis.total_inscriptions / total_encaissements / taux_recouvrement / total_impayes …` | `total_students / total_revenue_cents / collection_rate / total_theoretical_cents …` (amounts in **centimes**, not `revenue`) |
| i18n `bilan.total_inscriptions`, `bilan.monthly_breakdown`, `bilan.groups_enrolled`, `nav.bilan`, `common.no_data` | 16 of those 18 keys do not exist; the shipped keys are `bilan.kpi.*`, `bilan.monthly`, `bilan.topGroups`, `sidebar.bilan`, `common.*` (no `no_data`) |
| raw `invoke()` calls | `src/services/schoolYear.ts`, which routes to `devInvoke` in the browser — raw `invoke` throws outside Tauri, so the `npm run dev` preview would go blank |

Keeping the shipped page also keeps the 135-assertion browser suite, the `RENTREE` audit row and the
transactional rollback working; the snippet has none of them.

---

## 5. If you still see “Failed to resolve import” after all of this

That message is produced at **module-graph time** and cached in two places — Vite's
`node_modules/.vite` and the browser's error overlay. After any repair:

```bash
pkill -f "node .*vite"; rm -rf node_modules/.vite; npm run dev
```

…then hard-reload the page (`Ctrl+Shift+R`). `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1420/src/components/settings/RentreeWizardModal.tsx`
must answer `200`; if it does, the file is being served and the message you are reading is stale.
(If the missing module in your error is `./pages/BilanPage`, your copy is an intermediate state
where the `App.tsx` import survived the removal — run `remove-bilan.mjs` again, it cleans exactly
that import.)
