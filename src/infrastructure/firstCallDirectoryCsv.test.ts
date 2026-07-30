import { describe, expect, it } from "vitest";

import { formatFirstCallDirectoryCsv, parseFirstCallDirectoryCsv } from "./firstCallDirectoryCsv";

describe("First Call directory CSV", () => {
  it("round-trips reusable records, aliases, favorites, and quoted commas", () => {
    const csv = formatFirstCallDirectoryCsv({
      funeralHomes: [{ id: "1", name: "Example, Funeral", address: "1 Main St", phone: "202-555-0100", fax: "", email: "office@example.test", aliases: ["Example FH"], favorite: true, useCount: 3, lastUsedAt: null }],
      facilities: [{ id: "2", name: "Example Hospital", address: "2 Health Way", phone: "202-555-0200", aliases: [], favorite: false, useCount: 0, lastUsedAt: null }],
    });
    expect(parseFirstCallDirectoryCsv(csv)).toEqual([
      expect.objectContaining({ kind: "funeralHome", name: "Example, Funeral", aliases: ["Example FH"], favorite: true }),
      expect.objectContaining({ kind: "facility", name: "Example Hospital", favorite: false }),
    ]);
  });

  it("rejects Residence imports", () => {
    expect(() => parseFirstCallDirectoryCsv("kind,name,address,phone,fax,email,aliases,favorite\nfacility,Residence,Private address,,,,,false"))
      .toThrow(/cannot be imported/i);
  });
});
