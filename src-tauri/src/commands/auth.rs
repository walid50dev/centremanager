//! Authentication & session security (single admin, V1).
//!
//! The admin password is stored **only** as an Argon2id hash, in the
//! `settings` table under `admin_password_hash`. It never travels to the
//! frontend: the UI only learns whether setup is done, whether a password
//! matches, and the centre name.
//!
//! Structure: `setup` / `authenticate` / `change_password` / … are plain
//! functions over a `&Connection` (unit-testable), while the `cmd_*`
//! functions are thin Tauri wrappers that borrow the shared connection from
//! `State<Db>`.
//!
//! Argon2 verification is CPU-bound (~50–200 ms), so the mutex is released
//! before hashing/verifying and re-acquired only to write.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::Argon2;
use password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rand::rngs::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use super::db_err;
use crate::db::Db;

/// Settings keys owned by this module.
pub const KEY_PASSWORD_HASH: &str = "admin_password_hash";
pub const KEY_CENTER_NAME: &str = "center_name";
pub const KEY_LOCK_TIMEOUT: &str = "lock_timeout_minutes";

pub const MIN_PASSWORD_LENGTH: usize = 4;
pub const DEFAULT_CENTER_NAME: &str = "CentreManager";
pub const DEFAULT_LOCK_TIMEOUT_MINUTES: i64 = 15;
/// Upper bound accepted for the idle timeout (24 h); `0` disables auto-lock.
const MAX_LOCK_TIMEOUT_MINUTES: i64 = 1440;

// French messages are shown as-is by the UI (they are the user-facing contract
// of the API), so keep them stable.

// ---------------------------------------------------------------------------
// Rate limiting (defence in depth)
//
// The UI already disables the form after 3 failures, but that is only cosmetic:
// anything running in the webview can call `cmd_login` directly. The same rule
// is therefore enforced in Rust. State is in-memory, so it resets when the app
// restarts — acceptable for a local single-user desktop app, and the offline
// Argon2 hash remains the real barrier.
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS: u32 = 3;
const LOCKOUT_DURATION: Duration = Duration::from_secs(30);

#[derive(Debug, Default)]
struct LoginThrottle {
    failures: u32,
    locked_until: Option<Instant>,
}

static LOGIN_THROTTLE: Mutex<LoginThrottle> = Mutex::new(LoginThrottle {
    failures: 0,
    locked_until: None,
});

fn throttle_guard() -> std::sync::MutexGuard<'static, LoginThrottle> {
    LOGIN_THROTTLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `Err(...)` while the cooldown is running, with the seconds remaining.
fn throttle_check() -> Result<(), String> {
    let mut throttle = throttle_guard();

    if let Some(until) = throttle.locked_until {
        let now = Instant::now();
        if now < until {
            let remaining = (until - now).as_secs_f64().ceil() as u64;
            return Err(format!(
                "Trop de tentatives. Réessayez dans {}s",
                remaining.max(1)
            ));
        }
        // Cooldown elapsed: start from a clean slate.
        throttle.locked_until = None;
        throttle.failures = 0;
    }

    Ok(())
}

fn throttle_register_failure() {
    let mut throttle = throttle_guard();
    throttle.failures += 1;
    if throttle.failures >= MAX_FAILED_ATTEMPTS {
        throttle.failures = 0;
        throttle.locked_until = Some(Instant::now() + LOCKOUT_DURATION);
    }
}

fn throttle_reset() {
    let mut throttle = throttle_guard();
    throttle.failures = 0;
    throttle.locked_until = None;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/// Read a `settings` value (NULL/absent -> `None`).
pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(Option::flatten)
}

/// Insert or update a `settings` value.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Password primitives (Argon2id)
// ---------------------------------------------------------------------------

/// Hash a password with Argon2id (default params) and a random salt.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| format!("Impossible de chiffrer le mot de passe : {err}"))
}

/// Constant-time verification of a password against a PHC hash string.
pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    match PasswordHash::new(stored_hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        // A corrupted/legacy hash must never authenticate anyone.
        Err(_) => false,
    }
}

/// The stored hash, if a password has been configured.
pub fn stored_hash(conn: &Connection) -> Result<Option<String>, String> {
    get_setting(conn, KEY_PASSWORD_HASH).map_err(|err| db_err("Lecture du mot de passe", err))
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/// `true` once an admin password exists.
pub fn check_setup(conn: &Connection) -> Result<bool, String> {
    Ok(stored_hash(conn)?.is_some())
}

/// Validate a new password; returns a user-facing French message on failure.
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(format!(
            "Le mot de passe doit contenir au moins {MIN_PASSWORD_LENGTH} caractères"
        ));
    }
    Ok(())
}

fn validate_center_name(center_name: &str) -> Result<(), String> {
    if center_name.trim().is_empty() {
        return Err("Le nom du centre est obligatoire".to_string());
    }
    Ok(())
}

/// First-launch configuration: store the centre name and the password hash.
pub fn setup(conn: &Connection, center_name: &str, password: &str) -> Result<(), String> {
    validate_center_name(center_name)?;
    validate_password(password)?;

    let center_name = center_name.trim();
    let hash = hash_password(password)?;

    set_setting(conn, KEY_PASSWORD_HASH, &hash)
        .map_err(|err| db_err("Enregistrement du mot de passe", err))?;
    set_setting(conn, KEY_CENTER_NAME, center_name)
        .map_err(|err| db_err("Enregistrement du nom du centre", err))?;

    // Make sure the idle-lock default exists (never overwrite a custom value).
    let has_timeout = get_setting(conn, KEY_LOCK_TIMEOUT)
        .map_err(|err| db_err("Lecture du délai de verrouillage", err))?
        .is_some();
    if !has_timeout {
        set_setting(
            conn,
            KEY_LOCK_TIMEOUT,
            &DEFAULT_LOCK_TIMEOUT_MINUTES.to_string(),
        )
        .map_err(|err| db_err("Enregistrement du délai de verrouillage", err))?;
    }

    Ok(())
}

/// Verify a password against the stored hash.
///
/// Returns `Err("Mot de passe incorrect")` when it does not match, and
/// `Err(...)` mentioning the missing configuration when no password is set.
///
/// The `cmd_*` wrappers use [`verify_against_stored`] so they can release the
/// connection mutex while Argon2 runs; this reference implementation is what
/// the unit tests exercise and what the Phase 2 password-change UI will call.
#[cfg_attr(not(test), allow(dead_code))]
pub fn authenticate(conn: &Connection, password: &str) -> Result<(), String> {
    let hash = stored_hash(conn)?
        .ok_or_else(|| "Aucun mot de passe n'est configuré pour ce centre".to_string())?;

    if verify_password(password, &hash) {
        Ok(())
    } else {
        Err("Mot de passe incorrect".to_string())
    }
}

/// Change the password after verifying the current one.
///
/// Same note as [`authenticate`]: `cmd_change_password` performs the same steps
/// against a released mutex, this version is used by the tests.
#[cfg_attr(not(test), allow(dead_code))]
pub fn change_password(
    conn: &Connection,
    old_password: &str,
    new_password: &str,
) -> Result<(), String> {
    authenticate(conn, old_password).map_err(|err| {
        // Do not leak "no password configured" as a wrong-old-password message.
        if err == "Mot de passe incorrect" {
            "Ancien mot de passe incorrect".to_string()
        } else {
            err
        }
    })?;

    validate_password(new_password)?;
    let hash = hash_password(new_password)?;
    set_setting(conn, KEY_PASSWORD_HASH, &hash)
        .map_err(|err| db_err("Mise à jour du mot de passe", err))
}

/// Centre name with a safe fallback.
pub fn center_name(conn: &Connection) -> String {
    get_setting(conn, KEY_CENTER_NAME)
        .ok()
        .flatten()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| DEFAULT_CENTER_NAME.to_string())
}

/// Idle auto-lock delay in minutes (`0` = disabled).
pub fn lock_timeout_minutes(conn: &Connection) -> i64 {
    get_setting(conn, KEY_LOCK_TIMEOUT)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|minutes| (0..=MAX_LOCK_TIMEOUT_MINUTES).contains(minutes))
        .unwrap_or(DEFAULT_LOCK_TIMEOUT_MINUTES)
}

/// Persist the idle auto-lock delay.
pub fn set_lock_timeout_minutes(conn: &Connection, minutes: i64) -> Result<(), String> {
    if !(0..=MAX_LOCK_TIMEOUT_MINUTES).contains(&minutes) {
        return Err(format!(
            "Délai de verrouillage invalide : attendu entre 0 et {MAX_LOCK_TIMEOUT_MINUTES} minutes"
        ));
    }
    set_setting(conn, KEY_LOCK_TIMEOUT, &minutes.to_string())
        .map_err(|err| db_err("Enregistrement du délai de verrouillage", err))
}

// ---------------------------------------------------------------------------
// Shared command helpers
// ---------------------------------------------------------------------------

/// Verify `password` against the stored hash without holding the DB mutex
/// during the (slow) Argon2 verification.
fn verify_against_stored(db: &Db, password: &str) -> Result<(), String> {
    throttle_check()?;

    let hash = {
        let conn = db.conn();
        stored_hash(&conn)?
    }
    .ok_or_else(|| "Aucun mot de passe n'est configuré pour ce centre".to_string())?;

    if verify_password(password, &hash) {
        throttle_reset();
        Ok(())
    } else {
        throttle_register_failure();
        Err("Mot de passe incorrect".to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// `true` when the first-launch setup has already been completed.
#[tauri::command]
pub fn cmd_check_setup(db: State<'_, Db>) -> Result<bool, String> {
    let conn = db.conn();
    check_setup(&conn)
}

/// First-launch setup: centre name + admin password.
#[tauri::command]
pub fn cmd_setup(db: State<'_, Db>, center_name: String, password: String) -> Result<(), String> {
    let conn = db.conn();
    setup(&conn, &center_name, &password)
}

/// Login with the admin password.
#[tauri::command]
pub fn cmd_login(db: State<'_, Db>, password: String) -> Result<(), String> {
    verify_against_stored(&db, &password)
}

/// Change the admin password (old password required).
#[tauri::command]
pub fn cmd_change_password(
    db: State<'_, Db>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    // 1. Verify the old password without holding the connection lock.
    throttle_check()?;

    let hash = {
        let conn = db.conn();
        stored_hash(&conn)?
    }
    .ok_or_else(|| "Aucun mot de passe n'est configuré pour ce centre".to_string())?;

    if !verify_password(&old_password, &hash) {
        throttle_register_failure();
        return Err("Ancien mot de passe incorrect".to_string());
    }
    throttle_reset();

    // 2. Validate + hash, then write.
    validate_password(&new_password)?;
    let new_hash = hash_password(&new_password)?;

    let conn = db.conn();
    set_setting(&conn, KEY_PASSWORD_HASH, &new_hash)
        .map_err(|err| db_err("Mise à jour du mot de passe", err))
}

/// Unlock the lock screen (identical verification to login).
#[tauri::command]
pub fn cmd_verify_lock_password(db: State<'_, Db>, password: String) -> Result<(), String> {
    verify_against_stored(&db, &password)
}

/// Centre name for the login/lock screens, defaulting to "CentreManager".
#[tauri::command]
pub fn cmd_get_center_name(db: State<'_, Db>) -> String {
    let conn = db.conn();
    center_name(&conn)
}

/// Idle auto-lock delay in minutes (`0` = disabled).
#[tauri::command]
pub fn cmd_get_lock_timeout(db: State<'_, Db>) -> i64 {
    let conn = db.conn();
    lock_timeout_minutes(&conn)
}

/// Update the idle auto-lock delay (0 = disabled, max 1440).
#[tauri::command]
pub fn cmd_set_lock_timeout(db: State<'_, Db>, minutes: i64) -> Result<(), String> {
    let conn = db.conn();
    set_lock_timeout_minutes(&conn, minutes)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialises the tests that touch the process-global throttle.
    static THROTTLE_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn hash_is_argon2id_and_verifies() {
        let hash = hash_password("secret123").unwrap();
        assert!(
            hash.starts_with("$argon2id$"),
            "expected an Argon2id PHC string, got {hash}"
        );
        assert!(verify_password("secret123", &hash));
        assert!(!verify_password("secret124", &hash));
        // Same password must produce a different hash (random salt).
        assert_ne!(hash, hash_password("secret123").unwrap());
    }

    #[test]
    fn malformed_hash_never_authenticates() {
        assert!(!verify_password("secret123", "not-a-phc-string"));
        assert!(!verify_password("", ""));
    }

    #[test]
    fn setup_flow_enables_login() {
        let conn = test_conn();
        assert!(!check_setup(&conn).unwrap());

        setup(&conn, "  Centre Excellence  ", "motdepasse").unwrap();
        assert!(check_setup(&conn).unwrap());

        // Stored value is a hash, never the plaintext.
        let stored = stored_hash(&conn).unwrap().unwrap();
        assert!(stored.starts_with("$argon2id$"));
        assert!(!stored.contains("motdepasse"));

        assert_eq!(center_name(&conn), "Centre Excellence");
        assert!(authenticate(&conn, "motdepasse").is_ok());
        assert_eq!(
            authenticate(&conn, "mauvais").unwrap_err(),
            "Mot de passe incorrect"
        );
        // Default lock timeout is materialised at setup time.
        assert_eq!(lock_timeout_minutes(&conn), DEFAULT_LOCK_TIMEOUT_MINUTES);
    }

    #[test]
    fn setup_validation_rejects_bad_input() {
        let conn = test_conn();
        assert!(setup(&conn, "", "motdepasse").is_err());
        assert!(setup(&conn, "   ", "motdepasse").is_err());
        assert_eq!(
            setup(&conn, "Centre", "abc").unwrap_err(),
            "Le mot de passe doit contenir au moins 4 caractères"
        );
        assert!(!check_setup(&conn).unwrap());
    }

    #[test]
    fn change_password_requires_old_password() {
        let conn = test_conn();
        setup(&conn, "Centre", "motdepasse").unwrap();

        let err = change_password(&conn, "faux", "nouveau123").unwrap_err();
        assert_eq!(err, "Ancien mot de passe incorrect");
        // Old password still works.
        assert!(authenticate(&conn, "motdepasse").is_ok());

        change_password(&conn, "motdepasse", "nouveau123").unwrap();
        assert!(authenticate(&conn, "nouveau123").is_ok());
        assert!(authenticate(&conn, "motdepasse").is_err());
    }

    #[test]
    fn change_password_enforces_minimum_length() {
        let conn = test_conn();
        setup(&conn, "Centre", "motdepasse").unwrap();
        assert!(change_password(&conn, "motdepasse", "abc").is_err());
        assert!(authenticate(&conn, "motdepasse").is_ok());
    }

    #[test]
    fn center_name_falls_back_when_missing() {
        let conn = test_conn();
        assert_eq!(center_name(&conn), DEFAULT_CENTER_NAME);
    }

    #[test]
    fn lock_timeout_is_persisted_and_validated() {
        let conn = test_conn();
        assert_eq!(lock_timeout_minutes(&conn), DEFAULT_LOCK_TIMEOUT_MINUTES);

        set_lock_timeout_minutes(&conn, 5).unwrap();
        assert_eq!(lock_timeout_minutes(&conn), 5);

        // 0 disables auto-lock and is a valid value.
        set_lock_timeout_minutes(&conn, 0).unwrap();
        assert_eq!(lock_timeout_minutes(&conn), 0);

        assert!(set_lock_timeout_minutes(&conn, -5).is_err());
        assert!(set_lock_timeout_minutes(&conn, 5000).is_err());
        assert_eq!(lock_timeout_minutes(&conn), 0);
    }

    #[test]
    fn three_failures_trigger_a_backend_cooldown() {
        // The throttle is process-global: serialise and reset before/after.
        let _serial = THROTTLE_TEST_LOCK.lock().unwrap();
        throttle_reset();

        assert!(throttle_check().is_ok());
        throttle_register_failure();
        throttle_register_failure();
        assert!(throttle_check().is_ok(), "two failures must not lock");

        throttle_register_failure();
        let error = throttle_check().unwrap_err();
        assert!(
            error.starts_with("Trop de tentatives. Réessayez dans "),
            "unexpected message: {error}"
        );
        assert!(error.ends_with('s'));

        // A successful login clears the counter.
        throttle_reset();
        assert!(throttle_check().is_ok());
    }

    #[test]
    fn login_path_enforces_the_backend_cooldown() {
        let _serial = THROTTLE_TEST_LOCK.lock().unwrap();
        throttle_reset();

        let conn = test_conn();
        setup(&conn, "Centre", "motdepasse").unwrap();
        // `Db` is exactly what `cmd_login` borrows from Tauri state.
        let db = Db::new(conn);

        for _ in 0..MAX_FAILED_ATTEMPTS {
            assert_eq!(
                verify_against_stored(&db, "faux").unwrap_err(),
                "Mot de passe incorrect"
            );
        }

        // During the cooldown even the correct password is refused.
        let error = verify_against_stored(&db, "motdepasse").unwrap_err();
        assert!(
            error.starts_with("Trop de tentatives. Réessayez dans "),
            "expected the cooldown message, got: {error}"
        );

        // Once cleared, the correct password works again.
        throttle_reset();
        assert!(verify_against_stored(&db, "motdepasse").is_ok());
    }

    #[test]
    fn authenticate_without_setup_is_rejected() {
        let conn = test_conn();
        assert!(authenticate(&conn, "anything").is_err());
    }
}
