//! The report window. It is built here rather than left to tauri.conf.json so that it reopens where
//! it was left, opens already drawn, keeps its webview storage in the app's data folder, and cannot
//! be navigated away from the report.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{App, LogicalPosition, LogicalSize, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::state::append_log;

/// The shape the Electron builds wrote, so an existing window-state.json is picked up as it is.
/// Coordinates are logical pixels, as Electron's were.
#[derive(Clone, Copy, Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    maximized: bool,
}

/// The first showing of the window, which the interface and a fallback timer race to make.
pub struct PendingReveal {
    shown: AtomicBool,
    maximize: bool,
}

pub fn create(app: &App, data_directory: &Path) -> Result<(), Box<dyn Error>> {
    let config = app.config().app.windows.iter().find(|window| window.label == "main").ok_or("No main window is configured.")?.clone();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        // Beside the database rather than in a folder named after the bundle identifier, so the one
        // data folder still holds everything the app keeps — the interface's own preferences included.
        .data_directory(data_directory.join("WebView2"))
        // Nothing in the report links anywhere. This catches the rest: a file dropped on the window
        // would otherwise replace the report with whatever was dropped.
        .on_navigation(|url| matches!(url.host_str(), Some("tauri.localhost" | "localhost")))
        .build()?;

    let state_path = data_directory.join("window-state.json");
    let log_directory = data_directory.join("logs");
    let saved = read_state(&state_path, &window);
    match saved {
        Some(state) => {
            window.set_size(LogicalSize::new(state.width, state.height))?;
            match (state.x, state.y) {
                (Some(x), Some(y)) => window.set_position(LogicalPosition::new(x, y))?,
                _ => window.center()?,
            }
        }
        None => window.center()?,
    }

    // The window is created hidden, sized and placed while nobody can see it, and shown by the
    // interface once the report has drawn, so it opens finished rather than as an empty frame that
    // fills in. Maximizing shows a window, so that waits for the same moment. If the interface never
    // gets that far — a script error, say — it is shown anyway after a few seconds, not left hidden.
    app.manage(PendingReveal { shown: AtomicBool::new(false), maximize: saved.is_some_and(|state| state.maximized) });
    let fallback = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        reveal(&fallback);
    });

    // Bounds are captured on close rather than on every resize: a drag fires hundreds of resize events
    // and none of the in-between ones are worth a disk write. What is tracked as it goes is the last
    // size the window had when it was neither maximized nor minimized, since that is what a
    // maximized window returns to — and the window itself only reports its maximized size.
    let normal = Arc::new(Mutex::new(saved.map(|state| WindowState { maximized: false, ..state })));
    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if !tracked.is_maximized().unwrap_or(false) && !tracked.is_minimized().unwrap_or(false) {
                if let (Some(bounds), Ok(mut guard)) = (current_bounds(&tracked), normal.lock()) {
                    *guard = Some(bounds);
                }
            }
        }
        WindowEvent::CloseRequested { .. } => {
            let maximized = tracked.is_maximized().unwrap_or(false);
            let remembered = normal.lock().ok().and_then(|guard| *guard);
            let bounds = if maximized || tracked.is_minimized().unwrap_or(false) { remembered } else { current_bounds(&tracked) };
            if let Some(bounds) = bounds.or(remembered) {
                let state = WindowState { maximized, ..bounds };
                if let Err(error) = serde_json::to_string(&state).map_err(|error| error.to_string()).and_then(|json| fs::write(&state_path, json).map_err(|error| error.to_string())) {
                    append_log(&log_directory, "window-state", &error);
                }
            }
        }
        _ => {}
    });
    Ok(())
}

/// Shows the window the first time either the interface or the fallback asks; later asks do nothing.
fn reveal(window: &WebviewWindow) {
    let Some(pending) = window.try_state::<PendingReveal>() else { return };
    if pending.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if pending.maximize {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Called by the interface once the first report is on screen.
#[tauri::command]
pub fn show_window(window: WebviewWindow) {
    reveal(&window);
}

/// Whether Windows draws the Mica backdrop the window asks for (tauri.conf.json): Windows 11, which
/// is build 22000 and later. Anywhere else the see-through looks would show holes rather than Mica, so
/// the interface keeps its panels solid. The app manifest declares Windows 10 support, which is what
/// makes Windows report its real build here instead of an older one.
#[tauri::command]
pub fn backdrop_supported() -> bool {
    use windows::Win32::System::SystemInformation::{GetVersionExW, OSVERSIONINFOW};
    let mut info = OSVERSIONINFOW { dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32, ..Default::default() };
    unsafe { GetVersionExW(&mut info) }.is_ok() && info.dwMajorVersion >= 10 && info.dwBuildNumber >= 22000
}

fn current_bounds(window: &WebviewWindow) -> Option<WindowState> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(WindowState { width: size.width.round(), height: size.height.round(), x: Some(position.x.round()), y: Some(position.y.round()), maximized: false })
}

fn read_state(path: &PathBuf, window: &WebviewWindow) -> Option<WindowState> {
    let state: WindowState = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    if state.width < 640.0 || state.height < 480.0 {
        return None;
    }
    // A saved position is only usable if it still lands on a display that is attached now — otherwise
    // unplugging a second monitor would reopen the window off-screen.
    let on_screen = match (state.x, state.y) {
        (Some(x), Some(y)) => window.available_monitors().map_or(false, |monitors| {
            monitors.iter().any(|monitor| {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let (left, top) = (f64::from(area.position.x) / scale, f64::from(area.position.y) / scale);
                let (width, height) = (f64::from(area.size.width) / scale, f64::from(area.size.height) / scale);
                x >= left - 16.0 && y >= top - 16.0 && x < left + width && y < top + height
            })
        }),
        _ => true,
    };
    Some(if on_screen { state } else { WindowState { x: None, y: None, ..state } })
}
