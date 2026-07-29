import { describe, expect, it } from "vitest";

import { createFirstCallDraft, deriveDeceasedLastName, hasFirstCallContent } from "./firstCall";

describe("First Call defaults and surname derivation", () => {
  it("defaults the date and taken-by value without treating them as user content", () => {
    const draft = createFirstCallDraft(new Date(2026, 6, 28, 23, 30));
    expect(draft.values.dateOfCall).toBe("July 28, 2026");
    expect(draft.values.takenBy).toBe("Vincent");
    expect(draft.values.timeOfCall).toBe("");
    expect(draft.highlights).toEqual([]);
    expect(hasFirstCallContent(draft)).toBe(false);
  });

  it("treats a manual highlight as temporary sheet content", () => {
    const draft = createFirstCallDraft();
    draft.highlights.push({ id: "highlight-1", x: 10, y: 10, width: 20, height: 10, color: "yellow" });
    expect(hasFirstCallContent(draft)).toBe(true);
  });

  it.each([
    ["Mary Smith", "SMITH"],
    ["Smith, Mary A.", "SMITH"],
    ["Anne Van Buren Jr.", "BUREN"],
    ["Jordan Smith-Jones III", "SMITH-JONES"],
  ])("derives %s as %s", (name, expected) => {
    expect(deriveDeceasedLastName(name)).toBe(expected);
  });
});
