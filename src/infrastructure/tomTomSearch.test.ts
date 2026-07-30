import { describe, expect, it } from "vitest";

import { formatTomTomAddress, formatTomTomPhone, parseTomTomResults } from "./tomTomSearch";

describe("TomTom First Call lookup", () => {
  it("formats only the simple US address fields requested by the form", () => {
    expect(formatTomTomAddress({
      streetNumber: "3300",
      streetName: "Gallows Road",
      municipality: "Falls Church",
      countrySubdivision: "VA",
      postalCode: "22042",
      freeformAddress: "unused fallback",
    })).toBe("3300 Gallows Road, Falls Church, VA 22042");
  });

  it("keeps the place name, simple address, and optional main phone only", () => {
    expect(parseTomTomResults({ results: [{
      id: "place-1",
      poi: { name: "Example Hospital", phone: "+1 703-555-0100" },
      address: { streetNumber: "1", streetName: "Health Way", municipality: "Fairfax", countrySubdivision: "VA", postalCode: "22030" },
    }] })).toEqual([{
      sourceId: "place-1",
      name: "Example Hospital",
      address: "1 Health Way, Fairfax, VA 22030",
      phone: "703-555-0100",
      fax: "",
      email: "",
      attribution: "TomTom",
    }]);
  });

  it("removes TomTom's US country prefix without reformatting the local number", () => {
    expect(formatTomTomPhone("+1 202-555-0100")).toBe("202-555-0100");
    expect(formatTomTomPhone("+1 (202) 555-0100")).toBe("(202) 555-0100");
    expect(formatTomTomPhone("202-555-0100")).toBe("202-555-0100");
  });

  it("rejects malformed provider responses", () => {
    expect(() => parseTomTomResults({ results: [{ id: 3 }] })).toThrow();
  });

  it("accepts address-only candidates only for an explicit Residence lookup", () => {
    const payload = { results: [{ id: "address-1", address: { streetNumber: "10", streetName: "Oak Street", municipality: "Washington", countrySubdivision: "DC", postalCode: "20001" } }] };
    expect(parseTomTomResults(payload)).toEqual([]);
    expect(parseTomTomResults(payload, true)).toEqual([expect.objectContaining({
      name: "10 Oak Street, Washington, DC 20001",
      address: "10 Oak Street, Washington, DC 20001",
      phone: "",
    })]);
  });
});
