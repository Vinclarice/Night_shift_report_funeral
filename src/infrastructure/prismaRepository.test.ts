// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VersionConflictError } from "@/application/reportService";
import { createEmptyReport } from "@/domain/report";
import { PrismaReportRepository } from "./prismaRepository";

describe("PrismaReportRepository", () => {
  let directory: string;
  let repository: PrismaReportRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "night-report-test-"));
    repository = new PrismaReportRepository(join(directory, "test.db"));
    await repository.initialize();
  });

  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists structured entries and rejects a stale version", async () => {
    const report = createEmptyReport("2026-07-26");
    report.sections[0].entries.push({
      id: crypto.randomUUID(),
      type: "funeral",
      funeralHome: "McGuire",
      deceased: [{ id: crypto.randomUUID(), name: "Smith", locationCode: "13A", specialRequest: "Rush delivery" }],
      rush: true,
      keepSeparate: false, pinnedBottom: false,
      createdAt: new Date().toISOString(),
    });
    await repository.create(report);

    const loaded = await repository.findByDate(report.reportDate);
    expect(loaded?.sections[0].entries[0]).toMatchObject({ type: "funeral", funeralHome: "McGuire", rush: true });
    await expect(repository.save(loaded!, 99)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("creates and restores finalized revisions", async () => {
    const report = await repository.create(createEmptyReport("2026-07-26"));
    const final = await repository.finalize(report, 0, new Date("2026-07-25T23:00:00Z"));
    const revisions = await repository.listRevisions(final.id);
    expect(revisions).toHaveLength(1);
    const restored = await repository.restoreRevision(final.id, revisions[0].id, final.version);
    expect(restored.status).toBe("draft");
    expect(restored.version).toBe(2);
  });

  it("preloads the regular funeral-home suggestions on first launch", async () => {
    const homes = await repository.listFuneralHomes();
    expect(homes.map((home) => home.name)).toContain("McGuire");
    expect(homes.map((home) => home.name)).toContain("NMS");
  });

  it("stores First Call directories separately from Night Shift funeral homes", async () => {
    await repository.saveFirstCallFuneralHome({ name: "Example Funeral", address: "1 Main St", phone: "202-555-0100", fax: "", email: "" });
    await repository.saveFirstCallFacility({ name: "Example Hospital", address: "2 Health Way", phone: "202-555-0200" });

    const firstCall = await repository.listFirstCallDirectories();
    expect(firstCall.funeralHomes).toEqual([expect.objectContaining({ name: "Example Funeral", address: "1 Main St" })]);
    expect(firstCall.facilities).toEqual([expect.objectContaining({ name: "Example Hospital", address: "2 Health Way" })]);
    expect((await repository.listFuneralHomes()).map((home) => home.name)).not.toContain("Example Funeral");
  });

  it("rejects Residence at the persistence boundary", async () => {
    await expect(repository.saveFirstCallFacility({ name: "  residence ", address: "Private address", phone: "Private phone" }))
      .rejects.toThrow(/never saved/i);
    expect((await repository.listFirstCallDirectories()).facilities).toEqual([]);
  });

  it("persists First Call calibration without creating a sheet record", async () => {
    await repository.saveFirstCallPrintPreference({ scale: 1.025, offsetXInches: 0.03, offsetYInches: -0.02 });
    await expect(repository.loadFirstCallPrintPreference()).resolves.toEqual({ scale: 1.025, offsetXInches: 0.03, offsetYInches: -0.02 });
    expect(await repository.listReports()).toEqual([]);
  });

  it("caches only explicit non-residential place lookup results", async () => {
    const candidate = { sourceId: "tomtom-1", name: "Example Hospital", address: "2 Health Way", phone: "202-555-0200", fax: "", email: "", attribution: "TomTom" as const };
    await repository.writeFirstCallLookupCache("facility", "facility:example hospital", [candidate]);
    await expect(repository.readFirstCallLookupCache("facility", "facility:example hospital")).resolves.toEqual([candidate]);
    await expect(repository.readFirstCallLookupCache("funeralHome", "facility:example hospital")).resolves.toBeNull();
  });
});
