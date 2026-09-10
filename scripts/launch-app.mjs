/**
 * Starts the built app against a throwaway data folder and connects Playwright to its page.
 *
 * Shared by the desktop tests and the print gate: both need the real application rather than the
 * interface on its own, and neither may touch the real report database. WebView2 exposes the page
 * over the Chrome DevTools protocol when asked to through its environment, which is all Playwright
 * needs to drive it.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

export const projectRoot = resolve(import.meta.dirname, "..");
export const builtExecutable = process.env.NIGHT_SHIFT_REPORT_EXECUTABLE ?? join(projectRoot, "out", "Night Shift Report.exe");

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolvePort(port));
  });
});

export async function launchApp({ prefix = "night-shift-app-" } = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), prefix));
  const port = await freePort();
  const child = spawn(builtExecutable, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory,
      NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));

  const removeData = async () => {
    // WebView2's helper processes let go of the folder a moment after the app itself has exited.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await rm(dataDirectory, { recursive: true, force: true });
        return;
      } catch {
        await sleep(250);
      }
    }
  };

  let browser;
  for (let attempt = 0; attempt < 120 && !browser && child.exitCode === null; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await sleep(250);
    }
  }
  if (!browser) {
    child.kill();
    await removeData();
    throw new Error(`Could not connect to ${builtExecutable}. Run pnpm build first.`);
  }

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  await page.waitForLoadState("domcontentloaded");

  const close = async () => {
    await browser.close().catch(() => undefined);
    if (child.exitCode === null) child.kill();
    await exited;
    await removeData();
  };
  return { page, dataDirectory, close };
}
