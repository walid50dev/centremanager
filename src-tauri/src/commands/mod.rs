//! Tauri command handlers.
//!
//! - `auth`          — single-admin authentication & session security
//! - `settings`      — generic key/value settings
//! - `school_years`  — academic years (one active at a time)
//! - `levels`        — levels & branches reference data
//! - `subjects`      — subjects reference data
//! - `backup`        — database backup & info
//! - `students`      — student management (Phase 3)
//! - `groups`        — scheduled classes, capacity & monthly fee (Phase 4)
//! - `enrollments`   — enrollment workflow + first invoice (Phase 4)
//! - `invoices`      — monthly generation, student invoices, collection alerts (Phase 5)
//! - `payments`      — payment allocation, history, frozen receipts (Phase 5)
//! - `teachers`      — teacher directory & payroll configuration (Phase 6)
//! - `compensation`  — monthly payroll calculation & settlements (Phase 6)
//! - `activities`    — hours/sessions log feeding the hourly modes (Phase 6)
//! - `dashboard`     — read-only home page aggregates (Phase 7)
//! - `expenses`      — monthly charges, totals & editable categories (Phase 11)

pub mod activities;
pub mod auth;
pub mod backup;
pub mod compensation;
pub mod dashboard;
#[cfg(test)]
pub mod demo;
pub mod duplicates;
#[cfg(test)]
mod edge_cases;
pub mod enrollments;
pub mod expenses;
pub mod groups;
pub mod invoices;
pub mod levels;
pub mod payments;
pub mod schedules;
pub mod schedule_conflicts;
pub mod school_years;
pub mod settings;
pub mod students;
pub mod subjects;
pub mod teachers;
pub mod trash;
pub mod year_import;
pub mod year_export;

/// Uniform translation of a SQLite error into a user-facing French message.
/// Shared by every command module so error wording stays consistent.
pub(crate) fn db_err(context: &str, err: rusqlite::Error) -> String {
    format!("{context} : {err}")
}

/// Health check: the frontend should receive "pong".
///
/// Debug console: `window.__TAURI__.core.invoke('cmd_ping')`
#[tauri::command]
pub fn cmd_ping() -> String {
    "pong".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(cmd_ping(), "pong");
    }
}
