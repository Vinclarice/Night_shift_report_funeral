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
    prior.sections[0].entries.push({ id: "old", type: "plain", text: "Carry forward", rush: false, keepSeparate: false, createdAt: clock().toISOString() });
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

