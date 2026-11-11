> **Nettoyage :** le kit de réparation Phase 14 et les scripts E2E temporaires historiques ont été retirés. Les vérifications maintenues se trouvent dans `tests/` et `scripts/check-i18n.mjs`. Les sections historiques ci-dessous peuvent décrire des fonctionnalités ou fichiers qui ne sont plus présents.

# CentreManager

Desktop application (Windows) for managing tutoring centres in Morocco — students, groups, teachers, monthly billing and payroll. Bilingual **French (default, LTR)** / **Arabic (RTL)**, with every amount stored in **centimes** and formatted as `DH`.

**Phase 0** delivered the buildable scaffold (app shell, navigation, i18n/RTL, design system, 17-table SQLite schema).
**Phase 1** delivers the complete authentication and session-security system — first-run setup, Argon2id login, idle auto-lock, manual lock and rate limiting — replacing the old scaffold password.
**Phase 2** delivers the **Settings page** (8 sections: centre, school year, levels, subjects, language, printing, security, backup) together with the reference-data seeding and CRUD commands behind it.
**Phase 3** delivers **student management** — searchable list, create/edit/activate/deactivate, a four-tab student sheet and a per-student audit trail.
**Phase 4** delivers **groups and enrollment** — the prepaid core: a group grid with live capacity, a four-step enrollment wizard, and the automatic first invoice (no prorata).
**Phase 5** delivers **invoicing and payments** — the monthly generator, the oldest-first allocation engine, the four-step payment modal, printed receipts frozen at issuance, and the student *Finances* tab.
**Phase 6** delivers **teachers and payroll** — the teacher records and their subjects, one cumulative compensation configuration per teacher (fixed / hourly / per session / percentage + recruitment bonus), the daily activity log, the monthly payroll computed on the **theoretical** revenue of the groups, cumulative settlements, and the *Règlements enseignants* tab of the Payments page.

**Phase 7** delivers the **dashboard** — the screen the centre owner opens first: five month KPIs compared with the previous month, the invoices due within a week sorted by urgency, the ten latest payments and the payroll of the period, each card linking to the screen that owns its data.

**Phase 8** delivers **printed receipts** — the receipt is now a real PDF rendered with `@react-pdf/renderer`, in two layouts (A4 or 80 mm thermal), previewed inline, downloadable and printable — plus the **final UI polish**: a per-route error boundary, `Ctrl/Cmd+K`, `Ctrl/Cmd+L` and `Escape` shortcuts, a pulsing late-payment badge on *Paiements*, toast stacking and press/modal animations.

**Phase 10** refines the two most-used forms: a student now carries the **father's name** (`Nom du père`) and a **home address** (`Adresse maison`, which replaced the old free-form address) — carried over from an existing database by a rename, never a data loss — and every phone number is displayed as `06 07 12 34 56` while staying stored as ten raw digits. All `<input type="number">` were replaced by a single **`NumberInput`** component (grouped thousands, clamped min/max, hold-to-repeat +/- buttons inside the border, no spinners and no wheel-to-change), with `MoneyInput` rebuilt on top of it so centimes stay exact.

**Phase 9** makes it a **release**: every one of the twenty edge cases is now covered by a test (14 new Rust tests plus a 42-assertion browser suite), *Paramètres → Sauvegarde* grows a one-click **demo data** seeder (15 students, 5 teachers, 8 groups, two months of invoices at ~60 % collection, activities and settlements), and the packaging is final — identifier `com.centremanager.app` (a V1.0 database is migrated automatically), production **CSP**, version **1.1.0**, **NSIS** installer in French and Arabic, 1280 × 800 window.

**Phase 11** closes the last gap between *revenue* and *profit*: a new **Frais** page records the centre's monthly charges (rent, WiFi, electricity, water, the assistant, supplies — the categories are editable in *Paramètres*), each row coloured by category and audited, and the dashboard grows a sixth card — **💎 Total Net** = revenue − expenses − teacher payroll — green in profit, red in loss, amber on break-even, with the three amounts in its tooltip and its trend against the previous month. Expenses are internal tracking, so they can be edited and deleted in V1 (the audit log keeps the snapshot). Since **V1.6.0** each charge also carries **its own date** — a date picker in the form, a *Date* column in the list, newest first — so a charge can be recorded late or back-dated.

**Phase 12** removes the last dead end in the forms: every dropdown that points at another entity — teacher, subject, level, group, student, expense category — now ends with **“+ Nouveau…”**. Choosing it opens a *minimal* quick-create dialog **on top of** the form (no navigation, no lost input); the new record is created, the dropdown refreshes, and it is selected. One level of nesting is allowed and enforced (`z-50` form → `z-60` quick-create → `z-70` nested), so the stack can never grow a third dialog.

| A dropdown that can create: “+ Nouveau…” under the options | Quick-create above the group form (z-60) | …the created teacher is selected |
| --- | --- | --- |
| ![Creatable dropdown](docs/screenshots/phase12-01-creatable-dropdown.png) | ![Quick subject](docs/screenshots/phase12-02-quick-subject.png) | ![Quick teacher](docs/screenshots/phase12-03-quick-teacher.png) |

| New student straight from the payment wizard | Nested: subject created from the group wizard (z-70) | Group wizard, step 2 |
| --- | --- | --- |
| ![Quick student](docs/screenshots/phase12-04-quick-student.png) | ![Nested](docs/screenshots/phase12-05-nested.png) | ![Quick group](docs/screenshots/phase12-06-quick-group.png) |

| An empty list still offers “+ Nouveau…” | Arabic / RTL dropdown | …and the Arabic quick-create |
| --- | --- | --- |
| ![Empty](docs/screenshots/phase12-07-empty.png) | ![Arabic dropdown](docs/screenshots/phase12-08-arabic.png) | ![Arabic modal](docs/screenshots/phase12-09-arabic-modal.png) |

**Phase 13** makes a group *weekly*: it now meets on as many days as it likes, each with its own
hours (`group_schedules`, the 19th table, one row per day), and a new **Emploi du temps** page
draws the whole week on one grid — subject-coloured blocks that span their real duration, sticky
day and hour rails, four server-side filters (niveau, matière, enseignant, salle) that combine,
a click-through to the group sheet, and a day-tab layout on a phone. The legacy
`day_of_week/start_time/end_time` columns are kept (nothing is dropped in V1) and mirrored from
the first day, so every older read path still works and pre-Phase 13 groups appear unchanged.

| The week on one grid | Days of the week in the group form | The same card, now multi-day |
| --- | --- | --- |
| ![Timetable](docs/screenshots/phase13-01-timetable.png) | ![Week editor](docs/screenshots/phase13-03-group-week.png) | ![Multi-day card](docs/screenshots/phase13-04-multiday-card.png) |

| Filters that combine (and an empty week) | Quick-create: days + “same hours” | Phone: one day at a time |
| --- | --- | --- |
| ![Empty state](docs/screenshots/phase13-02-empty-state.png) | ![Quick create days](docs/screenshots/phase13-06-quick-create-days.png) | ![Mobile](docs/screenshots/phase13-07-mobile.png) |

| Click a block → the group sheet | Arabic / RTL, Monday still on the left | …and the Arabic week editor |
| --- | --- | --- |
| ![Block detail](docs/screenshots/phase13-05-block-detail.png) | ![Arabic timetable](docs/screenshots/phase13-08-arabic.png) | ![Arabic week](docs/screenshots/phase13-09-arabic-week.png) |

| Frais du mois | New expense | Delete with confirmation |
| --- | --- | --- |
| ![Expenses page](docs/screenshots/phase11-01-expenses-page.png) | ![Expense modal](docs/screenshots/phase11-02-expense-modal.png) | ![Delete](docs/screenshots/phase11-04-delete-confirm.png) |

| Total Net on the dashboard | Expenses categories, in *Paramètres* | Frais, Arabic / RTL |
| --- | --- | --- |
| ![Net card](docs/screenshots/phase11-05-dashboard-net.png) | ![Categories](docs/screenshots/phase11-03-settings-categories.png) | ![Expenses AR](docs/screenshots/phase11-07-expenses-ar.png) |

| Zero net = break-even (amber) |
| --- |
| ![Break-even](docs/screenshots/phase11-06-dashboard-zero.png) |

| Fill the app with demo data (real window) | Confirmation (real window) | …then it is a full centre (real window) |
| --- | --- | --- |
| ![Demo button](docs/screenshots/demo-05-window-button.png) | ![Demo confirm](docs/screenshots/demo-06-window-confirm.png) | ![Seeded dashboard](docs/screenshots/demo-07-window-dashboard.png) |

| Seeded payments (real window) | A4 receipt, **release build** | Thermal receipt, **release build** |
| --- | --- | --- |
| ![Seeded payments](docs/screenshots/demo-08-window-payments.png) | ![Release A4](docs/screenshots/demo-10-release-receipt-csp.png) | ![Release thermal](docs/screenshots/demo-11-release-thermal-csp.png) |

| The same flow in the browser suite | …confirmation… | …and the seeded payments page |
| --- | --- | --- |
| ![Browser demo button](docs/screenshots/demo-01-settings-button.png) | ![Browser confirm](docs/screenshots/demo-02-confirm.png) | ![Browser payments](docs/screenshots/demo-04-payments.png) |

| Receipt — thermal 80 mm (real window) | Receipt — A4 (real window) | Receipt, Arabic / RTL (real window) |
| --- | --- | --- |
| ![Thermal receipt](docs/screenshots/receipt-tauri-01-thermal.png) | ![A4 receipt](docs/screenshots/receipt-tauri-02-a4.png) | ![Arabic receipt](docs/screenshots/receipt-tauri-03-arabic.png) |

| Dashboard (real window) | Payroll card | Previous period |
| --- | --- | --- |
| ![Dashboard](docs/screenshots/tauri-dashboard-01-overview.png) | ![Payroll](docs/screenshots/tauri-dashboard-02-payroll.png) | ![Previous month](docs/screenshots/tauri-dashboard-03-previous-month.png) |

| Dashboard, Arabic / RTL | Skeletons while loading | Phones (2 × 2 + 1 KPIs) |
| --- | --- | --- |
| ![Dashboard AR](docs/screenshots/tauri-dashboard-04-arabic.png) | ![Skeletons](docs/screenshots/dashboard-04-skeletons.png) | ![Mobile](docs/screenshots/dashboard-06-mobile.png) |

| First-run setup | Login (FR) | Locked session |
| --- | --- | --- |
| ![Setup](docs/screenshots/auth-tauri-01-setup.png) | ![Login](docs/screenshots/auth-tauri-06-login-reopen.png) | ![Lock](docs/screenshots/auth-tauri-03-lock-overlay.png) |

| Arabic / RTL login | 3 failures → countdown | Unlocked back to the same page |
| --- | --- | --- |
| ![Login AR](docs/screenshots/auth-tauri-08-login-ar.png) | ![Lockout](docs/screenshots/auth-tauri-07-lockout-countdown.png) | ![Unlocked](docs/screenshots/auth-tauri-05-unlocked-same-page.png) |

| Settings — centre | Levels & lycée branches | Backup |
| --- | --- | --- |
| ![Settings](docs/screenshots/tauri-settings-01-center-saved.png) | ![Levels](docs/screenshots/tauri-settings-04-branches.png) | ![Backup](docs/screenshots/tauri-settings-10-backup.png) |

**Années scolaires.** La version actuelle permet de créer et sélectionner une année,
ainsi que d’importer explicitement des élèves, groupes et enseignants depuis une autre année.
L’ancien assistant de rentrée et la page Bilan ont été retirés, y compris leurs commandes Rust.
Les descriptions et captures de ces fonctionnalités dans le journal historique ci-dessous
correspondent à des versions antérieures.

| The wizard, step 2 | Students to re-enroll | …and the result |
| --- | --- | --- |
| ![Rentrée groups](docs/screenshots/phase14-02-rentree-groups.png) | ![Rentrée students](docs/screenshots/phase14-03-rentree-students.png) | ![Rentrée result](docs/screenshots/phase14-05-rentree-result.png) |

| The recap before confirming | Arabic / RTL wizard |
| --- | --- |
| ![Rentrée recap](docs/screenshots/phase14-04-rentree-recap.png) | ![Rentrée AR](docs/screenshots/phase14-06-rentree-ar.png) |

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 (Rust) |
| UI | React 18 + TypeScript + Vite 5 |
| Styling | Tailwind CSS (design tokens, logical properties for RTL) |
| State | Zustand (`authStore`, `appStore`) |
| Routing | React Router 6 |
| i18n | react-i18next — `fr` (default) + `ar` (RTL) |
| Icons | lucide-react |
| Dates | date-fns |
| Database | SQLite via `rusqlite` (bundled), WAL mode |
| Passwords | `argon2` 0.5 (Argon2id) + `password-hash` 0.5 + `rand` 0.8 |

## Prerequisites (Windows)

1. **Node.js 18+** and npm.
2. **Rust** (stable, MSVC toolchain): https://rustup.rs — `rustup default stable-msvc`.
3. **Visual Studio Build Tools** with "Desktop development with C++" (Rust + bundled SQLite).
4. **WebView2 runtime** — pre-installed on Windows 10/11.

> `rusqlite` uses the `bundled` feature, so no system SQLite is needed.

## Getting started

```bash
npm install          # install frontend dependencies
npm run tauri dev    # build the Rust backend + launch the desktop window
npm run tauri build  # production installer (NSIS, French + Arabic)
```

**First launch** opens the setup screen (centre name + password, 4 characters minimum). Every following launch opens the login screen. The session auto-locks after 15 idle minutes by default.

Frontend-only preview (browser, no Tauri IPC — see *Browser development fallback*):

```bash
npm run dev          # http://localhost:1420
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 1420 |
| `npm run build` | `tsc` type-check + production bundle |
| `npm run tauri dev` | Desktop app in development with HMR |
| `npm run tauri build` | Windows NSIS installer (`CentreManager_1.1.0_x64-setup.exe`) |
| `npm run check:i18n` | Fails if a `t('key')` used in `src/` has no entry in `fr.json` / `ar.json` |
| `cargo test` (in `src-tauri/`) | 190 Rust tests (schema, WAL, FK, auth, throttle, settings, reference data, students, groups, enrollments, invoices, payments, teachers, compensation, activities, dashboard, late-payment count, backup, demo seed, the twenty edge cases) |
| `python3 tools/generate_icons.py` | Regenerate app icons (PNG/ICO/ICNS) |

## Project structure

```
centremanager/
├── tools/generate_icons.py        # brand mark -> src-tauri/icons/*
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                # builder, setup hook, command registration
│       ├── db/
│       │   ├── mod.rs             # init_db(), run_migrations(), get_connection(), Db state
│       │   └── schema.sql         # 17 CREATE TABLE statements
│       ├── models/mod.rs          # serde structs (money = i64 centimes)
│       ├── commands/
│       │   ├── mod.rs             # module list + shared db_err() helper
│       │   ├── auth.rs            # Argon2id auth, setup, lock timeout, throttling
│       │   ├── settings.rs        # key/value settings (password key is protected)
│       │   ├── school_years.rs    # school years, single active year (transactional)
│       │   ├── levels.rs          # levels + lycée branches, delete guards
│       │   ├── subjects.rs        # subjects CRUD + active toggle
│       │   ├── students.rs        # students CRUD, search/filters, audit trail
│       │   ├── groups.rs          # groups, capacity, group sheet, monthly summary (Phase 4)
│       │   ├── enrollments.rs     # enrollment workflow, due dates, first invoice (Phase 4)
│       │   ├── invoices.rs        # monthly generator, due dates, student balances (Phase 5)
│       │   ├── payments.rs        # oldest-first allocation, receipts, student finances (Phase 5)
│       │   ├── teachers.rs        # teachers CRUD, subjects, group list (Phase 6)
│       │   ├── compensation.rs    # per-teacher config, payroll maths, settlements (Phase 6)
│       │   ├── activities.rs      # daily activity log (Phase 6)
│       │   ├── dashboard.rs       # KPIs, échéances, recent payments (Phase 7)
│       │   └── backup.rs          # WAL checkpoint + file copy, DB info
└── src/
    ├── App.tsx                    # bootstrap, ProtectedRoute, routes
    ├── components/
    │   ├── auth/
    │   │   ├── LockScreen.tsx     # full-screen lock overlay
    │   │   └── LanguageToggle.tsx
    │   ├── layout/                # Sidebar, Header, AppLayout (idle timer + overlay)
    │   ├── dashboard/             # KpiCard (Phase 7)
    │   ├── students/              # StudentModal + Informations / Inscriptions / Finances tabs
    │   ├── groups/                # GroupModal, GroupDetailModal
    │   ├── enrollments/           # four-step EnrollmentModal
    │   ├── payments/              # PaymentModal, ReceiptPreviewModal, MoneyInput
    │   ├── print/                 # Phase 8: ReceiptA4, ReceiptThermal, receiptPdf, PDF viewer
    │   ├── teachers/              # config card, four tabs, SettlementModal, ActivityModal
    │   ├── settings/              # 8 section components + SettingsSection card
    │   ├── ui/                    # Button, Modal, Input, Select, Switch, Badge, Table, Card, Toast, ConfirmDialog
    │   └── ErrorBoundary.tsx      # Phase 8: per-route fallback card
    ├── hooks/
    │   ├── useIdleTimer.ts        # idle auto-lock
    │   ├── useLoginAttempts.ts    # 3 attempts -> 30 s countdown
    │   ├── useLockTimeout.ts      # live timeout value
    │   ├── useUnlockForm.ts       # shared login / unlock form logic
    │   ├── useKeyboardShortcuts.ts # Phase 8: Ctrl+K, Ctrl+L, Escape
    │   ├── useLatePaymentBadge.ts  # Phase 8: badge refresh (mount + 5 min + events)
    │   └── useDebounce.ts
    ├── pages/                     # 8 pages + LoginPage (setup + login)
    ├── services/
    │   ├── api.ts                 # typed invoke() wrapper
    │   ├── auth.ts                # typed auth commands (+ dev-only browser stub)
    │   ├── settings.ts            # typed settings/reference-data/backup commands
    │   └── settingsDevBackend.ts  # localStorage mirror for browser-only development
    ├── stores/                    # authStore, appStore
    ├── i18n/                      # index.ts, fr.json, ar.json
    ├── types/index.ts
    └── utils/
        ├── authErrors.ts          # localise backend messages
        ├── format.ts              # formatCurrency, formatDate, amountToCents…
        ├── schedule.ts            # group title + "Lundi 16:00–18:00" labels
        ├── billing.ts             # month/period labels, invoice statuses, todayIsoDate
        ├── compensation.ts        # payroll mode labels, statuses, totals
        ├── dashboard.ts           # long date, trends, collection-rate tone, alert wording
        └── lockTimeout.ts         # read/hydrate/write idle timeout
```

---

## Authentication & security (Phase 1)

### Threat model in one paragraph

V1 is a **single-admin, local-first** application: one password protects the UI of a desktop machine that is assumed to be physically controlled by its owner. The password hash is Argon2id, so an attacker who can copy `centremanager.db` cannot cheaply recover the password offline, and the app never stores or transmits the plaintext. This is *casual-access protection*, not protection against someone with filesystem access and time (see [Limitations](#limitations)).

### How the password is stored

| Item | Location |
| --- | --- |
| Password hash (Argon2id PHC string) | `settings` row `admin_password_hash` |
| Centre name | `settings` row `center_name` |
| Idle lock timeout (minutes, `0` = disabled) | `settings` row `lock_timeout_minutes` |

* Argon2id with the crate defaults (`m=19456 KiB`, `t=2`, `p=1`) and a random 16-byte salt generated from `rand::rngs::OsRng`.
* Stored value looks like `$argon2id$v=19$m=19456,t=2,p=1$…` — verified on a real setup run, the plaintext never appears in the database.
* The hash **never crosses the IPC boundary**: the frontend can only ask "is setup done?", "does this password match?" and "what is the centre name?".
* `isAuthenticated` is deliberately **not** persisted → closing the app always requires the password. `isSetup` is cached in `localStorage` only to avoid a UI flash; the database remains the source of truth (`bootstrap()` re-checks it on every start).

### Flows

| Situation | Behaviour |
| --- | --- |
| First launch (no `admin_password_hash`) | Setup card: centre name, password, confirmation. Inline validation, then `cmd_setup` → hashes → stores → dashboard |
| Normal launch | Login card titled with the centre name; `cmd_login` verifies with Argon2 |
| Wrong password | Inline red message + toast + shake animation (`0.3s`), attempt counter |
| 3 wrong passwords | Form disabled, visible countdown “Trop de tentatives. Réessayez dans XXs”, re-enabled after 30 s with the counter reset |
| Header 🔒 | `authStore.lock()` → overlay appears, no redirect, page stays mounted |
| 15 min idle (configurable) | `useIdleTimer` fires `lock()` → same overlay |
| Correct password on overlay | `cmd_verify_lock_password` → overlay disappears, **same page** as before |
| Password change (API only in this phase) | `cmd_change_password(old, new)` |

### Backend commands (`src-tauri/src/commands/auth.rs`)

| Command | Signature | Errors |
| --- | --- | --- |
| `cmd_check_setup` | `() -> Result<bool, String>` | DB error |
| `cmd_setup` | `(centerName: String, password: String) -> Result<(), String>` | centre name empty, password < 4 |
| `cmd_login` | `(password: String) -> Result<(), String>` | `Mot de passe incorrect` |
| `cmd_change_password` | `(oldPassword, newPassword) -> Result<(), String>` | `Ancien mot de passe incorrect`, password < 4 |
| `cmd_verify_lock_password` | `(password: String) -> Result<(), String>` | `Mot de passe incorrect` |
| `cmd_get_center_name` | `() -> String` | falls back to `CentreManager` |
| `cmd_get_lock_timeout` | `() -> i64` | falls back to `15` |
| `cmd_set_lock_timeout` | `(minutes: i64) -> Result<(), String>` | `0..=1440` |

JS arguments are camelCase and are mapped onto the snake_case Rust parameters by Tauri (`centerName` → `center_name`).

The last two commands are the only addition beyond the brief: the business rules require the timeout to live in `settings`, and the Phase 2 settings page needs a way to read/write it. They are dedicated (rather than a generic `get_setting`) so the password hash can never be requested from the frontend.

### Rate limiting — enforced twice

1. **UI** (`useLoginAttempts`): counter in form state, 3 failures → 30 s disabled state with countdown, reset on success or expiry. Shared by the login form and the lock screen.
2. **Backend** (`LOGIN_THROTTLE` in `auth.rs`): the same rule in Rust, because anything running in the webview can call `cmd_login` directly and skip the UI. Applies to `cmd_login`, `cmd_verify_lock_password` and the old-password check of `cmd_change_password`; during the cooldown even the correct password is rejected with `Trop de tentatives. Réessayez dans Xs`. A test asserts exactly that.

### Idle auto-lock

`useIdleTimer(timeoutMinutes, onLock, enabled)` — active only while `isAuthenticated && !isLocked`, resets on `mousemove`, `mousedown`, `keydown`, `scroll` and `touchstart` (throttled to one reset per second), cleans up listeners and timer on unmount, and `timeoutMinutes === 0` disables it entirely.

Precedence for the value: `localStorage.lock_timeout_minutes` → `settings.lock_timeout_minutes` → `15`. Supported options: 5 / 10 / 15 / 30 / 60 / disabled (`LOCK_TIMEOUT_OPTIONS` in `src/utils/lockTimeout.ts`; the Phase 2 settings page will call `writeLockTimeout`).

Test it from the devtools console:

```js
localStorage.setItem('lock_timeout_minutes', '1');    // 1 minute
localStorage.setItem('lock_timeout_minutes', '0.05'); // 3 seconds, handy for testing
localStorage.setItem('lock_timeout_minutes', '0');    // disabled
location.reload();
```

### Lock screen

`LockScreen` renders `fixed inset-0 z-50` with `bg-background/95 backdrop-blur`, so the sidebar and page are dimmed and unreachable while the routed page stays mounted underneath (`AppLayout` renders it when `isLocked`). Toasts are `z-[60]`, i.e. above the overlay but below future modals (`z-60+`). There is **no redirect** — unlocking restores the exact page.

### Changing the password

```js
await window.__TAURI__.core.invoke('cmd_change_password', {
  oldPassword: 'Test1234',
  newPassword: 'Nouveau123',
}); // -> undefined on success, throws "Ancien mot de passe incorrect" otherwise
```

The same command now backs the **Sécurité → Changer le mot de passe** modal on the Settings page (old password, new password ≥ 4 characters, confirmation).

### Error localisation

Rust messages are French (part of the command contract). `src/utils/authErrors.ts` maps the known ones (wrong password, no password configured, invalid centre name, short password, backend cooldown with its remaining seconds) onto i18n keys, so an Arabic session shows Arabic errors and a French session French ones; unknown messages fall back to the raw text.

### Browser development fallback

`npm run dev` in a plain browser has no Tauri IPC. So that the screens stay explorable, `src/services/auth.ts` contains a **development-only** stub (guarded by `import.meta.env.DEV && !isTauri()`) that keeps a SHA-256 digest in `localStorage`. It is never compiled into the desktop app's runtime path and is **not** a substitute for Argon2. Use `npm run tauri dev` for any real authentication testing.

### Limitations

* Single admin, no roles, no user accounts (V1 brief).
* The throttle is in-memory → it resets when the app restarts. It slows down interaction-level guessing, not an offline attack on the database file.
* No OS keychain / DPAPI binding of the hash, no session encryption at rest.
* Auth events are not yet written to `audit_log` (Phase 3 candidate: log setup, login failures, lock/unlock, password changes).
* Password change is API-only until the settings UI ships.

---

## Settings & reference data (Phase 2)

The Settings page (`src/pages/SettingsPage.tsx`) is a stack of eight collapsible
cards (`components/settings/SettingsSection.tsx`). Every section reads and writes
the real database and shows a toast on success or on the backend's French error
message.

| # | Section | What it does |
| --- | --- | --- |
| 1 | **Centre** | name / address / phone (saved together), logo picked with a file input, read as base64 and stored in `center_logo`; the sidebar header follows the saved name |
| 2 | **Année scolaire** | list ordered by start date (newest first), green “Active” badge, `Activer` button, inline “Nouvelle année” form (label + dates, end > start) |
| 3 | **Niveaux** | three groups — Primaire / Collège / Lycée — with inline rename, up/down ordering saved by `Enregistrer l'ordre`, delete with confirmation; each lycée level expands to its branch badges (`+ Branche`, `×` to delete) |
| 4 | **Matières** | table with an active switch, inline rename (Enter/blur), add form |
| 5 | **Langue** | two radio cards (🇫🇷 Français / 🇲🇦 العربية); applies RTL instantly and persists `language` |
| 6 | **Impression** | radio cards A4 vs Thermique 80mm → `receipt_format` |
| 7 | **Sécurité** | idle lock timeout select (0/5/10/15/30/60, default 15) and the change-password modal (old / new ≥ 4 chars / confirm) |
| 8 | **Sauvegarde** | DB path, size and last backup; `Sauvegarder` opens the native save dialog (default `centremanager_backup_YYYYMMDD.db`) then copies the DB; `Restaurer` opens an `.db` picker, warns that it replaces **all** data, then explains the manual swap (V1 has no in-app restore) |

### Backend commands

All 39 commands are registered in `src-tauri/src/main.rs`; the Phase 2 ones live in
`commands/{settings,school_years,levels,subjects,backup}.rs`. Each file exposes a
pure core function that takes `&Connection` so it can be unit-tested against an
in-memory database, plus a thin `#[tauri::command]` wrapper that pulls the
connection out of the `Db` state.

| Command | Notes |
| --- | --- |
| `cmd_get_all_settings`, `cmd_get_setting`, `cmd_set_setting` | `admin_password_hash` is filtered out of reads and refused on write |
| `cmd_get_school_years`, `cmd_create_school_year`, `cmd_set_active_year` | `set_active` clears the previous active year inside one transaction |
| `cmd_get_levels`, `cmd_create_level`, `cmd_update_level`, `cmd_delete_level` | delete is refused while a group references the level; deleting a level also deletes its branches |
| `cmd_get_branches`, `cmd_create_branch`, `cmd_delete_branch` | `level_id` is optional (all branches when omitted); delete refused while referenced |
| `cmd_get_subjects`, `cmd_create_subject`, `cmd_update_subject` | duplicate names rejected case-insensitively |
| `cmd_backup_db`, `cmd_get_db_info` | backup checkpoints the WAL (`TRUNCATE`), refuses to overwrite the live DB and writes through `fs::copy`; `db_info` reports path, size and `last_backup_date` |

`DB info` size includes the `-wal` sidecar: in WAL mode the main `.db` file can stay
at a few KB until a checkpoint, which made a busy database look empty.

### Seed data (idempotent)

`db::run_migrations()` runs `SCHEMA_SQL` then `seed_reference_data()`, guarded by a
`reference_data_seeded` row in `settings` — so a fresh install gets its reference
data once, and **user deletions are never resurrected**. Seeded content:

* **12 levels** — 6 primaire, 3 collège, 3 lycée (fixed ids 1-12)
* **15 branches** — 5 for each lycée level (Sciences Maths, Sciences Expérimentales,
  Sciences Économiques, Lettres et Sciences Humaines, Autre)
* **10 subjects** — Mathématiques, Physique-Chimie, SVT, Français, Arabe, Anglais,
  Philosophie, Histoire-Géographie, Économie, Informatique
* **1 school year** — `2024-2025` (2024-09-01 → 2025-06-30), active
* default settings — `currency=DH`, `language=fr`, `lock_timeout_minutes=15`,
  `receipt_format=a4`, `db_version=2`

Renames are preserved: the seeding step updates only rows it created and skips
anything the user changed (covered by the `seeding_preserves_user_edits` test).

---

## Student management (Phase 3)

Students are the first screen with real business data. Three pieces:
`pages/StudentsPage.tsx` (list), `components/students/StudentModal.tsx` (create +
edit) and `pages/StudentDetailPage.tsx` (record sheet, route `/students/:id`).

### The list

| Element | Behaviour |
| --- | --- |
| Header | `Élèves` + a badge with the number of students matching the current filters, `+ Nouvel élève` on the right |
| Search | name **or** phone, case-insensitive partial match (`LIKE %term%`), debounced **300 ms** — typing does not fire a query per keystroke |
| Niveau | `Tous les niveaux` + the 12 seeded levels |
| Statut | `Tous` / `Actifs` / `Inactifs`, **defaults to `Actifs`** |
| Table | Nom complet (+ `Père : …` underneath when set) · Niveau (`level_name — branch_name`, `—` when unset) · Téléphone (`06 07 12 34 56`) · Statut badge · Date inscription |
| Row click | navigates to the student's sheet (whole row is a button, keyboard accessible) |
| Loading | 5 skeleton rows, so the table never jumps |
| Empty | illustration + `Aucun élève trouvé`; when filters are active the copy changes to `Aucun élève ne correspond à ces filtres.` and a `Réinitialiser les filtres` button appears |
| Pagination | `Affichage 1-20 sur 25 résultats` + `Précédent` / `Page 1 sur 2` / `Suivant`, 20 rows per page; changing a filter returns to page 1 |

Query shape (`cmd_get_students`): a single statement with `LEFT JOIN levels` /
`LEFT JOIN branches`, every filter `AND`ed only when provided, `ORDER BY created_at DESC`,
`LIMIT ?/OFFSET ?` and a `COUNT(*)` with the same filters for `total`.

### The form

Two-column grid (Phase 10 layout): nom complet\* (full width) · **nom du père** · date de
naissance · téléphone\* · téléphone parent · niveau · branche (disabled until a level is
picked, then filtered to that level's branches) · **adresse maison** (textarea, full
width) · notes (textarea, full width). Validation is inline and runs on blur + on
submit, so the red message sits under the offending field; `Enregistrer` stays disabled
while the form is invalid or unchanged. Toasts: `Élève ajouté ✓` / `Élève modifié ✓`.
Phones are typed freely (`0607123456`, `06 07 12 34 56`, `06-07-12-34-56`) and grouped
on blur; validation always runs on the ten stripped digits (see *Phase 10*).

Only **nom complet** and **téléphone** are mandatory, which is what the "create with
required fields only" case requires; the other five columns accept `NULL` in the schema
and the UI renders `—`.

### The record sheet

Back arrow, name + status badge, `Niveau — Branche` under the title, and
`Modifier` / `Désactiver` (or `Réactiver`) on the right, both behind the standard
`ConfirmDialog` when they change state. Four tabs:

| Tab | Content |
| --- | --- |
| Informations | two-column definition list of every field (nom complet · nom du père · date de naissance · téléphone · téléphone parent · niveau · branche · adresse maison · notes) + `Inscrit le` / `Dernière modification`, phones rendered grouped in a `dir="ltr"` run |
| Inscriptions | empty state — filled in Phase 4 |
| Finances | empty state — filled in Phase 5 |
| Historique | timeline of `audit_log` (last 50, newest first): green dot = création, blue = modification, orange = changement de statut; the JSON payload is rendered as readable lines, ids resolved to level/branch names and dates formatted |

### Business rules enforced in Rust (`commands/students.rs`)

* **Students are never deleted** — `cmd_set_student_status` is the only way out, `actif` ↔ `inactif`.
* **Every mutation writes `audit_log`** (`entity_type = 'student'`): `CREATE` stores the
  full snapshot, `UPDATE` stores a diff `{"phone":{"from":…,"to":…}}` and is skipped
  entirely when nothing changed, `STATUS_CHANGE` stores `{"from":"actif","to":"inactif"}`.
* **Phone format** — `^0[67]\d{8}$`, applied to `phone` (required) and `parent_phone`
  (optional, but validated when present). `0123456789`, `061234567` and `0812345678`
  are all rejected; `0612345678` and `0712345678` are accepted.
* Names are trimmed and required; level/branch ids are validated to exist (a level with
  a branch from another level is refused).
* A level that is deleted **keeps its students** (`ON DELETE SET NULL`).

### Commands

| Command | Notes |
| --- | --- |
| `cmd_get_students(search, level_id, status, page, limit)` | `limit` clamped to 1…100, returns `{ items, total, page, limit }` |
| `cmd_get_student_detail(id)` | student + `enrollments: []` + `invoices: []` (Phases 4-5) + last 50 audit entries |
| `cmd_create_student(input)` | returns the new id, writes the `CREATE` audit row in the same transaction |
| `cmd_update_student(id, data)` | diff-based audit, no row when nothing changed |
| `cmd_set_student_status(id, status)` | `actif` / `inactif`, audited |

The browser development backend (`services/settingsDevBackend.ts`) implements the same
five commands over `localStorage` with four seeded students, so the whole screen can be
exercised in a plain browser without the desktop shell.

---

## Groups & enrollment (Phase 4)

The prepaid core of the app: a group is one scheduled class with a monthly fee
and a hard capacity, and enrolling a student immediately invoices the current
month.

| Groups grid (1/20, 1/15, 1/1 = complet) | Group sheet + financial summary | Validation, then "Groupe modifié ✓" |
| --- | --- | --- |
| ![Grid](docs/screenshots/tauri-groups-01-grid.png) | ![Sheet](docs/screenshots/tauri-groups-02-detail.png) | ![Edit](docs/screenshots/tauri-groups-03-edit.png) |

| Invalid time range | Enrollment summary (prepaid, no prorata) | Group full → checkbox disabled |
| --- | --- | --- |
| ![Validation](docs/screenshots/tauri-groups-02-validation.png) | ![Summary](docs/screenshots/tauri-enrollment-01-summary.png) | ![Full](docs/screenshots/tauri-enrollment-06-full-group.png) |

| Student tab — active enrollments | Terminated (collapsed) | Re-enrolled on the same row |
| --- | --- | --- |
| ![Tab](docs/screenshots/tauri-enrollment-02-tab.png) | ![Ended](docs/screenshots/tauri-enrollment-04-ended.png) | ![Reactivated](docs/screenshots/tauri-enrollment-05-reactivated.png) |

| Enroll from the group sheet | Arabic / RTL group grid |
| --- | --- |
| ![From group](docs/screenshots/tauri-enrollment-07-from-group-confirm.png) | ![RTL](docs/screenshots/tauri-groups-04-arabic.png) |

### The groups grid (`pages/GroupsPage.tsx`)

| Element | Behaviour |
| --- | --- |
| Header | `Groupes` + the number of groups in the selected year, the school-year filter (defaults to the **active** year) and `+ Nouveau groupe` |
| Cards | 1 / 2 / 3 columns. Subject — level (+ branch), teacher, weekly slot + room, `300.00 DH /mois`, `X/Y` and a capacity bar |
| Capacity bar | green below 70 %, amber 70-90 %, red at 90 % and above (computed from the live `enrolled_count`) |
| Card click | opens the group sheet |
| Empty | `Aucun groupe pour cette année scolaire` + a create button |

### The group form (`components/groups/GroupModal.tsx`)

Matière\*, Niveau\*, Branche (only for lycée levels, filtered by the level),
Enseignant (the active teachers of Phase 6, `Non assigné` when the list is
non-empty and `Aucun enseignant disponible` while nobody is active),
Année scolaire\*, Jour\*, Heure début\*, Heure fin\*, Salle,
Tarif mensuel\* (typed in DH, stored in centimes), Capacité\*. Inline errors for
every rule, including `L'heure de fin doit être après l'heure de début`,
`Le tarif doit être supérieur à 0` and `La capacité doit être au moins 1`.

### The group sheet (`components/groups/GroupDetailModal.tsx`)

Teacher / day / room / fee, the capacity bar, and the **current-month financial
summary**: `Théorique` (active enrollments × fee) versus `Encaissé`
(`SUM(paid_amount_cents)` of this month's invoices), with its own ratio bar.
Below it the enrolled students with a `Retirer` action (confirm dialog) and
`+ Ajouter élève`.

### The enrollment wizard (`components/enrollments/EnrollmentModal.tsx`)

Four steps, two entry points:

| | `from_student` (student sheet) | `from_group` (group sheet) |
| --- | --- | --- |
| Step 1 | the student is fixed; pick any number of groups (full ones are disabled and badged `Groupe complet`) | the group is fixed; search a student by name or phone |
| Step 2 | **one start date per group**, defaulted to today | one start date |
| Step 3 | summary table + monthly total + the prepaid / no-prorata notice | idem |
| Step 4 | confirmation → one atomic batch call | idem |

Groups the student is already active in never appear in step 1, which is the
first line of defence against duplicates (the backend refuses them too).

### Business rules

* **Prepaid, no prorata** — enrolling generates the invoice of the month of the
  start date for the **full** monthly fee, whatever the day.
* **Due date = the enrollment day**, clamped by `adjust_due_date()` when the day
  does not exist in a month: 31 Jan → 28 (29) Feb, 30 Jan → 28 (29) Feb,
  31 Mar → 30 Apr, 31 May → 30 Jun. (The first invoice lands in the enrollment
  month, so the clamp matters for the following months — Phase 5 — and is
  unit-tested on those exact cases.)
* **"d9a wehda" and "ayam mkhtalfa"** — the batch command wraps every enrollment
  and every invoice in a single transaction; one failure rolls the whole batch
  back. Dates are per group, so same-day and different-day enrollments both work.
* **Capacity** is checked before every insert: `enrolled_count < capacity`,
  otherwise `Groupe complet`.
* **Duplicate** → `Déjà inscrit dans ce groupe`. The schema has a plain
  `UNIQUE (student_id, group_id)`, so a student who left a group and comes back
  is **re-enrolled on the same row** (start date reset, `end_date` cleared) and
  the month's invoice is not duplicated (`invoice_created: false` in the audit).
* **Ending keeps the money** — `status = 'terminé'`, `end_date = today`, the
  current-month invoice is neither deleted nor refunded.
* Every mutation writes `audit_log` with `entity_type = 'group'` or
  `'enrollment'` (`CREATE`, `UPDATE` with a diff, `ENROLL`, `END_ENROLLMENT`).

### Commands

| Command | Notes |
| --- | --- |
| `cmd_get_groups(school_year_id?, status?)` | joins subjects/levels/branches/teachers, computed `enrolled_count`, school-week order then start time |
| `cmd_get_group_detail(id)` | group + enrolled students + this month's `financial_summary` |
| `cmd_create_group(data)` / `cmd_update_group(id, data)` | validation + audit (`UPDATE` stores a per-field diff, capacity can never drop under the enrolled count) |
| `cmd_get_teacher_options()` | the active teachers, for the form select (re-implemented on the Phase 6 tables) |
| `cmd_enroll_student(student_id, group_id, start_date)` | one transaction: enrollment + first invoice + audit |
| `cmd_enroll_student_batch(enrollments[])` | same logic for N groups, all-or-nothing |
| `cmd_end_enrollment(enrollment_id)` | `terminé` + `end_date`, invoice untouched |
| `cmd_get_student_enrollments(student_id)` | joined labels, newest first |
| `cmd_get_available_groups_for_student(student_id, level_id?)` | active groups minus the student's active enrollments |

## Invoicing & payments (Phase 5)

The billing engine of a prepaid centre: every active enrollment is turned into a
monthly invoice, and every dirham received is allocated to the **oldest unpaid
invoice first** — never spread by hand, never prorated. The **Payments page is
the primary place to record money**; the student sheet has the same modal one
click away and shows the resulting ledger.

| Collections tab, three sections | Payment modal, step 2 | Receipt (FR, real window) |
| --- | --- | --- |
| ![Collections](docs/screenshots/tauri-payments-01-late.png) | ![Invoices](docs/screenshots/tauri-payments-02-invoices.png) | ![Receipt](docs/screenshots/tauri-payments-03-receipt.png) |

| Student sheet → Finances | Amount field, focused | Partial payment receipt |
| --- | --- | --- |
| ![Finances](docs/screenshots/tauri-payments-04-student-finances.png) | ![Amount](docs/screenshots/tauri-payments-07-amount.png) | ![Partial](docs/screenshots/tauri-payments-08-receipt-partial.png) |

| Arabic / RTL payments page | Arabic / RTL student finances | What actually reaches the printer |
| --- | --- | --- |
| ![AR payments](docs/screenshots/tauri-payments-06-arabic.png) | ![AR finances](docs/screenshots/tauri-payments-05-arabic-finances.png) | ![Print](docs/screenshots/payments-11-print.png) |

### The payments page (`pages/PaymentsPage.tsx`)

| Element | Behaviour |
| --- | --- |
| Tabs | `💰 Encaissements` (default) and `👨‍🏫 Règlements enseignants` — the teacher payroll summary, see [Phase 6](#teacher-payroll-summary-payments-tab-2) |
| Month / year selects | default to the current month and reload the three sections on change |
| `Générer factures` | `cmd_generate_monthly_invoices`; toast `X factures générées ✓`, or `Aucune facture à générer pour cette période` — the button is safe to press twice |
| 🔴 En retard | overdue students, sorted by `days_late` **desc**, days past 7 shown in bold red |
| 🟡 Proches | due within the next 3 days (today included), sorted by the nearest due date first |
| 🟢 À jour | students whose invoices of the selected month are all paid this month |
| Sections | collapsible cards with a count badge (`2 élèves`) and a celebratory empty state (`Aucun élève en retard 🎉`) |
| Rows | name, phone, comma-separated groups, amount due, due date, days late and an `Encaisser` button that opens the modal already filled with that student |
| Loading | skeleton rows while the alerts are fetched |

### The payment modal (`components/payments/PaymentModal.tsx`)

Four steps, same component from the payments page and from `Enregistrer paiement`
on the student sheet:

| Step | Content |
| --- | --- |
| 1 · Élève | debounced name/phone search (skipped when a student is already fixed) |
| 2 · Factures | every unpaid invoice, **pre-checked**, with its period, group, amount, paid and remaining; the running `Total sélectionné`; `Suivant` stays disabled while nothing is selected |
| 3 · Paiement | the amount prefilled with the selected total (`MoneyInput`), inline `Paiement partiel — le reste sera dû le mois prochain` / `Le surplus sera enregistré comme avance`, the four methods (Espèces / Virement / Chèque / Autre, cash by default) and free-text notes |
| 4 · Confirmation | student, invoices, amount, method, notes and the remaining/advance line, then `Confirmer` or `Confirmer & Imprimer` → `cmd_create_receipt` + the receipt modal |

`MoneyInput` (`components/ui/MoneyInput.tsx`) is the only money field of the app:
it displays `300.00` with a `DH` suffix outside the input, shows the raw number
while focused so the caret does not sit after zeros, rejects anything but digits
and one decimal point, caps the decimals at two, and always hands centimes back
to the caller.

### Receipts

`cmd_create_receipt(payment_id)` numbers the receipt `REC-YYYYMMDD-XXXX` (XXXX =
number of receipts already issued that day + 1) and **freezes** the student name,
the amount, the date, the method and the groups at that moment in `receipts`.
Renaming the student or changing a group afterwards leaves the receipt intact;
only the centre name/address/phone/logo are read live from `settings`.

> Phase 8 replaced the HTML sheet of Phase 5 with a real PDF
> (`@react-pdf/renderer`, A4 or 80 mm thermal) previewed inline in the same modal
> — see [Receipt PDFs & UI polish](#receipt-pdfs-and-ui-polish-phase-8). The modal,
> its data source and the frozen snapshot are unchanged; the print path now goes
> through the PDF blob instead of `.receipt-print`.

### The student *Finances* tab (`components/students/StudentFinancesTab.tsx`)

Three summary cards (`Total dû` / `Total payé` / `Reste`), the invoice table
(period, group, amount, paid, remaining, status badge `Impayé` / `Partiel` /
`Payé`, with `(en retard)` next to an overdue due date) and the payment history
(date, method, amount, notes). No row of either table can be deleted — V1 has no
delete action anywhere.

### Business rules

* **Prepaid, full month, no prorata** — the generator always bills
  `groups.monthly_fee_cents`.
* **Due date = the enrollment day**, run through `adjust_due_date()` so a
  student enrolled on the 31st is due on the 28th (29th) of February and the
  30th of April.
* **Statuses derive from the amounts**, they are never set by hand:
  `impayé` (`paid = 0`), `partiel` (`0 < paid < amount`), `payé`
  (`paid >= amount`).
* **Oldest first** — the payment is allocated to the selected invoices sorted by
  `due_date ASC`; each row is capped by its remaining amount and the leftovers
  roll to the next invoice. Anything left over at the end is stored as an
  **advance**: one extra payment row with `invoice_id = NULL`.
* **One payment row per allocated invoice**, all sharing the same `created_at`,
  so the history reads like a ledger and the audit trail stays readable.
* **Nothing is deleted** — a wrong payment is corrected by recording another
  one, in V1.

### Commands

| Command | Notes |
| --- | --- |
| `cmd_generate_monthly_invoices(month, year)` | one invoice per `actif` enrollment, skips `(enrollment_id, month, year)` that already exist, returns the count, audits `GENERATE_INVOICES` |
| `cmd_get_student_invoices(student_id)` | joined subject/level/branch labels, newest period first, `remaining_cents` computed |
| `cmd_get_payment_alerts(month, year)` | the three sections: `late` / `upcoming` / `current`, with per-student totals and the earliest unpaid due date |
| `cmd_record_payment(student_id, invoice_ids, amount_cents, method, notes)` | one transaction: ownership check, oldest-first allocation, `paid_amount_cents` + status updates, advance row if needed, audit `PAYMENT` with the allocation detail |
| `cmd_get_payments_history(student_id?, month?, year?, page, limit)` | paginated ledger joined with the student name, newest first |
| `cmd_create_receipt(payment_id)` | frozen snapshot, `REC-YYYYMMDD-XXXX`, audit `RECEIPT` |
| `cmd_get_receipt_data(receipt_id)` | frozen fields + the centre block from `settings` (logo as base64) |

---

## Teachers, estimates and manual payments

The teacher directory and profile are scoped to the active academic year. The
profile has information, groups and payments tabs. There is no activity log.
Existing activity data is retained in the database for historical compatibility.

### Compensation estimates

The teacher's configuration remains on the information tab. Fixed monthly
amounts and percentages (including an optional bonus based on current groups'
theoretical revenue) are indicative estimates, not amounts automatically owed
or paid. Historical hourly and per-session configurations remain editable as
rates, but there is no automatic amount derived from an activity journal.

### Manual payments

From either the teacher's Payments tab or Payments → teacher payments, choose
**Enregistrer un paiement**. The single form asks for a positive amount, payment
date, method (cash, transfer or cheque) and an optional note. It works even when
no compensation is configured. The profile lists each payment's date, amount,
method and note and shows the active-year total. Like the previous settlement
flow, payment rows are immutable and are not deleted from the UI.

New payments carry an explicit active-school-year owner, independent of the
payment date. Legacy settlements remain unchanged and are shown in the year
identified by their payroll period only when the match is unique. Ambiguous or
undated historical rows are available separately on the teacher profile and are
excluded from yearly totals rather than assigned by guesswork. Year exports and
year deletion use the same ownership rules. The dashboard net result deducts
actual teacher payments by payment date, not compensation estimates.

Tauri commands: `cmd_set_compensation`, `cmd_create_teacher_payment`,
`cmd_list_teacher_payments`, and `cmd_list_unattributed_teacher_payments`.
The dev backend mirrors these commands; old activity data and settlement rows
are not removed by this change.

---

## Dashboard (Phase 7)

The home screen (`/`, `pages/DashboardPage.tsx`) answers one question in one
glance: *where is this month going?* Five numbers on top, then what has to be
chased, what has just come in, and what has been paid to teachers. Every card is a
shortcut to the screen that owns the data — an échéance opens the student sheet,
a payroll row opens the teacher sheet.

| Dashboard (real window) | Payroll card | Previous period |
| --- | --- | --- |
| ![Dashboard](docs/screenshots/tauri-dashboard-01-overview.png) | ![Payroll](docs/screenshots/tauri-dashboard-02-payroll.png) | ![Previous month](docs/screenshots/tauri-dashboard-03-previous-month.png) |

| Dashboard, Arabic / RTL | Skeletons while loading | Phones (2 × 2 + 1 KPIs) |
| --- | --- | --- |
| ![Dashboard AR](docs/screenshots/tauri-dashboard-04-arabic.png) | ![Skeletons](docs/screenshots/dashboard-04-skeletons.png) | ![Mobile](docs/screenshots/dashboard-06-mobile.png) |

| Empty centre | Tablet (3 + 2 KPIs, one column) |
| --- | --- |
| ![Empty](docs/screenshots/dashboard-05-empty.png) | ![Tablet](docs/screenshots/dashboard-07-tablet.png) |

### The five KPIs

A greeting with today's date written out (`Dimanche 1 novembre 2026`), a month
and a year selector, then:

| Card | Value | Comparison |
| --- | --- | --- |
| Élèves actifs | students with `status = 'actif'` | previous month = distinct students with an enrollment overlapping the previous month |
| Revenus du mois | `SUM(payments.amount_cents)` of the month, **cash received** | previous month revenue |
| Taux de recouvrement | `revenue / theoretical × 100`, 1 decimal — `1000.00 DH / 1050.00 DH` → `95.2 %` | none; the hint carries the ratio |
| Groupes actifs | groups with `status = 'actif'` | none |
| Enseignants | teachers with `status = 'actif'` | none |

```text
// commands/dashboard.rs — the period is the one chosen in the header
let revenue: i64 = payments of `month`/`year` …
let theoretical   = invoices of the period (tarif × inscrits, no prorata)
let rate = if theoretical > 0 { revenue as f64 / theoretical as f64 * 100.0 } else { 0.0 };
```

The rate is coloured at a glance: **green > 80 %**, **amber 50–80 %**, **red
below 50 %** (`utils/dashboard.ts::rateTone`, asserted in the browser run).

A trend is only shown when a comparison is meaningful: `+82 %` in green when the
month improved, `−70 %` in red when it fell, and a plain `—` when the previous
month was at zero — there is no honest percentage against a zero baseline
(`computeTrend` returns `percent: null`).

### Échéances — what to chase this week

Unpaid or part-paid invoices whose `due_date` falls in **today ± 7 days**, sorted
by due date, capped at 15 rows:

| Row | Severity | Colour |
| --- | --- | --- |
| `En retard de 3 jours` | `late` | red |
| `Demain` / `Dans 3 jours` | `upcoming` | amber |
| `Dans 5 jours` / `Dans 7 jours` | `ok` | muted |

The amount shown is the **remaining** amount (`amount_cents − paid_amount_cents`),
not the invoice total: after a 150.00 DH payment the 350.00 DH invoice reads
`200.00 DH`. The count badge in the card header is the number of rows. Clicking
a row opens `/students/:id`; *Voir tout* opens the payments page.

### Derniers paiements

The ten latest payments, newest first, with the student, the date, the method
badge (`Espèces` / `Chèque` / `Virement` / `Autre`) and the amount in green.
This list is **not** filtered by the selected period: it answers "what came in
recently", which is what the owner wants after a day at the desk.

### Paiements enseignants

The table shows teachers in the active school year and their actual payments
in the selected month. Select a row to open the teacher profile. The net KPI
also deducts actual payments, not the indicative compensation configuration.

### Period, loading, empty and error states

* The header selects drive **the KPIs and the payroll**; the échéances and the
  last payments are always "as of now" (`currentPeriod()` starts on the current
  month).
* On the first load the five cards, the three lists and the table render
  `.skeleton` shimmer blocks (`dashboard-kpi-skeleton` × 5).
* Changing the period **keeps the previous figures on screen** until the new
  ones arrive — no skeleton flash, no layout jump.
* An empty centre gets a real empty state per card (`Aucune échéance cette
  semaine 🎉`, `Aucun paiement récent`, `Aucun enseignant`) and zeros
  in the KPIs, with `0.0 %` in red and a `—` trend.
* The four commands run through `Promise.allSettled`: one failure shows a single
  toast (`Impossible de charger le tableau de bord — …`) and the cards that did
  answer are still rendered.

### Responsive

| Width | Layout |
| --- | --- |
| ≥ 1024 px | 5 KPIs in a row, then échéances (60 %) beside last payments (40 %), then the full-width payroll table |
| 768–1023 px | 3 + 2 KPIs, everything in one column |
| < 768 px | 2 × 2 + 1 KPIs, the icon bubble moves above the label so words never break mid-word, the sidebar collapses to its 72 px rail |

### Commands (`src-tauri/src/commands/dashboard.rs`)

| Command | Behaviour |
| --- | --- |
| `cmd_get_dashboard_kpis(month, year)` | `DashboardKPIs`; `Mois invalide (1 à 12)` / `Année invalide` outside the range, `rate = 0.0` when the period has no invoice |
| `cmd_get_dashboard_alerts()` | `AlertItem[]` — unpaid invoices due in ±7 days, `late` / `upcoming` / `ok`, remaining amount, due-date order, 15 rows max |
| `cmd_get_recent_payments(limit)` | `RecentPayment[]`, newest first, `limit <= 0` → `Limite invalide`, capped at 50, default 10 |

All three are read-only and share the `db_err("Lecture du tableau de bord" | "Lecture des échéances" | "Lecture des derniers paiements", …)` messages; 15 Rust tests cover the month boundaries, the invoice statuses, the ±7-day window and the severities, the remaining amounts, the ordering, the limits and the previous-month comparisons.

---

## Receipt PDFs and UI polish (Phase 8)

Phase 5 printed its receipt as **HTML in a modal**. Phase 8 replaces that with a
real **PDF** the centre can keep, mail or reprint years later, and finishes the
interface: nothing in the app may crash the window, close a modal in one
keystroke, or hide a late payment.

### Two templates, one document

| | `ReceiptA4.tsx` | `ReceiptThermal.tsx` |
| --- | --- | --- |
| Page | A4, **595.28 × 841.89 pt**, 20 mm margins (57 pt) | **226 pt** wide (80 mm), height follows the content (≈ 151 pt for one period) |
| Font | Helvetica (regular / bold) | Courier (regular / bold) — monospace, like a till roll |
| Header | base64 logo ≤ 60 × 60, centre name 18 pt bold centred, address 10 pt grey, phone 10 pt grey | centre name 10 pt bold, phone 7 pt grey, `REÇU` 8 pt, receipt number and date 7 pt |
| Rules | 1 pt `#E2E8F0`, full width | dashed 1 pt `#64748B` — a `View` with `borderStyle: 'dashed'` |
| Title | `REÇU DE PAIEMENT` 14 pt bold centred, a `N°: REC-…` / `Date: DD/MM/YYYY` row under it | — |
| Body | `Élève` / `Groupe(s)` / `Période` 11 pt; `Montant payé` 10 pt grey, amount 20 pt bold **#2563EB**, `Mode:` 10 pt | `Élève` 8 pt, `Groupe(s)` / `Période` 7 pt, `TOTAL: … DH` 10 pt bold centred, `Mode:` 7 pt |
| Footer | `Merci de votre confiance` + centre name, 9 pt grey | `Merci !` 8 pt |

Both templates are pure functions of a **flat, pre-formatted payload**
(`receiptLabels.ts::ReceiptDocumentData`): the modal translates the labels and
formats the amounts *outside* React, because `@react-pdf/renderer` renders with
its own reconciler, where hooks and i18next are not reachable. Everything is
null-safe: no logo, no phone, no groups or no period simply removes the block.

```tsx
// receiptPdf.tsx — the library is ~1.2 MB, so it is only imported on demand
const [{ pdf }, templateModule] = await Promise.all([
  import('@react-pdf/renderer'),
  template === 'a4' ? import('./ReceiptA4') : import('./ReceiptThermal'),
]);
return pdf(<Document data={data} labels={labels} />);
```

The dynamic import gives Vite a separate `react-pdf.browser-*.js` chunk, so the
app shell keeps its size (`index-*.js` 550.34 kB, 153.60 kB gzip).

### Two layout traps worth knowing

Both were found by printing real receipts, not by reading the docs:

| Trap | Symptom | Fix |
| --- | --- | --- |
| `size={{ width: 226, height: 'auto' }}` + `wrap={false}` | the auto height is measured **once**: a value that wraps (three periods in `Période`, three groups in `Groupe(s)`) is drawn on top of the next block instead of pushing it down — `TOTAL` and `Mode` overlap | the values are split into single-line chunks by `wrapValue()` (`Courier` is monospace, so 39 characters at 7 pt / 34 at 8 pt fit exactly) and each chunk gets its own `View`; the page then grows to 215 pt for a two-line period, without overlap |
| two text expressions side by side | `New York` + `Espèces` was rendered as `New YorkEspèces` — the separator lived in a *different* text node and the bidi run swallowed it | one template literal per line: `` `${labels.method} ${data.methodText}` `` (and the same for the Arabic student line in `PaymentModal`) |

`tools/p8-pdf-check.py` prints `{pages, width_pt, height_pt, title, images,
text}` for a PDF; `pdfplumber` was used once by hand to assert that no two text
lines overlap and that nothing is drawn below the MediaBox.

### `ReceiptPreviewModal` (upgraded, not rebuilt)

| Element | Behaviour |
| --- | --- |
| `PDFViewer` | inline, `width: 100%`, `height: 400 px` (`PDF_HEIGHT`), wrapped in an error boundary + suspense; `receipt-loading` while the document renders, `receipt-error` with `Imprimer` / `Télécharger` still available |
| Toggle | 80 mm, 58 mm, A5 ou A4, appliqué sans recharger le reçu |
| Default template | 80 mm pour une nouvelle installation ; le format existant est conservé. Le choix peut être modifié dans Paramètres ou à l'ouverture du reçu. |
| `Télécharger PDF` | `downloadReceiptPdf()` → `recu_REC-20261101-0001.pdf` |
| `Imprimer` | `printReceiptPdf()` opens the blob in its own window (`window.open(url, '_blank')`, **no** `noopener` — the handle is needed for `print()`), with a hidden-iframe fallback |
| `Fermer` | fermeture explicite par le bouton ou la croix ; ni clic extérieur ni Échap |
| `receipt-summary` | `REC-… · 700.00 DH` in the header, plus the periods in the footer |
| Data | **frozen at issuance**: the PDF is built from the `receipts` row, so renaming the student afterwards leaves the old receipt untouched |

`PDFViewer` renders the document in place (it owns its own blob); *Télécharger*
and *Imprimer* build a **second** blob through `buildReceiptPdf()`, revoked after
10 s (download) and 60 s (print) — long enough for the browser to consume it.

### Arabic

The receipt PDF in Arabic is a **known V1 limitation, and it is worse than
"imperfect"**: Helvetica/Courier use WinAnsi, so Arabic labels are not shaped —
they are *not representable* and fall back to garbage glyphs (`REÇU` renders as
`D'5] %`). Fixing it needs a font with Arabic glyphs **and** a bidi/shaping
engine, which `@react-pdf/renderer` does not have; that is V2 work. V1 therefore:

* strips the bidi isolates (`U+2066–U+2069`) from every value and falls back to
  Helvetica when the requested font is missing;
* renders the PDF regardless (no crash, no blank viewer);
* shows the amber note `receipt.arabicLimitation` at the top of the modal
  (`receipt-arabic-note`): *"L'impression PDF en arabe est limitée en V1 : les
  caractères arabes peuvent manquer. Utilisez l'impression thermique pour les
  reçus rapides, ou le format A4 en français."*

The rest of the modal stays fully translated and RTL-mirrored; only the paper
is affected. In practice: print a receipt in French.

### Print CSS

The existing `@media print` block in `src/index.css` is kept and extended: only
the PDF (`iframe`, `embed`, `object` pointing at the blob) is printed, everything
else — sidebar, header, modal chrome, buttons, toasts — is `display: none`. The
`.modal-backdrop` loses its blur and its background so the paper stays white.
The `Imprimer` button does not rely on it (it prints the PDF in its own window),
but `Ctrl+P` from the preview now produces the same clean sheet.

### Error boundary (`components/ErrorBoundary.tsx`)

A class component wrapping **each route** in `App.tsx` (`key="students"`,
`key="payments"`… 9 scopes). It catches render and lifecycle errors, logs them
with `console.error`, and renders a card with `⚠️`, `error.title`
(`Une erreur est survenue`), `error.message`, the technical message **in
development only** (`error-boundary-detail`) and a `Recharger` button
(`error-boundary-reload`). The shell — sidebar, header, language — stays usable,
and navigating to another route mounts a *fresh* boundary: the `key` is what
stops a caught error from poisoning every later page. `/__error` (dev only,
`DevCrashPage.tsx`) throws on purpose so the fallback can be verified.

### Keyboard shortcuts (`hooks/useKeyboardShortcuts.ts`, mounted in `App.tsx`)

| Keys | Effect |
| --- | --- |
| `Ctrl/Cmd + K` | dispatches `focus-search`; the students page focuses `students-search` (and selects the text) |
| `Ctrl/Cmd + L` | `authStore.lock()` with `preventDefault()` (the browser's address bar never wins) |
| `Escape` | ne ferme pas les fenêtres modales ; utiliser Annuler ou la croix |

Shortcuts are ignored while a `Ctrl`/`Cmd` combination targets an input in a
native text field, except the two above.

### Micro-interactions (`src/index.css`)

| Class | Effect |
| --- | --- |
| `.btn-press` | `transform: scale(0.97)` on `:active` — every `Button` |
| `.modal-enter` / `.modal-exit` | `modalIn` / `modalOut` keyframes (opacity + 10 px rise + 0.95 scale), 200 ms in / 150 ms out |
| `.tab-indicator` | 2 px primary underline sliding under the active tab (student and teacher sheets); `transform-origin` flips in RTL |
| `.badge-alert` | `pulse-red` — a 2 s halo on the sidebar badge |

`prefers-reduced-motion: reduce` disables all four.

### Sidebar badge — the one place the spec had to move

The late-payment badge on *Paiements* is `appStore.latePaymentCount`, refreshed
by `useLatePaymentBadge` on mount, every **5 min**, and on the
`late-payments:refresh` event (payment recorded, invoices generated). It is
hidden at `0`, shows `9+` above 9, and pulses.

> **Deviation, on purpose.** The plan was to count `cmd_get_payment_alerts(...).late`
> of the current month. In the real window that badge stayed **invisible** while
> the dashboard showed three late invoices: `payment_alerts` is *month-scoped*,
> and on 1 November the November invoices are due on the 30th — the overdue ones
> belonged to October. A badge that says "nothing to chase" while the dashboard
> says "3 late" is a bug, so Phase 8 added **`cmd_get_late_payment_count`**: every
> unpaid or part-paid invoice whose `due_date` is before today, **across all
> periods** (the same rule as the dashboard échéances, minus the ±7-day window).
> It reads `3` on the demo database, `2` after a payment, and disappears when
> nothing is late. The Payments page itself stays month-scoped — switch the month
> to collect an older period.

### Toasts

`useToastStore` keeps at most **3** visible toasts (`MAX_VISIBLE_TOASTS`), the
oldest dropped first; success 3 s, info 4 s, error 5 s, warning manual (sticky,
`duration: 0`). The container sits **bottom-right** in LTR and **bottom-left** in
RTL. Every mutation (payment, settlement, activity, CRUD, backup, settings) shows
one; failures show the backend message after a localized prefix.

### Empty states

Audited screen by screen: students (no data / no search result), groups, group
sheet, teachers, activities, settlements, invoices, payments (three buckets),
dashboard (four cards), student sheet (four tabs). **No gap was found** — the
student *Finances* tab already rendered `Aucune facture` / `Aucun paiement`
(`student.noInvoices*` / `student.noPayments*`), so Phase 8 added none and only
kept the existing ones intact.

### i18n

`fr` and `ar` both hold **579** keys; `npm run check:i18n` reports
`579 keys used, all present` for both languages. Phase 8 added
`receipt.downloadPdf`, `receipt.printPdf`, `receipt.arabicLimitation`,
`receipt.templateA4`, `receipt.templateThermal`, `error.title`, `error.message`,
`error.reload`, `keyboard.search`, `keyboard.lock`, `sidebar.latePayments`.

### Commands & dev backend

| Command | Where | Notes |
| --- | --- | --- |
| `cmd_get_late_payment_count()` | `commands/invoices.rs` (new) | `i64`; overdue unpaid/part-paid invoices across all periods; 1 Rust test (`late_count_spans_every_period`) |
| `cmd_get_payment_alerts(month, year)` | unchanged | month-scoped, used by the Payments page |
| `cmd_get_setting('receipt_format')` | unchanged | default template of the modal |

The browser dev backend (`settingsDevBackend.ts`) implements the new command on
the localStorage mirror, so the badge works with `npm run dev` too.

Test ids added for automated checks: `payment-collect` (Encaisser),
`payment-next`, `payment-confirm`, `payment-confirm-print`, alongside the Phase 8
`sidebar-late-badge`, `error-boundary*`, `receipt-*` and `lock-screen` ids.


---

## Groupes et emploi du temps

La création d'un groupe demande son nom, sa matière, son niveau, son tarif et
éventuellement son professeur. La capacité des nouveaux groupes est fixée à
200 élèves ; celle des groupes existants est conservée. Les horaires se gèrent uniquement depuis
**Emploi du temps → Gérer les horaires** : choisissez un groupe, ajoutez ou
supprimez ses créneaux et indiquez la salle de chaque créneau. La structure
actuelle accepte un créneau par groupe et par jour. Les anciens groupes sans
nom conservent leur libellé matière/niveau.

Les reçus proposent les tickets 80 mm et 58 mm (hauteur automatique), A5 et A4.
Les fenêtres modales ne se ferment ni par clic extérieur ni par Échap.

## Frais d'inscription annuels

Le montant est défini dans la fiche de chaque élève, en DH (0 par défaut).
Il est conservé pour les inscriptions futures, y compris lors d'un changement
d'année. Modifier le montant ne modifie pas les factures déjà émises ; une
décision à 0 lors de la première inscription reste valable pour cette année. À la
première inscription dans un groupe, une facture indépendante du groupe est
créée une seule fois pour l'élève et l'année. Elle peut être réglée en totalité
ou partiellement avec les autres factures ; elle apparaît séparément sur la
fiche élève, le reçu et l'export des paiements (`invoice_kind`). Les encaissements
alimentent le tableau de bord comme les autres paiements. La création en lot est
transactionnelle et la suppression d'un groupe ne supprime pas les frais.

## Demo data, edge cases and packaging (Phase 9)

V1.1 is about trust: a centre owner must be able to **try** the app before entering a
single real student, every awkward real-life case must behave, and the installer must be
the exact one the specification asks for.

### Demo fixtures (tests only)

The Settings demo button and its command have been removed. The Rust demo
fixture remains available only to unit tests; reference-data seeding is unchanged.

### The twenty edge cases

Every case has an automated test; the ones that are UI-observable also have a browser
assertion. `src-tauri/src/commands/edge_cases.rs` holds the Rust half (14 tests that walk
the real command functions on a migrated database).

| # | Case | Expected | Tested in | Result |
| --- | --- | --- | --- | --- |
| 1 | Enrollment on the 31st, invoice for February (28 days) | due date clamps to `2025-02-28` | `due_dates_clamp_to_the_end_of_the_month_and_handle_leap_years` | ✅ |
| 2 | Same, leap year | `2024-02-29` | idem + `a_thirtieth_of_february_does_not_exist_and_clamps_every_year` | ✅ |
| 3 | Enrollment on the 30th, 31-day month → 30-day month | `2025-04-30` | idem | ✅ |
| 4 | 31 May → June | `2025-06-30` | idem | ✅ |
| 5 | December → January | next year, same day | idem | ✅ |
| 6 | Century year that is not a leap year | `2100-02-28` | `a_thirtieth_of_february…` | ✅ |
| 7 | Payment larger than the invoice | invoice `payé`, the surplus stored as an **advance** row (`invoice_id IS NULL`) | `overpayment_is_stored_as_an_advance_row` | ✅ |
| 8 | Zero or negative amount | refused, *« Le montant doit être supérieur à 0 »*, nothing written | `a_zero_payment_is_rejected_with_the_documented_message` | ✅ |
| 9 | Three partial payments | `partiel` → `partiel` → `payé`, no advance | `partial_payments_accumulate_until_the_invoice_is_paid` | ✅ |
| 10 | Two groups, one fee paid | oldest invoice settled, the other untouched, the student still owes 600 DH | `paying_one_groups_fee_only_settles_the_oldest_invoice` | ✅ |
| 11 | Same group enrolled twice | *« Déjà inscrit dans ce groupe »* **and** the `UNIQUE (student_id, group_id)` index refuses a raw `INSERT` | `the_same_group_twice_is_refused_by_the_app_and_by_the_database` | ✅ |
| 12 | Group at capacity | *« Groupe complet »*; a seat freed by ending an enrollment becomes usable again | `a_full_group_refuses_the_next_student` | ✅ |
| 13 | Enrollment ended mid-month | the current invoice stays, the next month generates nothing, the invoice is still payable | `ending_mid_month_keeps_the_current_invoice_and_creates_no_next_one` | ✅ |
| 14 | Re-enrolling in a group already left | the same enrollment row is **reactivated** (documented behaviour, forced by the `UNIQUE` pair): new start date, empty end date, a new invoice, two `ENROLL` rows in `audit_log` | `re_enrolling_reactivates_the_same_row_instead_of_duplicating_it` | ✅ |
| 15 | Arabic student name in the French UI | stored, searchable, no horizontal overflow in the table, shown on the student sheet | browser (`edge-01-arabic-name.png`) | ✅ |
| 16 | Phone number inside the Arabic UI | rendered as an LTR run, digits unchanged, separator inside the run | browser (`edge-02-rtl-phone.png`) | ✅ |
| 17 | Deleting a level a group uses | refused, *« utilisé par N groupe(s) »*, level kept | `a_level_used_by_a_group_cannot_be_deleted` | ✅ |
| 18 | Teacher deactivated while teaching | groups still list the teacher, enrollment and invoicing still work, no error boundary | `deactivating_a_teacher_keeps_the_groups_readable` | ✅ |
| 19 | Backup, delete, restore | the file comes back whole: students, enrollments, invoices, payments and the invoice status | `a_backup_restores_the_data_after_a_deletion` | ✅ |
| 20 | Double click on *Confirmer* | exactly one payment (the button is disabled while `saving`) | browser (`expectedCents` == amount recorded) | ✅ |

### What Phase 9 fixed

| Defect | Fix |
| --- | --- |
| The demo pattern *« 5 paid + 2 half + 3 unpaid »* produced a **77 %** collection rate: a half fee paid in two instalments was counted twice, so the demo centre did not look like the specification's ~60 % | the pattern became `0–3` full / `4–5` half **split in two instalments** / `6–9` nothing, and the test guard was tightened to `0.5..=0.7` (measured **0.591**) |
| Demo groups were priced 200–400 DH with 12–20 seats | re-priced **200–500 DH**, **10–20 seats**, and the browser mirror follows |
| The demo button **reloaded the window**, which logged the owner out and dropped the page they were on | the reload is gone: the pages refetch on mount and the badge is nudged with the existing `late-payments:refresh` event, so the session and the current page survive |
| The specification's CSP has no `script-src`, so the receipt preview was **blank in the release build** (pdf.js needs `eval`) while it looked perfect in `tauri dev` | `script-src 'self' 'unsafe-eval' blob:` + `worker-src`/`child-src`/`frame-src blob:` added, then verified by opening an A4 **and** a thermal receipt in the release binary |
| Changing the identifier in V1.1 (part of the packaging spec) **moves the app-data folder** — every V1.0 centre would have opened on the *setup* screen | `db::migrate_legacy_data_dir()` copies `ma.centremanager.desktop/centremanager.db` (plus `-wal` / `-shm`) into the new folder once, without touching the old one; verified with the real binary (`base V1.0 migrée depuis …`, then the V1.0 centre name on the login screen and its 15 students on the dashboard) |

### Packaging — `src-tauri/tauri.conf.json`

| Field | V1.0 | V1.1 (specification) |
| --- | --- | --- |
| `version` | `0.1.0` | **`1.1.0`** (also in `package.json`) |
| `identifier` | `ma.centremanager.desktop` | **`com.centremanager.app`** |
| window `title` | `CentreManager` | **`CentreManager V1.1`** |
| window size / minimum | 1280 × 820 / 1024 × 700 | **1280 × 800 / 900 × 600**, centred |
| `app.security.csp` | `null` | see below |
| `bundle.targets` | `["nsis", "msi"]` | **`["nsis"]`** |
| `bundle.windows.nsis` | `installMode: perMachine` | **`currentUser`**, `languages: ["French", "Arabic"]`, `displayLanguageSelector: true`, `headerImage: null`, `sidebarImage: null` |

The production CSP, and why each exception is there:

```
default-src 'self';
img-src     'self' data: blob:;                          /* logo, PDF page bitmaps */
font-src    'self' data: https://fonts.gstatic.com;
style-src   'self' 'unsafe-inline';                      /* Tailwind inline styles */
script-src  'self' 'unsafe-eval' blob:;                  /* the pdf.js viewer */
worker-src  'self' blob:;                                /* the pdf.js worker */
frame-src   'self' blob:;                                /* the receipt PDFViewer iframe */
child-src   'self' blob:;
connect-src 'self' ipc: http://ipc.localhost blob: data:;
```

Each line was earned, not guessed — this is what the release binary proved:

| Directive | Removing it breaks |
| --- | --- |
| `connect-src ipc: http://ipc.localhost` | **everything**: the webview can no longer reach the Tauri 2 IPC endpoint, so no command runs (the app would sit on empty screens) |
| `script-src 'unsafe-eval'` | the **receipt preview**: `pdf.js` compiles its font/CFF code with `eval`, so the viewer iframe stays a blank white box — found exactly this way in the release build (dev mode hid it, because `devCsp` is looser) |
| `script-src blob:` + `worker-src blob: + child-src blob:` | the viewer's own bootstrap and its worker, both loaded from `blob:` URLs |
| `frame-src blob:` | the `PDFViewer` iframe itself |
| `img-src blob:` | the rendered PDF pages (and the centre logo, `data:`) |
| `font-src https://fonts.gstatic.com` | any webfont; kept because the specification asks for it |

The specification's literal CSP (`default-src 'self'; img-src …; style-src …; font-src …`)
has **no `script-src`**, so it falls back to `default-src 'self'` and the receipt preview is
blank in production while fine in development. The directives above are that CSP plus the
minimum the PDF viewer needs, and they are verified by rendering a receipt **in the release
binary** (A4 and thermal, screenshots below). A separate `devCsp` adds Vite's HMR websocket
and its inline preamble; everything else is identical.

| Release binary, A4 receipt (production CSP) | Same, thermal 80 mm | Same in `tauri dev` (dev CSP) |
| --- | --- | --- |
| ![Release A4](docs/screenshots/demo-10-release-receipt-csp.png) | ![Release thermal](docs/screenshots/demo-11-release-thermal-csp.png) | ![Dev receipt](docs/screenshots/demo-09-window-receipt-csp.png) |

The eight packaging points were verified in the key order that makes a miss obvious: window
title and size read back from the real window (`xdotool getwindowname` →
`CentreManager V1.1`, `getwindowgeometry` → `1280x800`), the CSP exercised by opening a
receipt (the PDF renders — screenshot above), and the database path printed by the app
(`…/com.centremanager.app/centremanager.db`).

---

## Database

The SQLite file is created on first launch in the OS app-data directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\ma.centremanager.desktop\centremanager.db` |
| macOS | `~/Library/Application Support/ma.centremanager.desktop/centremanager.db` |
| Linux | `~/.local/share/ma.centremanager.desktop/centremanager.db` |

Every connection is opened with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`. `run_migrations()` executes `schema.sql` (embedded with `include_str!`), so the schema is applied — idempotently — on every launch.

### The 19 tables

`settings`, `school_years`, `levels`, `branches`, `subjects`, `students`, `teachers`, `teacher_subjects`, `groups`, `group_schedules` (Phase 13), `enrollments`, `invoices`, `payments`, `receipts`, `teacher_activities`, `teacher_compensation`, `teacher_settlements`, `monthly_expenses` (Phase 11, `expense_date` since Phase 15), `audit_log`.

`group_schedules(group_id, day_of_week, start_time, end_time)` is `UNIQUE(group_id, day_of_week)`
and cascades on delete. `groups.day_of_week/start_time/end_time` stay in the table — V1 never drops
a column — and are kept equal to the **first** day of the week by the backend, so receipts, exports
and any older query keep reading a sensible slot.

Money is always `i64` **centimes**. `center_name` and `admin_password_hash` are deliberately **not** seeded: their absence is what triggers the first-launch setup screen.

## Frontend architecture

### Routing & protection

| Route | Page | Shell |
| --- | --- | --- |
| `/login` | `LoginPage` (setup card on first launch, then login card) | none |
| `/`, `/students`, `/students/:id`, `/groups`, `/timetable`, `/teachers`, `/payments`, `/expenses`, `/settings` | page shells | `ProtectedRoute` → `AppLayout` (Sidebar + Header + `<Outlet/>`) |

`ProtectedRoute`: `!isSetup` → `/login`; `!isAuthenticated` → `/login`; `isLocked` → **no redirect**, the overlay is rendered over the still-mounted route.

### `authStore`

```ts
interface AuthState {
  isAuthenticated: boolean;   // memory only — never persisted
  isLocked: boolean;
  isSetup: boolean;           // false = first launch, show setup
  centerName: string;
  initialized: boolean;       // DB consulted (avoids flashing the wrong screen)
  bootstrap(): Promise<void>;
  login(): void;
  logout(): void;
  lock(): void;
  unlock(): void;
  setSetupDone(): void;
  setCenterName(name: string): void;
}
```

`App` awaits `bootstrap()` (`cmd_check_setup` + `cmd_get_center_name`) behind a splash screen before rendering routes.

### Layout & RTL

`AppLayout` renders `dir="rtl"` when the language is Arabic; the flex shell then puts the 250px sidebar on the **right**. Styling uses logical utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `border-e`). Fonts switch in `index.css`:

```css
html[dir='ltr'] { font-family: 'Inter', sans-serif; }
html[dir='rtl'] { font-family: 'Noto Sans Arabic', sans-serif; }
```

### Design tokens

`primary #2563EB`, `foreground #0F172A`, `background #F8FAFC`, `border #E2E8F0`, `success #16A34A`, `warning #D97706`, `destructive #DC2626`, `muted #64748B`. Type scale: h1 24/p600, h2 20/p600, body 14/p400, labels 13/p500 muted, buttons 14/p500. Card/button/badge classes live in `src/index.css`; the `shake` keyframes and `.animate-shake` are used by the login and lock forms (and disabled under `prefers-reduced-motion`).

### Formatting helpers

```ts
formatCurrency(15000);        // "150.00 DH"
formatDate('2025-01-15');     // "15/01/2025"
amountToCents('150,50');      // 15050
```


---

## Build & Distribution (Windows)

V1.1 ships as a **single Windows installer** built by Tauri 2 with NSIS. Everything below
runs on the developer's Windows machine; no build server is involved.

### Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Windows | 10 or 11 (x64) | target of the NSIS installer |
| Node.js + npm | 18 LTS or newer | Vite, `tsc`, the Tauri CLI |
| Rust | stable **MSVC** toolchain (`rustup default stable-msvc`) | compiles the backend and the bundled SQLite |
| Visual Studio Build Tools | *Desktop development with C++* workload | MSVC linker, Windows SDK |
| WebView2 runtime | any recent build | pre-installed on Windows 10/11; the app is a WebView2 shell |
| NSIS | downloaded automatically by Tauri | the `nsis` bundle target |

```powershell
git clone <repository> centremanager
cd centremanager
npm install
```

### Build

```powershell
npm run tauri build
```

Tauri runs `npm run build` first (`tsc --noEmit` then `vite build`), compiles the Rust
backend in release mode (`cargo build --release`), then bundles the installer. A cold build
takes 5–10 minutes; the following ones take under a minute.

### Output

```
src-tauri\target\release\bundle\nsis\
└── CentreManager_1.1.0_x64-setup.exe
src-tauri\target\release\centremanager.exe      # the app itself, runnable as-is
```

| Artifact | Size |
| --- | --- |
| `CentreManager_1.1.0_x64-setup.exe` | ~4–6 MB (WebView2 is **not** embedded: it is pre-installed on Windows 10/11) |
| `centremanager.exe` + `dist` assets embedded | ~10–12 MB |
| Front-end bundle compiled into the exe | **shell ≈ 154 kB gzip** + the lazy `@react-pdf` chunk (455 kB gzip) loaded only when a receipt opens |

> This repository was developed on Linux, where NSIS cannot be produced: the packaging was
> validated by building the **release binary** (`npm run tauri build -- --no-bundle`) and
> running it, and by checking every field of `tauri.conf.json` against the specification.
> `tauri build` on Windows adds nothing but the wrapper.

### Install

1. Double-click `CentreManager_1.1.0_x64-setup.exe`.
2. The installer is **per-user** (`installMode: currentUser`): no administrator password,
   it installs under `%LOCALAPPDATA%\Programs\CentreManager` and registers a Start-menu
   shortcut. The language page offers **Français** and **العربية**; the interface language
   itself stays switchable inside the app.
3. Leave *Launch CentreManager* checked → the first window is the **setup** screen
   (centre name + password, 4 characters minimum).
4. Upgrading from V1.0 is safe: the database in
   `%APPDATA%\ma.centremanager.desktop\` is copied into
   `%APPDATA%\com.centremanager.app\` on the first start, and the old folder is left alone.

Uninstall from *Paramètres Windows → Applications → CentreManager*. The uninstaller removes
the program, **never** the database.

### Backup — what to tell the centre owner

The whole centre lives in one file:

```
%APPDATA%\com.centremanager.app\centremanager.db
```

* *Paramètres → Sauvegarde → **Sauvegarder*** writes a copy wherever they choose
  (the app checkpoints the WAL first, so the copy is complete). Do it weekly and before
  every Windows update.
* Keep the copies **outside** the PC too: a USB key, or a cloud folder.
* To move to a new PC: install V1.1, close the app, copy `centremanager.db` into the same
  `%APPDATA%\com.centremanager.app\` folder, reopen.
* To restore: close the app, keep the current file aside, copy the backup over
  `centremanager.db` (delete `centremanager.db-wal` / `-shm` if they exist), reopen.
  The in-app *Restaurer* button explains this procedure — V1 deliberately does not swap a
  live database file.

## Known Limitations V1

1. **No editing or cancelling** of a recorded payment or a teacher settlement. A mistake is
   corrected with a compensating entry (an over-payment becomes an advance, a settlement can
   be over-settled); nothing is ever deleted from the books.
2. **Invoices are generated month by month**, by hand, from *Paiements → Générer factures*.
   There is no scheduler and no automatic run at the start of the month.
3. **Arabic receipts are not printable yet**: the PDF is laid out correctly but the Arabic
   glyphs need an Arabic font *and* bidi shaping in the PDF engine (both V2). The receipt
   modal says so explicitly; French receipts are unaffected.
4. **`Imprimer` depends on the webview's PDF viewer** (it opens the blob in a new window and
   calls `print()`). A native print bridge is V2.
5. **Restore is manual**: the file is swapped while the app is closed. There is no in-app
   automated restore, on purpose — replacing an open SQLite file is a data-loss risk.
6. **One active school year at a time.** The year-end rollover (*Nouvelle rentrée*) copies the
   groups and re-enrolls the students you tick, but it carries nothing else over: no pro-rata, no
   automatic promotion to the next level, no transfer of an unpaid balance to the new year. Past
   years are never deleted, but V1 no longer has an annual summary screen: the *Bilan* page was
   removed, so a closed year is read through its payments and expenses pages.
7. **Local data only**: one database file on one PC. No sync, no network share, no
   multi-workstation use — sharing the file over a network drive is not supported.
8. **One password, no user accounts**: everybody who opens the app shares the same session.
   The Argon2id hash is not bound to the Windows account (DPAPI binding is V2), so copying
   the database to another machine copies the password with it.
9. **No prorata and no discounts**: the month of enrollment is billed in full whenever the
   student joins, and there is no scholarship/percentage discount, no e-mailing or texting of
   receipts, and no payroll export (CSV/Excel).

## Version History

### V1.6.0 — 3 November 2026

**A charge now has a date.** The monthly-expense form gains a **Date de la dépense** field
(`type="date"`, today by default, editable) and the table a **Date** column, so a charge can be
recorded late — or dated in the past on purpose — instead of always being stamped "today".

| Backend | |
| --- | --- |
| `monthly_expenses.expense_date` | `TEXT NOT NULL DEFAULT (date('now'))`, ISO `YYYY-MM-DD`; existing databases get it through `ALTER TABLE` + a backfill from `created_at`, plus `idx_expenses_date` |
| `MonthlyExpense` / `ExpenseRow` | new `expense_date: String` |
| `CreateExpenseInput` | new `expense_date: Option<String>` — `None` (or blank) means today; strict ISO is enforced (`2026-1-5`, `2026-02-30`, `2023-02-29`, a full timestamp are all refused) |
| `cmd_get_expenses` | returns the date and sorts by it, **newest first** (then category, label, id) |
| `cmd_update_expense` | a payload without a date keeps the stored one |
| `cmd_delete_expense` | unchanged, and its audit snapshot now includes the date |

| Frontend | |
| --- | --- |
| `ExpensesPage` | a **Date** column first in the table, printed `DD/MM/YYYY` (fr) or `YYYY/MM/DD` (ar); after a back-dated save the page follows the charge to its month |
| `ExpenseModal` | date picker labelled *Date de la dépense* / *تاريخ المصروف*, today by default, required; the accounting period is read off the date |
| types / mock / i18n | `expense_date` in `Expense` and `ExpenseInput`, mirrored in the dev backend (validation, seeding, sorting, old stores upgraded), four new keys in both languages |

Verification: `cargo test` **197 / 0**, `fmt` + `clippy` clean, `tsc` clean, `check:i18n` **757 /
757**, `vite build` **655.49 kB (181.09 kB gzip)**, browser suite **39 / 0** with 0 console errors,
regressions **64 / 85 / 67 / 75 / 68** unchanged.

### V1.5.1 — 3 November 2026

**The *Bilan* page is gone.** Removed on request: `BilanPage.tsx`, its `/bilan` route and
`ErrorBoundary`, the sidebar entry and its `BarChart3` icon, `bilanApi` in
`src/services/schoolYear.ts`, the four Bilan-only types (`BilanData`, `MonthlyBreakdown`,
`TopGroup`, `TopStudent`), the `cmd_get_bilan` mock and `computeBilan` helper in
`src/services/settingsDevBackend.ts`, and the `bilan` block (18 keys) plus `sidebar.bilan` in both
languages — 964 → **946 leaf keys**, `rentree.confirmHint` reworded in fr and ar so no sentence
still points at the page.

| Kept, on purpose | Why |
| --- | --- |
| `src-tauri/src/commands/bilan.rs`, its six tests, `cmd_get_bilan` in `mod.rs` and `main.rs` | the backend was not to be touched; the command is compiled, registered and unexposed |
| the 19 tables, the schema, the migrations | a UI removal must never become a data migration |
| everything rentrée | `rentreeApi`, `Rentree*` types, `RentreeWizardModal`, the two commands, their mock and translations are untouched |

| Gate | Result |
| --- | --- |
| `cargo test` | **190 passed, 0 failed** — unchanged, `commands::bilan` included |
| `cargo fmt --check` / `cargo clippy --all-targets` | clean, **0 warnings** |
| `tsc --noEmit` / `vite build` | clean, **653.92 kB (180.61 kB gzip)**, CSS 41.68 kB — **12.97 kB of JS and 0.42 kB of CSS lighter** |
| `npm run check:i18n` | fr **753** / ar **753** keys used, all present (was 778) |
| Browser suite Phase 14 | **85 assertions, 0 failed, 0 console errors** — the sidebar's eight entries, no *Bilan*, `/bilan` falling through to the dashboard, the wizard end to end, the Arabic pass |
| Regression | Phase 13 **67 / 0** (back to “eight links”), Phase 12 **75 / 0**, Phase 11 **64 / 0**, Phase 10 **68 / 0** |
| Repair kit | `remove-bilan.mjs` reproduces the change byte for byte; the installer now installs Phase 14 *and* removes Bilan; `check-phase14` **36 / 0** |

### V1.5.0 — 1 November 2026

* **`cmd_get_rentree_preview` / `cmd_execute_rentree`** (`src-tauri/src/commands/rentree.rs`): the
  preview returns the active year with its groups (`schedule_text`, headcount, fee, teacher), its
  enrolled students (with the groups they are in) and its teachers; the execution is **one
  transaction** that creates and activates the new year, copies the selected groups with their
  `group_schedules`, re-enrolls the selected students in the copies of the groups they were in
  (through `enroll_on`, so each gets its first invoice), closes the old enrollments and writes a
  single `RENTREE` audit row. Inactive students and groups are skipped, never guessed into a group.
* **`cmd_get_bilan`** (`src-tauri/src/commands/bilan.rs`): one school year folded into totals
  (students, groups, revenue, theoretical, collection rate, payroll, expenses, net), twelve monthly
  rows with `month_name`, the top-five groups by money received and the top-ten payers. Money is
  scoped to the year's date range, invoices to their billing month inside it. **Kept, but no longer
  reachable from the UI** — see the removal note above.
* **`RentreeWizardModal`**: four steps — year (suggestions from the last `start_date`, duplicate
  label and reversed dates refused), groups (all pre-ticked, select/deselect all, `Y/Z` count),
  students (search, all pre-ticked, enrollment date defaulting to the new start date, warning and
  estimated invoice total) and recap — then a success card with the four counts. It is opened from a
  prominent button in *Paramètres → Année scolaire*, visible only while a year is active.
* **`BilanPage` (`/bilan`)** — eight KPI cards, the month-by-month table with its total row and
  CSS-only bars, the top-five groups and the top-ten payers, a year selector and an empty state,
  second in the sidebar. **Removed afterwards on request**: the page, its route, its sidebar entry,
  its service call, its types, its dev-backend mock and its `bilan.*` translations are gone; only
  the Rust command above remains.
* **No new table**: 19 before, 19 after. `school_years`, `groups`, `group_schedules`, `enrollments`,
  `invoices`, `payments`, `teacher_settlements`, `monthly_expenses` and `audit_log` are all reused.

### V1.4.0 — 1 November 2026

* **`group_schedules`** (`src-tauri/src/db/schema.sql`, the 19th table): one row per weekday per
  group, `UNIQUE(group_id, day_of_week)`, cascading on delete, with `idx_schedules_group` and
  `idx_schedules_day`. `run_migrations()` backfills it from the legacy columns of an existing
  database (`INSERT OR IGNORE … SELECT`), and the old `groups` columns are kept and mirrored from
  the first day — V1 never drops a column.
* **Four new commands** (`src-tauri/src/commands/schedules.rs`): `cmd_set_group_schedules`
  (replace a whole week in one transaction, validated), `cmd_get_group_schedules`,
  `cmd_get_timetable` (every active slot joined with subject, level, branch, teacher, room,
  headcount and fee; four optional ANDed filters; ordered by day then start) and
  `cmd_get_timetable_rooms`. `GroupRow` gained `schedules` and `schedule_text` (batched in one
  query), and `cmd_create_group`/`cmd_update_group` accept a whole week — falling back to the
  single legacy slot when they only get one.
* **Seven-day editor** in the group form: a Lun → Dim row of checkboxes, each with its own start
  and end time (greyed out until ticked), a live summary underneath, and per-day validation
  (`atLeastOneDay`, `endAfterStartDay`). The card now reads `📅 Lun 16-18 · Mer 14-16 · Ven 16-18`,
  or the familiar `Lundi 16:00–18:00` when a group still meets once. `QuickCreateGroup` follows
  with day chips and a **Horaires identiques** toggle (on: one range for every ticked day; off:
  one row per day).
* **New page `/timetable` — “Emploi du temps”**, between *Groupes* and *Enseignants*: a weekly
  CSS-grid timetable with sticky day and hour rails, blocks that span their real duration in the
  subject's colour, lane-splitting for overlapping classes, four server-side filters + reset, a
  debounced (200 ms) refetch, a Sunday toggle, a click-through to the group sheet, a hover tooltip,
  day tabs below `md`, and an empty state that keeps the rails visible.

### V1.3.0 — 1 November 2026

* **`CreatableSelect`** (`src/components/ui/CreatableSelect.tsx`): every dropdown that links to
  another entity now ends with **“+ Nouveau…”** after a separator. Keyboard (arrows, Enter,
  Escape, Home/End), click-outside, optional search — client-side, or server-side through
  `onSearch` — RTL-correct, with the create row sticky so a long list never hides it.
* **Six quick-create dialogs** (`src/components/quick-create/`): teacher, subject, level,
  student, group (two steps) and expense category. Each creates the record, closes, hands the
  new object back, and the parent refreshes and selects it — the parent form keeps everything
  already typed.
* **Depth control**: `Modal` gained a `zIndex` prop (default 50) whose backdrop darkens with each
  level, so a quick-create sits at `z-60` and a nested one at `z-70`; simple dialogs use plain
  selects, which makes a third dialog impossible rather than merely discouraged.
* **New entries**: *Paiements → Encaisser un paiement* opens the wizard on its search step
  (where a student can now be created on the spot), *Enseignants* gained **+ Nouvelle matière**
  under the subject checkboxes, and the enrollment wizard gained **+ Nouveau groupe /
  + Nouvel élève**.

### V1.2.0 — 1 November 2026

* **Monthly expenses**: a new **Frais** page (between *Paiements* and *Paramètres*) records the
  centre's charges month by month — label, amount in centimes, category, optional notes — with a
  month/year selector, a total in red, per-category mini cards with their own colours and icons,
  a category filter, and full edit/delete (expenses are internal tracking, so they *can* be
  deleted; every mutation is audited with a snapshot). `monthly_expenses` is the 18th table.
* **Editable categories**: *Paramètres → Catégories de dépenses* adds and removes the tags the
  expense form offers; the seven defaults (Loyer, WiFi, Électricité, Eau, Assistance,
  Fournitures, Autre) are seeded on a new database, and a renamed or removed category never
  orphans an existing row.
* **Total Net**: the dashboard now answers the question the owner actually asks — six KPI cards,
  the sixth being **💎 Total Net** = monthly revenue − expenses − payroll, green in profit, red in
  loss, amber on break-even, with its trend against the previous month and the three amounts in
  its tooltip. The payroll used is the *calculated* one, so the card is right even before the
  teachers are paid.
* The demo seeder fills twelve expenses across the current and previous month, so the new page
  and the net card are meaningful on a freshly seeded database.

### V1.1.0 — 1 November 2026

* **Demo data**: one button in *Paramètres → Sauvegarde* fills the app with a complete
  fictional centre (15 students, 5 teachers, 8 groups, two months of invoices at ~60 %
  collection, activities, settlements) — development builds only, and never on a database
  that already has students.
* **Hardening**: the twenty edge cases of the specification are covered by 14 new Rust tests
  and a 42-assertion browser suite; five defects found on the way were fixed (demo collection
  rate, demo fee range, the post-seed logout, the blank receipt preview under the production
  CSP, and the app-data folder move).
* **Packaging**: identifier `com.centremanager.app` with **automatic migration of a V1.0
  database**, production **CSP** (`'unsafe-eval'` + `blob:` for the pdf.js receipt preview,
  `ipc:` for the commands, `fonts.gstatic.com` allowed), version **1.1.0**, NSIS installer in
  **French and Arabic**
  with a language selector, per-user install, window `CentreManager V1.1` at 1280 × 800
  (minimum 900 × 600).
* Documentation: build & distribution guide, known limitations, this history.

### V1.0.0 — 2026

* Phases 1–8: authentication and session security, settings and reference data, students,
  groups and enrollment, invoicing and payments, teachers and payroll, the dashboard, printed
  receipts (A4 + thermal, inline preview, download, print) and the UI polish (error boundary,
  keyboard shortcuts, late-payment badge, toasts, RTL parity).

---

## Verification performed

Everything below was produced by running the suites, not by reading the code. The headline
results first, then one block per phase with the full detail.

Rust test counts are the size of the suite **at the end of that phase**; a browser suite is
listed only where one was written for that phase.

| Phase | Rust tests | Browser suite | Real window | Headline |
| --- | --- | --- | --- | --- |
| 0 — scaffold | — | — | ✅ | window opens, 17 tables in WAL mode, `cmd_ping`, `vite build` clean |
| 1 — auth & security | — | 33 assertions | ✅ | Argon2id, 3-failure lockout with countdown, idle auto-lock, manual lock |
| 2 — settings & reference data | 37 | — | ✅ | 8 sections, single active school year, delete guards, backup |
| 3 — students | 48 | — | ✅ | search/filters, four-tab sheet, audit trail with diffs |
| 4 — groups & enrollment | 68 | — | ✅ | capacity, four-step wizard, first invoice, end of enrollment |
| 5 — invoicing & payments | 90 | — | ✅ | month generator, oldest-first allocation, advances, frozen receipts |
| 6 — teachers & payroll | 117 | — | ✅ | 4 compensation modes, activities, cumulative settlements |
| 7 — dashboard | 132 | — | ✅ | 5 KPIs vs previous month, échéances ±7 days, payroll card |
| 8 — receipts & polish | 133 | 65 assertions | ✅ | A4 + thermal PDFs, error boundary, shortcuts, badge, toasts |
| **9 — demo data, twenty edge cases, packaging** | **150** | **42 assertions** | ✅ | demo seeder, 20/20 edge cases, CSP verified by rendering a receipt, V1.0 database migrated |
| **10 — father name, home address, numeric inputs** | **155** | **68 assertions** | ✅ | `nom du père` + `adresse maison` (renaming migration), phones grouped then stored raw, one `NumberInput` everywhere |
| **11 — monthly expenses & total net** | **165** | **64 assertions** | ✅ | `monthly_expenses` (18th table) + editable categories, Frais page, `Total Net = revenus − frais − salaires` card in three colours |
| **12 — creatable dropdowns everywhere** | **165** | **75 assertions** | ✅ | one `CreatableSelect` in six forms, six quick-create dialogs, one level of nesting (`z-50 → 60 → 70`), parent form never lost |
| **13 — multi-day groups & weekly timetable** | **176** | **67 assertions** | ✅ | `group_schedules` (19th table) + in-place backfill, seven-day editor, `Emploi du temps` grid (spanning, colours, lanes, filters, mobile tabs), legacy columns mirrored |
| **14 — rentrée** | **190** | **85 assertions** | ✅ | one-transaction year rollover (year + copied groups + fresh enrollments + invoices + audit), four-step wizard; the *Bilan* page was removed afterwards (the Rust command stays, unexposed), still 19 tables |
| **15 — the date of an expense** | **197** | **39 assertions** | ✅ | `monthly_expenses.expense_date` (ISO, back-datable, `ALTER TABLE` + backfill), date column in the list, date picker in the form, still 19 tables |

### Phase 15 — the date of a monthly expense

| Gate | Result |
| --- | --- |
| `cargo test` | **197 passed, 0 failed** — 7 new: `commands::expenses` (a charge keeps an explicit date and the list comes back **newest first**; a missing or blank date falls back to today; eight malformed dates are refused and a leap day is accepted; an update can move the date and is audited; an update that omits the date **keeps** the stored one; a hand-written row with an empty date still reads back as a day) and `db` (an older `monthly_expenses` gains the column, is backfilled from `created_at`, loses nothing and gets `idx_expenses_date`) |
| `cargo fmt --check` / `cargo clippy --all-targets` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **655.49 kB (181.09 kB gzip)**, CSS 41.68 kB (8.03 kB gzip) — the date column and its formatter cost 1.57 kB |
| `npm run check:i18n` | fr **757** / ar **757** keys, all present (`expenses.date`, `expenses.columns.date`, `expenses.hints.date`, `expenses.validation.dateRequired`) |
| Browser suite (`suite historique retirée`) | **39 assertions, 0 failed, 0 console errors** — the Date column first in the table, every row printing `DD/MM/YYYY`, the rendered order descending, the form defaulting to today (not disabled), a charge saved with an explicit day (stored, period derived, audited), a **back-dated** charge landing in its own month and the page following it there, an edit moving the date, an empty date refused with its message, the dashboard net card unchanged, and the Arabic pass (`التاريخ`, `تاريخ المصروف`, dates printed `YYYY/MM/DD`) |
| Regression | Phase 11 **64 / 0**, Phase 14 **85 / 0**, Phase 13 **67 / 0**, Phase 12 **75 / 0**, Phase 10 **68 / 0** |
| Database | still **19 tables**: one column added to `monthly_expenses`, plus `idx_expenses_date` |
| Screenshots | `docs/screenshots/phase15-01…05` — the *Date* column, the date picker on today, a dated row, a back-dated charge in its own month, the Arabic form |

Design notes worth keeping:

* **The date decides the period.** `month`/`year` remain the accounting period the summary and the
  dashboard add up, and the form derives them **from the chosen date** — so a rent entered late for
  October really lands in October, and the page switches to that month after the save so the new row
  is not hidden behind the selector. The command still takes `month`/`year` explicitly, so nothing
  else that calls it changes.
* **`ALTER TABLE` cannot use `DEFAULT (date('now'))`.** SQLite refuses a non-constant default in
  `ADD COLUMN` (*“Cannot add a column with non-constant default”*), so an existing database gets
  `TEXT NOT NULL DEFAULT ''` and every row is backfilled with `date(created_at)` — the day the
  charge was recorded, the best available guess. A fresh database is created from `schema.sql` with
  the real default. The app always writes the date itself, and the read path
  (`COALESCE(NULLIF(expense_date,''), date(created_at), date('now'))`) normalises any leftover, so
  the two shapes behave identically.
* **An update that says nothing about the date keeps it.** Only the create path defaults to today;
  a caller that edits the amount alone must not silently re-date a charge.
* **Arabic reads dates year-first.** `formatDateLocalized()` prints `05/11/2026` in French and
  `2026/11/05` in Arabic — same day, in the order the language expects; `formatDate()` (the rest of
  the app) is untouched.
* **What the money math sees is unchanged.** `month_total()`, the summary, the bilan and the
  dashboard still scope by `(month, year)`; `expense_date` is a display and ordering field, never a
  filter, so no historical figure moves.

### Phase 14 — the rentrée

| Gate | Result |
| --- | --- |
| `cargo test` | **190 passed, 0 failed** — 14 new: `commands::rentree` (the preview lists groups, students and teachers of the active year with their schedule text and headcount; a full run copies the groups *and* their `group_schedules`, re-enrolls each student in the copy of every group he was in, generates one invoice per fresh enrollment and closes the old ones with `end_date = enrollment_date`; only the ticked groups/students travel; capacity is enforced on the copies; an inactive student is neither offered nor re-enrolled; the four validation messages; an unknown year is refused; a failure mid-way rolls the whole year back — the new `school_years` row included) and `commands::bilan` (an empty year returns ten zeroed months from September to June; a year with data folds revenue / payroll / expenses / theoretical / net and ranks groups and students; another year's money and structure never leak in; the top lists cap at 10 and 5; months cross the year boundary) |
| `cargo fmt --check` / `cargo clippy --all-targets` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **653.92 kB (180.61 kB gzip)**, CSS 41.68 kB (8.03 kB gzip) — the wizard and its service cost ~21 kB raw; removing *Bilan* took 12.97 kB of JS and 0.42 kB of CSS out of the bundle |
| `npm run check:i18n` | fr **753** / ar **753** keys, all present (`rentree.*` — title, the four step names, the two validation messages, the estimate, the result block) |
| Browser suite | **85 assertions, 0 failed, 0 console errors** — the sidebar (eight links, the timetable still between groups and teachers, no *Bilan* entry, no `nav-bilan`), `/bilan` falling through to the dashboard without hitting the error boundary, the wizard end to end (suggestions, duplicate label refused, end-before-start refused, all groups pre-ticked, deselect/select all, student search, enrollment date before the year refused, estimate, recap, confirm), everything the transaction wrote (2 years, one active, groups copied with fee/capacity/teacher/week, old groups untouched, no enrollment deleted, old ones closed on the enrollment date, fresh ones active on it, one invoice per enrollment, a single `RENTREE` audit row with its JSON summary, the inactive student re-enrolled nowhere), the settings list refreshing behind the modal, and the Arabic pass (eight Arabic links, no Arabic *Bilan*, translated wizard) |
| Regression | Phase 13 **67 / 0**, Phase 12 **75 / 0**, Phase 11 **64 / 0**, Phase 10 **68 / 0**, Phase 9 **42 / 0** |
| Database | no schema change at all: the 19 tables of V1.4.0 are the 19 tables of V1.5.0 |
| Real window | the debug binary (version 1.5.0) starts against the migrated database with no error |

Design notes worth keeping:

* **The rentrée is one transaction, or nothing.** `cmd_execute_rentree` wraps the year, the copies,
  the enrollments and the invoices in a single `unchecked_transaction`; any error — a full group, a
  duplicate label — drops all of it, so a director can never be left with a half-migrated year.
  The dev backend does the same by working on a deep copy of its store and saving it at the very end.
* **Copying is explicit, never guessed.** Groups and students are checkbox lists that start
  pre-ticked, and a student is only ever re-enrolled in the copy of a group he was *already* in —
  which is exactly the director's request: the student's information carries over, the enrollment
  starts fresh. Nobody is dropped into a group by approximation, and an inactive student or group
  is silently skipped rather than aborting the run.
* **Re-enrollment reuses `enroll_on`.** Capacity, the duplicate check, the first invoice and the
  `ENROLL` audit row all behave exactly as they do in the enrollment wizard, because it is the same
  function (`pub(crate)` since this phase). The rentrée adds one `RENTREE` row on top, with the
  counts in its JSON.
* **The old year is frozen, not cleaned.** Old enrollments are closed with `status = 'terminé'` and
  `end_date = enrollment_date`; old invoices, payments, groups and receipts are never touched, so a
  closed year still reads exactly as it did.
* **Removing *Bilan* left the backend alone.** `bilan.rs` and `cmd_get_bilan` are still compiled,
  registered and covered by their six tests: deleting a UI must not touch the schema or the
  bookkeeping, and the command costs nothing while nothing calls it. The removal touched seven
  frontend files and two translation files, and shrank the bundle by 12.97 kB.

### Phase 13 — multi-day groups and the weekly timetable

| Gate | Result |
| --- | --- |
| `cargo test` | **176 passed, 0 failed** — 11 new: the seven of `commands::schedules` (three-day week stored in week order + legacy columns following the first day, the four validation messages, replace-not-append, create/update carrying a whole week, the timetable with every filter ANDed, inactive groups excluded, rooms of active groups only, `ON DELETE CASCADE`) plus one in `db` (`group_schedules` is the 19th table, and a pre-Phase 13 database is backfilled in place, idempotently) |
| `cargo fmt --check` / `cargo clippy --all-targets` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **634.96 kB (176.28 kB gzip)**, CSS 41.48 kB (7.99 kB gzip) — the page, the week editor and the schedule helpers cost ~21 kB raw |
| `npm run check:i18n` | fr **713** / ar **713** keys, all present (`timetable.*` — title, description, the four filters + reset, the seven day names and their short forms, summary, empty/emptyHint, loading, showSunday — plus `groups.schedules/schedulesHint/sameHours`, three `groups.validation.*` messages and `sidebar.timetable`) |
| Browser suite | **67 assertions, 0 failed, 0 console errors** — sidebar order (eight links, timetable between groups and teachers), the grid (six columns, Sunday opt-in, Monday left of Tuesday, blocks spanning rows, subject tint, content), filters that AND, the empty state over a live grid, the reset button, a three-day group created and persisted (week order, legacy mirror, per-day hours), the card summary, editing the week (prefill, no-day refusal, per-day reversed hours refusal, replace), the timetable following the edit, lane-splitting for two classes sharing a slot, click-through to the group sheet, the quick-create group (day chips, `Horaires identiques` on/off), the phone day tabs, and the Arabic pass (translated title/labels, Monday still the left-most column, RTL week editor) |
| Regression | Phase 12 **75 / 0**, Phase 11 **64 / 0**, Phase 10 **68 / 0**, Phase 9 **42 / 0** — none of them changed |
| Real database | the Phase 12 file (18 tables) opened by the new binary migrates in place: **19 tables**, `group_schedules` created with its two indexes, and a group written the old way (`Mercredi 14:00–16:00`) came back as one schedule row without touching its columns |
| Real window | the debug binary (version 1.4.0) starts against that migrated database with no error; the screenshots above come from the browser suite, which runs the same components against the development backend |

Design notes worth keeping:

* **One row per day, and the old columns still win.** `cmd_set_group_schedules` deletes and
  re-inserts the week of one group inside a single transaction, then copies the *first* day into
  `groups.day_of_week/start_time/end_time`. Nothing else in the app had to change: invoicing,
  enrollment and payroll read `groups`, and they see a valid slot.
* **The week is validated once, in Rust and in the dev backend.** At least one day, a known
  weekday, `end > start` per day, no duplicate day (the `UNIQUE(group_id, day_of_week)` constraint
  would otherwise surface as a raw SQLite error). Both implementations return the same French
  message, so the browser suite and the real app fail identically.
* **`GroupRow` gained `schedules` + `schedule_text` without touching `map_group`.** The 18 SQL
  columns keep their positions; a single extra query reads every schedule row for the page and
  attaches them in memory, so listing a hundred groups costs two queries, not a hundred and one.
* **The grid is data-driven.** Hour rows run from the earliest start to the latest end of what is
  actually on screen, one row per 30 minutes, so a 17:30 class starts at 17:30 rather than at the
  hour. Overlapping classes in the same column are packed into lanes instead of being drawn on top
  of each other — a real centre does run two groups at 16:00 in two rooms.
* **Monday on the left, in Arabic too.** The grid (and the week editor, and the quick-create day
  chips) carry `dir="ltr"` while their labels keep `dir="auto"`: the week is mirrored as text but
  never reversed, and time ranges are wrapped in bidi isolates so `16:00–18:00` does not print as
  `18:00–16:00` in an RTL page.
* **No week pagination.** `cmd_get_timetable` deliberately has no `week_start`: the schedule is a
  *recurring* week (`group_schedules` has no dates), so "next week" would be the same grid. The
  optional parameter was dropped from the signature rather than accepted and ignored.
* **Sunday is opt-in.** Most Moroccan centres close on Sunday, so the column is hidden and a
  checkbox brings it back — but a Sunday class is still stored if one is ever needed.

### Phase 12 — a dropdown that can create what it is missing

| Gate | Result |
| --- | --- |
| `cargo test` | **165 passed, 0 failed** — no Rust change: this phase is pure frontend, and the six creation commands (`cmd_create_teacher`, `cmd_create_subject`, `cmd_create_level`, `cmd_create_student`, `cmd_create_group`, `cmd_set_expense_categories`) already existed and are reused as-is |
| `cargo fmt --check` / `cargo clippy --all-targets` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **614.26 kB (170.48 kB gzip)**, CSS 40.36 kB (7.79 kB gzip) — the component, six dialogs and the copy cost ~29 kB raw |
| `npm run check:i18n` | fr **701** / ar **701** keys, all present (`common.createNew/creating/create/noOptions/clear/quickCreate`, the whole `quickCreate.*` block, `teachers.newSubject`, `enrollment.newGroup/newStudent`, `payments.newPayment`, `expenses.categoryPlaceholder`) |
| Browser suite | **75 assertions, 0 failed, 0 console errors** — the component itself (options, separator, sticky create row, primary colour, plus icon, search filtering, arrows/Enter/Escape, empty list, RTL icon side), six quick-create flows (subject, level, teacher, student, group, category), the parent form keeping every typed value through the detour, auto-selection, audit rows, duplicate refusal, cancel-without-changes, and the `z-50 → 60 → 70` stack |
| Regression | Phase 11 **64 / 0**, Phase 10 **68 / 0**, Phase 9 **42 / 0** — the previous suites pass unchanged apart from the one `selectOption` that now clicks the new component |
| Real window | the debug binary (version 1.3.0) starts against the existing 18-table database with no error; the screenshots above come from the browser suite, which runs the same components against the development backend |

Design notes worth keeping:

* **Why a custom component.** A native `<select>` cannot carry an action that is not a
  value, and the create row must sit *inside* the listbox (last item) while staying visible
  when the list scrolls — hence a button trigger, a portal popup positioned from the
  trigger's rectangle (a modal body's `overflow-y-auto` would clip an absolutely positioned
  list), and a `sticky` last row.
* **One level of nesting, by construction.** Quick-create dialogs of *simple* entities
  (subject, level, teacher, student, category) use plain `Select`s for their own linked
  fields — there is nothing left to create from them. Only `QuickCreateGroup` needs
  dropdowns with `+ Nouveau`, and it opens them at `z-70`; those dialogs are the simple ones,
  so the recursion stops there. `CreatableSelect` also ships a `disableCreate` prop for a
  caller that wants a plain dropdown.
* **The parent form is never unmounted.** Quick-create dialogs are siblings of the modal, not
  children of its `<form>`: submitting one cannot submit the other, and every keystroke of the
  parent survives (asserted: fee `450`, capacity `14`, student name, …).
* **Returned objects, not ids.** The commands return the new id; the dialog reads the row back
  (`cmd_get_teacher_options`, `cmd_get_student_detail`, `cmd_get_group_detail`, …) so the
  parent can select a real object — and so the dropdown is consistent with what a reload shows.
* **Enrollment wizard.** It keeps its rich multi-select list (one enrollment can cover several
  groups); the quick-create is a `+ Nouveau groupe` / `+ Nouvel élève` button in the same step,
  and a student created there is *pinned* at the top of the candidate list so the selection is
  visible.

### Phase 11 — monthly expenses and the real profit

| Gate | Result |
| --- | --- |
| `cargo test` | **165 passed, 0 failed** — 10 new tests: the seven of `commands::expenses` (centimes stored + `CREATE` audit, validation of label/amount/month/year, month and category filters, per-category summary, audited update *and* delete, the category list surviving a restart, its defaults on a fresh database) and two on the dashboard (`net = revenue − expenses − payroll` with a percentage **and** a fixed compensation; a negative net stays month-scoped) |
| `cargo fmt --check` / `cargo clippy --all-targets` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **585.14 kB (162.44 kB gzip)**, CSS 40.07 kB (7.71 kB gzip) — the Frais page, its modal and the sixth card cost ~28 kB raw |
| `npm run check:i18n` | fr **643** / ar **643** keys, all present (the whole `expenses.*` block (page, modal, empty state, toasts, the seven category names), `dashboard.kpi.netIncome/netTooltip/netPositive/netNegative/netZero`, `settings.expenseCategories*` and `sidebar.expenses`) |
| Browser suite | **64 assertions, 0 failed, 0 console errors** — sidebar order, month/category filters, create (`3 500` → `3 500.00` DH, stored as `350000` centimes), edit, delete with confirmation, the audit rows, a custom category added in *Paramètres* and immediately offered by the form, persistence across a reload, the six-card grid (3 × 2), the tooltip arithmetic, the three colours of `Total Net`, and the Arabic pass (RTL layout, translated category names, amounts kept LTR) |
| Regression | Phase 10 suite **68 / 0**, Phase 9 suite **42 / 0** — untouched |
| Real database | the Phase 10 file (17 tables) opened by the new binary migrates in place: **18 tables**, `idx_expenses_month_year` + `idx_expenses_category` created, `expense_categories` seeded with the seven defaults, no data lost |
| Real window | the Frais page and the Total Net card are screenshots of the app itself — see the gallery at the top |

Design notes worth keeping:

* **One number to rule the card.** `net_income_cents` is computed once in `dashboard.rs` from
  the three fields that already existed (`monthly_revenue_cents`, `month_total()` of the
  expenses, and the payroll the compensation module already returns), so the frontend never
  re-derives a total and the tooltip cannot drift from the value above it.
* **The payroll is the *calculated* one**, reused from `compensation_summary` — not the settled
  rows. A month where the director has not paid the teachers yet still shows the real net.
* **Categories live in `settings`** (`expense_categories`, a JSON array, seeded with the seven
  defaults). Removing a category never touches past rows: they keep their stored name, and the
  badge falls back to a hashed colour from a six-entry palette for names it does not know.
* **Expenses are deletable and audited.** `cmd_delete_expense` hard-deletes — internal
  tracking, not a financial record — but writes the whole row into `audit_log.details` first.
* **RTL.** Category badges are inline-flex tags, the table columns use logical properties
  (`ms-`/`pe-`), and percentages are wrapped in Unicode isolates (`U+2066…U+2069`) so Arabic
  keeps them on the same side as the sentence instead of pushing them to the far edge.

### Phase 10 — father name, home address and one numeric input

| Gate | Result |
| --- | --- |
| `cargo test` | **155 passed, 0 failed** — 5 new tests: the two renaming migrations (`address` → `home_address`, `email` → `home_address`, data preserved, idempotent), the fresh-database shape, phone separators stripped before validation *and* storage, and a father-name / home-address round trip through the audit trail |
| `cargo fmt --check` / `cargo clippy --all-targets` / `cargo build` | clean, **0 warnings** (clippy included — four pre-existing lints in `dashboard.rs`, `groups.rs`, `payments.rs`, `edge_cases.rs` were cleaned on the way) |
| `npx tsc --noEmit` / `vite build` | clean, **556.72 kB (155.74 kB gzip)**, CSS 33.92 kB (6.85 kB gzip) — the `NumberInput` costs ~5 kB raw |
| `npm run check:i18n` | fr **593** / ar **593** keys, all present (`students.fatherName`, `students.homeAddress`, `students.phonePlaceholder`, `common.suffix.*`) |
| Browser suite (`suite historique retirée`, dev backend, headless) | **68 assertions, 0 failures**, 0 console errors, 0 React warnings |
| Phase 0–9 regression (`suite historique retirée`, headed) | **42 assertions, 0 failures** (one expectation updated: the phone is now grouped), 4 expected console errors — identical to the Phase 9 baseline |
| Release binary (`cargo build --release`, `CARGO_BUILD_JOBS=1`) | **built and launched**: `target/release/centremanager`, **6 960 840 bytes (6.6 MiB)**, database created at `~/.local/share/com.centremanager.app/centremanager.db` |
| Real-database migration (release binary, Xvfb) | the `students` table was renamed back to its Phase 9 shape (`home_address` → `address`, `father_name` dropped) and a student `Ancien Eleve` inserted; the next launch leaves `home_address = '5 rue Atlas, Casablanca'`, `notes = 'Migré'` **intact** and adds `father_name` |

**The student fields.** `students.address` became `students.home_address` ("Adresse
maison") and `students.father_name` ("Nom du père") was added. `run_migrations` gains
`upgrade_student_columns`, which handles the three shapes found in the wild with a
`PRAGMA table_info` probe:

| Database | What happens |
| --- | --- |
| V1.0 sketch with `email` | `ALTER TABLE students RENAME COLUMN email TO home_address`, then `father_name` added — values kept |
| Phase 3–9 with `address` | same rename from `address`, data kept, then `father_name` added |
| Fresh database | `schema.sql` already has both columns; the upgrade is a no-op |

The rename is wrapped in an `if renamed.is_err()` fallback (`ADD COLUMN home_address` +
`UPDATE … SET home_address = address`) so a very old SQLite cannot lose the data either.
`CreateStudentInput` / `UpdateStudentInput` / `StudentRow` carry the two fields, the
`SELECT` lists `home_address` in the old `address` slot, and the audit trail stores the
new key — the student *Historique* tab maps `home_address` to its label automatically.

**Phones.** Storage stays exactly ten raw digits; everything else is presentation:

* Rust — `normalise_phone()` drops `' '`, `'-'`, U+00A0, U+202F, `'.'`, `'('`, `')'`
  before `is_valid_phone()` (`/^0[67]\d{8}$/`) runs, and the command stores the
  normalised value. So `06 07 12 34 56` and `06-07-12-34-56` are the same student
  record as `0607123456`, and a wrong length is still rejected.
* Frontend — `formatPhone()` (`06 07 12 34 56`, raw input when it is not ten digits,
  an em dash when empty) and `stripPhone()` live in `utils/format.ts`; `isValidPhone()`
  strips the same separators. Applied to the list, the record sheet (`tel:` links keep
  the raw digits), the payment modal (student picker + selected student), the payments
  page, the group sheet, the enrollment wizard, the teacher sheet and the student form
  itself (formatted on blur, stripped on submit). Every phone sits in a `dir="ltr"`
  run, so `06 07 12 34 56` stays grouped and left-to-right in Arabic too.

**`NumberInput` (`components/ui/NumberInput.tsx`).** One component for every numeric
field — a `type="text"` input with `inputMode="decimal"`, never `type="number"`:

| Behaviour | Detail |
| --- | --- |
| Display | raw value while focused (easy to edit), grouped with a space on blur (`1234567` → `1 234 567`, `1234.5` with `decimals={2}` → `1 234.50`) |
| Typing | characters filtered as typed, decimal count enforced (`decimals`), comma accepted as a decimal separator |
| Bounds | `min` / `max` clamped on blur; arrow keys and the +/- buttons clamp the same way |
| Buttons | +/- inside the border, one `step` per click, hold to repeat every **100 ms**, hidden when `disabled` or `step = 0`, disabled at the bound |
| Extras | `suffix` muted and non-selectable, `prefix`, `label` / `hint` / `error` / `required`, `aria-*`, no spinner, **the mouse wheel never changes the value** |
| RTL | the control carries `dir="ltr"` (digits + buttons keep their order) while the suffix and buttons move to the left edge in Arabic |

Sites migrated: group fee (`decimals 2`, `DH`, `min 0`, `step 50`) and capacity
(integer, `élèves`, `min 1`), teacher compensation amount and `bonus_pct`
(`decimals 1`, `%`, `0–100`), activity hours (`decimals 1`, `h`, `step 0.5`) and
sessions (integer), settlement and payment amounts. The settings lock timeout was
already a `<select>`, and it stays one. `MoneyInput` is now a thin wrapper
(`decimals 2`, `DH`, `min 0`) keeping the centimes ↔ dirhams conversion
(`Math.round(value * 100)`), so a settlement typed as `1 234.50` is stored as
**123 450** centimes — asserted in the browser suite.

| Students list — father name + grouped phone | Record sheet — `Nom du père`, `Adresse maison` | Student form, Arabic / RTL |
| --- | --- | --- |
| ![Students](docs/screenshots/phase10-02-students-list.png) | ![Student sheet](docs/screenshots/phase10-03-student-detail.png) | ![Form AR](docs/screenshots/phase10-08-student-modal-ar.png) |

| Group form — `NumberInput` fee + capacity | Teacher compensation — percentages | Payment amount (`MoneyInput`) |
| --- | --- | --- |
| ![Group modal](docs/screenshots/phase10-04-group-modal.png) | ![Compensation](docs/screenshots/phase10-05-compensation.png) | ![Payment](docs/screenshots/phase10-08-payment.png) |

### Phase 9 — edge cases, demo data and packaging

| Gate | Result |
| --- | --- |
| `cargo test` | **150 passed, 0 failed** — 14 new `commands::edge_cases::*` tests (the data-level cases 1–15 and 17–19; case 16 and case 20 are browser-only) and 3 `commands::demo::*` tests (full seed shape, refusal on a non-empty database, seeding after an ended enrollment) |
| `cargo fmt --check` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **551.70 kB (153.99 kB gzip)**, CSS 33.75 kB (6.82 kB gzip); the `@react-pdf` chunk stays lazy at 1 235.56 kB (455.45 kB gzip) |
| `npm run check:i18n` | fr **586** / ar **586** keys, all present (`settings.demo.*` added) |
| Browser suite (`suite historique retirée` with `npm run dev` up, headed) | **42 assertions, 0 failures**, 0 unexpected console errors (4 expected: the `/__error` route it provokes), 0 React warnings |
| Demo seed, measured | `Demo data: 15 students, 5 teachers, 8 groups, 50 invoices, 22 payments`, 25 enrollments, current-month collection **58.5 %**, fees 200 → 500 DH, capacities 10 → 20, 2 settlements |
| Real Tauri window (`tauri dev`) | seeded the demo centre in one click (507 kB → 4.1 MB), dashboard `15 élèves / 8 groupes / 5 enseignants` with 13 échéances and 6 recent payments, a payment posted, receipt `REC-20261101-0001` (850,00 DH) rendered by `PDFViewer` |
| V1.0 → V1.1 upgrade | planted `~/.local/share/ma.centremanager.desktop/centremanager.db`, started V1.1: `[CentreManager] base V1.0 migrée depuis …` in the log, the login screen shows the V1.0 centre name, the dashboard its 15 students; the old folder is untouched |
| Window geometry (real window) | `xdotool getwindowname 2097155` → **`CentreManager V1.1`**, `getwindowgeometry` → **`1280x800`**; minimum 900 × 600 verified in the browser run (no horizontal scroll at 900 × 600) |
| Packaging fields | version `1.1.0` (also `package.json` + `Cargo.toml`), identifier `com.centremanager.app`, `csp` set, `targets: ["nsis"]`, `installMode: currentUser`, `languages: ["French","Arabic"]`, `displayLanguageSelector: true`, `headerImage`/`sidebarImage` null |
| Release binary (`npm run tauri build -- --no-bundle`) | **built and run**: `target/release/centremanager`, **9 117 536 bytes (8.7 MiB)** with the embedded `dist/`; login → dashboard → payment → **A4 and thermal receipts rendered under the production CSP** (screenshots above); `xdotool getwindowname` still `CentreManager V1.1`, `1280x800` |

The full table with the expected value, the test name and the outcome is in *The twenty edge
cases* above. Cases 1–6 (the due-date arithmetic) are Rust-only by nature; 15 and 16 only exist
in a browser (an Arabic name in a French table, an LTR phone in an RTL modal); 20 is a UI state
(a button disabled while saving); the rest are Rust tests — all twenty are asserted, none is
merely argued.

> **About the installer.** NSIS only runs on Windows, so `CentreManager_1.1.0_x64-setup.exe`
> cannot be produced in this Linux sandbox. Everything up to the wrapper was: the release
> binary above is built with the **production CSP** and the **production asset embedding**
> (identical to what `tauri build` puts in the installer), and the payload it carries was
> measured — `dist/` = **1.84 MB on disk ≈ 618 kB gzip**, of which the eagerly loaded shell is
> 592 kB (≈ 162 kB gzip) and the `@react-pdf` chunk (1 235 kB) is fetched only when a receipt
> opens. Expect a **~4–6 MB** NSIS installer (per-user, WebView2 not embedded).
>
> The binary was compiled with `lto = false` / `codegen-units = 16` (env override only —
> `Cargo.toml` still asks for `lto = true`, `codegen-units = 1`, `panic = "abort"`,
> `strip = true`) because the project's LTO link needs ~2 GB of RAM and this sandbox has
> exactly 2 GB: the LTO build thrashed and never finished. On a normal developer machine the
> documented `npm run tauri build` produces the same binary **smaller** (LTO + strip), so treat
> 8.7 MiB as the upper bound.

Five defects were found and fixed during Phase 9 — the demo collection pattern, the demo fee
range, the post-seed logout, the blank receipt preview under the production CSP, and the
app-data folder move caused by the identifier change (table in *What Phase 9 fixed*).

### Phase 8 — receipt PDFs and UI polish

| Gate | Result |
| --- | --- |
| `cargo test` | **133 passed, 0 failed** — 1 new test (`late_count_spans_every_period`) |
| `cargo fmt --check` / `cargo build` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **550.34 kB (153.60 kB gzip)**, CSS 33.75 kB (6.82 kB gzip); `react-pdf.browser-*.js` **1 235.56 kB (455.44 kB gzip)** in its own lazy chunk, loaded only when a receipt opens |
| `npm run check:i18n` | fr **579** / ar **579** keys, `579 keys used, all present` |
| Browser walkthrough (Playwright, dev backend, headed for the PDF viewer) | **65 assertions, 0 failures**, 0 unexpected console errors (4 expected: the `/__error` crash it provokes), **0 `@react-pdf` warnings** |
| Real Tauri window (Xvfb + SQLite) | two receipts issued (thermal, then A4 toggled), badge `3 → 2 →` gone, lock/unlock, full Arabic/RTL pass — cross-checked in SQLite (see below) |
| PDF geometry (`tools/p8-pdf-check.py`) | A4 `595.28 × 841.89 pt`, 1 page, logo embedded, title `REÇU DE PAIEMENT REC-…`; thermal `226 × 151 pt` (one period) / `226 × 215 pt` (a period that wraps) |
| Overlap check (`pdfplumber`, one-off) | 0 overlapping text lines and 0 lines below the MediaBox, for 1, 2 and 3 periods, in both templates |

What the real window did, and what SQLite says:

| Step | Effect |
| --- | --- |
| Dashboard, 01/11/2026 | the sidebar shows a red **3** on *Paiements* — exactly the three invoices of 10/2026 still unpaid (`due_date 2026-10-31`) |
| Payments, month `Octobre 2026` → *Encaisser* on Yassine → 4 steps | amount prefilled `700.00 DH` (400 November + 300 October remaining), `Confirmer & Imprimer` → the PDF modal opens with the **thermal** receipt, correctly laid out |
| SQLite | `payments` ids `7` (`30000`, invoice 3) and `8` (`40000`, invoice 9), `receipts` id 3 `REC-20261101-0001` / `70000` / `Yassine El Amrani` |
| Same modal → `A4` | the A4 sheet renders inline: centred header with address + phone, rules, `REÇU DE PAIEMENT`, `Reçu n° REC-…` left / `Date 01/11/2026` right, `Montant payé` `700.00 DH` in blue 20 pt, footer |
| Badge after that payment | **2** (`Salma` still owes two invoices of October) |
| Arabic / RTL pass | sidebar on the right, badge on the top-end corner, tables mirrored, `تحصيل` on Salma → 1 150.00 DH over 4 invoices, `تأكيد وطباعة` → receipt `REC-20261101-0002` (id 4, `115000`, `Salma Benjelloun`) with the amber Arabic limitation note and the toggle mirrored (`A4` / `حراري 80 مم`) |
| Badge after the second payment | **gone** — nothing is late any more (`لا يوجد تلاميذ متأخرون 🎉`) |
| Lock (`Ctrl+L` and the header padlock) | `Session verrouillée`, one password, back on *Paiements* |

Four defects were found by these passes and fixed:

| Defect | Fix |
| --- | --- |
| **Thermal receipt overlapped** its own blocks as soon as a value wrapped: a payment covering two periods (the *normal* case — October + November) drew `TOTAL` and `Mode` on top of each other, because `height: 'auto'` is measured once and a wrapped `Text` in a flex row does not push the next block down | `wrapValue()` splits each value into single-line chunks (Courier is monospace: 39 chars at 7 pt, 34 at 8 pt) and each chunk becomes its own row; verified with `pdfplumber` (0 overlaps, page grows 198 → 215 pt) |
| **RTL: the phone was glued to the student name** in the payment modal (`0699887766Salma Benjelloun`) — `ms-2` on a `dir="ltr"` span resolves to that span's *own* left edge, so in RTL no gap was left | the separator moved inside the LTR run: `` {` — ${student.phone}`} `` |
| **The badge counted only the current month**, so on 1 November it hid three overdue October invoices the dashboard was showing | new `cmd_get_late_payment_count` (all periods, `due_date < today`, not fully paid) — see the deviation note above |
| `Imprimer` could not print: `window.open(url, '_blank', 'noopener,noreferrer')` returns a handle whose `url()` is `""` and whose `print()` is blocked | plain `window.open(url, '_blank')` (the blob URL is same-origin and revoked after 60 s) |

Two testing-only traps, for whoever reruns the suites: React Router ignores a
`popstate` to the current route (a page keeps stale data — bounce through `/`
first), and a dynamic `import('/src/stores/appStore.ts')` gets a **second** module
instance once Vite has hot-reloaded the file, so `setState` on it changes nothing
in the UI.

| Acceptance criterion | Evidence |
| --- | --- |
| A4 + thermal PDFs valid, laid out as specified | ✅ `595.28 × 841.89 pt` / `226 × 151 pt`, 20 mm margins, Helvetica + Courier, rules, amount 20 pt `#2563EB`; screenshots above |
| Inline PDF preview (`PDFViewer`, 400 px) | ✅ `receipt-preview iframe` with a `blob:` URL in the browser run, and the real WebKitGTK window renders it natively |
| Download produces a valid `.pdf` with the right name | ✅ `recu_REC-20261101-0001.pdf`, parsed back (1 page, text and logo present) |
| `Imprimer` opens a clean print view | ✅ popup handle present (`window.open` without `noopener`), `@media print` hides sidebar/header/modal chrome; the PDF is the only thing sent to the printer |
| Frozen receipt data | ✅ student renamed to `Élève Renommé`, the issued receipt still reads `Yassine El Amrani`; same for the amount and the groups |
| Template toggle + default from settings | ✅ `A4` ↔ `Thermique 80 mm` switch without reload; default `a4`, and `receipt_format = thermal` in the settings changes the default |
| Arabic: no crash, limitation explained | ✅ viewer renders, `receipt-arabic-note` shown, isolates stripped; PDF glyphs unreadable — documented V1 limitation |
| No `@react-pdf` warnings | ✅ `pdfRelated: []` in the browser run |
| Error boundary catches | ✅ `/__error` → `error-boundary` card with `Une erreur est survenue`, technical detail in dev, `Recharger`; the sidebar keeps working; the next route is clean (keyed boundaries) |
| `Ctrl+K` / `Ctrl+L` / `Escape` | ✅ `Ctrl+K` focuses `students-search`, `Ctrl+L` shows `lock-screen` and unlocking returns to the same page, `Escape` pops the topmost modal (and a plain form modal too) |
| Press / modal animations | ✅ `.btn-press:active` → `scale(0.97)`, opened dialogs carry `modal-enter` → `modalIn`, `.tab-indicator` present, `.badge-alert` → `pulse-red` |
| Badge count, pulse, `9+`, decreases | ✅ `2` on two overdue invoices (pulsing, on the icon corner), `9+` for 12, `1` after a payment, gone after the last one; real window `3 → 2 → gone` |
| Empty states | ✅ every screen audited; students `Aucun élève` on an empty search, the three payment buckets, dashboard cards, teacher payroll — the student *Finances* tab already had `Aucune facture` / `Aucun paiement`, so nothing had to be added |
| Toasts | ✅ 3 visible max, oldest dropped first, `success 3000 / info 4000 / error 5000 / warning 0`, bottom-right LTR and bottom-left RTL |
| RTL parity | ✅ sidebar, badge corner, tables, modals, PDF modal footer, toasts; the receipt *paper* is the documented exception |
| Phases 0–7 intact | ✅ 133 Rust tests, the browser run re-walks students, groups, payments, receipts, shortcuts and the student sheet; the Phase 7 dashboard numbers still match the database |
| Build < 600 kB gzip | ✅ 153.60 kB gzip for the shell (455.44 kB gzip for the on-demand PDF chunk, documented as intentional) |

### Phase 7 — dashboard

| Gate | Result |
| --- | --- |
| `cargo test` | **132 passed, 0 failed** — 15 new `commands::dashboard::*` tests (KPI semantics, month boundaries, `rate = 0` without invoices, previous-month comparisons, ±7-day window, severities, remaining amounts, ordering, alert cap, payment limits) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, **539.03 kB (149.43 kB gzip)**, CSS 31.23 kB (6.38 kB gzip) |
| Browser walkthrough (Playwright, dev backend) | **85 assertions, 0 failures, 0 console errors** |
| Real Tauri window (Xvfb, SQLite) | 3 invoices generated from the payments page, a 300.00 DH payment recorded from the student sheet, both periods, FR + AR, mobile/tablet widths — all cross-checked in SQLite (see below) |
| i18n | fr **565** / ar **565** keys, `npm run check:i18n` → 565 keys used, none missing |

What the real window did, and what SQLite says:

| Step | Effect |
| --- | --- |
| Payments → *Générer factures* on 11/2026 | `3 factures générées ✓`; the dashboard hint jumped from `0.00 DH / 0.00 DH` to `0.00 DH / 1050.00 DH` |
| Student sheet → Finances → *Enregistrer paiement* 300.00 DH | card `300.00 DH`, rate `28.6 %` (300 / 1050), two new rows at the top of *Derniers paiements* dated `01/11/2026`, and the Arabe échéance fell from `350.00 DH` to `200.00 DH` |

| Table | Content |
| --- | --- |
| `invoices` | 3 rows for 11/2026 (`ids 7–9` · `35000`, `30000`, `40000` → `105000`, all `due_date 2026-11-30`); the three of 10/2026 are now `20000/35000 partiel`, `30000/30000 impayé`, `30000/40000 partiel` |
| `payments` | 2 new rows of `15000` (`espèces`, one timestamp `2026-11-01 01:11:43`) on invoices `5` then `1` — oldest unpaid first, no prorata — plus the 4 rows of `2026-10-31` |
| computed | revenue 11/2026 = `30000` → `300.00 DH`; theoretical = `105000` → `1050.00 DH`; rate `28.57…` → `28.6 %`; the three échéances are exactly the invoices due `2026-10-31` with `20000 / 30000 / 30000` remaining |
| October period | revenue `1000.00 DH`, theoretical `1050.00 DH`, rate `95.2 %`, 6 payments listed, payroll `Youssef Benani · Pourcentage · 292.50 DH dû · 292.50 réglé · 0.00 reste · Réglé` |
| Arabic | `مرحبا`, `أكتوبر 2026`, `95.2 %`, hint `1050.00 DH / 1000.00 DH`, `متأخر بيوم واحد`, `أستاذ واحد مُهيَّأ` (CLDR *one*) |

Four defects were found by these passes and fixed:

| Defect | Fix |
| --- | --- |
| The trend label was hardcoded in the card: a month with no baseline showed `+0%` instead of `—`, and the `dashboard.trend.*` translations were never used | `KpiCard` now renders `trendText(t, trend)`; `computeTrend(0, 0)` is `stable` → `—`, and `percent: null` renders `—` rather than an invented percentage |
| The échéances card stretched to the height of the payments card, leaving a large empty area under three rows | `items-start` on the two-card grid: each card keeps its natural height |
| The 60 / 40 split only appeared at 1280 px, not on 1024 px desktops as specified | breakpoints moved to `lg` (`lg:grid-cols-5`, `lg:col-span-3` / `lg:col-span-2`) |
| At 390 px the sidebar kept its 250 px width and squeezed the content; long KPI labels overflowed the card (`recouvremen`) and then broke mid-word (`Groupe s actifs`) | below `lg` the sidebar is an icon-only 72 px rail (labels `hidden lg:inline`, items centred with `max-lg:`), and below `sm` the KPI bubble sits above the label so the words keep the full card width |

| Acceptance criterion | Evidence |
| --- | --- |
| Dashboard is the landing route after login | ✅ browser: `/` renders the greeting, `Dimanche 1 novembre 2026` and the KPIs; breadcrumb `Tableau de bord` |
| Five KPIs, computed for the period | ✅ dev seed: élèves `3`, revenus `1000.00 DH`, taux `83.3 %`, groupes `3`, enseignants `2`; previous period `550.00 DH` / `900.00 DH` → `61.1 %`; real window cross-checked against SQL |
| Comparison with the previous month | ✅ `+50 %` and `+82 %` in green, `−70 %` in red after the new month started, `—` when the baseline is zero (`computeTrend` returns `percent: null`) |
| Collection rate colour | ✅ `83.3 %` and `95.2 %` green (> 80 %), `61.1 %` amber (`text-warning`), `0.0 %` and `28.6 %` red (`text-destructive`) |
| Échéances ±7 days, sorted, remaining amounts | ✅ 3 rows: `En retard de 3 jours` (350.00, red), `Demain` (150.00, amber), `Dans 5 jours` (50.00, muted); count badge `3`; after a partial payment the row read `200.00 DH`, not `350.00 DH` |
| Échéance → student sheet | ✅ `dashboard-alert-0` → `/students/2`; browser assertion on the URL and the sheet |
| Last payments, newest first, method badges | ✅ 8 rows in the seed, 6 in the real DB; `Espèces` / `Chèque` / `Virement`, amounts green, `01/11/2026` on top after the real-window payment |
| *Voir tout* shortcuts | ✅ échéances and payments → `/payments`, payroll → `/teachers`; a payroll row → `/teachers/1` |
| Payroll card for the period | ✅ `1 enseignant configuré` / `2 enseignants configurés` badges, modes, totals, `Réglé` / `Partiel` / `Non réglé`; teachers without a configuration are excluded |
| Period switch | ✅ month `Octobre` → `550.00 DH`, `61.1 %`, hint `550.00 DH / 900.00 DH`, échéances unchanged (they are always "now"); back to `Novembre` → `1000.00 DH` |
| Skeletons, no flash | ✅ five `dashboard-kpi-skeleton` (plus the three list skeletons) on first load; switching the period keeps the previous figures until the new ones arrive |
| Empty centre | ✅ zeros, `0.0 %` red, `—` trend, `Aucune échéance cette semaine 🎉`, `Aucun paiement récent`, `Aucun enseignant` |
| Responsive | ✅ 5 columns + 60 / 40 at 1440 px (677 / 445 px), 3 + 2 at 820 px, 2 × 2 + 1 at 390 px with no horizontal overflow |
| Arabic / RTL parity | ✅ greeting, KPI labels, `83.3 %`, `+50 %`, `الاستحقاقات`, `متأخر بـ 3 أيام`, `غداً`, `آخر الأداءات`, `أجور الأساتذة`, `جزئي`; the trend sign and the rate keep their order (`dir="ltr"` isolates) |
| Read-only backend, no side effects | ✅ the three commands only read; `dashboard.rs` has no write path, and re-running the dashboard after a payment reflects the new state without touching anything |
| Earlier phases intact | ✅ students, groups, teachers, payments and settings screens re-checked in the browser run; `cargo test` 132/132 |

### Phase 6 — teachers & compensation

| Gate | Result |
| --- | --- |
| `cargo test` | **117 passed, 0 failed** — 27 new tests (`teachers::*`, `compensation::*`, `activities::*`, plus the schema-upgrade test) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, 508.25 kB (141.90 kB gzip), CSS 29.86 kB |
| Browser walkthrough (Playwright, dev backend) | **104 assertions, 0 failures, 0 console errors** |
| Real Tauri window (Xvfb, SQLite) | teacher created from the form, two groups assigned, 40 % + 5 % configured, 2 activities, 2 cumulative settlements, payroll tab 2, FR + AR — all verified in SQLite (see below) |
| i18n | fr **540** / ar **540** keys, `npm run check:i18n` → 540 keys used, none missing |

What the real window left in the database:

| Table | Content |
| --- | --- |
| `teachers` | `1 · Youssef Benani · 0661234567 · actif · percentage / 4000 / bonus 5.0` (empty email, notes `Maths et physique, 2eme Bac.`) |
| `teacher_subjects` | `(1,1)` Mathématiques and `(1,2)` Physique-Chimie |
| `groups` | `2` (Arabe — 2ème Bac, 35000) and `3` (Mathématiques — Tronc Commun, 30000) now carry `teacher_id = 1` |
| `teacher_activities` | `2026-11-01 · cours · 2.5 h · 1 séance` and `2026-11-01 · rattrapage · 1.5 h · 2 séances` → totals `4 h / 3 séances` |
| `teacher_settlements` | `10000` (virement) then `19250` (espèces), both `month 11 / year 2026` → `29250` settled on a `29250` total |
| `audit_log` | `CREATE {teacher_id:1}`, `SET_COMPENSATION {from:{null}, to:{percentage, 4000, 5.0}}`, two `ACTIVITY`, two `SETTLEMENT` (with `month`, `amount_cents`, `status`, `total_cents`) |

The two groups of the teacher carried **0.00 DH of collections** the whole time
(`Encaissé: 0.00 DH` on both group sheets), which is exactly the point of the
percentage mode: the payroll still owed `260.00 DH + 32.50 DH = 292.50 DH`.

Four defects were found during this phase and fixed:

| Defect | Fix |
| --- | --- |
| `1 élèves` in the detail line (French takes the singular for 0 and 1) | `lineGroup` / `lineSessions` became real CLDR plurals (`_one` / `_other` in fr, the six forms in ar) |
| `Total réglé0.00 DH` — the label and the amount were glued together once the summary row switched to two columns | the amount spans became `block` so they always sit under their label |
| In Arabic, `292.50 DH` was rendered `DH 292.50`: the digits were read as Arabic numbers and pushed after the currency | `formatCurrency()` wraps the amount in the `U+2066 … U+2069` isolates, and each calculation line renders its formula in a `dir="ltr"` span |
| Enabling the bonus toggle immediately showed `Le pourcentage doit être compris entre 0 et 100` on the empty field | an empty bonus field is tolerated (saved as no bonus) and the error only appears once a real out-of-range value is typed |

| Acceptance criterion | Evidence |
| --- | --- |
| Create / edit a teacher with subjects | ✅ real window: `Youssef Benani`, `0661234567`, Mathématiques + Physique-Chimie, notes → `Enseignant ajouté ✓`; browser: edit renames and swaps the subjects (`[3,5] → [3,7]`), both audited (`CREATE`, `UPDATE` with a diff) |
| Moroccan phone validation | ✅ `12` → `Format invalide (06XXXXXXXX, 07XXXXXXXX ou +212…)` on blur, save blocked; Rust returns the same message |
| Compensation saved incl. bonus | ✅ `SET_COMPENSATION` with `from`/`to`, card badge `40% du théorique`, `compensation_value_cents = 4000`, `bonus_pct = 5.0` |
| Four modes compute correctly | ✅ fixed `Montant fixe : 1000.00 DH`; hourly `4 heures × 80.00 DH / heure = 320.00 DH` (two activities summed); per session `3 séances × 150.00 DH / séance = 450.00 DH`; percentage `1 élève × 350.00 DH = 350.00 DH` → `140.00 DH` |
| Percentage on **theoretical** revenue | ✅ theoretical `650.00 DH` with `0.00 DH` collected → `260.00 DH` base; Rust test proves the same with **no invoice at all** |
| Bonus added on top | ✅ `Bonus recrutement : 650.00 DH × 5% = 32.50 DH`, total `292.50 DH` = base + bonus |
| Multiple cumulative settlements + statuses | ✅ `10000` → 🟡 `Partiel` (`reste 192.50 DH`) → `19250` → 🟢 `Réglé` (`reste 0.00 DH`); the two rows stay listed, `SETTLEMENT` audited twice |
| Payments tab 2 correct for everyone | ✅ 3 teachers (settled / partial / not configured) with the right modes, totals and a `💡` totals row; the table refreshes after a settlement made from it |
| Settlement modal from both places | ✅ payroll tab and Payments row both open it prefilled with the remaining amount |
| No delete button | ✅ zero buttons in the settlements table (asserted), no delete action anywhere on the sheet |
| Unconfigured teacher cannot settle | ✅ `Régler` disabled on the payroll tab **and** on the Payments row, `⚠️ Compensation non configurée` + shortcut to the configuration card |
| Audit | ✅ `CREATE`, `UPDATE`, `STATUS_CHANGE`, `SET_COMPENSATION`, `ACTIVITY`, `SETTLEMENT`, all `entity_type = 'teacher'` |
| Arabic / RTL parity | ✅ grid, sheet, four tabs, payroll, settlements table and Payments tab 2 mirrored; `292.50 DH` keeps its order; status `مؤدى` / `جزئي` / `غير معد` |
| Phases 0–5 intact | ✅ `cargo test` 117/117, students, groups, enrollment, invoices, payments and receipts screens unchanged, the group form still lists the active teachers |

### Phase 5 — invoicing & payments

| Gate | Result |
| --- | --- |
| `cargo test` | **90 passed, 0 failed** — 22 new tests (`invoices::*` and `payments::*`) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, 449.75 kB (129.74 kB gzip), CSS 29.41 kB |
| Browser walkthrough (Playwright, dev backend) | **97 assertions, 0 failures, 0 console errors** |
| Real Tauri window (Xvfb, SQLite) | the September generation from the payments page (3 invoices, `due_date 2026-09-30`), a 500 DH transfer from the late table, a 500 DH cash payment with notes from the payments page, 2 receipts, FR + AR — all verified in SQLite (see below) |
| i18n | fr **410** / ar **410** keys, `npm run check:i18n` → 410 keys used, none missing |

What the real window left in the database:

| Table | Content |
| --- | --- |
| `invoices` | 3 rows for 09/2026 (`35000`, `30000`, `40000`, `due_date 2026-09-30`) + the 3 enrollment invoices of 10/2026; after the two payments: `4` → `35000/35000 payé`, `5` → `30000/15000 partiel`, `6` → `40000/40000 payé`, `3` → `40000/10000 partiel` |
| `payments` | `35000` + `15000` (virement, one timestamp) then `40000` + `10000` (espèces, notes `Virement recu`, one timestamp) — the oldest invoices absorbed the money first in both cases |
| `receipts` | `REC-20261031-0001` (Salma, 50000) and `REC-20261031-0002` (Yassine, 50000), frozen names and groups |
| `audit_log` | `GENERATE_INVOICES {month:9, year:2026, count:3}`, `PAYMENT {allocations:[{invoice_id:6, 40000},{invoice_id:3, 10000}], advance_cents:0}` and the matching `RECEIPT` rows |

One defect was found by the real-window pass and fixed in this phase:

| Defect | Fix |
| --- | --- |
| The amount field of step 3 was **blank while focused** and typing then produced garbage (`500` + `12.34` → `50012.34`): a `useEffect` wrote the `toFixed(2)` value back into the focused input | `MoneyInput` now derives its text (`focused ? typed : formatted`) with no effect sync, seeds the raw value once in a ref on focus, and sanitises in the change handler; the focused value is `500`, the blurred one `500.00` |

| Acceptance criterion | Evidence |
| --- | --- |
| Generation is idempotent and one invoice per active enrollment | ✅ first run `3 factures générées ✓`, second run `Aucune facture à générer pour cette période`, 3 rows in `invoices` |
| Amounts from the group fee, due date = enrollment day | ✅ `35000 / 30000 / 40000`, `due_date 2026-09-30` (day 31 clamped by `adjust_due_date`) |
| Oldest-first allocation | ✅ 500 DH on the 09/2026 + 10/2026 invoices → September paid in full (`35000`), October part-paid (`15000`); a second payment → `40000` on 09/2026 and `10000` on 10/2026 |
| Status transitions | ✅ `impayé → payé` and `impayé → partiel` recomputed from the amounts |
| Advance | ✅ browser run: paying 250.00 DH against the 150.00 DH still due creates the allocation row plus one `invoice_id = NULL` advance row of `10000` centimes, with the `Le surplus sera enregistré comme avance` notice on steps 3 and 4 |
| Retard / Proches / À jour, with sorting | ✅ 09/2026 → 2 students late (`31 jours`), most overdue first; 10/2026 → 2 students `Proches`; a fully paid month shows the `🟢 À jour` list |
| Four-step modal end to end | ✅ Élève → Factures (pre-checked, total 1300.00) → Paiement (partial warning `Il restera 800.00 DH`) → Confirmation → `Paiement enregistré ✓` |
| Receipt frozen at issuance | ✅ Rust test `receipt_freezes_the_student_name_and_totals`: the receipt is issued, the student row is then renamed to `Salma B. (mariée)`, and `cmd_get_receipt_data` still returns `Salma Benjelloun` with the original amount and groups; the centre block is the only live part (read from `settings`) |
| Receipt printing | ✅ `Imprimer` calls `window.print()`; under emulated print media the computed style keeps `[data-testid=receipt-preview]` visible and hides the app chrome, and the screenshot shows the 148 mm card alone on the sheet (`docs/screenshots/payments-11-print.png`) |
| Student *Finances* tab | ✅ `Total dû 1300.00 DH` / `Total payé 500.00 DH` / `Reste 800.00 DH`, 4 invoice rows with `(en retard)` on the overdue one, 2 history rows |
| No delete UI | ✅ no delete action on invoices, payments or receipts anywhere |
| Centimes ↔ DH | ✅ every stored value is an `i64` of centimes, every screen shows `formatCurrency`; 500 DH typed → `50000` stored |
| Audit log | ✅ `GENERATE_INVOICES`, `PAYMENT` (with allocations), `RECEIPT` |
| Arabic RTL | ✅ payments page (`المدفوعات`, `التحصيل` / `أجور الأساتذة`, `فريبو الاستحقاق`), payment modal (`تحصيل مبلغ`), receipt (`إيصال الدفع`), student finances (`DH 800.00`, `تحويل بنكي`) — all mirrored, amounts formatted the same |
| No console errors / warnings, earlier phases intact | ✅ 0 console errors; auth, settings, students, groups and enrollment checks still pass |

### Phase 4 — groups & enrollment

| Gate | Result |
| --- | --- |
| `cargo test` | **68 passed, 0 failed** — 20 new tests (`groups::*` and `enrollments::*`) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, 408 kB (120 kB gzip) |
| Browser walkthrough (Playwright, dev backend) | **89 assertions, 0 failures, 0 console errors** |
| Real Tauri window (Xvfb, SQLite) | 2 groups created through the form, 1 edited, 3 enrollments (1 batch of 2, 1 from the group sheet), 1 end, 1 reactivation, FR + AR — all verified in SQLite (see below) |
| i18n | fr **398** / ar **406** keys (the six Arabic CLDR plural forms); `npm run check:i18n` → 317 keys used, none missing |

What the real window left in the database:

| Table | Content |
| --- | --- |
| `groups` | `Arabe · 2ème Bac · Autre · Mardi 16:00-18:00 · Salle 12 · 35000 · cap 15`, `Mathématiques · Tronc Commun · Mercredi 14:00-16:00 · Salle 4 · 30000 · cap 1`, and the legacy row 1 edited to `Français · 2ème année · Lundi 16:00-18:00 · Salle 5 · 40000 · cap 20` |
| `enrollments` | 3 active rows (student 2 → groups 2 and 3, student 1 → group 1, `start_date 2026-10-31`) |
| `invoices` | `35000`, `30000` and `40000` centimes, `period 10/2026`, `impayé`, `due_date 2026-10-31` |
| `audit_log` | `group CREATE ×2`, `group UPDATE ×1` (6-field diff), `enrollment ENROLL ×3` (one with `invoice_created:false` after a reactivation), `END_ENROLLMENT ×1` |

Three defects were found by the real-window pass that the browser walkthrough had
missed, and are fixed in this phase:

| Defect | Fix |
| --- | --- |
| The student search in `from_group` mode rendered the raw i18n key `students.searchPlaceholder` | the component now uses the existing `students.search`, and `npm run check:i18n` guards the whole app against this class of bug |
| Editing a group whose `branch_id` does not belong to its `level_id` (imported/legacy rows) silently sent the stale id back and was refused with `La branche ne correspond pas au niveau sélectionné` | `GroupModal` clears a branch that is not in the level's list, so the form always saves what it displays |
| The confirmation step labelled the student name as "Groupe :" in `from_group` mode | the heading is always "Élève :", the fixed group being listed in the rows below |

| Acceptance criterion | Evidence |
| --- | --- |
| Create a group with every field → correct card + capacity bar | ✅ form → card `Informatique — 2ème Bac Sciences Maths`, 400 DH, 0/4, green bar |
| Edit a group → changes reflected | ✅ browser: fee 250 → 275, room → Salle 9, card + sheet + `UPDATE` diff updated. Real window: subject set to `Français` and room to `Salle 5` on the legacy row → header `Français — 2ème année`, `Groupe modifié ✓`, audit `{"subject_id":{"from":null,"to":4},"room":{"from":null,"to":"Salle 5"}…}` |
| School-year filter | ✅ second year `2025-2026` created in settings; filtering shows 1 group vs 6 |
| Capacity bar colours | ✅ 25 %→green, 75 %→amber (`data-tone="warning"`), 100 %→red |
| Enroll in one group → invoice generated | ✅ `amount_cents = 40000`, `paid = 0`, `impayé`, `due_date` = start date |
| Several groups, same day | ✅ `2 inscriptions créées ✓`, two invoices, both `2026-03-05` |
| Different dates per group | ✅ `2026-01-31` → period 1 invoice, `2026-02-10` → period 2 invoice |
| Duplicate enrollment | ✅ `Déjà inscrit dans ce groupe` (Rust test + API assertion); the UI hides already-enrolled groups |
| Full group | ✅ `Groupe complet` error (Rust/API), checkbox disabled + red badge in the wizard, card bar red at 1/1 |
| End enrollment keeps the invoice | ✅ `status = terminé`, `end_date` set, invoice row byte-identical, `END_ENROLLMENT` audit |
| End-of-month due date rule | ✅ `adjust_due_date`: Jan 31→Feb 28, leap→Feb 29, Jan 30→Feb 28, Mar 31→Apr 30, May 31→Jun 30 |
| Group sheet financial summary | ✅ `Théorique: 800.00 DH (2 élèves × 400.00 DH)` vs `Encaissé: 300.00 DH`, bar at 38 % |
| Student sheet tab 2 | ✅ 2 active enrollments + a collapsed `Inscriptions terminées (1)` table with the end date |
| Wizard, both modes | ✅ `from_student` (multi-select, per-group dates, batch of 2) and `from_group` (`+ Ajouter élève` on the group sheet → search → `1 inscription créée ✓`, invoice 40000 centimes, table row `Yassine El Amrani · 0612345678 · 31/10/2026`) |
| Audit log | ✅ `group CREATE`, `group UPDATE` (diff), `enrollment ENROLL`, `enrollment END_ENROLLMENT` |
| Arabic RTL | ✅ browser: grid, sheet, wizard (Arabic step labels) mirrored. Real window: sidebar switches to the right, cards reverse, `المجموعات 3`, `+ مجموعة جديدة` |
| No console errors / warnings, earlier phases intact | ✅ 0 console errors; auth, settings and student CRUD still pass their checks |

### Phase 3 — student management

| Gate | Result |
| --- | --- |
| `cargo test` | **48 passed, 0 failed** — 11 new `commands::students::*` tests (audit snapshot + diff, no-op update writes nothing, filters/pagination, phone rule, status toggle, missing-student errors, level delete keeps students, Phase 4/5 arrays empty) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `vite build` | clean, 363 kB (109 kB gzip) |
| Browser walkthrough (Playwright, dev backend) | **83 assertions, 0 failures, 0 console errors** — see the table below |
| Real Tauri window (Xvfb, SQLite) | created 2 students (one required-only, one full record), edited a phone, deactivated and reactivated; verified in SQLite: rows joined to `levels`/`branches`, `audit_log` = `CREATE` (snapshot) ×2, `UPDATE` (`{"phone":{"from":"0723456789","to":"0699887766"}}`), `STATUS_CHANGE` ×2 |
| i18n | fr **274** / ar **274** keys, no missing or extra key |

| Acceptance criterion | Evidence |
| --- | --- |
| List renders seeded students with level + branch | ✅ `2ème Bac — Sciences Maths` in the Niveau column |
| Search: partial, case-insensitive, name or phone | ✅ `sal` → Salma only; `0612345678` → Yassine only; `zzz` → empty state |
| Search is debounced (300 ms) | ✅ asserted that the table is **unchanged** 60 ms after typing and filtered 500 ms later |
| Level filter | ✅ `6ème année` → only 6ème rows |
| Status filter, default `Actifs` | ✅ 3 actives by default, `Tous` → 4, `Inactifs` → 1 |
| Pagination text and boundaries | ✅ 25 rows: `Affichage 1-20 sur 25`, `Page 1 sur 2`, `Suivant` → `Affichage 21-25 sur 25`, both buttons disabled at their ends |
| Create, required fields only | ✅ `Amine Berrada` + phone → row appears, `—` in Niveau |
| Create, every field | ✅ `Hind Ouazzani` with birth date, parent phone, level, branch, address, notes → all visible on the sheet |
| Edit | ✅ modal prefilled from the API, phone changed, list + sheet + history updated |
| Phone validation | ✅ `0123456789`, `061234567`, `0812345678` block submit; `0612345678` / `0712345678` pass; parent phone validated too |
| Branch select filtered by level | ✅ disabled with no level, `2ème Bac` → 5 lycée branches, `6ème année` → disabled again |
| Detail tabs | ✅ Informations populated, Inscriptions/Finances placeholders, Historique shows the create/update/status entries with the before → after diff |
| Deactivate / reactivate with confirmation | ✅ `Désactiver « Salma Benjelloun » ?` → badge turns grey/red, button becomes `Réactiver`, both audited |
| Skeletons and empty state | ✅ 5 skeleton rows while loading; `Aucun élève trouvé` + `Ajouter le premier élève` on an empty database |
| Arabic RTL | ✅ sidebar, breadcrumb, table columns and pagination mirrored; `عرض 1 إلى 2 من أصل 2 نتيجة` |
| No console errors, auth + settings still work | ✅ 0 console errors; login, lock, settings untouched |

### Phase 2 — settings & reference data

| Gate | Result |
| --- | --- |
| `cargo test` | **37 passed, 0 failed** (5 new suites: settings, school years, levels/branches, subjects, backup) |
| `cargo fmt --check` / `cargo check` | clean, **0 warnings** |
| `npx tsc --noEmit` / `npm run build` | clean, bundle 335 kB (102 kB gzip) |
| Browser walkthrough (Playwright, dev backend) | **71 assertions, 0 failures, 0 console errors** — all 8 sections, persistence across reload, single active year, ordering, delete guard, subject toggle, language RTL, printing, password modal, backup + restore flows |
| Real Tauri window (Xvfb, fresh DB) | seeding verified in SQLite (12 levels / 15 branches / 10 subjects / 1 active year); centre info, level rename+delete, branch add, subject toggle+add, `receipt_format`, lock timeout and language persisted to the DB; delete refused with “Ce niveau est utilisé par 1 groupe(s)…” |
| Native dialogs (`tauri-plugin-dialog`) | save dialog opened with `centremanager_backup_20261031.db`, produced a valid 196 KB SQLite copy; open dialog accepted the `.db` filter |
| Restart | all settings, reference data and the new password survived a full app restart (old password rejected, new one accepted) |

### Phase 1 — authentication & security

Verified by three independent means: Rust unit tests, a scripted browser run of every UI flow, and manual end-to-end runs in the **real Tauri window** (screenshots above).

| Acceptance criterion | Evidence |
| --- | --- |
| First launch → setup screen → dashboard | ✅ Real app with a wiped app-data dir; `center_name` + `$argon2id$…` hash written to `settings` |
| Close & reopen → login screen | ✅ App restarted: centre-named login card, sidebar absent |
| Correct password → dashboard | ✅ Real app (FR and AR) via Argon2 verification |
| Wrong password → shake + error | ✅ Inline red message + toast; `.animate-shake` present |
| 3 wrong passwords → disabled + 30 s countdown | ✅ Captured in the real app at 29s; countdown ticks and re-enables after 30 s (timed assertion) |
| Auto-lock after idle timeout | ✅ `0.05` min → overlay after ~3 s; `0` → never locks |
| Manual lock via header 🔒 | ✅ Overlay covers the sidebar (element-hit test); page stays mounted |
| Unlock → overlay gone, same page | ✅ Locked on `/students`, unlocked on `/students` |
| Password change via `cmd_change_password` | ✅ Rust tests: old password required, min length enforced, old hash invalidated |
| Lock timeout configurable | ✅ localStorage `lock_timeout_minutes` (5/10/15/30/60/0) + persisted to `settings` |
| No console errors / Rust warnings | ✅ 0 console errors over the full run; `cargo check` clean; `cargo fmt --check` clean; `tsc` clean |
| Existing sidebar, routing, i18n still work | ✅ All 6 nav routes + `/students/:id`, FR↔AR with RTL flip |

* **Rust tests: 15 passed** — schema (17 tables, idempotent), WAL, foreign keys, Argon2id hashing/salt/verification, malformed-hash rejection, setup flow, validation, change-password rules, centre-name fallback, lock-timeout persistence/validation, backend cooldown (helpers **and** the real login path), `cmd_ping`.
* **Browser run: 33 assertions passed**, 0 console errors — setup validation → setup → dashboard, reload → login, wrong password, 3-attempt lockout with live countdown and re-enable, login, manual lock, sidebar coverage, wrong-password shake on the lock screen, unlock to the same page, idle auto-lock, timeout `0` = disabled, Arabic RTL strings.

### Phase 0 — scaffold (still green)

`npm run tauri dev` launches the window; sidebar navigation across all pages; FR ↔ AR with the sidebar moving right; SQLite file with all 17 tables in `wal` mode; `cmd_ping` → `"pong"` via `window.__TAURI__.core.invoke('cmd_ping')`; Tailwind applied; `npm run build` clean.

---

## Notes & next steps

* **Phase 9 shipped the release** (demo data, the twenty edge cases, packaging V1.1). What is
  still open before V2: an Arabic receipt (see limitation 3), a native print bridge, an
  automatic month-end invoice run, and an in-app restore.
* Demo-data decisions worth knowing: the seeder goes through the **real commands**, so a change
  in the business rules can never make the demo rows inconsistent; it is **dev-only** in both
  backends and refuses a database that already has students, which is what makes the button
  safe to put next to *Sauvegarder*; and it deliberately leaves the previous month unpaid so
  the badge, the échéances and the *En retard* bucket have something to show.
* Packaging decisions worth knowing: the identifier moved to `com.centremanager.app`, which
  **moves the app-data folder** — `db::migrate_legacy_data_dir()` copies a V1.0 database once
  and never deletes the old one; the CSP keeps `ipc:`/`http://ipc.localhost` (without them no
  command would run) and `blob:` in `frame-src`/`worker-src` (the receipt viewer and pdf.js);
  and the NSIS installer is per-user, in French and Arabic, with the language selector on the
  first page.
* **Phase 8 shipped the PDF receipts and the UI polish**; what is still open: a real Arabic receipt (needs an Arabic font **and** bidi shaping in the PDF engine — V2), a native print bridge so `Imprimer` does not depend on the webview's PDF viewer, e-mailing a receipt, and payroll exports/printing on the settlement summary.
* Receipt decisions worth knowing: the PDF is built from the **frozen** `receipts` row (never from live student data), the thermal page grows with its content but every value is pre-split into single lines (auto height is measured once), the template default comes from `receipt_format` and is overridable per opening, and the `@react-pdf` chunk is lazy so the shell stays at ~154 kB gzip.
* The late-payment badge counts **every** overdue invoice, whatever its period, while the Payments page stays month-scoped: switch the month selector to collect an older period. The badge refreshes on mount, every 5 minutes and after each payment/invoice run.
* Dashboard decisions worth knowing: the échéances and the last payments ignore the period selector on purpose (they always answer "now"), the collection rate is computed on the period's invoices (so a payment received in a month without invoices shows a 0 % rate — the hint `0.00 DH / 0.00 DH` makes it explicit), and a period with no baseline shows `—` instead of a percentage.
* Known payroll decisions: settlements cannot be deleted, a teacher can be settled more than the month total (the remaining goes negative on purpose), and the payroll summary lists active teachers only.
* Known V1 limitations: a payment or a settlement cannot be cancelled or edited (no deletion anywhere), and the generator is triggered month by month from the payments page rather than by a scheduler.
* Later: write auth events to `audit_log`; bind the hash to the OS user (DPAPI on Windows); a native in-app restore that swaps the DB for the chosen backup; receipt printing against the saved paper format.
* Every amount stays in centimes end-to-end; convert only at the display/input boundary (`formatCurrency` / `amountToCents`).
* `withGlobalTauri: true` is enabled so the acceptance console snippets work; remove it for production if you want a stricter global surface.

### Student identity and guardian contacts

The student form separates identity, guardian contacts and administrative details. First
and last names, level, guardian name and Moroccan mobile number are required; the centre
registration date defaults to today. Guardian and secondary numbers are stored as digits,
while displayed numbers are grouped. The student list searches names and contact numbers.

On startup, legacy student tables are rebuilt in a transaction to support older SQLite
versions and the registration-date default. Student IDs and foreign-key references are
preserved: old father names become guardian names, home addresses become addresses, old
parent numbers become secondary numbers, and old birth dates are retained. Existing
full names are split at the first space as a best-effort migration; users can correct them
in the form. For very old databases where `email` was used as the address field, its
value is kept in the address. Make a backup before upgrading an existing installation.

`node tests/student-dev-backend.mjs` checks the browser development backend's student
creation, validation, search and update paths; Rust tests cover the database migration
and phone normalization.

### Corbeille et historique financier

La suppression d'un élève, d'un enseignant, d'un groupe ou d'une dépense est
logique : la ligne d'origine et ses relations restent en place, avec une date de
suppression. Les listes ordinaires masquent ces lignes ; la corbeille permet de
les restaurer sans recréer leurs identifiants. À partir de 30 jours, une purge au
démarrage supprime physiquement les éléments sans historique financier lié.
Les éléments associés à des paiements, factures ou règlements (y compris par une
inscription ou un groupe) sont conservés indéfiniment et restent restaurables.
La suppression définitive manuelle et « Vider la corbeille » respectent la même
protection. Les paiements et reçus ne sont jamais supprimés par cette fonction.
Les dépenses masquées sont exclues des totaux courants jusqu'à leur restauration.

Test du backend de développement : `node tests/trash-dev-backend.mjs`. Les tests
Rust du module `commands::trash` couvrent la restauration, la purge et la protection
des écritures financières. Effectuez une sauvegarde avant toute mise à niveau.

## Jeu de données isolé pour test de charge

Ce jeu **fictif** contient 200 élèves, 14 groupes (dont deux sans horaire),
6 enseignants, 300 inscriptions, jusqu’à trois mois récents de factures dans l’année de
test et 180 frais d’inscription. Pour novembre 2026, 140 élèves sont à jour, 30 sont partiellement réglés
et 30 n’ont pas payé (les dates du jeu fourni sont fixes). Les paiements enseignants et
12 dépenses sont également inclus. L’année de test court de septembre à août
pour rester utilisable toute l’année ; une autre année vide permet de tester le
changement d’année. Les dates, téléphones et personnes sont synthétiques.

### Données actives en développement

```sh
npm ci
npm run dev                 # navigateur
npm run tauri dev           # application desktop debug
```

Par défaut, un profil navigateur neuf et une base Tauri debug neuve ne contiennent
aucun élève, groupe, professeur, paiement ou dépense. Les niveaux, matières,
paramètres et année scolaire active sont conservés comme références utiles.
Les profils déjà existants ne sont jamais effacés automatiquement : pour les
vider, utiliser **Paramètres → Sauvegarde → Remise à zéro des données**, après
une sauvegarde, puis confirmer. Cette opération irréversible supprime les données
opérationnelles et la corbeille de **toutes les années**, mais conserve les
références, réglages et accès. Elle ne supprime pas les fichiers de sauvegarde.

Le jeu de test reste disponible uniquement sur demande explicite :

```sh
VITE_LOAD_TEST_FIXTURE=1 npm run dev
CENTREMANAGER_LOAD_TEST_FIXTURE=1 npm run tauri dev
```

En navigateur, le chargement explicite sauvegarde au préalable le profil dev
existant et conserve son mot de passe ; un profil neuf reçoit `test1234`.
En Tauri debug, le jeu n'est copié que si `test-data/centremanager-dev.db`
n'existe pas ; le mot de passe `test1234` n'est créé que s'il n'y en a pas.
Les modifications ultérieures sont conservées et la base de production n'est
jamais remplacée par le jeu de test.

Pour saisir un paiement antérieur, définir la date de début d'inscription réelle,
préparer le mois concerné dans le modal de paiement, sélectionner les factures
puis renseigner la date effective du paiement dans l'année active. La préparation
ne crée que les factures manquantes de l'élève choisi ; les paiements sont datés
du jour renseigné dans l'historique et les totaux, et leur saisie est journalisée.

### Base SQLite autonome

```sh
python3 scripts/create-load-test-db.py --input-json test-data/centremanager-charge.json --output /chemin/vers/nouveau-test.db
```

Le script crée **uniquement un nouveau fichier** et refuse tout chemin déjà
existant. Il ne réinitialise ni ne remplace la base active. La base modèle ne
contient aucun mot de passe ; l’authentification de test est initialisée sur la
copie Tauri debug uniquement. Ne jamais mélanger les fichiers WAL/SHM d’une base
avec ceux d’une autre base. Les données fournies sont fictives et ne doivent
pas être utilisées comme données de production.

Les contrôles reproductibles sont `node tests/dev-database-fixture.mjs`,
`python3 tests/dev-fixture-sqlite.py`, `node tests/load-test-fixture.mjs`,
`python3 tests/load-test-sqlite.py` et, avec le serveur de test démarré,
`node tests/browser/load-test.mjs`. Les temps mesurés par le dernier test
concernent le backend navigateur simulé, pas une mesure de performance Tauri.
