import { fireEvent, render, screen } from "@testing-library/react";
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
        compactLevel={2}
      />,
    );

    expect(container.querySelector(".report-page")).toHaveClass("compact-2");
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

  it("prints three trailing free rows in the specified HR cards and one for Airport Drops", () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-fdp")!.entries.push({
      id: "entry-one", type: "plain", text: "Existing entry", rush: false, keepSeparate: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const { container } = render(<ReportPage report={report} layout={{ sectionWidths: {}, marginInches: 0.35, scale: 1, offsetXInches: 0, offsetYInches: 0 }} />);

    expect(container.querySelector('[data-section-key="human-deliver"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-fdp"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-pending"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-ship-outs"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(3);
    expect(container.querySelector('[data-section-key="human-airport"]')?.querySelectorAll('[data-testid="free-row"]')).toHaveLength(1);
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
      id: "move-me", type: "plain", text: "Move this case", rush: false, keepSeparate: false, createdAt: "2026-07-25T12:00:00.000Z",
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
