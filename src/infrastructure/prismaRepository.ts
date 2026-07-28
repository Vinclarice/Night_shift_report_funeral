import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PrismaClient } from "@/generated/prisma-client";
import type { Prisma } from "@/generated/prisma-client";

import { VersionConflictError } from "@/application/reportService";
import type { ReportRepository, RevisionSummary } from "@/application/repository";
import { normalizeFuneralHome } from "@/domain/entries";
import { createEmptyReport } from "@/domain/report";
import type { LayoutSettings, NightReport, ReportEntry } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { BackupSummary, FuneralHomeOption } from "@/shared/contracts";
import { migrate } from "./migrations";

type LoadedReport = Prisma.ReportGetPayload<{
  include: { entries: { include: { deceased: true } } };
}>;

const STARTER_FUNERAL_HOMES = [
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

export class PrismaReportRepository implements ReportRepository {
  private client: PrismaClient;

  constructor(readonly databasePath: string) {
    this.client = this.createClient();
  }

  private createClient() {
    return new PrismaClient({ datasources: { db: { url: `file:${this.databasePath.replace(/\\/g, "/")}` } } });
  }

  async initialize() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    await migrate(this.client);
    const seeded = await this.client.$queryRawUnsafe<Array<{ value: string }>>(
      `SELECT "value" FROM "AppSetting" WHERE "key" = 'starterFuneralHomesSeeded'`,
    );
    if (!seeded.length) {
      await this.client.$transaction(async (tx) => {
        for (const name of STARTER_FUNERAL_HOMES) {
          const normalizedName = normalizeFuneralHome(name);
          await tx.funeralHome.upsert({
            where: { normalizedName },
            update: {},
            create: { name, normalizedName },
          });
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "AppSetting" ("key", "value") VALUES ('starterFuneralHomesSeeded', '1')`,
        );
      });
    }
  }

  async close() { await this.client.$disconnect(); }

  private async loadedBy(where: { id?: string; reportDate?: string }): Promise<NightReport | null> {
    const loaded = await this.client.report.findUnique({
      where: where.id ? { id: where.id } : { reportDate: where.reportDate! },
      include: { entries: { include: { deceased: { orderBy: { position: "asc" } } }, orderBy: [{ sectionKey: "asc" }, { position: "asc" }] } },
    });
    return loaded ? this.toDomain(loaded) : null;
  }

  findByDate(date: string) { return this.loadedBy({ reportDate: date }); }

  findById(id: string) { return this.loadedBy({ id }); }

  /** Summaries only — the archive list never needs entry bodies, just a count per report. */
  async listReports() {
    const items = await this.client.report.findMany({
      orderBy: { reportDate: "desc" },
      select: { id: true, reportDate: true, status: true, finalizedAt: true, _count: { select: { entries: true } } },
    });
    return items.map((item) => ({
      id: item.id,
      reportDate: item.reportDate,
      status: item.status === "finalized" ? "finalized" as const : "draft" as const,
      entryCount: item._count.entries,
      finalizedAt: item.finalizedAt ? item.finalizedAt.toISOString() : null,
    }));
  }

  async latestFinalized() {
    const item = await this.client.report.findFirst({ where: { status: "finalized" }, orderBy: { reportDate: "desc" } });
    return item ? this.loadedBy({ id: item.id }) : null;
  }

  async latestDraft() {
    const item = await this.client.report.findFirst({ where: { status: "draft" }, orderBy: { reportDate: "desc" } });
    return item ? this.loadedBy({ id: item.id }) : null;
  }

  async create(report: NightReport) {
    await this.client.$transaction(async (tx) => {
      await tx.report.create({ data: {
        id: report.id,
        reportDate: report.reportDate,
        status: report.status,
        version: report.version,
        finalizedAt: report.finalizedAt ? new Date(report.finalizedAt) : null,
      } });
      await this.writeEntries(tx, report);
    });
    return (await this.loadedBy({ id: report.id }))!;
  }

  async save(report: NightReport, expectedVersion: number) {
    const nextVersion = expectedVersion + 1;
    await this.client.$transaction(async (tx) => {
      const changed = await tx.report.updateMany({
        where: { id: report.id, version: expectedVersion },
        data: {
          status: report.status,
          version: nextVersion,
          finalizedAt: report.finalizedAt ? new Date(report.finalizedAt) : null,
        },
      });
      if (changed.count !== 1) throw new VersionConflictError();
      await tx.entry.deleteMany({ where: { reportId: report.id } });
      await this.writeEntries(tx, report);
    });
    return (await this.loadedBy({ id: report.id }))!;
  }

  async finalize(report: NightReport, expectedVersion: number, finalizedAt: Date) {
    const finalSnapshot: NightReport = {
      ...structuredClone(report),
      status: "finalized",
      finalizedAt: finalizedAt.toISOString(),
      version: expectedVersion + 1,
    };
    await this.client.$transaction(async (tx) => {
      const changed = await tx.report.updateMany({
        where: { id: report.id, version: expectedVersion },
        data: { status: "finalized", finalizedAt, version: finalSnapshot.version },
      });
      if (changed.count !== 1) throw new VersionConflictError();
      await tx.entry.deleteMany({ where: { reportId: report.id } });
      await this.writeEntries(tx, finalSnapshot);
      const count = await tx.revision.count({ where: { reportId: report.id } });
      await tx.revision.create({ data: {
        reportId: report.id,
        revisionNumber: count + 1,
        snapshotJson: JSON.stringify(finalSnapshot),
        finalizedAt,
      } });
    });
    return (await this.loadedBy({ id: report.id }))!;
  }

  async listRevisions(reportId: string): Promise<RevisionSummary[]> {
    return (await this.client.revision.findMany({ where: { reportId }, orderBy: { revisionNumber: "desc" } }))
      .map((item) => ({ id: item.id, revisionNumber: item.revisionNumber, finalizedAt: item.finalizedAt.toISOString() }));
  }

  async restoreRevision(reportId: string, revisionId: string, expectedVersion: number) {
    const revision = await this.client.revision.findFirstOrThrow({ where: { id: revisionId, reportId } });
    const current = await this.loadedBy({ id: reportId });
    if (!current) throw new Error("Report no longer exists.");
    const snapshot = JSON.parse(revision.snapshotJson) as NightReport;
    return this.save({ ...snapshot, id: reportId, reportDate: current.reportDate, status: "draft", finalizedAt: null }, expectedVersion);
  }

  async purgeOlderThan(cutoffDate: string) {
    const result = await this.client.report.deleteMany({ where: { reportDate: { lt: cutoffDate } } });
    if (result.count) {
      await this.client.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
      await this.client.$executeRawUnsafe("PRAGMA secure_delete = ON");
    }
    return result.count;
  }

  async listFuneralHomes(): Promise<FuneralHomeOption[]> {
    return this.client.funeralHome.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  }

  async renameFuneralHome(id: string, name: string) {
    const clean = name.trim().replace(/\s+/g, " ");
    await this.client.funeralHome.update({ where: { id }, data: { name: clean, normalizedName: normalizeFuneralHome(clean) } });
    return this.listFuneralHomes();
  }

  async mergeFuneralHomes(sourceId: string, targetId: string) {
    await this.client.$transaction(async (tx) => {
      await tx.entry.updateMany({ where: { funeralHomeId: sourceId }, data: { funeralHomeId: targetId } });
      await tx.funeralHome.delete({ where: { id: sourceId } });
    });
    return this.listFuneralHomes();
  }

  async deleteFuneralHome(id: string) {
    await this.client.funeralHome.delete({ where: { id } });
    return this.listFuneralHomes();
  }

  async loadLayout(): Promise<LayoutSettings> {
    const [print, widths] = await Promise.all([
      this.client.printPreference.findUnique({ where: { id: 1 } }),
      this.client.layoutPreference.findMany(),
    ]);
    return {
      ...DEFAULT_LAYOUT,
      ...(print ? {
        marginInches: print.marginInches,
        scale: print.scale,
        offsetXInches: print.offsetXInches,
        offsetYInches: print.offsetYInches,
      } : {}),
      sectionWidths: Object.fromEntries(widths.filter((item) => item.widthInches != null).map((item) => [item.sectionKey, item.widthInches!])),
    };
  }

  async saveLayout(layout: LayoutSettings): Promise<LayoutSettings> {
    await this.client.$transaction(async (tx) => {
      await tx.printPreference.upsert({
        where: { id: 1 },
        create: { id: 1, marginInches: layout.marginInches, scale: layout.scale, offsetXInches: layout.offsetXInches, offsetYInches: layout.offsetYInches },
        update: { marginInches: layout.marginInches, scale: layout.scale, offsetXInches: layout.offsetXInches, offsetYInches: layout.offsetYInches },
      });
      for (const [sectionKey, widthInches] of Object.entries(layout.sectionWidths)) {
        await tx.layoutPreference.upsert({ where: { sectionKey }, create: { sectionKey, widthInches }, update: { widthInches } });
      }
      const activeKeys = Object.keys(layout.sectionWidths);
      await tx.layoutPreference.deleteMany({ where: activeKeys.length ? { sectionKey: { notIn: activeKeys } } : {} });
    });
    return this.loadLayout();
  }

  async backupTo(targetPath: string) {
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    const escaped = targetPath.replace(/'/g, "''").replace(/\\/g, "/");
    await this.client.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  }

  private toDomain(loaded: LoadedReport): NightReport {
    const report = createEmptyReport(loaded.reportDate);
    report.id = loaded.id;
    report.status = loaded.status as NightReport["status"];
    report.version = loaded.version;
    report.finalizedAt = loaded.finalizedAt?.toISOString() ?? null;
    for (const section of report.sections) {
      section.entries = loaded.entries.filter((entry) => entry.sectionKey === section.key).map((entry): ReportEntry => {
        const base = { id: entry.id, rush: entry.rush, keepSeparate: entry.keepSeparate, pinnedBottom: entry.pinnedBottom, createdAt: entry.createdAt.toISOString() };
        if (entry.type === "funeral") return { ...base, type: "funeral", funeralHome: entry.funeralHomeNameSnapshot ?? "", deceased: entry.deceased.map((person) => ({ id: person.id, name: person.name, locationCode: person.locationCode ?? "", specialRequest: person.specialRequest ?? "" })) };
        if (entry.type === "funeralHomeOnly") return { ...base, type: "funeralHomeOnly", funeralHome: entry.funeralHomeNameSnapshot ?? "" };
        if (entry.type === "count") return { ...base, type: "count", text: entry.text ?? "", count: entry.count ?? 1 };
        if (entry.type === "combined") return { ...base, type: "combined", leftText: entry.leftText ?? "", rightText: entry.rightText ?? "", count: entry.count ?? 1 };
        return { ...base, type: "plain", text: entry.text ?? "" };
      });
    }
    return report;
  }

  private async writeEntries(tx: Prisma.TransactionClient, report: NightReport) {
    // Each entry carries its section-relative position (matching the read-side ordering by
    // sectionKey/position), so this flattens once up front rather than re-deriving it per query.
    const allEntries = report.sections.flatMap((section) =>
      section.entries.map((entry, position) => ({ section, entry, position })),
    );

    // Previously this upserted the funeral home once per *entry*, re-upserting the same name
    // repeatedly whenever it appeared more than once in the report. Upsert each distinct name
    // exactly once, in parallel, and look the id up by name while building the entry rows below.
    const namesByNormalized = new Map<string, string>();
    for (const { entry } of allEntries) {
      if (entry.type === "funeral" || entry.type === "funeralHomeOnly") {
        const clean = entry.funeralHome.trim().replace(/\s+/g, " ");
        namesByNormalized.set(normalizeFuneralHome(clean), clean);
      }
    }
    const idByNormalizedName = new Map<string, string>();
    await Promise.all(
      [...namesByNormalized.entries()].map(async ([normalizedName, name]) => {
        const home = await tx.funeralHome.upsert({
          where: { normalizedName },
          update: {},
          create: { name, normalizedName },
        });
        idByNormalizedName.set(normalizedName, home.id);
      }),
    );

    // Previously this issued one entry.create (with a nested deceased create) per entry.
    // Two batched calls replace what could be dozens of sequential round trips per save.
    const entryRows = allEntries.map(({ section, entry, position }) => {
      const funeralHomeNameSnapshot =
        entry.type === "funeral" || entry.type === "funeralHomeOnly" ? entry.funeralHome.trim().replace(/\s+/g, " ") : undefined;
      return {
        id: entry.id,
        reportId: report.id,
        sectionKey: section.key,
        type: entry.type,
        rush: entry.rush,
        keepSeparate: entry.keepSeparate,
        pinnedBottom: entry.pinnedBottom,
        position,
        funeralHomeId: funeralHomeNameSnapshot ? idByNormalizedName.get(normalizeFuneralHome(funeralHomeNameSnapshot)) : undefined,
        funeralHomeNameSnapshot,
        text: entry.type === "plain" || entry.type === "count" ? entry.text : undefined,
        leftText: entry.type === "combined" ? entry.leftText : undefined,
        rightText: entry.type === "combined" ? entry.rightText : undefined,
        count: entry.type === "count" || entry.type === "combined" ? entry.count : undefined,
        createdAt: new Date(entry.createdAt),
      };
    });
    const deceasedRows = allEntries.flatMap(({ entry }) =>
      entry.type === "funeral"
        ? entry.deceased.map((person, personPosition) => ({
            id: person.id,
            entryId: entry.id,
            name: person.name,
            locationCode: person.locationCode || null,
            specialRequest: person.specialRequest || null,
            position: personPosition,
          }))
        : [],
    );

    if (entryRows.length) await tx.entry.createMany({ data: entryRows });
    if (deceasedRows.length) await tx.deceased.createMany({ data: deceasedRows });
  }
}

export class BackupManager {
  constructor(private readonly repository: PrismaReportRepository, readonly backupDirectory: string) {}

  async create(label = "finalized") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(this.backupDirectory, `${stamp}-${label}.db`);
    await this.repository.backupTo(path);
    return path;
  }

  async list(): Promise<BackupSummary[]> {
    await mkdir(this.backupDirectory, { recursive: true });
    const names = (await readdir(this.backupDirectory)).filter((name) => name.endsWith(".db"));
    return Promise.all(names.map(async (name) => {
      const info = await stat(join(this.backupDirectory, name));
      return { name, createdAt: info.mtime.toISOString(), size: info.size };
    })).then((items) => items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async purge(days: number) {
    const cutoff = Date.now() - days * 86_400_000;
    for (const item of await this.list()) {
      if (new Date(item.createdAt).getTime() < cutoff) await rm(join(this.backupDirectory, item.name), { force: true });
    }
  }

  async restore(name: string) {
    if (!/^[\w.-]+\.db$/.test(name)) throw new Error("Invalid backup name.");
    const source = join(this.backupDirectory, name);
    // Snapshot the current database before touching anything, in case the chosen backup turns
    // out to be the wrong one — this is the only way back if so. Must happen before close()
    // since it needs the live connection.
    await this.create("pre-restore");
    await this.repository.close();

    // Atomic replace: copy into a temp file on the same filesystem, then rename over the live
    // database, rather than overwriting it directly. A copyFile straight to the live path that
    // fails partway would otherwise leave a truncated, corrupted database with no way back.
    const databasePath = this.repository.databasePath;
    const tempPath = `${databasePath}.restoring-${Date.now()}`;
    await copyFile(source, tempPath);
    await rename(tempPath, databasePath);

    // Clean up any WAL/SHM sidecar files left over from the database we just replaced — they
    // describe uncommitted writes against the OLD file and must never be applied to the new one.
    await Promise.all([
      rm(`${databasePath}-wal`, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
    ]);
  }
}
