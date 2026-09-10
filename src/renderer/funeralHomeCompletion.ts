import { completeFuneralHome, normalizeFuneralHome } from "@/domain/entries";
import type { ReportSection } from "@/domain/types";

/** The names offered by the suggestion list an input is wired to, in the order it offers them. */
export function suggestedNames(input: HTMLInputElement): string[] {
  const listId = input.getAttribute("list");
  const list = listId ? input.ownerDocument.getElementById(listId) : null;
  return list ? [...list.querySelectorAll("option")].map((option) => option.value) : [];
}

/**
 * What Tab turns a canvas row into while its funeral home is still being typed, or null to leave
 * Tab committing the row as it always has.
 *
 * Only while nothing follows the home yet — no dash, no //, no count. A Human Remains row goes on to
 * the deceased, so the separator comes with the name and the cursor lands ready for it. A Cremated
 * row is usually the home alone, so it gets just the name, and a second Tab commits it; one already
 * typed out in full commits on the first, since the case is corrected on commit anyway.
 */
export function completeRowFuneralHome(draft: string, names: readonly string[], category: ReportSection["category"]): string | null {
  if (/\s[–—-]\s|\/\/|\sx\s*\d/i.test(draft)) return null;
  const match = completeFuneralHome(draft, names);
  if (!match) return null;
  if (category === "human") return `${match} – `;
  return normalizeFuneralHome(match) === normalizeFuneralHome(draft) ? null : match;
}
