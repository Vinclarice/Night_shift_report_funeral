import { describe, expect, it } from "vitest";

import { formatTomTomAddress, parseTomTomResults } from "./tomTomSearch";

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
      phone: "+1 703-555-0100",
      fax: "",
      email: "",
      attribution: "TomTom",
    }]);
  });

  it("rejects malformed provider responses", () => {
    expect(() => parseTomTomResults({ results: [{ id: 3 }] })).toThrow();
  });
});
