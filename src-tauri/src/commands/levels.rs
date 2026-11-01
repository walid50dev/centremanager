//! Levels and branches (reference data used by students, groups and teachers).
//!
//! Deleting reference data is guarded: a level or branch still referenced by a
//! group cannot be removed, because invoices and schedules depend on it.
//! Deleting a level also removes its own branches (they belong to the level);
//! students keep existing and simply lose their level (`ON DELETE SET NULL`).

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::{Branch, Level};

/// Valid values for `levels.category`.
pub const CATEGORIES: [&str; 3] = ["primaire", "college", "lycee"];

fn validate_category(category: &str) -> Result<(), String> {
    if CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(format!(
            "Catégorie invalide : {} (attendu : primaire, college, lycee)",
            category
        ))
    }
}

fn validate_name(name: &str, label: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(format!("Le nom du {label} est obligatoire"));
    }
    Ok(trimmed.to_string())
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/// All levels, ordered by `sort_order`.
pub fn list_levels(conn: &Connection) -> rusqlite::Result<Vec<Level>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order, category
         FROM levels
         ORDER BY sort_order ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Level {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
            category: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Create a level and return its id.
pub fn create_level(
    conn: &Connection,
    name: &str,
    category: &str,
    sort_order: i32,
) -> Result<i64, String> {
    let name = validate_name(name, "niveau")?;
    validate_category(category)?;

    conn.execute(
        "INSERT INTO levels (name, sort_order, category) VALUES (?1, ?2, ?3)",
        params![name, sort_order, category],
    )
    .map_err(|err| db_err("Création du niveau", err))?;

    Ok(conn.last_insert_rowid())
}

/// Rename a level and/or move it.
pub fn update_level(conn: &Connection, id: i64, name: &str, sort_order: i32) -> Result<(), String> {
    let name = validate_name(name, "niveau")?;

    let updated = conn
        .execute(
            "UPDATE levels SET name = ?1, sort_order = ?2 WHERE id = ?3",
            params![name, sort_order, id],
        )
        .map_err(|err| db_err("Mise à jour du niveau", err))?;

    if updated == 0 {
        return Err("Niveau introuvable".to_string());
    }
    Ok(())
}

/// How many groups use this level.
fn groups_using_level(conn: &Connection, id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM groups WHERE level_id = ?1",
        params![id],
        |row| row.get(0),
    )
}

/// Delete a level (and its branches) when no group references it.
pub fn delete_level(conn: &Connection, id: i64) -> Result<(), String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM levels WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|err| db_err("Vérification du niveau", err))?
        .is_some();
    if !exists {
        return Err("Niveau introuvable".to_string());
    }

    let used =
        groups_using_level(conn, id).map_err(|err| db_err("Vérification des groupes", err))?;
    if used > 0 {
        return Err(format!(
            "Ce niveau est utilisé par {used} groupe(s) et ne peut pas être supprimé"
        ));
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;
    tx.execute("DELETE FROM branches WHERE level_id = ?1", params![id])
        .map_err(|err| db_err("Suppression des branches", err))?;
    tx.execute("DELETE FROM levels WHERE id = ?1", params![id])
        .map_err(|err| db_err("Suppression du niveau", err))?;
    tx.commit()
        .map_err(|err| db_err("Validation de la transaction", err))
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

/// Branches for one level, or all branches when `level_id` is `None`.
pub fn list_branches(conn: &Connection, level_id: Option<i64>) -> rusqlite::Result<Vec<Branch>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, level_id
         FROM branches
         WHERE (?1 IS NULL OR level_id = ?1)
         ORDER BY name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![level_id], |row| {
        Ok(Branch {
            id: row.get(0)?,
            name: row.get(1)?,
            level_id: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Create a branch under a level.
pub fn create_branch(conn: &Connection, name: &str, level_id: i64) -> Result<i64, String> {
    let name = validate_name(name, "branche")?;

    let level_exists = conn
        .query_row(
            "SELECT 1 FROM levels WHERE id = ?1",
            params![level_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|err| db_err("Vérification du niveau", err))?
        .is_some();
    if !level_exists {
        return Err("Niveau introuvable".to_string());
    }

    conn.execute(
        "INSERT INTO branches (name, level_id) VALUES (?1, ?2)",
        params![name, level_id],
    )
    .map_err(|err| db_err("Création de la branche", err))?;

    Ok(conn.last_insert_rowid())
}

/// Delete a branch when no group references it.
pub fn delete_branch(conn: &Connection, id: i64) -> Result<(), String> {
    let used: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM groups WHERE branch_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Vérification des groupes", err))?;
    if used > 0 {
        return Err(format!(
            "Cette branche est utilisée par {used} groupe(s) et ne peut pas être supprimée"
        ));
    }

    let deleted = conn
        .execute("DELETE FROM branches WHERE id = ?1", params![id])
        .map_err(|err| db_err("Suppression de la branche", err))?;
    if deleted == 0 {
        return Err("Branche introuvable".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_get_levels(db: State<'_, Db>) -> Result<Vec<Level>, String> {
    let conn = db.conn();
    list_levels(&conn).map_err(|err| db_err("Lecture des niveaux", err))
}

#[tauri::command]
pub fn cmd_create_level(
    db: State<'_, Db>,
    name: String,
    category: String,
    sort_order: i32,
) -> Result<i64, String> {
    let conn = db.conn();
    create_level(&conn, &name, &category, sort_order)
}

#[tauri::command]
pub fn cmd_update_level(
    db: State<'_, Db>,
    id: i64,
    name: String,
    sort_order: i32,
) -> Result<(), String> {
    let conn = db.conn();
    update_level(&conn, id, &name, sort_order)
}

#[tauri::command]
pub fn cmd_delete_level(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.conn();
    delete_level(&conn, id)
}

#[tauri::command]
pub fn cmd_get_branches(db: State<'_, Db>, level_id: Option<i64>) -> Result<Vec<Branch>, String> {
    let conn = db.conn();
    list_branches(&conn, level_id).map_err(|err| db_err("Lecture des branches", err))
}

#[tauri::command]
pub fn cmd_create_branch(db: State<'_, Db>, name: String, level_id: i64) -> Result<i64, String> {
    let conn = db.conn();
    create_branch(&conn, &name, level_id)
}

#[tauri::command]
pub fn cmd_delete_branch(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.conn();
    delete_branch(&conn, id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn insert_group(conn: &Connection, level_id: Option<i64>, branch_id: Option<i64>) {
        conn.execute(
            "INSERT INTO groups (level_id, branch_id, monthly_fee_cents, capacity)
             VALUES (?1, ?2, 30000, 15)",
            params![level_id, branch_id],
        )
        .unwrap();
    }

    #[test]
    fn seeded_reference_data_is_present() {
        let conn = test_conn();
        let levels = list_levels(&conn).unwrap();
        assert_eq!(levels.len(), 12, "12 seeded levels");
        assert_eq!(levels[0].category.as_deref(), Some("primaire"));
        assert_eq!(levels[9].name.as_deref(), Some("Tronc Commun"));

        let branches = list_branches(&conn, None).unwrap();
        assert_eq!(branches.len(), 15, "5 branches x 3 lycée levels");
        assert!(branches.iter().all(|branch| branch.level_id.is_some()));
    }

    #[test]
    fn create_update_and_delete_a_level() {
        let conn = test_conn();
        let id = create_level(&conn, "  7ème année  ", "college", 99).unwrap();

        let created = list_levels(&conn)
            .unwrap()
            .into_iter()
            .find(|level| level.id == id)
            .unwrap();
        assert_eq!(
            created.name.as_deref(),
            Some("7ème année"),
            "name is trimmed"
        );

        update_level(&conn, id, "7ème année B", 100).unwrap();
        let updated = list_levels(&conn)
            .unwrap()
            .into_iter()
            .find(|level| level.id == id)
            .unwrap();
        assert_eq!(updated.name.as_deref(), Some("7ème année B"));
        assert_eq!(updated.sort_order, Some(100));

        delete_level(&conn, id).unwrap();
        assert!(!list_levels(&conn)
            .unwrap()
            .iter()
            .any(|level| level.id == id));
    }

    #[test]
    fn level_validation() {
        let conn = test_conn();
        assert!(create_level(&conn, "  ", "college", 1).is_err());
        assert!(create_level(&conn, "X", "universite", 1).is_err());
        assert_eq!(
            update_level(&conn, 9999, "X", 1).unwrap_err(),
            "Niveau introuvable"
        );
    }

    #[test]
    fn level_delete_is_blocked_when_groups_reference_it() {
        let conn = test_conn();
        insert_group(&conn, Some(10), None);

        let error = delete_level(&conn, 10).unwrap_err();
        assert!(error.contains("utilisé par 1 groupe"), "{error}");
        // Still there.
        assert!(list_levels(&conn)
            .unwrap()
            .iter()
            .any(|level| level.id == 10));
    }

    #[test]
    fn deleting_a_level_removes_its_branches() {
        let conn = test_conn();
        assert!(!list_branches(&conn, Some(12)).unwrap().is_empty());

        delete_level(&conn, 12).unwrap();
        assert!(list_branches(&conn, Some(12)).unwrap().is_empty());
    }

    #[test]
    fn create_and_delete_branches() {
        let conn = test_conn();
        let id = create_branch(&conn, "  Sciences de Gestion ", 11).unwrap();

        let branch = list_branches(&conn, Some(11))
            .unwrap()
            .into_iter()
            .find(|branch| branch.id == id)
            .unwrap();
        assert_eq!(branch.name.as_deref(), Some("Sciences de Gestion"));

        delete_branch(&conn, id).unwrap();
        assert!(!list_branches(&conn, Some(11))
            .unwrap()
            .iter()
            .any(|branch| branch.id == id));

        assert!(create_branch(&conn, "  ", 11).is_err());
        assert_eq!(
            create_branch(&conn, "X", 9999).unwrap_err(),
            "Niveau introuvable"
        );
    }

    #[test]
    fn branch_delete_is_blocked_when_groups_reference_it() {
        let conn = test_conn();
        let branch = list_branches(&conn, Some(10)).unwrap().remove(0);
        insert_group(&conn, Some(10), Some(branch.id));

        let error = delete_branch(&conn, branch.id).unwrap_err();
        assert!(error.contains("utilisée par 1 groupe"), "{error}");
    }
}
