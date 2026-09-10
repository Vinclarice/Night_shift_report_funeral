/**
 * Copies the exe `tauri build` produced out of Cargo's target folder, which sits outside this
 * repository (see src-tauri/.cargo/config.toml), to where it is run from.
 *
 *   node scripts/stage-build.mjs            → out/Night Shift Report.exe
 *   node scripts/stage-build.mjs --release  → release/Night Shift Report Portable <version>.exe
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
// Run from src-tauri: Cargo reads .cargo/config.toml relative to where it is run, not to the
// manifest, so from the project root it would report the default target folder instead.
const metadata = JSON.parse(execFileSync(
  "cargo",
  ["metadata", "--format-version", "1", "--no-deps"],
  { encoding: "utf8", cwd: join(projectRoot, "src-tauri") },
));
const built = join(metadata.target_directory, "release", "Night Shift Report.exe");
const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));

const release = process.argv.includes("--release");
const directory = join(projectRoot, release ? "release" : "out");
const target = join(directory, release ? `Night Shift Report Portable ${version}.exe` : "Night Shift Report.exe");

await mkdir(directory, { recursive: true });
try {
  await copyFile(built, target);
} catch (error) {
  if (error.code === "EBUSY" || error.code === "EPERM") {
    throw new Error(`${target} is in use. Close Night Shift Report and run the build again.`, { cause: error });
  }
  throw error;
}
console.log(`Staged ${target}`);
