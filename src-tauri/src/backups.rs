use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OpenFlags};

use crate::model::BackupSummary;
use crate::repository;
use crate::state::{file_stamp, iso_timestamp, now_ms, sibling_path, AppResult, AppState};

fn is_backup_file(name: &str) -> bool {
    name.ends_with(".db")
}

pub fn create(state: &AppState, label: &str) -> AppResult<PathBuf> {
    if label.is_empty() || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid backup label.".into());
    }
    fs::create_dir_all(&state.backup_directory)?;
    let path = state.backup_directory.join(format!("{}-{label}.db", file_stamp()));
    let _ = fs::remove_file(&path);
    state.with_connection(|connection| repository::vacuum_into(connection, &path))?;
    if let Err(error) = verify(&path) {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

fn verify(path: &Path) -> AppResult<()> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut statement = connection.prepare("PRAGMA integrity_check")?;
    let results = statement.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    if results.len() == 1 && results[0] == "ok" {
        Ok(())
    } else {
        Err("Database integrity verification failed.".into())
    }
}

pub fn list(state: &AppState) -> AppResult<Vec<BackupSummary>> {
    fs::create_dir_all(&state.backup_directory)?;
    let mut items = Vec::new();
    for item in fs::read_dir(&state.backup_directory)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !is_backup_file(&name) {
            continue;
        }
        let metadata = item.metadata()?;
        items.push(BackupSummary { name, created_at: iso_timestamp(metadata.modified()?), size: metadata.len() });
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

pub fn purge(state: &AppState, days: u64) -> AppResult<()> {
    let cutoff = SystemTime::now() - Duration::from_secs(days * 86_400);
    for item in fs::read_dir(&state.backup_directory)? {
        let item = item?;
        if is_backup_file(&item.file_name().to_string_lossy()) && item.metadata()?.modified()? < cutoff {
            let _ = fs::remove_file(item.path());
        }
    }
    Ok(())
}

pub fn restore(state: &AppState, name: &str) -> AppResult<()> {
    let valid = is_backup_file(name) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if !valid {
        return Err("Invalid backup name.".into());
    }
    let source = state.backup_directory.join(name);
    if !source.is_file() {
        return Err("That backup no longer exists.".into());
    }

    // Snapshot the current database before touching anything, in case the chosen backup turns out to
    // be the wrong one — this is the only way back if so.
    create(state, "pre-restore")?;
    state.close_connection()?;
    let replaced = replace_database(&source, &state.database_path);
    if replaced.is_err() {
        // Unlike a successful restore there is no relaunch to follow, so the app needs its database back.
        state.reopen_connection()?;
    }
    replaced
}

/// Copies into a temporary file beside the database and renames it over, rather than copying straight
/// onto the live file: a copy that failed partway would leave a truncated database with no way back.
fn replace_database(source: &Path, database: &Path) -> AppResult<()> {
    let temporary = sibling_path(database, &format!(".restoring-{}", now_ms()));
    fs::copy(source, &temporary)?;
    if let Err(error) = fs::rename(&temporary, database) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    // Sidecar files describe writes against the database just replaced and must never be applied to the new one.
    let _ = fs::remove_file(sibling_path(database, "-wal"));
    let _ = fs::remove_file(sibling_path(database, "-shm"));
    Ok(())
}
