//! One-click printing. The sheet goes straight to the printer chosen in Print setup with the page
//! settings fixed — Letter, no margins, backgrounds on, no header or footer — so none of them can be
//! left wrong in a print dialog at the end of a shift. The dialog is still there for anything else;
//! that path never reaches Rust.

use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::PlatformWebview;
use tauri::{State, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE, COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
};
use webview2_com::PrintCompletedHandler;
use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Graphics::Printing::{EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W};

use crate::state::{AppResult, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterOption {
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOutcome {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

/// The printers installed for this Windows user, network ones included, alphabetically.
#[tauri::command]
pub async fn list_printers() -> AppResult<Vec<PrinterOption>> {
    let default = default_printer();
    let mut names = printer_names();
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names.into_iter().map(|name| PrinterOption { is_default: default.as_deref() == Some(name.as_str()), name }).collect())
}

#[tauri::command]
pub async fn print_report(window: WebviewWindow, state: State<'_, AppState>, printer_name: String) -> AppResult<PrintOutcome> {
    let outcome = match print_silently(&window, printer_name).await {
        Ok(()) => PrintOutcome { success: true, failure_reason: None },
        Err(reason) => {
            state.log("report:print", &reason);
            PrintOutcome { success: false, failure_reason: Some(reason) }
        }
    };
    Ok(outcome)
}

async fn print_silently(window: &WebviewWindow, printer: String) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let setup_failed = sender.clone();
    window
        .with_webview(move |webview| {
            // WebView2 has to be driven from the thread that owns it, which is where this closure runs.
            if let Err(error) = unsafe { start_print(&webview, &printer, sender) } {
                let _ = setup_failed.send(Err(format!("The report could not be sent to the printer: {error}")));
            }
        })
        .map_err(|error| error.to_string())?;

    // A printer that answers at all accepts the job in seconds; this only stops a dead one hanging the button.
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(90)))
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|_| Err("The printer did not answer. Check it is on, then print again.".into()))
}

unsafe fn start_print(webview: &PlatformWebview, printer: &str, sender: mpsc::Sender<Result<(), String>>) -> windows::core::Result<()> {
    let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
    let environment: ICoreWebView2Environment6 = webview.environment().cast()?;

    let settings = environment.CreatePrintSettings()?;
    settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
    settings.SetPageWidth(8.5)?;
    settings.SetPageHeight(11.0)?;
    settings.SetMarginTop(0.0)?;
    settings.SetMarginBottom(0.0)?;
    settings.SetMarginLeft(0.0)?;
    settings.SetMarginRight(0.0)?;
    settings.SetScaleFactor(1.0)?;
    // The column banners and card tints are backgrounds. Left off, the banners' white text prints on
    // white and both column headings vanish.
    settings.SetShouldPrintBackgrounds(true)?;
    settings.SetShouldPrintHeaderAndFooter(false)?;
    settings.cast::<ICoreWebView2PrintSettings2>()?.SetPrinterName(&HSTRING::from(printer))?;

    let printer = printer.to_owned();
    let handler = PrintCompletedHandler::create(Box::new(move |result, status| {
        let outcome = match result {
            Err(error) => Err(format!("The report could not be sent to {printer}: {error}")),
            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => Ok(()),
            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE => {
                Err(format!("{printer} is not available. Check it is on and connected, or choose another printer in Print setup."))
            }
            Ok(()) => Err(format!("{printer} could not print the report.")),
        };
        let _ = sender.send(outcome);
        Ok(())
    }));
    core.Print(&settings, &handler)
}

fn printer_names() -> Vec<String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut returned) = (0u32, 0u32);
    // The first call only reports how large a buffer the list needs.
    let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut returned) };
    if needed == 0 {
        return Vec::new();
    }
    // Backed by u64 rather than u8 so the records laid out inside it are aligned for reading as structs.
    let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
    let bytes = unsafe { std::slice::from_raw_parts_mut(buffer.as_mut_ptr().cast::<u8>(), buffer.len() * 8) };
    if unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, Some(bytes), &mut needed, &mut returned) }.is_err() {
        return Vec::new();
    }
    let records = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), returned as usize) };
    records.iter().filter_map(|record| unsafe { record.pPrinterName.to_string() }.ok()).collect()
}

fn default_printer() -> Option<String> {
    let mut length = 0u32;
    let _ = unsafe { GetDefaultPrinterW(None, &mut length) };
    if length == 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    if !unsafe { GetDefaultPrinterW(Some(PWSTR(buffer.as_mut_ptr())), &mut length) }.as_bool() {
        return None;
    }
    let end = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}
