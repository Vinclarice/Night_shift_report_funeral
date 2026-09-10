//! Shapes that cross between the interface and Rust.
//!
//! Incoming reports mirror `NightReport` in src/domain/types.ts. Outgoing reports stay as flat rows
//! that the interface groups into sections itself, so the list of sections is still written down in
//! one place only, `REPORT_SECTIONS` in src/domain/report.ts. Two copies of it drifting apart once
//! made every save fail: ROAD TRIPS was added to one and not the other.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NightReport {
    pub id: String,
    pub report_date: String,
    pub version: i64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub hidden_sections: Vec<String>,
    pub sections: Vec<ReportSection>,
}

#[derive(Deserialize)]
pub struct ReportSection {
    pub key: String,
    pub entries: Vec<ReportEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntry {
    pub id: String,
    pub rush: bool,
    pub keep_separate: bool,
    #[serde(default)]
    pub pinned_bottom: bool,
    #[serde(default)]
    pub rush_by: Option<String>,
    pub created_at: String,
    #[serde(flatten)]
    pub kind: EntryKind,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum EntryKind {
    #[serde(rename = "funeral")]
    Funeral { funeral_home: String, deceased: Vec<DeceasedPerson> },
    #[serde(rename = "funeralHomeOnly")]
    FuneralHomeOnly { funeral_home: String },
    #[serde(rename = "count")]
    Count { text: String, count: i64 },
    #[serde(rename = "combined")]
    Combined { left_text: String, right_text: String, count: i64 },
    #[serde(rename = "plain")]
    Plain { text: String },
}

impl EntryKind {
    pub fn type_name(&self) -> &'static str {
        match self {
            Self::Funeral { .. } => "funeral",
            Self::FuneralHomeOnly { .. } => "funeralHomeOnly",
            Self::Count { .. } => "count",
            Self::Combined { .. } => "combined",
            Self::Plain { .. } => "plain",
        }
    }

    pub fn funeral_home(&self) -> Option<&str> {
        match self {
            Self::Funeral { funeral_home, .. } | Self::FuneralHomeOnly { funeral_home } => Some(funeral_home),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeceasedPerson {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub location_code: String,
    #[serde(default)]
    pub special_request: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredReport {
    pub id: String,
    pub report_date: String,
    pub version: i64,
    pub notes: Option<String>,
    /// Left as the stored JSON text; the interface parses it with the same fallbacks it always had.
    pub hidden_sections: Option<String>,
    pub entries: Vec<StoredEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEntry {
    pub id: String,
    pub section_key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub rush: bool,
    pub keep_separate: bool,
    pub pinned_bottom: bool,
    pub rush_by: Option<String>,
    pub funeral_home_name_snapshot: Option<String>,
    pub text: Option<String>,
    pub left_text: Option<String>,
    pub right_text: Option<String>,
    pub count: Option<i64>,
    /// Epoch milliseconds, as stored.
    pub created_at: i64,
    pub deceased: Vec<StoredDeceased>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDeceased {
    pub id: String,
    pub name: String,
    pub location_code: Option<String>,
    pub special_request: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FuneralHomeOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub name: String,
    pub created_at: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    #[serde(default)]
    pub section_widths: BTreeMap<String, f64>,
    pub margin_inches: f64,
    pub scale: f64,
    pub offset_x_inches: f64,
    pub offset_y_inches: f64,
    /// Where Print report sends the sheet without a dialog. None opens the dialog instead.
    #[serde(default)]
    pub printer_name: Option<String>,
}
