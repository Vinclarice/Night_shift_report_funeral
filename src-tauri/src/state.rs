use std::ffi::OsString;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;

use crate::repository;

/// The folder under %LOCALAPPDATA% holding the database, backups, logs, window state and the
/// webview's own storage. It is the folder the Electron builds used, so an existing installation
/// carries straight on.
const DATA_FOLDER: &str = "Night Shift Report";
const DATABASE_FILE: &str = "night-shift-report.db";

#[derive(Debug)]
pub struct AppError(String);

pub type AppResult<T> = Result<T, AppError>;

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AppError {}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self(message.to_owned())
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

// Errors reach the interface as a plain message, which it shows in a toast as it is.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// `NIGHT_SHIFT_REPORT_DATA_DIR` points the app at a throwaway folder, which the desktop tests and the
/// print gate rely on to stay clear of the real report.
pub fn data_directory(local_data: &Path) -> PathBuf {
    std::env::var_os("NIGHT_SHIFT_REPORT_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| local_data.join(DATA_FOLDER))
}

pub struct AppState {
    /// `None` only while a backup is being restored over the database file.
    connection: Mutex<Option<Connection>>,
    pub database_path: PathBuf,
    pub backup_directory: PathBuf,
    log_directory: PathBuf,
}

impl AppState {
    pub fn open(data_directory: &Path) -> AppResult<Self> {
        let log_directory = data_directory.join("logs");
        let opened = Self::open_in(data_directory, log_directory.clone());
        if let Err(error) = &opened {
            // There is no window yet to show this in, so the log is the only place it can go.
            append_log(&log_directory, "startup", &error.0);
        }
        opened
    }

    fn open_in(data_directory: &Path, log_directory: PathBuf) -> AppResult<Self> {
        let database_path = data_directory.join(DATABASE_FILE);
        let backup_directory = data_directory.join("backups");
        fs::create_dir_all(&backup_directory)?;
        if database_path.exists() {
            // Taken before migrations touch the file, on every launch.
            let _ = fs::copy(&database_path, backup_directory.join(format!("{}-pre-migration.db", file_stamp())));
        }
        let connection = repository::open(&database_path)?;
        Ok(Self { connection: Mutex::new(Some(connection)), database_path, backup_directory, log_directory })
    }

    pub fn with_connection<T>(&self, work: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.connection.lock().map_err(|_| AppError::from("The database is unavailable. Restart the app."))?;
        let connection = guard.as_mut().ok_or_else(|| AppError::from("The database is closed while a backup is restored."))?;
        work(connection)
    }

    pub fn close_connection(&self) -> AppResult<()> {
        let mut guard = self.connection.lock().map_err(|_| AppError::from("The database is unavailable. Restart the app."))?;
        guard.take();
        Ok(())
    }

    pub fn reopen_connection(&self) -> AppResult<()> {
        let mut guard = self.connection.lock().map_err(|_| AppError::from("The database is unavailable. Restart the app."))?;
        *guard = Some(repository::open(&self.database_path)?);
        Ok(())
    }

    /// A packaged build has no console, so anything that fails overnight is written to a log file too.
    pub fn logged<T>(&self, scope: &str, result: AppResult<T>) -> AppResult<T> {
        if let Err(error) = &result {
            self.log(scope, &error.0);
        }
        result
    }

    pub fn log(&self, scope: &str, detail: &str) {
        append_log(&self.log_directory, scope, detail);
    }
}

/// Failures here are swallowed deliberately: logging must never be the reason an operation fails.
pub fn append_log(directory: &Path, scope: &str, detail: &str) {
    eprintln!("[{scope}] {detail}");
    let now = Utc::now();
    let _ = fs::create_dir_all(directory).and_then(|()| {
        let path = directory.join(format!("main-{}.log", now.format("%Y-%m-%d")));
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(file, "{} [{scope}] {detail}", now.to_rfc3339_opts(SecondsFormat::Millis, true))
    });
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// `new Date().toISOString().replace(/[:.]/g, "-")` — the stamp backup files have always been named with.
pub fn file_stamp() -> String {
    Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ").to_string()
}

pub fn iso_timestamp(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse_timestamp(value: &str) -> AppResult<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.timestamp_millis())
        .map_err(|_| AppError(format!("An entry has an unreadable creation time: {value}")))
}

pub fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(path.as_os_str());
    name.push(suffix);
    PathBuf::from(name)
}
