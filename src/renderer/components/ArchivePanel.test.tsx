import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { NightShiftApi, ReportSummary } from "@/shared/contracts";
import { App } from "../App";

function archivedReport(date: string, funeralHome: string): NightReport {
  const report = createEmptyReport(date);
  report.status = "finalized";
  report.sections.find((section) => section.key === "human-deliver")!.entries.push({
    id: `entry-${date}`,
    type: "funeralHomeOnly",
    funeralHome,
    rush: false,
    keepSeparate: false, pinnedBottom: false,
    createdAt: "2026-07-20T12:00:00.000Z",
  });
  return report;
}

const PAST = [archivedReport("2026-07-24", "Bellweather"), archivedReport("2026-07-25", "Coleridge")];

const SUMMARIES: ReportSummary[] = PAST.map((report) => ({
  id: report.id,
  reportDate: report.reportDate,
  status: "finalized",
  entryCount: 1,
  finalizedAt: "2026-07-25T04:00:00.000Z",
}));

function mockApi(initialReport: NightReport, overrides: Partial<NightShiftApi> = {}): NightShiftApi {
  let current = initialReport;
  return {
    bootstrap: async () => ({ report: current, latestFinalized: null, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    createDraft: async () => current,
    saveReport: async (report, expectedVersion) => { current = { ...report, version: expectedVersion + 1 }; return current; },
    finalizeReport: async (report, expectedVersion) => { current = { ...report, status: "finalized", version: expectedVersion + 1 }; return current; },
    reopenReport: async (report, expectedVersion) => { current = { ...report, status: "draft", version: expectedVersion + 1 }; return current; },
    listRevisions: async () => [],
    restoreRevision: async () => current,
    saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [],
    mergeFuneralHomes: async () => [],
    deleteFuneralHome: async () => [],
    listBackups: async () => [],
    restoreBackup: async () => {},
    printReport: async () => ({ success: true }),
    listReports: async () => SUMMARIES,
    loadReport: async (id) => PAST.find((report) => report.id === id) ?? null,
    windowControl: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => () => {},
    ...overrides,
  };
}

async function openArchive() {
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Report archive/ }));
  return screen.findByRole("dialog", { name: "Report archive" });
}

describe("ArchivePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.nightShift = mockApi(createEmptyReport("2026-07-26"));
  });

  it("lists retained reports with their entry counts", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    await within(drawer).findByText("Fri, Jul 24, 2026");
    expect(within(drawer).getByText("Sat, Jul 25, 2026")).toBeInTheDocument();
    expect(within(drawer).getAllByText("1 entry")).toHaveLength(2);
  });

  it("opens a past report read-only, with no editing affordances", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    fireEvent.click(await within(drawer).findByText("Sat, Jul 25, 2026"));

    expect(await within(drawer).findByText(/read-only/i)).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /Reprint/ })).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("stages the archived report for printing instead of tonight's report", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    fireEvent.click(await within(drawer).findByText("Sat, Jul 25, 2026"));
    await within(drawer).findByText(/read-only/i);

    // .print-only is what webContents.print() captures, so the archived entry must appear there.
    await waitFor(() => {
      expect(document.querySelector(".print-only")).toHaveTextContent("Coleridge");
    });
  });

  it("restores the live report as the print target once the drawer closes", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    fireEvent.click(await within(drawer).findByText("Sat, Jul 25, 2026"));
    await waitFor(() => expect(document.querySelector(".print-only")).toHaveTextContent("Coleridge"));

    fireEvent.click(screen.getByRole("button", { name: "Close Report archive" }));

    await waitFor(() => {
      expect(document.querySelector(".print-only")).not.toHaveTextContent("Coleridge");
    });
  });

  it("returns to the list without clearing it", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    fireEvent.click(await within(drawer).findByText("Sat, Jul 25, 2026"));
    fireEvent.click(await within(drawer).findByRole("button", { name: /Back to list/ }));

    expect(await within(drawer).findByText("Fri, Jul 24, 2026")).toBeInTheDocument();
  });

  it("explains the empty state rather than showing a blank panel", async () => {
    window.nightShift = mockApi(createEmptyReport("2026-07-26"), { listReports: async () => [] });
    render(<App />);
    await screen.findByText("Night Shift Report");
    const drawer = await openArchive();

    expect(await within(drawer).findByText(/No past reports yet/)).toBeInTheDocument();
  });

  it("surfaces a load failure as a toast instead of failing silently", async () => {
    window.nightShift = mockApi(createEmptyReport("2026-07-26"), {
      listReports: vi.fn(async () => { throw new Error("Archive unavailable."); }),
    });
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openArchive();

    expect(await screen.findByText("Archive unavailable.")).toBeInTheDocument();
  });
});
