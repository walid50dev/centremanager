//! Business logic layer, kept separate from the thin Tauri command handlers.
//!
//! Planned modules (implemented in later milestones):
//! - `billing`      — monthly invoice generation from enrollments
//! - `receipts`     — sequential receipt numbering + PDF snapshots
//! - `compensation` — teacher payroll computed from activities
//! - `backup`       — SQLite file backup / restore
//! - `seed`         — reference data (levels, branches, subjects)
