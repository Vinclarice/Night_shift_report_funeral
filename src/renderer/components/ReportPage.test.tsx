import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { createEmptyReport } from "@/domain/report";
import { ReportPage } from "./ReportPage";

describe("print report", () => {
  it("renders all independent section cards", () => {
    render(
      <ReportPage
        report={createEmptyReport("2026-07-26")}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
      />,
    );
    expect(screen.getByText("NIGHT SHIFT REPORT")).toBeInTheDocument();
    expect(screen.getByText("JULY 26, 2026")).toBeInTheDocument();
    expect(screen.getAllByTestId("section-card")).toHaveLength(9);
  });

  it("prints the manual date override in place of the report's own date", () => {
    render(
      <ReportPage
        report={createEmptyReport("2026-07-26")}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
        dateOverride="2026-07-24"
      />,
    );
    expect(screen.getByText("JULY 24, 2026")).toBeInTheDocument();
    expect(screen.queryByText("JULY 26, 2026")).not.toBeInTheDocument();
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
    const input = screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" });
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
    const input = screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" });
    fireEvent.change(input, { target: { value: "Second entry" } });
    fireEvent.keyDown(input, { key });
    view.rerender(<ReportPage report={nextReport} layout={layout} interactive onLineCommit={onLineCommit} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" })).toHaveFocus());
    expect(screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" })).toHaveValue("");
  });

  it("prints the configured number of trailing free rows per section", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-fdp")!.entries.push({
      id: "entry-one", type: "plain", text: "Existing entry", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container } = render(<ReportPage report={report} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} />);

    expect(container.querySelector('[data-section-key="human-deliver"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-fdp"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-pending"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(2);
    expect(container.querySelector('[data-section-key="human-ship-outs"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(1);
    expect(container.querySelector('[data-section-key="human-airport"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(1);
  });

  // Compaction shrinks type and spacing, never the writing rows. A row vanishing is the one
  // compaction a person watching the page actually sees, and it takes away somewhere they were
  // about to write — so the counts have to survive all four steps, entries or no entries.
  it.each([1, 2, 3, 4] as const)("keeps every writing row at compaction step %i", (compactLevel) => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-fdp")!.entries.push({
      id: "entry-one", type: "plain", text: "Existing entry", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container } = render(
      <ReportPage
        report={report}
        layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }}
        compactLevel={compactLevel}
      />,
    );

    // human-fdp carries an entry and human-deliver does not, so this covers both branches the
    // old level-3 rule distinguished between. Step four is the backstop and shrinks type furthest;
    // it must still not take a row away.
    expect(container.querySelector('[data-section-key="human-deliver"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-fdp"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-pending"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(2);
    expect(container.querySelector('[data-section-key="human-ship-outs"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(1);
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
    const input = screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" });
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

    expect(onEntryMove).toHaveBeenCalledWith("human-pending", "human-deliver", "move-me", undefined, undefined);
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

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", "entry-Beta", undefined);
  });

  it("targets the following row when released on the bottom half", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries(["Alpha", "Beta", "Gamma"])} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[0]);
    dropAt(rows[0], { sectionKey: "human-deliver", entryId: "entry-Gamma" }, 16);

    // Below the midpoint of "Alpha" means "after Alpha", which is above the next row, "Beta".
    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Gamma", "entry-Beta", undefined);
  });

  it("pins when released on the bottom half of the last row, matching the drag-to-bottom rule", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const rows = screen.getAllByRole("button", { name: "Edit Human Remains DELIVER" });
    stubHeight(rows[1]);
    dropAt(rows[1], { sectionKey: "human-deliver", entryId: "entry-Alpha" }, 16);

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", null, undefined);
  });

  it("requests a pin when an entry is dropped on the blank row past the end", () => {
    const onEntryMove = vi.fn();
    render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const blank = screen.getByRole("button", { name: "Type in Human Remains DELIVER" });
    fireEvent.drop(blank, { dataTransfer: dataTransfer({ sectionKey: "human-deliver", entryId: "entry-Alpha" }) });

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-deliver", "entry-Alpha", null, undefined);
  });

  it("leaves position unspecified for a drop on the card body so nothing is pinned by accident", () => {
    const onEntryMove = vi.fn();
    const { container } = render(<ReportPage report={reportWithDeliverEntries()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const card = container.querySelector('[data-section-key="human-fdp"]')!;
    fireEvent.drop(card, { dataTransfer: dataTransfer({ sectionKey: "human-deliver", entryId: "entry-Alpha" }) });

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-fdp", "entry-Alpha", undefined, undefined);
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

  function twoPersonReport() {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "merged", type: "funeral", funeralHome: "McGuire",
      deceased: [
        { id: "smith", name: "Smith", locationCode: "13A", specialRequest: "" },
        { id: "jones", name: "Jones", locationCode: "17B", specialRequest: "" },
      ],
      rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    return report;
  }

  it("makes a deceased name its own drag source, carrying just their person id, when the entry has more than one", () => {
    const onEntryMove = vi.fn();
    const { container } = render(<ReportPage report={twoPersonReport()} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={onEntryMove} />);

    const values = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) ?? "", effectAllowed: "move", dropEffect: "move" };
    const jones = screen.getByText("Jones").closest(".deceased-person")!;
    expect(jones).toHaveAttribute("draggable", "true");

    fireEvent.dragStart(jones, { dataTransfer });
    fireEvent.drop(container.querySelector('[data-section-key="human-fdp"]')!, { dataTransfer });

    expect(onEntryMove).toHaveBeenCalledWith("human-deliver", "human-fdp", "merged", undefined, "jones");
  });

  it("does not make a lone deceased's name separately draggable, since it's the same as dragging the row", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "solo", type: "funeral", funeralHome: "McGuire",
      deceased: [{ id: "smith", name: "Smith", locationCode: "13A", specialRequest: "" }],
      rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container } = render(<ReportPage report={report} layout={LAYOUT} interactive onLineCommit={vi.fn()} onEntryMove={vi.fn()} />);

    const smith = container.querySelector(".deceased-person")!;
    expect(smith).not.toHaveClass("draggable-person");
    expect(smith).toHaveAttribute("draggable", "false");
  });
  it("keeps a leading blank line so a note can start on the second rule", () => {
    // The notes block is two ruled lines. Starting on the second one means a leading newline, and
    // trimming both ends used to pull the text back onto the first rule the moment it committed.
    const onNotesCommit = vi.fn();
    render(<ReportPage report={createEmptyReport("2026-07-26")} layout={LAYOUT} interactive onNotesCommit={onNotesCommit} />);

    fireEvent.click(screen.getByRole("button", { name: "Click a line to type on it" }));
    const area = screen.getByRole("textbox", { name: "Report notes" });
    fireEvent.change(area, { target: { value: "\nMeant for line two" } });
    fireEvent.blur(area);

    expect(onNotesCommit).toHaveBeenCalledWith("\nMeant for line two");
  });

  it("still drops trailing whitespace from a note", () => {
    const onNotesCommit = vi.fn();
    render(<ReportPage report={createEmptyReport("2026-07-26")} layout={LAYOUT} interactive onNotesCommit={onNotesCommit} />);

    fireEvent.click(screen.getByRole("button", { name: "Click a line to type on it" }));
    const area = screen.getByRole("textbox", { name: "Report notes" });
    fireEvent.change(area, { target: { value: "A note  \n\n  " } });
    fireEvent.blur(area);

    expect(onNotesCommit).toHaveBeenCalledWith("A note");
  });
  it("resizes the card when its grip is dragged", () => {
    // The grip sits outside the card, as a sibling inside the shell, so it can hang past the edge
    // without the card's overflow clip eating half of it. That also means it cannot find the card
    // by walking up from itself — when it tried, dragging silently did nothing at all.
    const onWidthChange = vi.fn();
    const onWidthCommit = vi.fn();
    const { container } = render(<ReportPage report={createEmptyReport("2026-07-26")} layout={LAYOUT} interactive onLineCommit={vi.fn()} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} />);

    // Both columns have a DELIVER, so the grip is reached through its own card's shell.
    const grip = container.querySelector('[data-section-key="human-deliver"]')!
      .closest(".section-card-shell")!.querySelector(".width-handle")!;
    fireEvent.pointerDown(grip, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 96 });
    fireEvent.pointerUp(window);

    expect(onWidthChange).toHaveBeenCalledWith("human-deliver", expect.any(Number));
    expect(onWidthCommit).toHaveBeenCalledWith("human-deliver", expect.any(Number));
  });
  it("leaves road trips off the sheet until the night has one", () => {
    const report = createEmptyReport("2026-07-26");
    const { container, rerender } = render(<ReportPage report={report} layout={LAYOUT} />);
    expect(container.querySelector('[data-section-key="human-road-trips"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="section-card"]')).toHaveLength(9);

    rerender(<ReportPage report={{ ...report, roadTripsVisible: true }} layout={LAYOUT} />);
    const card = container.querySelector('[data-section-key="human-road-trips"]');
    expect(card).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="section-card"]')).toHaveLength(10);
    // Between AIRPORT DROPS and FDP, which is the whole point of where it goes.
    const humanKeys = [...container.querySelectorAll('.human-column [data-section-key]')].map((el) => el.getAttribute("data-section-key"));
    expect(humanKeys).toEqual(["human-deliver", "human-airport", "human-road-trips", "human-fdp", "human-pending", "human-ship-outs"]);
    expect(card!.querySelectorAll('[data-testid="free-row"]')).toHaveLength(2);
  });

  it("keeps road trip entries when the card is put away", () => {
    // Hiding is a view change, not a delete: the entries have to be there when it comes back.
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-road-trips")!.entries.push({
      id: "trip", type: "plain", text: "Ron to Richmond", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container, rerender } = render(<ReportPage report={{ ...report, roadTripsVisible: true }} layout={LAYOUT} />);
    expect(screen.getByText("Ron to Richmond")).toBeInTheDocument();

    rerender(<ReportPage report={{ ...report, roadTripsVisible: false }} layout={LAYOUT} />);
    expect(screen.queryByText("Ron to Richmond")).not.toBeInTheDocument();
    expect(container.querySelector('[data-section-key="human-road-trips"]')).toBeNull();

    rerender(<ReportPage report={{ ...report, roadTripsVisible: true }} layout={LAYOUT} />);
    expect(screen.getByText("Ron to Richmond")).toBeInTheDocument();
  });
  it("offers the funeral home list to a row typed on the canvas", () => {
    // The same names the inspector offers. Studio renders the list itself, so this only asserts the
    // wiring; the row is a combobox rather than a plain textbox precisely because of it.
    render(<ReportPage report={createEmptyReport("2026-07-26")} layout={LAYOUT} interactive onLineCommit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Type in Human Remains DELIVER" }));
    expect(screen.getByRole("combobox", { name: "Edit Human Remains DELIVER" }))
      .toHaveAttribute("list", "funeral-home-options");
  });
  it("does not offer the funeral home list on a row that already has an entry", () => {
    // Reopening a finished row to fix a name or add a deceased is not the moment for a list of
    // funeral homes: the home is already chosen, and the suggestions sit over the line being read.
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "existing", type: "plain", text: "Greene - Johnson", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    render(<ReportPage report={report} layout={LAYOUT} interactive onLineCommit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Human Remains DELIVER" }));
    expect(screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" })).not.toHaveAttribute("list");
  });
});
