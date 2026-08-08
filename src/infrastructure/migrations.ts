import type { PrismaClient } from "@/generated/prisma-client";

const statements = [
  `CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportDate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Report_reportDate_key" ON "Report"("reportDate")`,
  `CREATE TABLE IF NOT EXISTS "FuneralHome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "FuneralHome_normalizedName_key" ON "FuneralHome"("normalizedName")`,
  `CREATE TABLE IF NOT EXISTS "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rush" BOOLEAN NOT NULL DEFAULT false,
    "keepSeparate" BOOLEAN NOT NULL DEFAULT false,
    "pinnedBottom" BOOLEAN NOT NULL DEFAULT false,
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
  )`,
  `CREATE INDEX IF NOT EXISTS "Entry_reportId_sectionKey_position_idx" ON "Entry"("reportId", "sectionKey", "position")`,
  `CREATE TABLE IF NOT EXISTS "Deceased" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationCode" TEXT,
    "specialRequest" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "Deceased_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LayoutPreference" ("sectionKey" TEXT NOT NULL PRIMARY KEY, "widthInches" REAL)`,
  `CREATE TABLE IF NOT EXISTS "PrintPreference" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "marginInches" REAL NOT NULL DEFAULT 0.35,
    "scale" REAL NOT NULL DEFAULT 1,
    "offsetXInches" REAL NOT NULL DEFAULT 0,
    "offsetYInches" REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS "AppSetting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)`,
];

/**
 * Tables that used to exist but no longer do. These statements drop them from any existing local
 * database on next launch, rather than leaving them behind as orphaned data. First Call and
 * Cremation Batch were removed after that work moved to a separate program; Revision was removed
 * along with the finalize/lock system, which was its only source. The generic "AppSetting" table
 * stays — it's also used by the core starter-funeral-home seeding flag.
 */
const droppedTables = [
  "FirstCallFuneralHome",
  "FirstCallFacility",
  "FirstCallLookupCache",
  "FirstCallPrintPreference",
  "CremationFuneralHome",
  "CremationSequenceState",
  "CremationPrintPreference",
  "Revision",
];

/** Columns that used to exist on a table that's kept. SQLite has no "DROP COLUMN IF EXISTS". */
const droppedColumns: Array<{ table: string; column: string }> = [
  { table: "Report", column: "status" },
  { table: "Report", column: "finalizedAt" },
  { table: "Report", column: "basedOnReportId" },
];

async function applyDroppedColumns(client: PrismaClient): Promise<void> {
  for (const { table, column } of droppedColumns) {
    const columns = await client.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
    if (!columns.some((existing) => existing.name === column)) continue;
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  }
}

/**
 * Columns added after the first release. The CREATE TABLE statements above only run on a fresh
 * database, so an existing one needs the column added explicitly. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", hence the pragma check — running ALTER blindly and swallowing the
 * error would also hide genuine failures.
 */
const addedColumns: Array<{ table: string; column: string; definition: string }> = [
  { table: "Entry", column: "pinnedBottom", definition: `BOOLEAN NOT NULL DEFAULT false` },
];

async function applyAddedColumns(client: PrismaClient): Promise<void> {
  for (const { table, column, definition } of addedColumns) {
    const columns = await client.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
    if (columns.some((existing) => existing.name === column)) continue;
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

export async function migrate(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const statement of statements) await client.$executeRawUnsafe(statement);
  await applyAddedColumns(client);
  await applyDroppedColumns(client);
  for (const table of droppedTables) await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
  await client.printPreference.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
