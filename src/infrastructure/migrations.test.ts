// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEmptyReport } from "@/domain/report";
import { PrismaClient } from "@/generated/prisma-client";
import { migrate } from "./migrations";
import { PrismaReportRepository } from "./prismaRepository";

/**
 * The upgrade path, which is the one that runs against the only copy of the data there is. The
 * repository's own tests all start from an empty directory, so they only ever prove that a database
 * created by this build works — never that a database created by an older one survives meeting it.
 *
 * Each case here builds a current database, writes a night into it, winds the schema back to what
 * an earlier build would have left behind, and then opens it the way the app does on launch.
 */
describe("migrate", () => {
  let directory: string;
  let databasePath: string;

  /** Columns this build adds to a database that predates them. */
  const ADDED = [
    { table: "Report", column: "notes" },
    { table: "Report", column: "roadTripsVisible" },
    { table: "Entry", column: "pinnedBottom" },
    { table: "Entry", column: "rushBy" },
  ];

  const rawClient = () => new PrismaClient({ datasources: { db: { url: `file:${databasePath.replace(/\\/g, "/")}` } } });

  const columnsOf = async (client: PrismaClient, table: string) =>
    (await client.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)).map((row) => row.name);

  /** A night with something in every field the added columns carry. */
  async function seedCurrentDatabase() {
    const repository = new PrismaReportRepository(databasePath);
    await repository.initialize();
    const report = createEmptyReport("2026-07-26");
    report.notes = "Ron called about the Helwig roadtrip";
    report.roadTripsVisible = true;
    report.sections[0].entries.push({
      id: "kept-entry",
      type: "funeral",
      funeralHome: "McGuire",
      deceased: [{ id: "kept-person", name: "Smith", locationCode: "13A", specialRequest: "Rush delivery" }],
      rush: true,
      rushBy: "10:00 AM",
      keepSeparate: false,
      pinnedBottom: true,
      createdAt: "2026-07-25T12:00:00.000Z",
    });
    await repository.create(report);
    await repository.close();
  }

  /** Drops the added columns, leaving the database as an earlier build would have. */
  async function windSchemaBack() {
    const client = rawClient();
    for (const { table, column } of ADDED) {
      await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
    }
    await client.$disconnect();
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "night-report-migrate-"));
    databasePath = join(directory, "night-shift-report.db");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("adds the missing columns to an older database and keeps the night that was already in it", async () => {
    await seedCurrentDatabase();
    await windSchemaBack();

    const reopened = new PrismaReportRepository(databasePath);
    await reopened.initialize();
    try {
      const loaded = await reopened.findByDate("2026-07-26");
      expect(loaded).not.toBeNull();

      // The entry, and the person on it, are still there.
      const entries = loaded!.sections.find((section) => section.key === "human-deliver")!.entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "funeral", funeralHome: "McGuire", rush: true });
      expect(entries[0].type === "funeral" && entries[0].deceased[0]).toMatchObject({ name: "Smith", locationCode: "13A", specialRequest: "Rush delivery" });

      // What the dropped columns held is gone, because an older database never had it — but it
      // comes back as a usable default rather than as a null that breaks the page.
      expect(loaded!.notes).toBe("");
      expect(loaded!.roadTripsVisible).toBe(false);
      expect(entries[0].pinnedBottom).toBe(false);
    } finally {
      await reopened.close();
    }
  });

  it("puts every added column back", async () => {
    await seedCurrentDatabase();
    await windSchemaBack();

    const repository = new PrismaReportRepository(databasePath);
    await repository.initialize();
    await repository.close();

    const client = rawClient();
    try {
      for (const { table, column } of ADDED) {
        expect(await columnsOf(client, table)).toContain(column);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it("changes nothing on the second launch", async () => {
    // migrate runs on every start, so it has to be safe to run against a database it has already
    // brought up to date — an ALTER that fired twice would fail and take the launch with it.
    await seedCurrentDatabase();

    const client = rawClient();
    try {
      const before = { Report: await columnsOf(client, "Report"), Entry: await columnsOf(client, "Entry") };
      await migrate(client);
      await migrate(client);
      expect(await columnsOf(client, "Report")).toEqual(before.Report);
      expect(await columnsOf(client, "Entry")).toEqual(before.Entry);
    } finally {
      await client.$disconnect();
    }

    // And the night is still readable afterwards.
    const repository = new PrismaReportRepository(databasePath);
    await repository.initialize();
    try {
      const loaded = await repository.findByDate("2026-07-26");
      expect(loaded!.notes).toBe("Ron called about the Helwig roadtrip");
      expect(loaded!.roadTripsVisible).toBe(true);
    } finally {
      await repository.close();
    }
  });
});
