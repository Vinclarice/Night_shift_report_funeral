import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Drags one row onto another card by dispatching the drag events directly, sharing one DataTransfer
 * between them the way a real drag does.
 *
 * Playwright's dragTo drives HTML5 drag-and-drop with synthetic mouse movement, and Chromium starts
 * a native drag from those only sometimes — this assertion failed roughly one run in three while
 * the code under it was fine. What matters here is that the app's handlers move the entry, not that
 * the browser recognises a gesture, so the gesture is not the part worth simulating.
 */
async function dragRowOntoCard(page: Page, rowSelector: string, cardSelector: string) {
  await page.evaluate(({ rowSelector, cardSelector }) => {
    const row = document.querySelector(rowSelector);
    const card = document.querySelector(cardSelector);
    if (!row || !card) throw new Error(`drag needs both ${rowSelector} and ${cardSelector}`);
    const dataTransfer = new DataTransfer();
    row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    card.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    card.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    row.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
  }, { rowSelector, cardSelector });
}

test("launches portably and renders the exact nine-card page", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "night-shift-e2e-"));
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1400));
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/version-2-launch.png" });
    // The app opens directly into tonight's report — no welcome screen or click required.
    await expect(page.getByText("Live canvas")).toBeVisible();
    await page.screenshot({ path: "test-results/studio-empty.png" });
    const preview = page.locator(".report-page").first();
    await expect(preview.getByTestId("section-card")).toHaveCount(9);
    await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>("*")) element.scrollTop = 0; window.scrollTo(0, 0); });
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden"; window.scrollTo(0, 0); });
    await page.screenshot({ path: "test-results/empty-report-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
    await page.emulateMedia({ media: "screen" });

    const humanDeliverCard = page.locator('.page-stage [data-section-key="human-deliver"]');
    await humanDeliverCard.locator(".inline-row-button.blank-row").first().click();
    const inlineInput = page.getByRole("combobox", { name: "Edit Human Remains DELIVER" });
    await inlineInput.fill("Preview Home - Typed Family (9A)");
    await inlineInput.press("Enter");
    await expect(page.getByText("Typed Family").first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Edit Human Remains DELIVER" })).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Edit Human Remains DELIVER" })).toHaveValue("");
    await page.getByRole("combobox", { name: "Edit Human Remains DELIVER" }).press("Escape");
    await expect(page.locator(".save-state")).toHaveText("Saved");

    // Double-click: a single click on a row that has something on it selects it rather than
    // opening it, so that the row can be picked without an input landing over it.
    await page.getByRole("button", { name: "Edit Human Remains DELIVER" }).dblclick();
    // An existing row is a plain textbox: the suggestion list is offered on empty rows only.
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).fill("");
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).press("Enter");
    await expect(page.getByText("Typed Family")).toHaveCount(0);

    const pendingCard = page.locator('.page-stage [data-section-key="human-pending"]');
    await pendingCard.locator(".inline-row-button.blank-row").first().click();
    const pendingInput = page.getByRole("combobox", { name: /Edit Human Remains HR DEL/ });
    await pendingInput.fill("beltway crem - jane doe (13a)");
    await pendingInput.press("Enter");
    await expect(page.getByText("Jane Doe").first()).toBeVisible();
    await dragRowOntoCard(page, '.page-stage [data-section-key="human-pending"] .draggable-row', '.page-stage [data-section-key="human-deliver"]');
    await expect(humanDeliverCard).toContainText("Jane Doe");
    await expect(pendingCard).not.toContainText("Jane Doe");
    await humanDeliverCard.locator(".draggable-row").dblclick();
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).fill("");
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).press("Enter");

    await page.evaluate(async () => {
      const data = await window.nightShift.bootstrap();
      const report = data.report!;
      const base = () => ({ id: crypto.randomUUID(), rush: false, keepSeparate: false, pinnedBottom: false, createdAt: new Date().toISOString() });
      const funeral = (home: string, name: string, code = "", special = "", rush = false) => ({ ...base(), type: "funeral" as const, funeralHome: home, rush, deceased: [{ id: crypto.randomUUID(), name, locationCode: code, specialRequest: special }] });
      const section = (key: string) => report.sections.find((item) => item.key === key)!;
      section("human-deliver").entries.push(funeral("McGuire", "Priority Family", "13A", "Rush delivery", true));
      section("human-fdp").entries.push(
        funeral("Greene", "Johnson", "TRL"), funeral("MD Crem", "Rumer", "17B"),
        funeral("Crescent", "Wanzer", "13A"), funeral("McGuire", "Willoughby", "13A"),
        funeral("Inman", "Lassahn", "SSR"), funeral("Alfirdaus", "Fall", "PR"), funeral("Moloney", "Rivera", "SSR"),
      );
      section("human-pending").entries.push(funeral("Brown/PA", "Helwig", "", "Roadtrip – Ron OK"), funeral("Beltway Crem", "Hernandez", "", "FH will call"));
      section("human-ship-outs").entries.push(funeral("NMS", "Nicholas", ""), funeral("NMS", "Curry", "", "FDP or S/O?"));
      section("cremated-deliver").entries.push(
        { ...base(), type: "funeralHomeOnly" as const, funeralHome: "Collins" },
        { ...base(), type: "funeralHomeOnly" as const, funeralHome: "Barber" },
        { ...base(), type: "funeralHomeOnly" as const, funeralHome: "Nova Jewish" },
      );
      section("cremated-fdp").entries.push(
        { ...base(), type: "combined" as const, leftText: "McGuire", rightText: "JFC", count: 2 },
        { ...base(), type: "count" as const, text: "Reese", count: 3 },
        { ...base(), type: "plain" as const, text: "Fraizer-Mason" },
        { ...base(), type: "count" as const, text: "Sewell", count: 2 },
        { ...base(), type: "plain" as const, text: "Covenant" },
      );
      await window.nightShift.saveReport(report, report.version);
    });
    await page.reload();
    await expect(page.getByText("Priority Family").first()).toBeVisible();
    await page.screenshot({ path: "test-results/studio-populated.png" });
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1180, 760));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/studio-narrow.png" });
    await page.getByRole("button", { name: "Tools" }).click();
    await page.getByRole("menuitem", { name: /Print setup/ }).click();
    await expect(page.getByRole("dialog", { name: "Print setup" })).toBeVisible();
    await page.screenshot({ path: "test-results/studio-print-setup.png" });
    await page.getByRole("button", { name: "Close Print setup" }).click();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1400));
    await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>("*")) element.scrollTop = 0; window.scrollTo(0, 0); });
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden"; window.scrollTo(0, 0); });
    await page.screenshot({ path: "test-results/sample-report-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
    await page.emulateMedia({ media: "screen" });

    await page.evaluate(async () => {
      const data = await window.nightShift.bootstrap();
      const report = data.report!;
      const base = () => ({ id: crypto.randomUUID(), rush: false, keepSeparate: false, pinnedBottom: false, createdAt: new Date().toISOString() });
      const funeral = (home: string, name: string, code = "") => ({ ...base(), type: "funeral" as const, funeralHome: home, deceased: [{ id: crypto.randomUUID(), name, locationCode: code, specialRequest: "" }] });
      const section = (key: string) => report.sections.find((item) => item.key === key)!;
      section("human-deliver").entries.push(funeral("Metropolitan Memorial Services of Greater Washington", "Alexandria Catherine-Margaret Longsurname", "17B"));
      // The taller column decides compaction, and this fixture exists to prove the fallback
      // actually engages and still fits. It is sized against the space actually available, which
      // the notes block at the foot of the sheet reduced — hence fewer rows than it once needed.
      for (let index = 1; index <= 6; index += 1) {
        section("human-fdp").entries.push(funeral(`Funeral Home ${index}`, `Family ${index}`, `${index}A`));
      }
      for (let index = 1; index <= 6; index += 1) {
        section("cremated-fdp").entries.push({ ...base(), type: "count" as const, text: `Additional cremains ${index}`, count: (index % 3) + 1 });
      }
      await window.nightShift.saveReport(report, report.version);
    });
    await page.reload();
    await expect(page.locator(".page-stage .report-page")).toBeVisible();
    // Squeezed, but nowhere near as hard as the sheet can be: this fixture is a busy night, not an
    // impossible one. An exact figure would be brittle — compaction is continuous and settles a
    // point or two either side of the same answer — so the assertion is the band it belongs in.
    // Polled, because the search takes a few measured renders to settle and reading it the instant
    // the page appears catches it mid-search rather than at its answer.
    const tightenNow = async () => Number(await page.locator(".page-stage .report-page").getAttribute("data-tighten"));
    await expect.poll(tightenNow, { timeout: 10_000 }).toBeLessThan(0.6);
    expect(await tightenNow()).toBeGreaterThan(0);
    // Compaction is a fallback that must make the report fit, not merely fire.
    await expect(page.getByText(/Printing is paused/)).toHaveCount(0);
    await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>("*")) element.scrollTop = 0; window.scrollTo(0, 0); });
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden"; window.scrollTo(0, 0); });
    await page.screenshot({ path: "test-results/busy-report-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
    await page.emulateMedia({ media: "screen" });

    await page.evaluate(async () => {
      const data = await window.nightShift.bootstrap();
      const report = data.report!;
      const section = report.sections.find((item) => item.key === "human-fdp")!;
      // Well past the ceiling. Squeezed all the way down, to 7.2pt, the sheet holds somewhere north
      // of sixty entries. Sixty added on top of the busy fixture above clears even that; the guard
      // only means anything if the fixture is genuinely bigger than the sheet can take, so it has
      // to stay ahead of the tightest the page is ever drawn, not merely of a busy night.
      for (let index = 1; index <= 60; index += 1) {
        section.entries.push({
          id: crypto.randomUUID(),
          type: "plain" as const,
          text: `Overflow safety entry ${index}`,
          rush: false,
          keepSeparate: false, pinnedBottom: false,
          createdAt: new Date().toISOString(),
        });
      }
      await window.nightShift.saveReport(report, report.version);
    });
    await page.reload();
    await expect(page.getByText(/Printing is paused/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Print report" })).toBeDisabled();
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("shows and hides the road trips card, and remembers which", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "night-shift-roadtrips-"));
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1400));
    await expect(page.getByText("Live canvas")).toBeVisible();
    const preview = page.locator(".report-page").first();
    const openSections = async () => page.getByRole("button", { name: "Sections", exact: true }).click();
    const roadTrips = page.getByRole("menuitemcheckbox", { name: /ROAD TRIPS/ });

    await expect(preview.getByTestId("section-card")).toHaveCount(9);
    await openSections();
    await expect(roadTrips).toHaveAttribute("aria-checked", "false");

    await roadTrips.click();
    await expect(preview.getByTestId("section-card")).toHaveCount(10);
    await expect(preview.locator('[data-section-key="human-road-trips"]')).toBeVisible();

    // Through a reload, which is what actually exercises the column and the migration that adds
    // it: the flag has to survive the round trip to SQLite, not just live in React state.
    await page.reload();
    await expect(page.getByText("Live canvas")).toBeVisible();
    await expect(preview.getByTestId("section-card")).toHaveCount(10);
    await openSections();
    await expect(roadTrips).toHaveAttribute("aria-checked", "true");

    await roadTrips.click();
    await expect(preview.getByTestId("section-card")).toHaveCount(9);
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

const packagedExecutable = process.env.TEST_PACKAGED_EXECUTABLE ?? join(process.cwd(), "release", "win-unpacked", "Night Shift Report.exe");
test("the packaged Windows application starts with clean local data", async () => {
  test.skip(process.env.TEST_PACKAGED !== "1" || !existsSync(packagedExecutable), "Run after building the portable Windows release.");
  const dataDirectory = await mkdtemp(join(tmpdir(), "night-shift-packaged-"));
  const electronApp = await electron.launch({
    executablePath: packagedExecutable,
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    // A fresh install has no prior report to clone from, so the app opens directly into a clean,
    // empty report for tonight rather than any kind of welcome screen.
    await expect(page.getByText("Live canvas")).toBeVisible();
    const preview = page.locator(".report-page").first();
    await expect(preview.getByTestId("section-card")).toHaveCount(9);
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
