import { z } from "zod";

import type { FirstCallLookupCandidate } from "@/domain/firstCall";

const tomTomResultSchema = z.object({
  id: z.string(),
  poi: z.object({ name: z.string(), phone: z.string().optional() }).optional(),
  address: z.object({
    streetNumber: z.string().optional(),
    streetName: z.string().optional(),
    municipality: z.string().optional(),
    localName: z.string().optional(),
    countrySubdivision: z.string().optional(),
    postalCode: z.string().optional(),
    freeformAddress: z.string().optional(),
  }),
});

const tomTomResponseSchema = z.object({ results: z.array(tomTomResultSchema) });

type TomTomAddress = z.infer<typeof tomTomResultSchema>["address"];

export function formatTomTomAddress(address: TomTomAddress): string {
  const street = [address.streetNumber, address.streetName].filter(Boolean).join(" ");
  const city = address.municipality ?? address.localName ?? "";
  const region = [address.countrySubdivision, address.postalCode].filter(Boolean).join(" ");
  const formatted = [street, city, region].filter(Boolean).join(", ");
  return formatted || address.freeformAddress || "";
}

export function parseTomTomResults(payload: unknown): FirstCallLookupCandidate[] {
  const parsed = tomTomResponseSchema.parse(payload);
  return parsed.results.filter((item) => item.poi?.name).map((item) => ({
    sourceId: item.id,
    name: item.poi!.name,
    address: formatTomTomAddress(item.address),
    phone: item.poi!.phone ?? "",
    fax: "",
    email: "",
    attribution: "TomTom",
  }));
}

export async function searchTomTom(
  query: string,
  apiKey: string,
  endpoint: string,
  signal: AbortSignal,
): Promise<FirstCallLookupCandidate[]> {
  const base = endpoint.replace(/\/$/, "");
  const url = new URL(`${base}/${encodeURIComponent(query)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrySet", "US");
  url.searchParams.set("language", "en-US");
  // A DC anchor biases results toward the DMV without excluding broader US matches.
  url.searchParams.set("lat", "38.9072");
  url.searchParams.set("lon", "-77.0369");

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Online lookup failed (${response.status}).`);
  return parseTomTomResults(await response.json());
}
