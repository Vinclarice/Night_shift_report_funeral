import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { ReportService, VersionConflictError } from "./reportService";
import type { ReportRepository, RevisionSummary } from "./repository";

class MemoryRepository implements ReportRepository {
  reports = new Map<string, NightReport>();
  revisions = new Map<string, Array<{ summary: RevisionSummary; snapshot: NightReport }>>();

  async findByDate(date: string) { return structuredClone(this.reports.get(date) ?? null); }
  async latestFinalized() {
    return [...this.reports.values()].filter((r) => r.status === "finalized").sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] ?? null;
  }
  async latestDraft(onOrBefore: string) {
    return [...this.reports.values()].filter((r) => r.status === "draft" && r.reportDate <= onOrBefore).sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] ?? null;
  }
  async create(report: NightReport) { this.reports.set(report.reportDate, structuredClone(report)); return structuredClone(report); }
  async save(report: NightReport, expectedVersion: number) {
    const current = this.reports.get(report.reportDate);
    if (!current || current.version !== expectedVersion) throw new VersionConflictError();
    const saved = { ...structuredClone(report), version: expectedVersion + 1 };
    this.reports.set(report.reportDate, saved);
    return structuredClone(saved);
  }
  async finalize(report: NightReport, expectedVersion: number, finalizedAt: Date) {
    const saved = await this.save({ ...report, status: "finalized", finalizedAt: finalizedAt.toISOString() }, expectedVersion);
    const items = this.revisions.get(saved.id) ?? [];
    const summary = { id: crypto.randomUUID(), revisionNumber: items.length + 1, finalizedAt: finalizedAt.toISOString() };
    items.push({ summary, snapshot: structuredClone(saved) });
    this.revisions.set(saved.id, items);
    return saved;
  }
  async listRevisions(reportId: string) { return (this.revisions.get(reportId) ?? []).map((item) => item.summary); }
  async restoreRevision(reportId: string, revisionId: string, expectedVersion: number) {
    const item = (this.revisions.get(reportId) ?? []).find((candidate) => candidate.summary.id === revisionId)!;
    return this.save({ ...structuredClone(item.snapshot), status: "draft", finalizedAt: null }, expectedVersion);
  }
  async purgeOlderThan() { return 0; }
}

describe("ReportService", () => {
  const clock = () => new Date(2026, 6, 25, 21, 0);

  it("creates tomorrow's empty draft and resumes it later", async () => {
    const repository = new MemoryRepository();
    const service = new ReportService(repository, clock);
    const created = await service.createTonight("empty");
    expect(created.reportDate).toBe("2026-07-26");
    await expect(service.loadTonight()).resolves.toEqual(created);
  });

  it("clones entries from the latest finalized report with fresh identity", async () => {
    const repository = new MemoryRepository();
    const prior = createEmptyReport("2026-07-25");
    prior.status = "finalized";
    prior.sections[0].entries.push({ id: "old", type: "plain", text: "Carry forward", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: clock().toISOString() });
    repository.reports.set(prior.reportDate, prior);
    const created = await new ReportService(repository, clock).createTonight("clone");
    expect(created.sections[0].entries[0]).toMatchObject({ type: "plain", text: "Carry forward" });
    expect(created.sections[0].entries[0].id).not.toBe("old");
  });

  it("finalizes, preserves a revision, and reopens without losing it", async () => {
    const repository = new MemoryRepository();
    const service = new ReportService(repository, clock);
    const draft = await service.createTonight("empty");
    const final = await service.finalize(draft, draft.version);
    expect(final.status).toBe("finalized");
    expect(await service.listRevisions(final.id)).toHaveLength(1);
    const reopened = await service.reopen(final, final.version);
    expect(reopened.status).toBe("draft");
    expect(await service.listRevisions(final.id)).toHaveLength(1);
  });
});


describe("report date rolling over mid-shift", () => {
  const beforeMidnight = () => new Date(2026, 6, 27, 21, 0);
  const afterMidnight = () => new Date(2026, 6, 28, 1, 0);

  it("names the report for the next calendar day, which changes partway through a night shift", () => {
    expect(new ReportService(new MemoryRepository(), beforeMidnight).tonightDate).toBe("2026-07-28");
    expect(new ReportService(new MemoryRepository(), afterMidnight).tonightDate).toBe("2026-07-29");
  });

  it("offers the draft started earlier in the shift once the date has rolled over", async () => {
    const repository = new MemoryRepository();
    await new ReportService(repository, beforeMidnight).createTonight("empty");

    // Same shift, but the calendar day changed, so loadTonight now looks for a report that
    // does not exist and the earlier draft would otherwise be unreachable.
    const afterRestart = new ReportService(repository, afterMidnight);
    expect(await afterRestart.loadTonight()).toBeNull();

    const resumable = await afterRestart.resumableDraft();
    expect(resumable?.reportDate).toBe("2026-07-28");
  });

  it("offers nothing to resume while tonight's report already exists", async () => {
    const repository = new MemoryRepository();
    const service = new ReportService(repository, beforeMidnight);
    await service.createTonight("empty");

    expect(await service.resumableDraft()).toBeNull();
  });

  it("does not offer a finalized report as resumable", async () => {
    const repository = new MemoryRepository();
    const service = new ReportService(repository, beforeMidnight);
    const created = await service.createTonight("empty");
    await service.finalize(created, created.version);

    expect(await new ReportService(repository, afterMidnight).resumableDraft()).toBeNull();
  });

  it("does not offer a draft dated later than tonight, which would be a real future report", async () => {
    const repository = new MemoryRepository();
    await new ReportService(repository, afterMidnight).createTonight("empty");

    // Clock moved backwards (or the future draft was made deliberately); 2026-07-29 is ahead of
    // this service's 2026-07-28, so it is not a stranded draft from the current shift.
    expect(await new ReportService(repository, beforeMidnight).resumableDraft()).toBeNull();
  });

  it("offers the newest eligible draft even when a later future draft also exists", async () => {
    const repository = new MemoryRepository();
    const olderDraft = createEmptyReport("2026-07-27");
    const futureDraft = createEmptyReport("2026-07-29");
    repository.reports.set(olderDraft.reportDate, olderDraft);
    repository.reports.set(futureDraft.reportDate, futureDraft);

    const resumable = await new ReportService(repository, beforeMidnight).resumableDraft();

    expect(resumable?.reportDate).toBe("2026-07-27");
  });
});
