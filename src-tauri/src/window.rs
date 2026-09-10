//! The report window. It is built here rather than left to tauri.conf.json so that it reopens where
//! it was left, keeps its webview storage in the app's data folder, and cannot be navigated away
//! from the report.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{App, LogicalPosition, LogicalSize, WebviewWindow, WebviewWindowBuilder, WindowEvent};

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
            if state.maximized {
                window.maximize()?;
            }
        }
        None => window.center()?,
    }
    // The window is created hidden so that it appears already in place rather than jumping there.
    window.show()?;

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
