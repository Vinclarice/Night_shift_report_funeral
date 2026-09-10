//! What the interface can ask of Rust. Each command is `async` so it runs off the main thread, where a
//! plain Tauri command would run and hold up the window while the database works.

use tauri::{AppHandle, State};

use crate::backups;
use crate::model::{BackupSummary, FuneralHomeOption, LayoutSettings, NightReport, StoredReport};
use crate::repository;
use crate::state::{AppResult, AppState};

#[tauri::command]
pub async fn find_report_by_date(state: State<'_, AppState>, date: String) -> AppResult<Option<StoredReport>> {
    state.logged("report:find", state.with_connection(|connection| repository::find_by_date(connection, &date)))
}

#[tauri::command]
pub async fn most_recent_report(state: State<'_, AppState>) -> AppResult<Option<StoredReport>> {
    state.logged("report:most-recent", state.with_connection(|connection| repository::most_recent(connection)))
}

#[tauri::command]
pub async fn create_report(state: State<'_, AppState>, report: NightReport) -> AppResult<StoredReport> {
    state.logged("report:create", state.with_connection(|connection| repository::create(connection, &report)))
}

#[tauri::command]
pub async fn save_report(state: State<'_, AppState>, report: NightReport, expected_version: i64) -> AppResult<StoredReport> {
    state.logged("report:save", state.with_connection(|connection| repository::save(connection, &report, expected_version)))
}

#[tauri::command]
pub async fn purge_reports_except(state: State<'_, AppState>, id: String) -> AppResult<usize> {
    state.logged("report:purge", state.with_connection(|connection| repository::purge_except(connection, &id)))
}

#[tauri::command]
pub async fn list_funeral_homes(state: State<'_, AppState>) -> AppResult<Vec<FuneralHomeOption>> {
    state.logged("funeral:list", state.with_connection(|connection| repository::list_funeral_homes(connection)))
}

#[tauri::command]
pub async fn rename_funeral_home(state: State<'_, AppState>, id: String, name: String) -> AppResult<Vec<FuneralHomeOption>> {
    state.logged("funeral:rename", state.with_connection(|connection| repository::rename_funeral_home(connection, &id, &name)))
}

#[tauri::command]
pub async fn merge_funeral_homes(state: State<'_, AppState>, source_id: String, target_id: String) -> AppResult<Vec<FuneralHomeOption>> {
    state.logged(
        "funeral:merge",
        state.with_connection(|connection| repository::merge_funeral_homes(connection, &source_id, &target_id)),
    )
}

#[tauri::command]
pub async fn delete_funeral_home(state: State<'_, AppState>, id: String) -> AppResult<Vec<FuneralHomeOption>> {
    state.logged("funeral:delete", state.with_connection(|connection| repository::delete_funeral_home(connection, &id)))
}

#[tauri::command]
pub async fn load_layout(state: State<'_, AppState>) -> AppResult<LayoutSettings> {
    state.logged("layout:load", state.with_connection(|connection| repository::load_layout(connection)))
}

#[tauri::command]
pub async fn save_layout(state: State<'_, AppState>, layout: LayoutSettings) -> AppResult<LayoutSettings> {
    state.logged("layout:save", state.with_connection(|connection| repository::save_layout(connection, &layout)))
}

#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>, label: String) -> AppResult<()> {
    state.logged("backup:create", backups::create(&state, &label).map(|_| ()))
}

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> AppResult<Vec<BackupSummary>> {
    state.logged("backup:list", backups::list(&state))
}

#[tauri::command]
pub async fn purge_backups(state: State<'_, AppState>, days: u64) -> AppResult<()> {
    state.logged("backup:purge", backups::purge(&state, days))
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, state: State<'_, AppState>, name: String) -> AppResult<()> {
    state.logged("backup:restore", backups::restore(&state, &name))?;
    app.restart()
}

/// For failures the interface handles itself but that should still leave a trace.
#[tauri::command]
pub async fn log_error(state: State<'_, AppState>, scope: String, detail: String) -> AppResult<()> {
    state.log(&scope, &detail);
    Ok(())
}
