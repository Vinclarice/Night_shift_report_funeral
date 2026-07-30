import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { createEmptyReport } from "@/domain/report";
import { ReportPage } from "./ReportPage";

describe("print report", () => {
  it("renders all independent section cards and a draft watermark", () => {
    render(
      <ReportPage
        report={createEmptyReport("2026-07-26")}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
      />,
    );
    expect(screen.getByText("NIGHT SHIFT REPORT")).toBeInTheDocument();
    expect(screen.getByText("JULY 26, 2026")).toBeInTheDocument();
    expect(screen.getAllByTestId("section-card")).toHaveLength(9);
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
  });

  it("applies the requested print compaction level to the shared page", () => {
    const { container } = render(
      <ReportPage
        report={createEmptyReport("2026-07-26")}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
        compactLevel={1}
      />,
    );

    expect(container.querySelector(".report-page")).toHaveClass("compact-1");
  });

  it("lets the operator type into an empty preview row and commit with Enter", () => {
    const onLineCommit = vi.fn();
    render(
      <ReportPage
        report={createEmptyReport("2026-07-26")}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
        interactive
        onLineCommit={onLineCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Type in Human Remains DELIVER" }));
    const input = screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" });
    fireEvent.change(input, { target: { value: "McGuire \u2013 Smith (13A)" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onLineCommit).toHaveBeenCalledWith("human-deliver", null, "McGuire \u2013 Smith (13A)");
  });

  it.each(["Enter", "Tab"])("opens the next blank preview row after committing with %s", async (key) => {
    const layout = { sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 };
    const report = createEmptyReport("2026-07-26");
    let nextReport = report;
    const onLineCommit = vi.fn((sectionKey: string, _entryId: string | null, value: string) => {
      nextReport = structuredClone(report);
      nextReport.sections.find((section) => section.key === sectionKey)!.entries.push({
        id: "continued-entry", type: "plain", text: value, rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
      });
    });
    const view = render(<ReportPage report={report} layout={layout} interactive onLineCommit={onLineCommit} />);

    fireEvent.click(screen.getByRole("button", { name: "Type in Human Remains DELIVER" }));
    const input = screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" });
    fireEvent.change(input, { target: { value: "Second entry" } });
    fireEvent.keyDown(input, { key });
    view.rerender(<ReportPage report={nextReport} layout={layout} interactive onLineCommit={onLineCommit} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" })).toHaveValue("");
  });

  it("prints three trailing free rows in the specified HR cards and one for Airport Drops", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-fdp")!.entries.push({
      id: "entry-one", type: "plain", text: "Existing entry", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container } = render(<ReportPage report={report} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} />);

    expect(container.querySelector('[data-section-key="human-deliver"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-fdp"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-pending"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-ship-outs"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-airport"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(1);
  });

  it("styles existing entry details semantically without duplicating report data", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "rush-entry",
      type: "funeral",
      funeralHome: "McGuire",
      deceased: [{ id: "person-one", name: "Priority Family", locationCode: "13A", specialRequest: "Rush delivery" }],
      rush: true,
      keepSeparate: false, pinnedBottom: false,
      createdAt: "2026-07-25T12:00:00.000Z",
    });

    const { container } = render(<ReportPage report={report} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} />);

    expect(screen.getByText("McGuire")).toHaveClass("entry-primary");
    expect(screen.getByText("Priority Family")).toHaveClass("deceased-name");
    expect(screen.getAllByText("13A")).toHaveLength(1);
    expect(screen.getByText("13A")).toHaveClass("location-code");
    expect(screen.getAllByText("RUSH DELIVERY")).toHaveLength(1);
    expect(screen.getByText("RUSH DELIVERY")).toHaveClass("rush-request");
    expect(container.querySelector('[data-section-key="human-deliver"] .report-row')).toHaveClass("rush-row");
  });

  it("expands an auto-width card immediately as a longer line is typed", () => {
    render(<ReportPage report={createEmptyReport("2026-07-26")} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} interactive onLineCommit={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Type in Human Remains DELIVER" })[0]);
    const input = screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" });
    const initialWidth = Number.parseFloat(input.style.width);
    fireEvent.change(input, { target: { value: "Metropolitan Memorial Services \u2013 Alexandria Longsurname" } });
    expect(Number.parseFloat(input.style.width)).toBeGreaterThan(initialWidth);
  });

  it("reports a dragged entry and its destination card", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-pending")!.entries.push({
      id: "move-me", type: "plain", text: "Move this case", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const onEntryMove = vi.fn();
    const { container } = render(<ReportPage report={report} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);
    const values = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) ?? "", effectAllowed: "move", dropEffect: "move" };

    fireEvent.dragStart(screen.getByRole("button", { name: /Edit Human Remains HR DEL/ }), { dataTransfer });
    fireEvent.drop(container.querySelector('[data-section-key="human-deliver"]')!, { dataTransfer });

    expect(onEntryMove).toHaveBeenCalledWith("human-pending", "human-deliver", "move-me");
  });
});

describe("drag to reorder", () => {
  const LAYOUT = { sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 };

  function reportWithDeliverEntries(names: string[] = ["Alpha", "Beta"]) {
    const report = createEmptyReport("2026-07-26");
    const deliver = report.sections.find((section) => section.key === "human-deliver")!;
    for (const name of names) {
      deliver.entries.push({
        id: `entry-${name}`,
        type: "funeralHomeOnly",
        funeralHome: name,
        rush: false,
        keepSeparate: true,
        pinnedBottom: false,
        createdAt: "2026-07-25T12:00:00.000Z",
      });
    }
    return report;
  }

  /** jsdom has no real DnD, so the payload is carried by a stub dataTransfer. */
  function dataTransfer(payload: object) {
    return { getData: () => JSON.stringify(payload), setData: vi.fn(), dropEffect: "", effectAllowed: "" };
  }

  function stubHeight(element: Element, height = 20, top = 0) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
  }

  /**
   * jsdom does not implement DragEvent, and Testing Library's fallback event drops clientY, so the
   * half-height rule cannot be exercised through fireEvent.drop. A MouseEvent does carry clientY,
   * so the drop is dispatched as one with dataTransfer attached.
   */
  function dropAt(element: Element, payload: object, clientY: number) {
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer(payload) });
    fireEvent(element, event);
  }

  it("drops an entry above the row it was released on", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[1]);
    // Released on the top half of "Beta", so the dragged entry lands above it.
    dropAt(rows[1], { sectionKey: "human-deliver", entryId: "entry-Alpha" }, 4);

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", "entry-Beta");
  });

  it("targets the following row when released on the bottom half", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries(["Alpha", "Beta", "Gamma"])} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[0]);
    dropAt(rows[0], { sectionKey: "human-deliver", entryId: "entry-Gamma" }, 16);

    // Below the midpoint of "Alpha" means "after Alpha", which is above the next row, "Beta".
    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Gamma", "entry-Beta");
  });

  it("pins when released on the bottom half of the last row, matching the drag-to-bottom rule", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[1]);
    dropAt(rows[1], { sectionKey: "human-deliver", entryId: "entry-Alpha" }, 16);

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", null);
  });

  it("requests a pin when an entry is dropped on the blank row past the end", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const blank = screen.getByRole("button", { name: "Type in Human Remains DELIVER" });
    fireEvent.drop(blank, { dataTransfer: dataTransfer({ sectionKey: "human-deliver", entryId: "entry-Alpha" }) });

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", null);
  });

  it("leaves position unspecified for a drop on the card body so nothing is pinned by accident", () => {
    const onEntryMove = vi.fn();
    const { container } = render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const card = container.querySelector('[data-section-key="human-fdp"]')!;
    fireEvent.drop(card, { dataTransfer: dataTransfer({ sectionKey: "human-deliver", entryId: "entry-Alpha" }) });

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-fdp", "entry-Alpha");
  });

  it("ignores a drop of the entry onto itself", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[0]);
    dropAt(rows[0], { sectionKey: "human-deliver", entryId: "entry-Alpha" }, 4);

    expect(onEntryMove).not.toHaveBeenCalled();
  });

  it("marks a pinned entry so it is distinguishable in the printed report", () => {
    const report = reportWithDeliverEntries();
    report.sections.find((section) => section.key === "human-deliver")!.entries[1].pinnedBottom = true;
    const { container } = render(<ReportPage report={report} layout={LAYOUT} />);

    const rows = container.querySelectorAll('[data-section-key="human-deliver"] .report-row');
    expect(rows[0]).not.toHaveClass("pinned-row");
    expect(rows[1]).toHaveClass("pinned-row");
  });
});
