import { formatEntryLine } from "@/domain/entries";
import type { ReportEntry } from "@/domain/types";

/**
 * Shared by the sidebar's current-entries list and the paste-review modal. Deliberately terser
 * than formatEntryLine's print-ready text for the funeral case only: both callers already show
 * each deceased person's location code and special request in a per-person breakdown right next
 * to this line, so repeating that detail here would just be noise. Every other entry type has
 * nothing extra to omit, so it delegates to the single canonical formatter instead of
 * re-implementing the same formatting a second time.
 */
export function entrySummary(entry: ReportEntry): string {
  if (entry.type === "funeral") return `${entry.funeralHome} – ${entry.deceased.map((person) => person.name).join(" + ")}`;
  return formatEntryLine(entry);
}
