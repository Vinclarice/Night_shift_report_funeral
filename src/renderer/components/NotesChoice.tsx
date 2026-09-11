import type { NightReport } from "@/domain/types";
import { useReportController } from "../state/ReportController";

type NotesLineCount = 0 | 1 | 2 | 3;

const CHOICES: ReadonlyArray<{ lines: NotesLineCount; label: string }> = [
  { lines: 0, label: "Off" },
  { lines: 1, label: "1" },
  { lines: 2, label: "2" },
  { lines: 3, label: "3" },
];

/**
 * The Sections menu's notes row: how many ruled lines the foot of the sheet carries, or none. It sits
 * with the optional cards because it is the same kind of decision — what tonight's sheet carries. The
 * choice is layout, so it carries on to the next night the way a card width does; the writing belongs
 * to the night, and is kept whatever is chosen here.
 */
export function NotesChoice({ report }: { report: NightReport }) {
  const controller = useReportController();
  const layout = controller.layout;
  if (!layout) return null;
  const current = layout.notesLines ?? 3;
  const written = report.notes.split("\n").some((line) => line.trim());
  const summary = current === 0
    ? written ? "Put away · note kept" : "Put away"
    : `${current} ${current === 1 ? "line" : "lines"} on the sheet`;

  return (
    <div className="notes-choice" role="group" aria-label="Notes lines">
      <span><strong>NOTES</strong><small>{summary}</small></span>
      <div className="notes-choice-options">
        {CHOICES.map(({ lines, label }) => (
          <button
            key={lines}
            type="button"
            role="menuitemradio"
            aria-checked={current === lines}
            aria-label={lines === 0 ? "Notes off" : `${lines} notes ${lines === 1 ? "line" : "lines"}`}
            title={lines === 0 ? "Take the notes off the sheet. Anything written is kept." : `Give the notes ${lines} ${lines === 1 ? "line" : "lines"}.`}
            onClick={() => void controller.saveLayout({ ...layout, notesLines: lines })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
