// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod models;
mod services;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Create/upgrade the SQLite database before the window is shown.
            let connection = db::init_db(app.handle()).map_err(|err| {
                eprintln!("[CentreManager] initialisation de la base impossible : {err}");
                std::io::Error::other(err)
            })?;

            let purged = commands::trash::purge_expired(&connection)
                .map_err(std::io::Error::other)?;
            eprintln!("[CentreManager] Corbeille : {purged} élément(s) purgé(s)");

            // Share the connection with future commands via `State<db::Db>`.
            app.manage(db::Db::new(connection));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cmd_ping,
            commands::trash::cmd_delete_to_trash,
            commands::trash::cmd_list_trash,
            commands::trash::cmd_restore_from_trash,
            commands::trash::cmd_purge_trash,
            commands::trash::cmd_delete_permanently,
            commands::trash::cmd_empty_trash,
            // Authentication & session security
            commands::auth::cmd_check_setup,
            commands::auth::cmd_setup,
            commands::auth::cmd_login,
            commands::auth::cmd_change_password,
            commands::auth::cmd_verify_lock_password,
            commands::auth::cmd_get_center_name,
            commands::auth::cmd_get_lock_timeout,
            commands::auth::cmd_set_lock_timeout,
            // Settings (key/value)
            commands::settings::cmd_get_all_settings,
            commands::settings::cmd_get_setting,
            // Weekly timetable (Phase 13)
            commands::schedules::cmd_set_group_schedules,
            commands::schedules::cmd_get_group_schedules,
            commands::schedules::cmd_get_timetable,
            commands::schedules::cmd_get_timetable_rooms,
            commands::settings::cmd_set_setting,
            // School years
            commands::school_years::cmd_get_school_years,
            commands::school_years::cmd_create_school_year,
            commands::school_years::cmd_set_active_year,
            // Levels & branches
            commands::levels::cmd_get_levels,
            commands::levels::cmd_create_level,
            commands::levels::cmd_update_level,
            commands::levels::cmd_delete_level,
            commands::levels::cmd_get_branches,
            commands::levels::cmd_create_branch,
            commands::levels::cmd_delete_branch,
            // Subjects
            commands::subjects::cmd_get_subjects,
            commands::subjects::cmd_create_subject,
            commands::subjects::cmd_update_subject,
            // Backup
            commands::backup::cmd_backup_db,
            commands::backup::cmd_get_db_info,
            // Students (Phase 3)
            commands::students::cmd_create_student,
            commands::students::cmd_update_student,
            commands::students::cmd_get_students,
            commands::students::cmd_get_student_detail,
            commands::students::cmd_set_student_status,
            // Groups (Phase 4)
            commands::groups::cmd_get_groups,
            commands::groups::cmd_get_group_detail,
            commands::groups::cmd_create_group,
            commands::groups::cmd_update_group,
            commands::groups::cmd_get_teacher_options,
            // Enrollments (Phase 4)
            commands::enrollments::cmd_enroll_student,
            commands::enrollments::cmd_enroll_student_batch,
            commands::enrollments::cmd_end_enrollment,
            commands::enrollments::cmd_get_student_enrollments,
            commands::enrollments::cmd_get_available_groups_for_student,
            // Invoicing (Phase 5)
            commands::invoices::cmd_generate_monthly_invoices,
            commands::invoices::cmd_get_student_invoices,
            commands::demo::cmd_seed_demo_data,
            commands::invoices::cmd_get_late_payment_count,
            commands::invoices::cmd_get_payment_alerts,
            // Payments & receipts (Phase 5)
            commands::payments::cmd_record_payment,
            commands::payments::cmd_get_payments_history,
            commands::payments::cmd_create_receipt,
            commands::payments::cmd_get_receipt_data,
            // Teachers (Phase 6)
            commands::teachers::cmd_create_teacher,
            commands::teachers::cmd_update_teacher,
            commands::teachers::cmd_get_teachers,
            commands::teachers::cmd_get_teacher_detail,
            commands::teachers::cmd_set_teacher_status,
            // Compensation & settlements (Phase 6)
            commands::compensation::cmd_set_compensation,
            commands::compensation::cmd_calculate_compensation,
            commands::compensation::cmd_record_settlement,
            commands::compensation::cmd_get_teacher_settlements,
            commands::compensation::cmd_get_all_teacher_compensation_summary,
            // Activities (Phase 6)
            commands::activities::cmd_record_activity,
            commands::activities::cmd_get_activities,
            // Dashboard (Phase 7)
            commands::dashboard::cmd_get_dashboard_kpis,
            commands::dashboard::cmd_get_dashboard_alerts,
            commands::dashboard::cmd_get_recent_payments,
            // Monthly expenses (Phase 11)
            commands::expenses::cmd_create_expense,
            commands::expenses::cmd_update_expense,
            commands::expenses::cmd_delete_expense,
            commands::expenses::cmd_get_expenses,
            commands::expenses::cmd_get_expenses_summary,
            commands::expenses::cmd_get_expense_categories,
            commands::expenses::cmd_set_expense_categories,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CentreManager");
}
