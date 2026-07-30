import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

async function directoryContainsText(directory: string, needle: string): Promise<boolean> {
  if (!existsSync(directory)) return false;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsText(path, needle)) return true;
    } else if ((await readFile(path)).toString("utf8").includes(needle)) return true;
  }
  return false;
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
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await page.screenshot({ path: "test-results/version-2-launch.png" });
    await page.getByRole("button", { name: "Open Night Shift Report" }).click();
    await expect(page.getByText("Live canvas")).toBeVisible();
    await page.screenshot({ path: "test-results/studio-empty.png" });
    await page.getByRole("button", { name: "Finalize" }).click();
    await expect(page.getByText("This report is locked")).toBeVisible();
    await page.screenshot({ path: "test-results/studio-finalized.png" });
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByRole("button", { name: "Finalize" })).toBeVisible();
    const preview = page.locator(".report-page").first();
    await expect(preview.getByTestId("section-card")).toHaveCount(9);
    await expect(page.getByText("DRAFT").first()).toBeVisible();
    await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>("*")) element.scrollTop = 0; window.scrollTo(0, 0); });
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden"; window.scrollTo(0, 0); });
    await page.screenshot({ path: "test-results/empty-report-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
    await page.emulateMedia({ media: "screen" });

    const humanDeliverCard = page.locator('.page-stage [data-section-key="human-deliver"]');
    await humanDeliverCard.locator(".inline-row-button.blank-row").first().click();
    const inlineInput = page.getByRole("textbox", { name: "Edit Human Remains DELIVER" });
    await inlineInput.fill("Preview Home - Typed Family (9A)");
    await inlineInput.press("Enter");
    await expect(page.getByText("Typed Family").first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Edit Human Remains DELIVER" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Edit Human Remains DELIVER" })).toHaveValue("");
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).press("Escape");
    await expect(page.locator(".save-state")).toHaveText("Saved");

    await page.getByRole("button", { name: "Edit Human Remains DELIVER" }).click();
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).fill("");
    await page.getByRole("textbox", { name: "Edit Human Remains DELIVER" }).press("Enter");
    await expect(page.getByText("Typed Family")).toHaveCount(0);

    const pendingCard = page.locator('.page-stage [data-section-key="human-pending"]');
    await pendingCard.locator(".inline-row-button.blank-row").first().click();
    const pendingInput = page.getByRole("textbox", { name: /Edit Human Remains HR DEL/ });
    await pendingInput.fill("beltway crem - jane doe (13a)");
    await pendingInput.press("Enter");
    await expect(page.getByText("Jane Doe").first()).toBeVisible();
    await pendingCard.locator(".draggable-row").dragTo(humanDeliverCard);
    await expect(humanDeliverCard).toContainText("Jane Doe");
    await expect(pendingCard).not.toContainText("Jane Doe");
    await humanDeliverCard.locator(".draggable-row").click();
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
      for (let index = 1; index <= 8; index += 1) {
        section("human-fdp").entries.push(funeral(`Funeral Home ${index}`, `Family ${index}`, `${index}A`));
      }
      for (let index = 1; index <= 10; index += 1) {
        section("cremated-fdp").entries.push({ ...base(), type: "count" as const, text: `Additional cremains ${index}`, count: (index % 3) + 1 });
      }
      await window.nightShift.saveReport(report, report.version);
    });
    await page.reload();
    await expect(page.locator(".page-stage .report-page")).toBeVisible();
    await expect(page.locator(".page-stage .report-page")).toHaveClass(/compact-[12]/);
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
      for (let index = 1; index <= 20; index += 1) {
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
    await expect(page.getByRole("button", { name: "Print draft" })).toBeDisabled();
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("saves, suggests, aliases, and manages a reusable First Call location", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "first-call-directory-e2e-"));
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1100));
    await page.getByRole("button", { name: "New First Call Sheet" }).click();
    await page.getByLabel("Direct funeral home name").fill("Harbor Funeral Directors");
    await page.getByLabel("Direct funeral home address").fill("100 Harbor Way, Alexandria, VA 22314");
    await page.getByLabel("Direct funeral home telephone").fill("703-555-0100");
    await page.getByRole("button", { name: "Save to directory" }).first().click();
    await expect(page.getByText("Funeral home saved.")).toBeVisible();

    await page.getByLabel("Direct funeral home name").fill("Harb");
    await page.getByRole("option", { name: /Harbor Funeral Directors/ }).click();
    await expect(page.getByLabel("Funeral home address", { exact: true })).toHaveValue("100 Harbor Way, Alexandria, VA 22314");

    await page.getByRole("button", { name: "Manage directories" }).click();
    await page.getByRole("button", { name: /Harbor Funeral Directors/ }).click();
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await page.getByLabel("Aliases").fill("HFD, Harbor Funeral");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Funeral home updated.")).toBeVisible();
    await page.screenshot({ path: "test-results/version-2-directory-manager.png" });
    await page.getByRole("button", { name: "Close directory manager" }).click();

    await page.getByLabel("Direct funeral home name").fill("HFD");
    await expect(page.getByRole("option", { name: /Harbor Funeral Directors/ })).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("opens the temporary First Call workspace and keeps Residence out of persistence", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "first-call-e2e-"));
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1200));
    await page.getByRole("button", { name: "New First Call Sheet" }).click();
    await expect(page.getByLabel("First Call Sheet canvas")).toBeVisible();
    await page.getByRole("button", { name: "100%" }).click();
    await expect(page.getByLabel("First Call preview page")).toHaveCSS("width", "816px");
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await page.getByLabel("First Call preview page").evaluate((element) => Number.parseFloat((element as HTMLElement).style.width))).toBeCloseTo(897.6, 1);
    expect(await page.locator(".first-call-print-only .first-call-letter").evaluate((element) => (element as HTMLElement).style.getPropertyValue("--first-call-scale"))).toBe("1");
    await page.emulateMedia({ media: "print" });
    await page.locator(".first-call-print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.screenshot({ path: "test-results/first-call-empty-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "100%" }).click();
    const semanticLabel = page.locator(".first-call-semantic-layer > span").filter({ hasText: "Name of Decedent:" });
    const semanticBox = await semanticLabel.boundingBox();
    if (!semanticBox) throw new Error("Selectable form text was not laid out.");
    await page.mouse.move(semanticBox.x + 3, semanticBox.y + semanticBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(semanticBox.x + semanticBox.width - 3, semanticBox.y + semanticBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
    await page.getByRole("button", { name: "Pink highlight" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator(".first-call-interactive .first-call-highlight-manual")).toHaveCount(1);
    await expect(page.locator(".first-call-print-only .first-call-highlight-manual")).toHaveCount(1);
    await page.getByLabel("Removal only").check();
    await expect(page.locator(".first-call-interactive .first-call-highlight-auto")).toHaveCount(1);
    await expect(page.locator(".first-call-print-only .first-call-highlight-auto")).toHaveCount(1);
    await page.screenshot({ path: "test-results/first-call-highlights.png" });
    await page.getByLabel("Name of decedent").fill("Smith, Mary A.");
    await expect(page.getByLabel("Deceased last name")).toHaveValue("SMITH");
    await page.getByRole("tab", { name: "Place of death" }).click();
    await page.getByRole("button", { name: "Residence" }).click();
    await page.getByLabel("Direct residence address").fill("Private residence address");
    await page.getByLabel("Direct residence telephone").fill("Private phone");
    await expect(page.getByLabel("Place of death address")).toHaveValue("Private residence address");
    await expect(page.getByLabel("Place of death phone")).toHaveValue("Private phone");
    await expect(page.getByText(/never cached, saved, recommended, logged, backed up/)).toBeVisible();
    expect(await page.evaluate(async () => (await window.nightShift.loadFirstCallWorkspace()).facilities)).toEqual([]);
    await page.screenshot({ path: "test-results/first-call-workspace.png" });

    await page.emulateMedia({ media: "print" });
    await page.locator(".first-call-print-only").evaluate((element) => { element.style.position = "absolute"; element.style.inset = "0"; });
    await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden"; window.scrollTo(0, 0); });
    await page.screenshot({ path: "test-results/first-call-residence-page.png", clip: { x: 0, y: 0, width: 816, height: 1056 } });
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("uses an explicit TomTom search and formats the selected result simply", async () => {
  test.setTimeout(60_000);
  let requestedUrl = "";
  const server = createServer((request, response) => {
    requestedUrl = request.url ?? "";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ results: [{
      id: "tomtom-place-1",
      poi: { name: "Example Medical Center", phone: "+1 703-555-0199" },
      address: { streetNumber: "3300", streetName: "Gallows Road", municipality: "Falls Church", countrySubdivision: "VA", postalCode: "22042" },
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock TomTom server did not start.");

  const dataDirectory = await mkdtemp(join(tmpdir(), "first-call-tomtom-e2e-"));
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: {
      ...process.env,
      NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory,
      NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1",
      NIGHT_SHIFT_REPORT_TOMTOM_API_KEY: "test-key",
      NIGHT_SHIFT_REPORT_TOMTOM_SEARCH_URL: `http://127.0.0.1:${address.port}/search/2/search`,
    },
  });
  try {
    const page = await electronApp.firstWindow();
    await page.getByRole("button", { name: "New First Call Sheet" }).click();
    await page.getByLabel("Direct funeral home name").fill("Example Medical");
    await page.getByRole("button", { name: "Search TomTom" }).first().click();
    const funeralHomeSection = page.locator(".first-call-tools > section").filter({ has: page.getByLabel("Direct funeral home name") });
    await expect(funeralHomeSection.getByLabel("Online lookup results")).toContainText("Example Medical Center");
    await funeralHomeSection.getByRole("button", { name: /Example Medical Center/ }).click();

    await expect(page.getByLabel("Funeral home address", { exact: true })).toHaveValue("3300 Gallows Road, Falls Church, VA 22042");
    await expect(page.getByLabel("Funeral home telephone number")).toHaveValue("703-555-0199");
    await expect(page.getByLabel("Funeral home fax number")).toHaveValue("");
    const request = new URL(requestedUrl, "http://localhost");
    expect(decodeURIComponent(request.pathname)).toContain("Example Medical.json");
    expect(request.searchParams.get("countrySet")).toBe("US");
    expect(request.searchParams.get("lat")).toBe("38.9072");
  } finally {
    await electronApp.close();
    server.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("searches a Residence address without persisting it anywhere in app data", async () => {
  test.setTimeout(60_000);
  let requestedUrl = "";
  const server = createServer((request, response) => {
    requestedUrl = request.url ?? "";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ results: [{
      id: "residence-address-1",
      address: { streetNumber: "742", streetName: "Evergreen Terrace", municipality: "Springfield", countrySubdivision: "VA", postalCode: "22150" },
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock TomTom server did not start.");
  const dataDirectory = await mkdtemp(join(tmpdir(), "first-call-residence-search-"));
  const privateQuery = "742 Evergreen Terrace";
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: {
      ...process.env,
      NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory,
      NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1",
      NIGHT_SHIFT_REPORT_TOMTOM_API_KEY: "test-key",
      NIGHT_SHIFT_REPORT_TOMTOM_SEARCH_URL: `http://127.0.0.1:${address.port}/search/2/search`,
    },
  });
  let appClosed = false;
  try {
    const page = await electronApp.firstWindow();
    await page.getByRole("button", { name: "New First Call Sheet" }).click();
    await page.getByRole("tab", { name: "Place of death" }).click();
    await page.getByRole("button", { name: "Residence" }).click();
    await page.getByLabel("Direct residence address").fill(privateQuery);
    await page.getByRole("button", { name: "Search address with TomTom" }).click();
    await page.getByRole("button", { name: /742 Evergreen Terrace, Springfield/ }).click();
    await expect(page.getByLabel("Place of death address")).toHaveValue("742 Evergreen Terrace, Springfield, VA 22150");
    expect(decodeURIComponent(requestedUrl)).toContain(privateQuery);
    expect(await page.evaluate(async () => (await window.nightShift.loadFirstCallWorkspace()).facilities)).toEqual([]);
    await electronApp.close();
    appClosed = true;
    expect(await directoryContainsText(dataDirectory, privateQuery)).toBe(false);
  } finally {
    if (!appClosed) await electronApp.close();
    server.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("runs a Cremation Batch while keeping deceased names out of local storage", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "cremation-batch-e2e-"));
  const privateName = "Privacy Canary Decedent";
  const electronApp = await electron.launch({
    args: [join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  let appClosed = false;
  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1050));
    await page.getByRole("button", { name: "New Cremation Batch" }).click();
    await expect(page.getByText("Cremation Batch", { exact: true })).toBeVisible();
    await page.getByLabel("Cremation number 1").fill("6-063-37");
    await page.getByLabel("Full name 1").fill(privateName);
    await expect(page.getByLabel("Display name 1")).toHaveValue("Privacy Decedent");
    await page.getByLabel("Funeral home 1").fill("Harbor Funeral Service");
    await page.getByLabel("Funeral home 1").press("Enter");
    await expect(page.getByLabel("Cremation number 2")).toHaveValue("6-063-38");
    await page.getByLabel("Full name 2").fill("Second Example Person");
    await page.getByLabel("Funeral home 2").fill("Harbor Funeral Service");
    await page.getByLabel("Cremation number 1").fill("6-063-38");
    await expect(page.getByLabel("Cremation number 2")).toHaveValue("6-064-01");
    await page.getByRole("button", { name: "Labels" }).click();
    await expect(page.getByRole("button", { name: "Print selected" })).toBeDisabled();
    await page.getByRole("button", { name: "Save final number" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Save final number" }).click();
    await expect(page.getByText("Saved 6-064-01 as the final cremation number.")).toBeVisible();
    await page.screenshot({ path: "test-results/cremation-batch.png" });
    const stored = await page.evaluate(() => window.nightShift.loadCremationWorkspace());
    expect(stored.savedFinalNumber).toBe("6-064-01");
    expect(stored.funeralHomes).toEqual([]);
    await electronApp.close();
    appClosed = true;
    expect(await directoryContainsText(dataDirectory, privateName)).toBe(false);
    expect(await directoryContainsText(dataDirectory, "Second Example Person")).toBe(false);
  } finally {
    if (!appClosed) await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

const packagedExecutable = process.env.TEST_PACKAGED_EXECUTABLE ?? join(process.cwd(), "release", "win-unpacked", "Night Shift Report.exe");
test("the packaged Windows application starts with clean local data", async () => {
  test.skip(process.env.TEST_PACKAGED !== "1" || !existsSync(packagedExecutable), "Run the packaged-app verification after building the portable release.");
  const dataDirectory = await mkdtemp(join(tmpdir(), "night-shift-packaged-"));
  const electronApp = await electron.launch({
    executablePath: packagedExecutable,
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDirectory, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole("heading", { name: "Night Shift Report" })).toBeVisible();
    await page.getByRole("button", { name: "New Cremation Batch" }).click();
    await expect(page.getByLabel("Cremation number 1")).toBeVisible();
    const labels = await page.evaluate(() => window.nightShift.checkCremationLabelReadiness());
    expect(labels.bpacInstalled).toBe(true);
    expect(labels.templateAvailable).toBe(true);
    expect(labels.message).not.toBe("");
    await page.getByRole("button", { name: "Night Shift" }).click();
    await page.getByRole("button", { name: "New First Call Sheet" }).click();
    await page.getByRole("tab", { name: /Settings/ }).click();
    await expect(page.getByRole("button", { name: /TomTom search settings/ })).toBeVisible();
    await expect(page.getByLabel("TomTom API key")).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage directories" })).toBeVisible();
    await page.getByRole("tab", { name: "Funeral home" }).click();
    await expect(page.getByLabel("Direct funeral home name")).toBeVisible();
    await page.getByRole("button", { name: "100%" }).click();
    await expect(page.getByLabel("First Call preview page")).toHaveCSS("width", "816px");
    await expect(page.getByLabel("Selectable printed form text")).toBeVisible();
    await page.getByLabel("Removal only").check();
    await expect(page.locator(".first-call-interactive .first-call-highlight-auto")).toHaveCount(1);
    await expect(page.locator(".first-call-print-only .first-call-highlight-auto")).toHaveCount(1);
    expect(await page.locator(".first-call-source-page > img").first().evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.getByRole("button", { name: "Night Shift" }).click();
    await page.getByRole("button", { name: "Leave sheet" }).click();
    await page.getByRole("button", { name: "Open Night Shift Report" }).click();
    await expect(page.getByText("Live canvas")).toBeVisible();
    expect(existsSync(join(dataDirectory, "night-shift-report.db"))).toBe(true);
  } finally {
    await electronApp.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
