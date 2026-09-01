import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { ReportService, VersionConflictError } from "./reportService";
import type { ReportRepository } from "./repository";

class MemoryRepository implements ReportRepository {
  reports = new Map<string, NightReport>();

  async findByDate(date: string) { return structuredClone(this.reports.get(date) ?? null); }
  async mostRecent() {
    return structuredClone([...this.reports.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] ?? null);
  }
  async create(report: NightReport) { this.reports.set(report.reportDate, structuredClone(report)); return structuredClone(report); }
  async save(report: NightReport, expectedVersion: number) {
    const current = this.reports.get(report.reportDate);
    if (!current || current.version !== expectedVersion) throw new VersionConflictError();
    const saved = { ...structuredClone(report), version: expectedVersion + 1 };
    this.reports.set(report.reportDate, saved);
    return structuredClone(saved);
  }
  async purgeExcept(id: string) {
    let count = 0;
    for (const [date, report] of this.reports) if (report.id !== id) { this.reports.delete(date); count += 1; }
    return count;
  }
}

describe("ReportService.resolveTonight", () => {
  const clock = () => new Date(2026, 6, 25, 21, 0);

  it("creates an empty report for tonight when nothing exists yet", async () => {
    const repository = new MemoryRepository();
    const { report, created } = await new ReportService(repository, clock).resolveTonight();
    expect(report.reportDate).toBe("2026-07-26");
    expect(report.sections.every((section) => section.entries.length === 0)).toBe(true);
    expect(created).toBe(true);
  });

  it("returns tonight's report unchanged when one already exists", async () => {
    const repository = new MemoryRepository();
    const service = new ReportService(repository, clock);
    const first = await service.resolveTonight();
    const second = await service.resolveTonight();
    expect(second.report.id).toBe(first.report.id);
    expect(second.created).toBe(false);
  });

  it("carries the put-away cards over to the next night", async () => {
    // Like a card width, not like the notes: a run of road-trip nights is set up once.
    const repository = new MemoryRepository();
    const prior = createEmptyReport("2026-07-20");
    prior.hiddenSections = [];
    repository.reports.set(prior.reportDate, prior);

    const { report } = await new ReportService(repository, clock).resolveTonight();
    expect(report.hiddenSections).toEqual([]);
  });

  it("starts a night with the shipped cards put away when there is nothing to carry over", async () => {
    const { report } = await new ReportService(new MemoryRepository(), clock).resolveTonight();
    expect(report.hiddenSections).toEqual(["human-road-trips"]);
  });

  it("clones entries from the retained report with fresh identity", async () => {
    const repository = new MemoryRepository();
    const prior = createEmptyReport("2026-07-20");
    prior.sections[0].entries.push({ id: "old", type: "plain", text: "Carry forward", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: clock().toISOString() });
    repository.reports.set(prior.reportDate, prior);

    const { report, created } = await new ReportService(repository, clock).resolveTonight();
    expect(report.reportDate).toBe("2026-07-26");
    expect(report.sections[0].entries[0]).toMatchObject({ type: "plain", text: "Carry forward" });
    expect(report.sections[0].entries[0].id).not.toBe("old");
    expect(created).toBe(true);
  });

  it("resumes a same-shift draft stranded by the midnight rollover in place, without cloning", async () => {
    const beforeMidnight = () => new Date(2026, 6, 27, 21, 0);
    const afterMidnight = () => new Date(2026, 6, 28, 1, 0);
    const repository = new MemoryRepository();
    const stranded = createEmptyReport("2026-07-28");
    stranded.sections[0].entries.push({ id: "mid-shift", type: "plain", text: "Still tonight", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: beforeMidnight().toISOString() });
    repository.reports.set(stranded.reportDate, stranded);

    const { report, created } = await new ReportService(repository, afterMidnight).resolveTonight();
    expect(report.id).toBe(stranded.id);
    expect(report.sections[0].entries[0].id).toBe("mid-shift");
    expect(created).toBe(false);
  });

  it("dates a shift first opened after midnight to the day it ends, not the day after", async () => {
    const repository = new MemoryRepository();
    // Only the previous shift's report is on hand — nobody opened the app before midnight tonight.
    repository.reports.set("2026-07-27", createEmptyReport("2026-07-27"));

    const { report, created } = await new ReportService(repository, () => new Date(2026, 6, 28, 2, 30)).resolveTonight();
    expect(report.reportDate).toBe("2026-07-28");
    expect(created).toBe(true);
  });

  it("stops resuming last night's report once the shift is over at 8am", async () => {
    const repository = new MemoryRepository();
    const yesterdays = createEmptyReport("2026-07-28");
    repository.reports.set(yesterdays.reportDate, yesterdays);

    const stillOnShift = await new ReportService(repository, () => new Date(2026, 6, 28, 7, 59)).resolveTonight();
    expect(stillOnShift.report.id).toBe(yesterdays.id);

    const shiftOver = await new ReportService(repository, () => new Date(2026, 6, 28, 8, 0)).resolveTonight();
    expect(shiftOver.report.reportDate).toBe("2026-07-29");
    expect(shiftOver.created).toBe(true);
  });

  it("rolls to a new date when last night's report is the only one left", async () => {
    const lastNight = () => new Date(2026, 6, 27, 21, 0);
    const tonight = () => new Date(2026, 6, 28, 21, 0);
    const repository = new MemoryRepository();
    const yesterdays = createEmptyReport("2026-07-28");
    yesterdays.sections[0].entries.push({ id: "last-night", type: "plain", text: "Carry forward", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: lastNight().toISOString() });
    repository.reports.set(yesterdays.reportDate, yesterdays);

    const { report, created } = await new ReportService(repository, tonight).resolveTonight();
    expect(report.reportDate).toBe("2026-07-29");
    expect(report.id).not.toBe(yesterdays.id);
    expect(report.sections[0].entries[0]).toMatchObject({ text: "Carry forward" });
    expect(report.sections[0].entries[0].id).not.toBe("last-night");
    expect(created).toBe(true);
  });
});

describe("report date across midnight", () => {
  it("keeps one shift on one date from the evening through to the end of the shift", () => {
    const at = (...parts: [number, number, number, number, number]) => () => new Date(...parts);
    expect(new ReportService(new MemoryRepository(), at(2026, 6, 27, 21, 0)).tonightDate).toBe("2026-07-28");
    expect(new ReportService(new MemoryRepository(), at(2026, 6, 28, 1, 0)).tonightDate).toBe("2026-07-28");
    expect(new ReportService(new MemoryRepository(), at(2026, 6, 28, 7, 59)).tonightDate).toBe("2026-07-28");
    // 8am: the shift is over and the next report to open belongs to the coming night.
    expect(new ReportService(new MemoryRepository(), at(2026, 6, 28, 8, 0)).tonightDate).toBe("2026-07-29");
  });
});
