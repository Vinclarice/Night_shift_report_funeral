//! The report's SQLite storage. It reads and writes the same tables, column types and values the
//! Electron build's Prisma client does — dates as epoch milliseconds, booleans as 0/1 — so a database
//! can move between the two builds in either direction.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::model::{EntryKind, FuneralHomeOption, LayoutSettings, NightReport, StoredDeceased, StoredEntry, StoredReport};
use crate::state::{now_ms, parse_timestamp, AppError, AppResult};

const STARTER_FUNERAL_HOMES: &[&str] = &[
    "Alfirdaus",
    "Barber",
    "Beltway Crem",
    "Brown/PA",
    "Collins",
    "Crescent",
    "Greene",
    "Inman",
    "McGuire",
    "MD Crem",
    "Moloney",
    "NMS",
    "Nova Jewish",
];

const VERSION_CONFLICT: &str = "This report changed since it was loaded. Reload before saving again.";
const MISSING_FUNERAL_HOME: &str = "That funeral home no longer exists.";

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory)?;
    }
    let mut connection = Connection::open(path)?;
    run_pragma(&connection, "PRAGMA foreign_keys = ON")?;
    migrate(&connection)?;
    seed_starter_funeral_homes(&mut connection)?;
    Ok(connection)
}

/// Some PRAGMAs answer with a row and some do not; stepping through whatever comes back handles both.
fn run_pragma(connection: &Connection, sql: &str) -> AppResult<()> {
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

// ── Migrations ──
//
// Every statement is safe to run on every launch, against a new database or one written by any
// earlier version, including the Electron builds.

const STATEMENTS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportDate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS "Report_reportDate_key" ON "Report"("reportDate")"#,
    r#"CREATE TABLE IF NOT EXISTS "FuneralHome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
  )"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS "FuneralHome_normalizedName_key" ON "FuneralHome"("normalizedName")"#,
    r#"CREATE TABLE IF NOT EXISTS "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rush" BOOLEAN NOT NULL DEFAULT false,
    "keepSeparate" BOOLEAN NOT NULL DEFAULT false,
    "pinnedBottom" BOOLEAN NOT NULL DEFAULT false,
    "rushBy" TEXT,
    "position" INTEGER NOT NULL,
    "funeralHomeId" TEXT,
    "funeralHomeNameSnapshot" TEXT,
    "text" TEXT,
    "leftText" TEXT,
    "rightText" TEXT,
    "count" INTEGER,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE,
    CONSTRAINT "Entry_funeralHomeId_fkey" FOREIGN KEY ("funeralHomeId") REFERENCES "FuneralHome" ("id") ON DELETE SET NULL
  )"#,
    r#"CREATE INDEX IF NOT EXISTS "Entry_reportId_sectionKey_position_idx" ON "Entry"("reportId", "sectionKey", "position")"#,
    r#"CREATE TABLE IF NOT EXISTS "Deceased" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationCode" TEXT,
    "specialRequest" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "Deceased_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE
  )"#,
    r#"CREATE TABLE IF NOT EXISTS "LayoutPreference" ("sectionKey" TEXT NOT NULL PRIMARY KEY, "widthInches" REAL)"#,
    r#"CREATE TABLE IF NOT EXISTS "PrintPreference" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "marginInches" REAL NOT NULL DEFAULT 0.35,
    "scale" REAL NOT NULL DEFAULT 1,
    "offsetXInches" REAL NOT NULL DEFAULT 0,
    "offsetYInches" REAL NOT NULL DEFAULT 0
  )"#,
    r#"CREATE TABLE IF NOT EXISTS "AppSetting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)"#,
];

const DROPPED_TABLES: &[&str] = &[
    "FirstCallFuneralHome",
    "FirstCallFacility",
    "FirstCallLookupCache",
    "FirstCallPrintPreference",
    "CremationFuneralHome",
    "CremationSequenceState",
    "CremationPrintPreference",
    "Revision",
];

const DROPPED_COLUMNS: &[(&str, &str)] = &[("Report", "status"), ("Report", "finalizedAt"), ("Report", "basedOnReportId")];

const ADDED_COLUMNS: &[(&str, &str, &str)] = &[
    ("Entry", "pinnedBottom", "BOOLEAN NOT NULL DEFAULT false"),
    ("Entry", "rushBy", "TEXT"),
    ("Report", "notes", "TEXT"),
    ("Report", "roadTripsVisible", "BOOLEAN NOT NULL DEFAULT false"),
    ("Report", "hiddenSections", "TEXT"),
    ("PrintPreference", "printerName", "TEXT"),
];

fn migrate(connection: &Connection) -> AppResult<()> {
    for statement in STATEMENTS {
        connection.execute_batch(statement)?;
    }
    for (table, column, definition) in ADDED_COLUMNS {
        if !has_column(connection, table, column)? {
            connection.execute_batch(&format!(r#"ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}"#))?;
        }
    }
    connection.execute_batch(
        r#"UPDATE "Report" SET "hiddenSections" = CASE WHEN "roadTripsVisible" THEN '[]' ELSE '["human-road-trips"]' END WHERE "hiddenSections" IS NULL"#,
    )?;
    for (table, column) in DROPPED_COLUMNS {
        if has_column(connection, table, column)? {
            connection.execute_batch(&format!(r#"ALTER TABLE "{table}" DROP COLUMN "{column}""#))?;
        }
    }
    for table in DROPPED_TABLES {
        connection.execute_batch(&format!(r#"DROP TABLE IF EXISTS "{table}""#))?;
    }
    connection.execute_batch(r#"INSERT OR IGNORE INTO "PrintPreference" ("id") VALUES (1)"#)?;
    Ok(())
}

fn has_column(connection: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = connection.prepare(&format!(r#"PRAGMA table_info("{table}")"#))?;
    let names = statement.query_map([], |row| row.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

fn seed_starter_funeral_homes(connection: &mut Connection) -> AppResult<()> {
    let seeded: bool = connection.query_row(
        r#"SELECT EXISTS(SELECT 1 FROM "AppSetting" WHERE "key" = 'starterFuneralHomesSeeded')"#,
        [],
        |row| row.get(0),
    )?;
    if seeded {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    for name in STARTER_FUNERAL_HOMES {
        upsert_funeral_home(&transaction, name)?;
    }
    transaction.execute(r#"INSERT INTO "AppSetting" ("key", "value") VALUES ('starterFuneralHomesSeeded', '1')"#, [])?;
    transaction.commit()?;
    Ok(())
}

// ── Names ──

fn clean_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `normalizeFuneralHome` in src/domain/entries.ts.
fn normalize_funeral_home(value: &str) -> String {
    clean_name(value).to_lowercase()
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}

fn upsert_funeral_home(connection: &Connection, name: &str) -> AppResult<String> {
    let normalized = normalize_funeral_home(name);
    connection.execute(
        r#"INSERT INTO "FuneralHome" ("id", "name", "normalizedName", "createdAt") VALUES (?1, ?2, ?3, ?4) ON CONFLICT ("normalizedName") DO NOTHING"#,
        params![uuid::Uuid::new_v4().to_string(), name, normalized, now_ms()],
    )?;
    Ok(connection.query_row(r#"SELECT "id" FROM "FuneralHome" WHERE "normalizedName" = ?1"#, [&normalized], |row| row.get(0))?)
}

// ── Reports ──

pub fn find_by_date(connection: &Connection, date: &str) -> AppResult<Option<StoredReport>> {
    load(connection, r#"WHERE "reportDate" = ?1"#, date)
}

fn find_by_id(connection: &Connection, id: &str) -> AppResult<Option<StoredReport>> {
    load(connection, r#"WHERE "id" = ?1"#, id)
}

pub fn most_recent(connection: &Connection) -> AppResult<Option<StoredReport>> {
    let id: Option<String> = connection
        .query_row(r#"SELECT "id" FROM "Report" ORDER BY "reportDate" DESC LIMIT 1"#, [], |row| row.get(0))
        .optional()?;
    match id {
        Some(id) => find_by_id(connection, &id),
        None => Ok(None),
    }
}

fn load(connection: &Connection, filter: &str, value: &str) -> AppResult<Option<StoredReport>> {
    let header = connection
        .query_row(
            &format!(r#"SELECT "id", "reportDate", "version", "notes", "hiddenSections" FROM "Report" {filter}"#),
            [value],
            |row| {
                Ok(StoredReport {
                    id: row.get(0)?,
                    report_date: row.get(1)?,
                    version: row.get(2)?,
                    notes: row.get(3)?,
                    hidden_sections: row.get(4)?,
                    entries: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut report) = header else { return Ok(None) };

    let mut deceased: HashMap<String, Vec<StoredDeceased>> = HashMap::new();
    let mut deceased_statement = connection.prepare(
        r#"SELECT "Deceased"."entryId", "Deceased"."id", "Deceased"."name", "Deceased"."locationCode", "Deceased"."specialRequest"
           FROM "Deceased" JOIN "Entry" ON "Entry"."id" = "Deceased"."entryId"
           WHERE "Entry"."reportId" = ?1 ORDER BY "Deceased"."position" ASC"#,
    )?;
    let rows = deceased_statement.query_map([&report.id], |row| {
        let person = StoredDeceased { id: row.get(1)?, name: row.get(2)?, location_code: row.get(3)?, special_request: row.get(4)? };
        Ok((row.get::<_, String>(0)?, person))
    })?;
    for row in rows {
        let (entry_id, person) = row?;
        deceased.entry(entry_id).or_default().push(person);
    }

    let mut entry_statement = connection.prepare(
        r#"SELECT "id", "sectionKey", "type", "rush", "keepSeparate", "pinnedBottom", "rushBy", "funeralHomeNameSnapshot",
                  "text", "leftText", "rightText", "count", "createdAt"
           FROM "Entry" WHERE "reportId" = ?1 ORDER BY "sectionKey" ASC, "position" ASC"#,
    )?;
    let entries = entry_statement
        .query_map([&report.id], |row| {
            Ok(StoredEntry {
                id: row.get(0)?,
                section_key: row.get(1)?,
                kind: row.get(2)?,
                rush: row.get(3)?,
                keep_separate: row.get(4)?,
                pinned_bottom: row.get(5)?,
                rush_by: row.get(6)?,
                funeral_home_name_snapshot: row.get(7)?,
                text: row.get(8)?,
                left_text: row.get(9)?,
                right_text: row.get(10)?,
                count: row.get(11)?,
                created_at: row.get(12)?,
                deceased: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    report.entries = entries
        .into_iter()
        .map(|mut entry| {
            entry.deceased = deceased.remove(&entry.id).unwrap_or_default();
            entry
        })
        .collect();
    Ok(Some(report))
}

fn read_back(connection: &Connection, id: &str) -> AppResult<StoredReport> {
    find_by_id(connection, id)?.ok_or_else(|| AppError::from("The report could not be read back after saving."))
}

pub fn create(connection: &mut Connection, report: &NightReport) -> AppResult<StoredReport> {
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"INSERT INTO "Report" ("id", "reportDate", "version", "notes", "hiddenSections", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)"#,
        params![report.id, report.report_date, report.version, non_empty(&report.notes), serde_json::to_string(&report.hidden_sections)?, now_ms()],
    )?;
    write_entries(&transaction, report)?;
    transaction.commit()?;
    read_back(connection, &report.id)
}

pub fn save(connection: &mut Connection, report: &NightReport, expected_version: i64) -> AppResult<StoredReport> {
    let transaction = connection.transaction()?;
    let changed = transaction.execute(
        r#"UPDATE "Report" SET "version" = ?1, "notes" = ?2, "hiddenSections" = ?3, "updatedAt" = ?4 WHERE "id" = ?5 AND "version" = ?6"#,
        params![expected_version + 1, non_empty(&report.notes), serde_json::to_string(&report.hidden_sections)?, now_ms(), report.id, expected_version],
    )?;
    if changed != 1 {
        return Err(VERSION_CONFLICT.into());
    }
    transaction.execute(r#"DELETE FROM "Entry" WHERE "reportId" = ?1"#, [&report.id])?;
    write_entries(&transaction, report)?;
    transaction.commit()?;
    read_back(connection, &report.id)
}

fn write_entries(connection: &Connection, report: &NightReport) -> AppResult<()> {
    // Each distinct funeral home is upserted once however many entries name it; when spellings differ
    // only in case, the last one wins, as it does in the Electron build.
    let mut names = HashMap::new();
    for entry in report.sections.iter().flat_map(|section| &section.entries) {
        if let Some(home) = entry.kind.funeral_home() {
            let clean = clean_name(home);
            names.insert(normalize_funeral_home(&clean), clean);
        }
    }
    let mut home_ids = HashMap::new();
    for (normalized, name) in names {
        home_ids.insert(normalized, upsert_funeral_home(connection, &name)?);
    }

    let mut insert_entry = connection.prepare(
        r#"INSERT INTO "Entry" ("id", "reportId", "sectionKey", "type", "rush", "keepSeparate", "pinnedBottom", "rushBy", "position",
                                "funeralHomeId", "funeralHomeNameSnapshot", "text", "leftText", "rightText", "count", "createdAt")
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"#,
    )?;
    let mut insert_deceased = connection.prepare(
        r#"INSERT INTO "Deceased" ("id", "entryId", "name", "locationCode", "specialRequest", "position") VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
    )?;

    for section in &report.sections {
        for (position, entry) in section.entries.iter().enumerate() {
            let snapshot = entry.kind.funeral_home().map(clean_name);
            let funeral_home_id = snapshot
                .as_deref()
                .filter(|name| !name.is_empty())
                .and_then(|name| home_ids.get(&normalize_funeral_home(name)));
            let rush_by = if entry.rush { entry.rush_by.as_deref().map(str::trim).filter(|value| !value.is_empty()) } else { None };
            let (text, left_text, right_text, count) = match &entry.kind {
                EntryKind::Plain { text } => (Some(text.as_str()), None, None, None),
                EntryKind::Count { text, count } => (Some(text.as_str()), None, None, Some(*count)),
                EntryKind::Combined { left_text, right_text, count } => (None, Some(left_text.as_str()), Some(right_text.as_str()), Some(*count)),
                EntryKind::Funeral { .. } | EntryKind::FuneralHomeOnly { .. } => (None, None, None, None),
            };
            insert_entry.execute(params![
                entry.id,
                report.id,
                section.key,
                entry.kind.type_name(),
                entry.rush,
                entry.keep_separate,
                entry.pinned_bottom,
                rush_by,
                position as i64,
                funeral_home_id,
                snapshot,
                text,
                left_text,
                right_text,
                count,
                parse_timestamp(&entry.created_at)?,
            ])?;
            if let EntryKind::Funeral { deceased, .. } = &entry.kind {
                for (person_position, person) in deceased.iter().enumerate() {
                    insert_deceased.execute(params![
                        person.id,
                        entry.id,
                        person.name,
                        non_empty(&person.location_code),
                        non_empty(&person.special_request),
                        person_position as i64,
                    ])?;
                }
            }
        }
    }
    Ok(())
}

/// Deletes every report except the one supplied — retention keeps only the current report.
pub fn purge_except(connection: &Connection, id: &str) -> AppResult<usize> {
    let removed = connection.execute(r#"DELETE FROM "Report" WHERE "id" <> ?1"#, [id])?;
    if removed > 0 {
        run_pragma(connection, "PRAGMA wal_checkpoint(TRUNCATE)")?;
        run_pragma(connection, "PRAGMA secure_delete = ON")?;
    }
    Ok(removed)
}

pub fn vacuum_into(connection: &Connection, target: &Path) -> AppResult<()> {
    connection.execute("VACUUM INTO ?1", [target.to_string_lossy().into_owned()])?;
    Ok(())
}

// ── Funeral homes ──

pub fn list_funeral_homes(connection: &Connection) -> AppResult<Vec<FuneralHomeOption>> {
    let mut statement = connection.prepare(r#"SELECT "id", "name" FROM "FuneralHome" ORDER BY "name" ASC"#)?;
    let homes = statement
        .query_map([], |row| Ok(FuneralHomeOption { id: row.get(0)?, name: row.get(1)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(homes)
}

pub fn rename_funeral_home(connection: &Connection, id: &str, name: &str) -> AppResult<Vec<FuneralHomeOption>> {
    let clean = clean_name(name);
    if clean.is_empty() {
        return Err("A funeral home needs a name.".into());
    }
    let changed = connection
        .execute(
            r#"UPDATE "FuneralHome" SET "name" = ?1, "normalizedName" = ?2 WHERE "id" = ?3"#,
            params![clean, normalize_funeral_home(&clean), id],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(failure, _) if failure.code == rusqlite::ErrorCode::ConstraintViolation => {
                AppError::from("Another funeral home already has that name. Merge the two instead.")
            }
            other => other.into(),
        })?;
    if changed == 0 {
        return Err(MISSING_FUNERAL_HOME.into());
    }
    list_funeral_homes(connection)
}

pub fn merge_funeral_homes(connection: &mut Connection, source_id: &str, target_id: &str) -> AppResult<Vec<FuneralHomeOption>> {
    if source_id != target_id {
        let transaction = connection.transaction()?;
        transaction.execute(r#"UPDATE "Entry" SET "funeralHomeId" = ?1 WHERE "funeralHomeId" = ?2"#, [target_id, source_id])?;
        if transaction.execute(r#"DELETE FROM "FuneralHome" WHERE "id" = ?1"#, [source_id])? == 0 {
            return Err(MISSING_FUNERAL_HOME.into());
        }
        transaction.commit()?;
    }
    list_funeral_homes(connection)
}

pub fn delete_funeral_home(connection: &Connection, id: &str) -> AppResult<Vec<FuneralHomeOption>> {
    if connection.execute(r#"DELETE FROM "FuneralHome" WHERE "id" = ?1"#, [id])? == 0 {
        return Err(MISSING_FUNERAL_HOME.into());
    }
    list_funeral_homes(connection)
}

// ── Layout ──

pub fn load_layout(connection: &Connection) -> AppResult<LayoutSettings> {
    let print = connection
        .query_row(
            r#"SELECT "marginInches", "scale", "offsetXInches", "offsetYInches", "printerName" FROM "PrintPreference" WHERE "id" = 1"#,
            [],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?, row.get::<_, f64>(3)?, row.get::<_, Option<String>>(4)?)),
        )
        .optional()?;
    // DEFAULT_LAYOUT in src/shared/contracts.ts.
    let (margin_inches, scale, offset_x_inches, offset_y_inches, printer_name) = print.unwrap_or((0.35, 1.0, 0.0, 0.0, None));
    let mut statement = connection.prepare(r#"SELECT "sectionKey", "widthInches" FROM "LayoutPreference" WHERE "widthInches" IS NOT NULL"#)?;
    let section_widths = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)))?
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    Ok(LayoutSettings { section_widths, margin_inches, scale, offset_x_inches, offset_y_inches, printer_name })
}

pub fn save_layout(connection: &mut Connection, layout: &LayoutSettings) -> AppResult<LayoutSettings> {
    let within = |value: f64, min: f64, max: f64| (min..=max).contains(&value);
    // The ranges the Print setup sliders offer.
    if !(within(layout.margin_inches, 0.15, 0.75)
        && within(layout.scale, 0.8, 1.05)
        && within(layout.offset_x_inches, -0.5, 0.5)
        && within(layout.offset_y_inches, -0.5, 0.5))
    {
        return Err("Those print settings are outside the range the report supports.".into());
    }

    let transaction = connection.transaction()?;
    transaction.execute(
        r#"INSERT INTO "PrintPreference" ("id", "marginInches", "scale", "offsetXInches", "offsetYInches", "printerName") VALUES (1, ?1, ?2, ?3, ?4, ?5)
           ON CONFLICT ("id") DO UPDATE SET "marginInches" = excluded."marginInches", "scale" = excluded."scale",
             "offsetXInches" = excluded."offsetXInches", "offsetYInches" = excluded."offsetYInches", "printerName" = excluded."printerName""#,
        params![
            layout.margin_inches,
            layout.scale,
            layout.offset_x_inches,
            layout.offset_y_inches,
            layout.printer_name.as_deref().map(str::trim).filter(|name| !name.is_empty()),
        ],
    )?;
    for (section_key, width) in &layout.section_widths {
        transaction.execute(
            r#"INSERT INTO "LayoutPreference" ("sectionKey", "widthInches") VALUES (?1, ?2)
               ON CONFLICT ("sectionKey") DO UPDATE SET "widthInches" = excluded."widthInches""#,
            params![section_key, width],
        )?;
    }
    let stored_keys = {
        let mut statement = transaction.prepare(r#"SELECT "sectionKey" FROM "LayoutPreference""#)?;
        let keys = statement.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        keys
    };
    for key in stored_keys.iter().filter(|key| !layout.section_widths.contains_key(*key)) {
        transaction.execute(r#"DELETE FROM "LayoutPreference" WHERE "sectionKey" = ?1"#, [key])?;
    }
    transaction.commit()?;
    load_layout(connection)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    /// A throwaway database folder, removed when the test ends. Bind it before the connection so the
    /// connection is dropped first — Windows will not delete a file that is still open.
    struct Scratch(PathBuf);

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fresh() -> (Scratch, Connection) {
        let scratch = Scratch(std::env::temp_dir().join(format!("night-shift-report-test-{}", uuid::Uuid::new_v4())));
        let connection = open(&scratch.0.join("test.db")).expect("database opens");
        (scratch, connection)
    }

    /// Built from JSON rather than Rust structs so the test also covers what the interface actually sends.
    fn report() -> NightReport {
        serde_json::from_value(json!({
            "id": "report-1", "reportDate": "2026-09-10", "version": 0, "notes": "", "hiddenSections": ["human-road-trips"],
            "sections": [
                { "key": "human-deliver", "category": "human", "title": "DELIVER", "entries": [
                    { "id": "e1", "type": "funeral", "rush": true, "keepSeparate": false, "pinnedBottom": false, "rushBy": "  by 10:00 AM ",
                      "createdAt": "2026-09-10T22:15:00.123Z", "funeralHome": "  collins   ", "deceased": [
                        { "id": "d1", "name": "Smith", "locationCode": "A1", "specialRequest": "" },
                        { "id": "d2", "name": "Jones", "locationCode": "", "specialRequest": "Call first" } ] },
                    { "id": "e2", "type": "plain", "rush": false, "keepSeparate": true, "pinnedBottom": true, "rushBy": "ignored",
                      "createdAt": "2026-09-10T22:16:00.000Z", "text": "Road trip" } ] },
                { "key": "cremated-mail", "category": "cremated", "title": "MAIL", "entries": [
                    // pinnedBottom and rushBy left out, as a report saved by an older build would.
                    { "id": "e3", "type": "count", "rush": false, "keepSeparate": false, "createdAt": "2026-09-10T22:17:00.000Z", "text": "Urns", "count": 3 },
                    { "id": "e4", "type": "combined", "rush": false, "keepSeparate": false, "createdAt": "2026-09-10T22:18:00.000Z",
                      "leftText": "Certs", "rightText": "Barber", "count": 2 },
                    { "id": "e5", "type": "funeralHomeOnly", "rush": false, "keepSeparate": false, "createdAt": "2026-09-10T22:19:00.000Z",
                      "funeralHome": "Brand New Home" } ] }
            ]
        }))
        .expect("report deserializes")
    }

    #[test]
    fn a_report_is_stored_the_way_the_electron_build_stores_it() {
        let (_scratch, mut connection) = fresh();
        let stored = create(&mut connection, &report()).unwrap();

        assert_eq!(stored.hidden_sections.as_deref(), Some(r#"["human-road-trips"]"#));
        assert_eq!(stored.notes, None, "empty notes are stored as null");
        let ids: Vec<_> = stored.entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["e3", "e4", "e5", "e1", "e2"], "ordered by section key, then position");

        let funeral = &stored.entries[3];
        assert_eq!(funeral.funeral_home_name_snapshot.as_deref(), Some("collins"));
        assert_eq!(funeral.rush_by.as_deref(), Some("by 10:00 AM"));
        assert_eq!(funeral.created_at, 1_789_078_500_123);
        let people: Vec<_> = funeral
            .deceased
            .iter()
            .map(|person| (person.name.as_str(), person.location_code.as_deref(), person.special_request.as_deref()))
            .collect();
        assert_eq!(people, [("Smith", Some("A1"), None), ("Jones", None, Some("Call first"))]);

        let plain = &stored.entries[4];
        assert_eq!(plain.rush_by, None, "a rush-by is only kept on a rush");
        assert!(plain.keep_separate && plain.pinned_bottom);
        assert_eq!((stored.entries[0].text.as_deref(), stored.entries[0].count), (Some("Urns"), Some(3)));
        assert_eq!(
            (stored.entries[1].left_text.as_deref(), stored.entries[1].right_text.as_deref(), stored.entries[1].text.as_deref()),
            (Some("Certs"), Some("Barber"), None)
        );

        // "collins" matched the starter "Collins" rather than adding a second one; the new name was added.
        let homes: Vec<_> = list_funeral_homes(&connection).unwrap().into_iter().map(|home| home.name).collect();
        assert_eq!(homes.iter().filter(|name| name.eq_ignore_ascii_case("collins")).count(), 1);
        assert!(homes.iter().any(|name| name == "Brand New Home"));
        let linked: bool = connection.query_row(r#"SELECT "funeralHomeId" IS NOT NULL FROM "Entry" WHERE "id" = 'e1'"#, [], |row| row.get(0)).unwrap();
        assert!(linked);
    }

    #[test]
    fn saving_checks_the_version_and_replaces_the_entries() {
        let (_scratch, mut connection) = fresh();
        create(&mut connection, &report()).unwrap();
        let mut next = report();
        next.sections[0].entries.truncate(1);
        next.notes = "Short night".into();

        let saved = save(&mut connection, &next, 0).unwrap();
        assert_eq!(saved.version, 1);
        assert_eq!(saved.notes.as_deref(), Some("Short night"));
        assert_eq!(saved.entries.len(), 4);
        let people: i64 = connection.query_row(r#"SELECT count(*) FROM "Deceased""#, [], |row| row.get(0)).unwrap();
        assert_eq!(people, 2, "the replaced entries' people go with them");

        let stale = save(&mut connection, &next, 0).unwrap_err();
        assert_eq!(stale.to_string(), VERSION_CONFLICT);
    }

    #[test]
    fn opening_a_database_again_changes_nothing() {
        let (scratch, mut connection) = fresh();
        create(&mut connection, &report()).unwrap();
        drop(connection);

        let reopened = open(&scratch.0.join("test.db")).unwrap();
        assert_eq!(list_funeral_homes(&reopened).unwrap().len(), STARTER_FUNERAL_HOMES.len() + 1);
        assert_eq!(find_by_date(&reopened, "2026-09-10").unwrap().unwrap().entries.len(), 5);
    }

    #[test]
    fn funeral_homes_can_be_renamed_merged_and_removed() {
        let (_scratch, mut connection) = fresh();
        let homes = list_funeral_homes(&connection).unwrap();
        let id_of = |name: &str| homes.iter().find(|home| home.name == name).unwrap().id.clone();
        let (barber, collins) = (id_of("Barber"), id_of("Collins"));

        let clash = rename_funeral_home(&connection, &barber, "  COLLINS ").unwrap_err();
        assert!(clash.to_string().contains("Merge"));
        let renamed = rename_funeral_home(&connection, &barber, "Barber   & Sons").unwrap();
        assert!(renamed.iter().any(|home| home.name == "Barber & Sons"));

        create(&mut connection, &report()).unwrap();
        let merged = merge_funeral_homes(&mut connection, &collins, &barber).unwrap();
        assert!(!merged.iter().any(|home| home.id == collins));
        let linked: String = connection.query_row(r#"SELECT "funeralHomeId" FROM "Entry" WHERE "id" = 'e1'"#, [], |row| row.get(0)).unwrap();
        assert_eq!(linked, barber);
        assert!(delete_funeral_home(&connection, &collins).is_err());
    }

    #[test]
    fn layout_keeps_only_current_widths_and_rejects_out_of_range_print_settings() {
        let (_scratch, mut connection) = fresh();
        let defaults = load_layout(&connection).unwrap();
        assert_eq!((defaults.margin_inches, defaults.scale), (0.35, 1.0));
        assert_eq!(defaults.printer_name, None, "a new database prints through the dialog");

        let mut layout = LayoutSettings {
            section_widths: BTreeMap::from([("human-deliver".to_string(), 3.25), ("cremated-mail".to_string(), 2.0)]),
            margin_inches: 0.4,
            scale: 0.9,
            offset_x_inches: 0.1,
            offset_y_inches: -0.1,
            printer_name: Some("  Front Office Laser ".to_string()),
        };
        save_layout(&mut connection, &layout).unwrap();
        layout.section_widths.remove("cremated-mail");
        let saved = save_layout(&mut connection, &layout).unwrap();
        assert_eq!(saved.section_widths, BTreeMap::from([("human-deliver".to_string(), 3.25)]));
        assert_eq!(saved.scale, 0.9);
        assert_eq!(saved.printer_name.as_deref(), Some("Front Office Laser"));

        layout.printer_name = Some(String::new());
        assert_eq!(save_layout(&mut connection, &layout).unwrap().printer_name, None, "an empty choice goes back to the dialog");

        layout.scale = 1.2;
        assert!(save_layout(&mut connection, &layout).is_err());
    }

    #[test]
    fn purging_keeps_only_the_named_report() {
        let (_scratch, mut connection) = fresh();
        create(&mut connection, &report()).unwrap();
        let mut older = report();
        older.id = "report-0".into();
        older.report_date = "2026-09-09".into();
        older.sections.iter_mut().for_each(|section| section.entries.clear());
        create(&mut connection, &older).unwrap();

        assert_eq!(most_recent(&connection).unwrap().unwrap().id, "report-1");
        assert_eq!(purge_except(&connection, "report-1").unwrap(), 1);
        assert!(find_by_date(&connection, "2026-09-09").unwrap().is_none());
    }

    #[test]
    fn a_vacuumed_copy_holds_the_same_report() {
        let (scratch, mut connection) = fresh();
        create(&mut connection, &report()).unwrap();
        let copy = scratch.0.join("copy.db");
        vacuum_into(&connection, &copy).unwrap();

        let reopened = Connection::open_with_flags(&copy, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(find_by_date(&reopened, "2026-09-10").unwrap().unwrap().entries.len(), 5);
    }
}
