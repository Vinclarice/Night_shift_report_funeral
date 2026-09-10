// A release build would otherwise open a console window beside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backups;
mod commands;
mod model;
mod printing;
mod repository;
mod snap;
mod state;
mod window;

use tauri::Manager;

use crate::state::AppState;

fn main() {
    let mut builder = tauri::Builder::default();
    // The desktop tests and the print gate run their own copy beside whatever is already open.
    if std::env::var("NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE").as_deref() != Ok("1") {
        // Registered first, so a second launch hands over to the window already open before anything
        // else in it starts.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            let data_directory = state::data_directory(&app.path().local_data_dir()?);
            app.manage(AppState::open(&data_directory)?);
            window::create(app, &data_directory)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::find_report_by_date,
            commands::most_recent_report,
            commands::create_report,
            commands::save_report,
            commands::purge_reports_except,
            commands::list_funeral_homes,
            commands::rename_funeral_home,
            commands::merge_funeral_homes,
            commands::delete_funeral_home,
            commands::load_layout,
            commands::save_layout,
            commands::create_backup,
            commands::list_backups,
            commands::purge_backups,
            commands::restore_backup,
            commands::log_error,
            printing::list_printers,
            printing::print_report,
            snap::place_snap_overlay,
            window::show_window,
            window::backdrop_supported,
        ])
        .run(tauri::generate_context!())
        .expect("Night Shift Report could not start");
}
