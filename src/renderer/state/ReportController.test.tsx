import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { NightShiftApi } from "@/shared/contracts";
import { ReportControllerProvider, useReportActions, useReportState } from "./ReportController";
import type { ReportActions } from "./ReportController";
import { ToastProvider } from "../ui/Toast";

function mockApi(initialReport: NightReport): NightShiftApi {
  let current = initialReport;
  return {
    bootstrap: async () => ({ report: current, latestFinalized: null, layout: DEFAULT_LAYOUT, funeralHomes: [{ id: "fh-1", name: "Bellweather" }], backups: [] }),
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
    listReports: async () => [],
    loadReport: async () => current,
    windowControl: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => () => {},
  };
}

/**
 * The whole point of splitting the contexts is that actions never change identity. A component
 * consuming only actions should therefore render once and never again, no matter how much report
 * state churns — this harness records both to assert exactly that.
 */
const seenActions: ReportActions[] = [];
const renders = { actions: 0 };

function ActionsOnlyConsumer() {
  const actions = useReportActions();
  // Recorded in an effect rather than during render, so the counter is a genuine side effect and
  // stays accurate under StrictMode's double-invoked render pass.
  useEffect(() => {
    renders.actions += 1;
    seenActions.push(actions);
  });
  return <button onClick={() => void actions.createDraft("empty")}>make draft</button>;
}

function StateConsumer() {
  const { report, status } = useReportState();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="entries">{report?.sections.find((section) => section.key === "human-deliver")?.entries.length ?? "none"}</span>
    </div>
  );
}

function Harness() {
  return (
    <ToastProvider>
      <ReportControllerProvider>
        <ActionsOnlyConsumer />
        <StateConsumer />
      </ReportControllerProvider>
    </ToastProvider>
  );
}

describe("ReportController contexts", () => {
  beforeEach(() => {
    seenActions.length = 0;
    renders.actions = 0;
    window.localStorage.clear();
    window.nightShift = mockApi(createEmptyReport("2026-07-26"));
  });

  it("keeps the actions object identity-stable across state changes", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("saved"));

    fireEvent.click(screen.getByRole("button", { name: "make draft" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("saved"));

    // Bootstrap plus a draft creation churned state repeatedly; every actions value seen must be
    // the same object, otherwise memoized consumers would re-render on unrelated state changes.
    expect(seenActions.length).toBeGreaterThan(0);
    expect(new Set(seenActions).size).toBe(1);
  });

  it("does not re-render an actions-only consumer when report state changes", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("saved"));
    const afterBootstrap = renders.actions;

    fireEvent.click(screen.getByRole("button", { name: "make draft" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("saved"));

    expect(renders.actions).toBe(afterBootstrap);
  });

  it("resolves a funeral home against the directory through a ref rather than a stale closure", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("saved"));

    // canonicalFuneralHome reads bootstrapRef; if it closed over state it would still see null here.
    expect(seenActions[0].canonicalFuneralHome("bellweather")).toBe("Bellweather");
    expect(seenActions[0].canonicalFuneralHome("mcguire")).toBe("Mcguire");
  });

  it("throws a clear error when the hooks are used outside the provider", () => {
    function Orphan() {
      useReportActions();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/within ReportControllerProvider/);
  });
});
