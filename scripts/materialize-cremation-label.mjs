import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const source = fileURLToPath(new URL("../resources/cremation/cremation-label.lbx.base64", import.meta.url));
const target = fileURLToPath(new URL("../resources/cremation/cremation-label.lbx", import.meta.url));
const encoded = (await readFile(source, "utf8")).trim();

await writeFile(target, Buffer.from(encoded, "base64"));
process.stdout.write("Materialized bundled Brother P-touch template.\n");
