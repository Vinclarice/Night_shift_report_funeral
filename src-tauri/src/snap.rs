//! Windows 11 Snap Layouts on the title bar's maximize button.
//!
//! Windows offers the snap grid when the pointer rests on what it takes to be a maximize button: a spot
//! where a window answers WM_NCHITTEST with HTMAXBUTTON. This app's button is drawn by the page inside
//! the webview, which Windows cannot see into, so a small native window — all but invisible — is laid
//! exactly over it to give that answer. Sitting on top, it also takes the button's clicks and hover, so
//! it maximizes and restores the window itself and tells the page when to draw the hover.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetParent, IsZoomed, LoadCursorW, RegisterClassW, SetLayeredWindowAttributes, SetWindowPos,
    ShowWindow, HTMAXBUTTON, HWND_TOP, IDC_ARROW, LWA_ALPHA, MA_NOACTIVATE, SWP_NOACTIVATE, SW_MAXIMIZE, SW_RESTORE, WM_MOUSEACTIVATE,
    WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WNDCLASSW, WS_CHILD,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_VISIBLE,
};

static APP: OnceLock<AppHandle> = OnceLock::new();
static OVERLAY: AtomicIsize = AtomicIsize::new(0);
static HOVERING: AtomicBool = AtomicBool::new(false);
/// Set once creating the overlay has failed, so it is not retried on every resize after.
static UNAVAILABLE: AtomicBool = AtomicBool::new(false);

/// Puts the overlay over the maximize button, given the button's box in the page's CSS pixels; a zero
/// size tucks it away. A plain (not async) command, so it runs on the main thread that owns the windows.
#[tauri::command]
pub fn place_snap_overlay(window: WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    if UNAVAILABLE.load(Ordering::SeqCst) {
        return;
    }
    let _ = APP.set(window.app_handle().clone());
    let (Ok(scale), Ok(parent)) = (window.scale_factor(), window.hwnd()) else { return };
    let overlay = match OVERLAY.load(Ordering::SeqCst) {
        0 => match unsafe { create_overlay(parent) } {
            Ok(overlay) => overlay,
            Err(error) => {
                // Not worth failing anything over: the page's own button still works without the grid.
                UNAVAILABLE.store(true, Ordering::SeqCst);
                if let Some(state) = window.try_state::<crate::state::AppState>() {
                    state.log("snap-overlay", &error.to_string());
                }
                return;
            }
        },
        raw => HWND(raw as _),
    };
    let physical = |value: f64| (value * scale).round() as i32;
    unsafe {
        let _ = SetWindowPos(overlay, Some(HWND_TOP), physical(x), physical(y), physical(width), physical(height), SWP_NOACTIVATE);
    }
}

unsafe fn create_overlay(parent: HWND) -> windows::core::Result<HWND> {
    let instance = HINSTANCE(GetModuleHandleW(PCWSTR::null())?.0);
    let class_name = w!("NightShiftReportSnapOverlay");
    let class = WNDCLASSW {
        lpfnWndProc: Some(overlay_procedure),
        hInstance: instance,
        hCursor: LoadCursorW(None, IDC_ARROW)?,
        lpszClassName: class_name,
        ..Default::default()
    };
    RegisterClassW(&class);
    let overlay = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_NOACTIVATE,
        class_name,
        PCWSTR::null(),
        WS_CHILD | WS_VISIBLE,
        0,
        0,
        0,
        0,
        Some(parent),
        None,
        Some(instance),
        None,
    )?;
    // An alpha of 1 in 255: nothing anyone can see, but unlike 0 it still receives the pointer. Without
    // it the window would be an opaque box over the button, so it goes if this does not take.
    if let Err(error) = SetLayeredWindowAttributes(overlay, COLORREF(0), 1, LWA_ALPHA) {
        let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(overlay);
        return Err(error);
    }
    OVERLAY.store(overlay.0 as isize, Ordering::SeqCst);
    Ok(overlay)
}

unsafe extern "system" fn overlay_procedure(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        // The whole of this window is the maximize button, which is what makes Windows offer the grid.
        WM_NCHITTEST => LRESULT(HTMAXBUTTON as isize),
        // Clicking it must not take focus from wherever the typing was.
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_NCMOUSEMOVE => {
            if !HOVERING.swap(true, Ordering::SeqCst) {
                let mut tracking = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: window,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&mut tracking);
                emit_hover(true);
            }
            DefWindowProcW(window, message, wparam, lparam)
        }
        WM_NCMOUSELEAVE => {
            HOVERING.store(false, Ordering::SeqCst);
            emit_hover(false);
            LRESULT(0)
        }
        // Acting on release, as a real caption button does, so a press dragged off the button does nothing.
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => LRESULT(0),
        WM_NCLBUTTONUP => {
            if let Ok(app_window) = GetParent(window) {
                let command = if IsZoomed(app_window).as_bool() { SW_RESTORE } else { SW_MAXIMIZE };
                let _ = ShowWindow(app_window, command);
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(window, message, wparam, lparam),
    }
}

fn emit_hover(hovering: bool) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to("main", "snap-hover", hovering);
    }
}
