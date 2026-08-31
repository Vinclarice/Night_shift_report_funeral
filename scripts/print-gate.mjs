/**
 * Builds the print pack for the physical print-quality gate in README.md.
 *
 * Renders every case the gate lists through the real application, writes each one as a
 * single-page PDF plus a PNG reference, and runs the checks that can be made mechanically —
 * card count, clipped text, cards jumping columns, compaction, calibration edges, page fit.
 *
 * Those checks cannot approve the gate. Toner density, border sharpness, and the comparison
 * against the Word report only exist on paper. Print the PDFs in print-gate/ on the
 * company printer and work through CHECKLIST.md there.
 *
 * Runs against a throwaway data directory, so it never touches the real report database in
 * %LOCALAPPDATA%\Night Shift Report.
 *
 *   pnpm build && node scripts/print-gate.mjs
 */
import { mkdtemp, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

import { CASES, fun, seedInPage } from "./report-fixtures.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
// Not under test-results/: Playwright clears that directory on every run, which would
// delete the pack the moment the desktop suite is run again.
const outDir = resolve(projectRoot, "print-gate");

/** Identical rows in five human sections, so each can carry a different hairline treatment. */
const RULE_SAMPLE = Object.fromEntries(
  ["human-deliver", "human-airport", "human-fdp", "human-pending", "human-ship-outs"].map((key) => [
    key,
    [fun("Greene", "Johnson", "TRL"), fun("MD Crematory", "Rumer", "17B"), fun("Crescent", "Wanzer", "13A"), fun("Inman", "Lassahn", "SSR")],
  ]),
);

const RULE_WEIGHTS = [
  { label: "A — .45px #c3c8cf  (current)", width: ".45px", color: "#c3c8cf" },
  { label: "B — .45px #a8b0ba", width: ".45px", color: "#a8b0ba" },
  { label: "C — .6px  #a8b0ba", width: ".6px", color: "#a8b0ba" },
  { label: "D — .6px  #8d97a3", width: ".6px", color: "#8d97a3" },
  { label: "E — .75px #8d97a3", width: ".75px", color: "#8d97a3" },
];

/**
 * Everything about the rendered page that can be judged without paper. Deliberately measured on
 * the print-only copy under print media: that is the artifact that reaches the printer, and unlike
 * the live canvas copy it carries no width-drag handles or the shells they hang off.
 */
const inspect = (page) => page.evaluate(() => {
  const el = document.querySelector(".print-only .report-page");
  const cards = [...el.querySelectorAll(".section-card")];
  const content = el.querySelector(".report-content");
  const columns = [...el.querySelectorAll(".report-column")];
  const pageRect = el.getBoundingClientRect();
  const scale = pageRect.height / el.offsetHeight;
  const bottom = Math.max(content.getBoundingClientRect().bottom, ...columns.map((c) => c.getBoundingClientRect().bottom));
  // .section-card is overflow:hidden, so content taller or wider than the box is ink lost off the edge.
  const clipped = cards
    .filter((c) => c.scrollHeight - c.clientHeight > 1 || c.scrollWidth - c.clientWidth > 1)
    .map((c) => c.dataset.sectionKey);
  const strayed = cards
    .map((c) => c.dataset.sectionKey)
    .filter((key) => {
      const inHuman = Boolean(el.querySelector(`.human-column [data-section-key="${key}"]`));
      return inHuman !== key.startsWith("human-");
    });
  return {
    cards: cards.length,
    compact: el.className.match(/compact-\d/)?.[0] ?? "none",
    clipped,
    strayed,
    widestCardIn: +(Math.max(...cards.map((c) => c.getBoundingClientRect().width)) / scale / 96).toFixed(2),
    bottomClearanceIn: +(((pageRect.bottom - bottom) / scale) / 96).toFixed(3),
  };
});

const run = async () => {
  await mkdir(outDir, { recursive: true });
  // Everything below is regenerated. Sweeping first matters because case ids carry a sequence
  // number: when a case is added the later ones shift, and a stale PDF from a previous run would
  // sit in the stack at the printer under a number that now means a different sheet.
  //
  // A locked file is reported rather than thrown on. This directory sits inside OneDrive on the
  // laptop this is run from, and a sync or an open PDF viewer holds a handle often enough that
  // aborting the whole gate over one undeleted sheet would be the wrong trade — anything the run
  // regenerates overwrites its stale copy anyway.
  const stranded = [];
  for (const name of await readdir(outDir)) {
    if (!/\.(png|pdf)$/.test(name) && name !== "CHECKLIST.md") continue;
    try {
      await rm(join(outDir, name), { force: true });
    } catch {
      stranded.push(name);
    }
  }
  const dataDir = await mkdtemp(join(tmpdir(), "night-shift-print-gate-"));
  const app = await electron.launch({
    args: [join(projectRoot, "out", "main", "index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDir, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  const failures = [];
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1400));
    await page.waitForSelector(".studio-canvas");

    for (const testCase of CASES) {
      await seedInPage(page, testCase.entries, testCase.notes, testCase.roadTripsVisible ?? false);
      await page.reload();
      await page.waitForSelector(".studio-canvas");
      await page.waitForTimeout(900);

      // The banner is display:none under print media, so read it before switching.
      const overflowWarning = await page.locator(".overflow-warning").count() > 0;
      await page.emulateMedia({ media: "print" });
      await page.locator(".print-only").evaluate((el) => { el.style.position = "absolute"; el.style.inset = "0"; });
      await page.evaluate(() => { document.documentElement.style.overflow = "hidden"; window.scrollTo(0, 0); });
      const report = await inspect(page);
      const problems = [];
      // Nine on almost every sheet; ten on the one that shows ROAD TRIPS, which is off by default.
      const expectedCards = testCase.expectCards ?? 9;
      if (report.cards !== expectedCards) problems.push(`${report.cards} cards, expected ${expectedCards}`);
      if (report.clipped.length) problems.push(`clipped: ${report.clipped.join(", ")}`);
      if (report.strayed.length) problems.push(`wrong column: ${report.strayed.join(", ")}`);
      if (report.widestCardIn > 3.56) problems.push(`card ${report.widestCardIn}in exceeds the 3.55in ceiling`);
      if (overflowWarning) problems.push("printing paused: does not fit one page");
      // The exact step, not merely that something compacted: each one renders a materially
      // different sheet, and a case that quietly slid from step two to step three would otherwise
      // pass while producing a sheet nobody has judged on paper.
      const expectedCompact = `compact-${testCase.expectCompact ?? 0}`;
      if (report.compact !== expectedCompact) problems.push(`expected ${expectedCompact}, got ${report.compact}`);
      if (problems.length) failures.push(`${testCase.id}: ${problems.join("; ")}`);

      await page.screenshot({ path: join(outDir, `${testCase.id}.png`), clip: { x: 0, y: 0, width: 816, height: 1056 } });
      await page.emulateMedia({ media: "screen" });

      const pdf = await app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        const buffer = await contents.printToPDF({ pageSize: { width: 8.5, height: 11 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true });
        return buffer.toString("base64");
      });
      await writeFile(join(outDir, `${testCase.id}.pdf`), Buffer.from(pdf, "base64"));

      const status = problems.length ? `FAIL — ${problems.join("; ")}` : `ok  (${report.compact}, ${report.bottomClearanceIn}in clear, widest card ${report.widestCardIn}in)`;
      console.log(`${testCase.id.padEnd(20)} ${status}`);
    }

    // Calibration sheet: all four dashed edges must survive the printer's own margins.
    await seedInPage(page, CASES[1].entries);
    await page.reload();
    await page.waitForSelector(".studio-canvas");
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(".report-page")) el.setAttribute("data-calibration", "true");
    });
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((el) => { el.style.position = "absolute"; el.style.inset = "0"; });
    await page.screenshot({ path: join(outDir, "00-calibration.png"), clip: { x: 0, y: 0, width: 816, height: 1056 } });
    const calPdf = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const buffer = await contents.printToPDF({ pageSize: { width: 8.5, height: 11 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true });
      return buffer.toString("base64");
    });
    await writeFile(join(outDir, "00-calibration.pdf"), Buffer.from(calPdf, "base64"));
    console.log("00-calibration       ok  (print this first and confirm all four dashed edges)");

    // Row-rule comparison: the same rows at several hairline treatments, labelled, so the choice
    // is made on paper. A monitor flatters a 0.45px line that a laser printer renders differently.
    // The calibration step above leaves print media emulated, which hides the whole workspace.
    await page.emulateMedia({ media: "screen" });
    await seedInPage(page, RULE_SAMPLE);
    await page.reload();
    await page.waitForSelector(".studio-canvas");
    await page.waitForTimeout(700);
    await page.evaluate((weights) => {
      const keys = ["human-deliver", "human-airport", "human-fdp", "human-pending", "human-ship-outs"];
      keys.forEach((key, index) => {
        const spec = weights[index];
        if (!spec) return;
        for (const card of document.querySelectorAll(`[data-section-key="${key}"]`)) {
          card.querySelector("h3").textContent = spec.label;
          for (const row of card.querySelectorAll(".report-row")) {
            row.style.borderBottomWidth = spec.width;
            row.style.borderBottomColor = spec.color;
          }
        }
      });
    }, RULE_WEIGHTS);
    await page.emulateMedia({ media: "print" });
    await page.locator(".print-only").evaluate((el) => { el.style.position = "absolute"; el.style.inset = "0"; });
    await page.screenshot({ path: join(outDir, "13-rule-weights.png"), clip: { x: 0, y: 0, width: 816, height: 1056 } });
    const rulePdf = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const buffer = await contents.printToPDF({ pageSize: { width: 8.5, height: 11 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true });
      return buffer.toString("base64");
    });
    await writeFile(join(outDir, "13-rule-weights.pdf"), Buffer.from(rulePdf, "base64"));
    await page.emulateMedia({ media: "screen" });
    console.log("13-rule-weights      ok  (print and pick the hairline that reads best)");

    await writeFile(join(outDir, "CHECKLIST.md"), checklist(), "utf-8");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nPrint pack: ${outDir}`);
  // Only the locked files this run did not go on to rewrite are worth mentioning: those are the
  // ones left over from a previous numbering, and the operator has to bin them by hand or they
  // reach the printer as part of the stack.
  const regenerated = new Set([
    ...CASES.flatMap((c) => [`${c.id}.png`, `${c.id}.pdf`]),
    "00-calibration.png", "00-calibration.pdf", "13-rule-weights.png", "13-rule-weights.pdf", "CHECKLIST.md",
  ]);
  const orphans = stranded.filter((name) => !regenerated.has(name));
  if (orphans.length) {
    console.log(`\nCould not delete ${orphans.length} file(s) left by a previous run — delete them`);
    console.log("before printing, or they will go into the stack under numbers that have moved:");
    for (const name of orphans) console.log(`  - ${name}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} mechanical check(s) failed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nMechanical checks passed. These cannot approve the gate — print the pack and work");
  console.log("through CHECKLIST.md on the company printer beside the Word report.");
};

const checklist = () => `# Physical print-quality gate — checklist

Generated by \`node scripts/print-gate.mjs\`. The mechanical checks in that script confirmed card
count, no clipped text, no card in the wrong column, the 3.55in card ceiling, one-page fit, and
that each compaction step engages exactly where intended. **None of that can approve this gate.**
What follows only exists on paper.

Cases 03 through 06 are one busy night at four sizes, one per compaction step. Print them
together and compare them against each other as well as against the Word report: they are how a
busy night reaches paper, and step four is the backstop that keeps the heaviest night printable at
all. No step ever takes away a blank writing row; type and spacing are all that give.

## Before printing

- [ ] Print \`00-calibration.pdf\` first. **All four dashed edges must be visible.** If any edge is
      missing or cut, open **Tools > Print setup** in the app and adjust page margin and the
      horizontal/vertical offsets for this printer, then regenerate and reprint.
- [ ] Print from the app itself (**Print report**) for at least one case as well as from the PDF.
      The PDF and the app's own print path use different drivers, and it is the app's path that
      ships.

## Each case, beside the current Word report

${CASES.map((c) => `### ${c.id} — ${c.title}\n${c.why}\n\n- [ ] No text clipped at any card edge\n- [ ] Borders and rules crisp, not fuzzy or doubled\n- [ ] No card has moved to the wrong column\n${(c.extra ?? []).map((item) => `- [ ] ${item}\n`).join("")}- [ ] Not worse than the Word document\n`).join("\n")}

## This restyle in particular

The palette changed, so these are new on paper and have never been printed:

- [ ] **Human Remains banner** (deep ink) — solid, not blotchy; white text fully legible.
- [ ] **Cremated Remains banner** (warm stone) — clearly *lighter* than the Human banner. On a
      black-and-white printer the two must still read as different greys; that is the whole point
      of the change. If they look the same, stop and report it.
- [ ] **Card header text** on each column tint — the Cremated one is the tighter of the two at
      4.9:1. Confirm it is comfortably readable at arm's length.
- [ ] **Rush rows** — the red left bar and RUSH chip still jump out of the page.
- [ ] **Location codes** (13A, SSR, TRL) — chip borders not lost at 7pt.
- [ ] **Pinned entry** (case ${CASES.find((c) => c.id.endsWith("pinned-bottom")).id}) — the heavier
      rule above it reads as a separator, not a smudge.

## Sign-off

- [ ] Every case above is at least as good as the Word document.
- [ ] Print setup offsets recorded, if any were changed: ______________________
- [ ] Date and printer: ______________________
`;

await run();
