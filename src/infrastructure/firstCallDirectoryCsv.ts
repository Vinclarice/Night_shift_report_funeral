import type { FirstCallDirectories, FirstCallDirectoryKind } from "@/domain/firstCall";
import { normalizeFirstCallDirectoryName } from "@/domain/firstCall";
import type { FirstCallFacilityInput, FirstCallFuneralHomeInput } from "@/shared/contracts";

export type FirstCallDirectoryCsvRow = ({ kind: "funeralHome" } & FirstCallFuneralHomeInput) | ({ kind: "facility" } & FirstCallFacilityInput);

const HEADERS = ["kind", "name", "address", "phone", "fax", "email", "aliases", "favorite"] as const;

function quote(value: string | number | boolean) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatFirstCallDirectoryCsv(directories: FirstCallDirectories) {
  const rows = [
    ...directories.funeralHomes.map((item) => ["funeralHome", item.name, item.address, item.phone, item.fax, item.email, item.aliases.join(" | "), item.favorite]),
    ...directories.facilities.map((item) => ["facility", item.name, item.address, item.phone, "", "", item.aliases.join(" | "), item.favorite]),
  ];
  return [HEADERS.join(","), ...rows.map((row) => row.map(quote).join(","))].join("\r\n");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  if (quoted) throw new Error("The directory CSV contains an unfinished quoted value.");
  return rows;
}

function parseFavorite(value: string) {
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

export function parseFirstCallDirectoryCsv(text: string): FirstCallDirectoryCsvRow[] {
  const rows = parseCsv(text.trim());
  if (!rows.length || HEADERS.some((header, index) => rows[0][index]?.trim() !== header)) throw new Error(`The directory CSV must begin with: ${HEADERS.join(",")}`);
  return rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row, index) => {
    const [kind, rawName, address = "", phone = "", fax = "", email = "", aliases = "", favorite = ""] = row;
    const name = rawName?.trim().replace(/\s+/g, " ") ?? "";
    if (kind !== "funeralHome" && kind !== "facility") throw new Error(`Row ${index + 2} has an invalid directory kind.`);
    if (!name) throw new Error(`Row ${index + 2} is missing a name.`);
    if (kind === "facility" && normalizeFirstCallDirectoryName(name) === "residence") throw new Error("Residence information cannot be imported into the directory.");
    const common = { name, address: address.trim(), phone: phone.trim(), aliases: aliases.split("|").map((alias) => alias.trim()).filter(Boolean), favorite: parseFavorite(favorite) };
    return kind === "funeralHome" ? { kind, ...common, fax: fax.trim(), email: email.trim() } : { kind, ...common };
  });
}

export function directoryKindLabel(kind: FirstCallDirectoryKind) {
  return kind === "funeralHome" ? "Funeral home" : "Facility";
}
