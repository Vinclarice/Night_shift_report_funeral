import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const mainOutput = resolve(projectRoot, "out", "main");

await mkdir(mainOutput, { recursive: true });
await copyFile(
  resolve(projectRoot, "src", "generated", "prisma-client", "query_engine-windows.dll.node"),
  resolve(mainOutput, "query_engine-windows.dll.node"),
);
