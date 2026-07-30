import { describe, expect, it } from "vitest";

import {
  deriveCremationDisplayName,
  createCremationBatchRow,
  formatCremationNumber,
  nextCremationNumber,
  parseCremationNumber,
  isCremationRowBlank,
} from "./cremation";

describe("cremation numbering", () => {
  it("increments the final segment through 38", () => {
    expect(nextCremationNumber("6-063-37")).toBe("6-063-38");
  });

  it("rolls the middle segment and then the major segment", () => {
    expect(nextCremationNumber("6-063-38")).toBe("6-064-01");
    expect(nextCremationNumber("6-999-38")).toBe("7-001-01");
  });

  it("rejects malformed and out-of-range numbers", () => {
    expect(parseCremationNumber("6-000-01")).toBeNull();
    expect(parseCremationNumber("6-063-39")).toBeNull();
    expect(parseCremationNumber("6-63-01")).toBeNull();
    expect(formatCremationNumber({ major: 8, middle: 2, minor: 3 })).toBe("8-002-03");
  });
});

describe("cremation label names", () => {
  it("keeps only first and last names", () => {
    expect(deriveCremationDisplayName("Caroll Milton Bush")).toBe("Caroll Bush");
    expect(deriveCremationDisplayName("Bush, Caroll Milton")).toBe("Caroll Bush");
  });

  it("drops common suffixes and preserves a hyphenated last name", () => {
    expect(deriveCremationDisplayName("John Allen Smith Jr.")).toBe("John Smith");
    expect(deriveCremationDisplayName("Smith Jr., John Allen")).toBe("John Smith");
    expect(deriveCremationDisplayName("Mary Anne Rivera-Lopez")).toBe("Mary Rivera-Lopez");
  });

  it("treats a successor-only trailing row as unused", () => {
    expect(isCremationRowBlank(createCremationBatchRow("6-064-01"))).toBe(true);
  });
});
