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
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { _electron as electron } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
// Not under test-results/: Playwright clears that directory on every run, which would
// delete the pack the moment the desktop suite is run again.
const outDir = resolve(projectRoot, "print-gate");

// Fixtures are built here as plain data and handed to the renderer as JSON. The app ships a
// script-src 'self' policy with no 'unsafe-eval', so serialising builder functions into the page
// is not an option — and weakening that policy for a test harness would be the wrong trade.
const base = () => ({ id: randomUUID(), rush: false, keepSeparate: false, pinnedBottom: false, createdAt: new Date().toISOString() });
const person = ([name, locationCode = "", specialRequest = ""]) => ({ id: randomUUID(), name, locationCode, specialRequest });
const fun = (home, name, code = "", special = "", rush = false) => ({ ...base(), type: "funeral", funeralHome: home, rush, deceased: [person([name, code, special])] });
const merged = (home, names, rush = false) => ({ ...base(), type: "funeral", funeralHome: home, rush, deceased: names.map(person) });
const fhOnly = (home, rush = false) => ({ ...base(), type: "funeralHomeOnly", funeralHome: home, rush });
const plain = (text, pinnedBottom = false) => ({ ...base(), type: "plain", text, pinnedBottom });
const count = (text, n) => ({ ...base(), type: "count", text, count: n });
const combined = (leftText, rightText, n) => ({ ...base(), type: "combined", leftText, rightText, count: n });

/** Each case's `entries` maps a section key to the rows that section should hold. */
const CASES = [
  {
    id: "01-empty",
    title: "Empty report",
    why: "Every card, header and rule with no content to prop them up.",
    entries: {},
  },
  {
    id: "02-sample",
    title: "Sample report",
    why: "The photographed reference the layout was originally built against.",
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A", "Rush delivery", true)],
      "human-fdp": [fun("Greene", "Johnson", "TRL"), fun("MD Crem", "Rumer", "17B"), fun("Crescent", "Wanzer", "13A"), fun("McGuire", "Willoughby", "13A"), fun("Inman", "Lassahn", "SSR"), fun("Alfirdaus", "Fall", "PR"), fun("Moloney", "Rivera", "SSR")],
      "human-pending": [fun("Brown/PA", "Helwig", "", "Roadtrip - Ron OK"), fun("Beltway Crem", "Hernandez", "", "FH will call")],
      "human-ship-outs": [fun("NMS", "Nicholas"), fun("NMS", "Curry", "", "FDP or S/O?")],
      "cremated-deliver": [fhOnly("Collins"), fhOnly("Barber"), fhOnly("Nova Jewish")],
      "cremated-fdp": [combined("McGuire", "JFC", 2), count("Reese", 3), plain("Fraizer-Mason"), count("Sewell", 2), plain("Covenant")],
    },
  },
  {
    id: "03-busy-compacted",
    title: "Busy report with automatic compaction",
    why: "The last-resort compaction pass. Row height, header height and chip leading all shrink.",
    expectCompact: true,
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A", "Rush delivery", true)],
      "human-fdp": Array.from({ length: 16 }, (_, i) => fun(`Funeral Home ${i + 1}`, `Family ${i + 1}`, `${i + 1}A`)),
      "human-pending": [fun("Brown/PA", "Helwig", "", "Roadtrip - Ron OK"), fun("Beltway Crem", "Hernandez", "", "FH will call")],
      "human-ship-outs": [fun("NMS", "Nicholas"), fun("NMS", "Curry", "", "FDP or S/O?")],
      "cremated-fdp": Array.from({ length: 10 }, (_, i) => count(`Additional cremains ${i + 1}`, (i % 3) + 1)),
    },
  },
  {
    id: "04-long-names",
    title: "Long funeral-home and deceased names",
    why: "Wrapping and the 3.55in card ceiling. Nothing may clip or push a card out of column.",
    entries: {
      "human-deliver": [fun("Metropolitan Memorial Services of Greater Washington", "Alexandria Catherine-Margaret Longsurname", "17B")],
      "human-fdp": [fun("Saint Elizabeth of Hungary Memorial Chapel and Crematory", "Bartholomew Fitzwilliam-Harrington III", "SSR", "Family viewing before release")],
      "human-pending": [fun("Wheatley-Fernandez & Sons Funeral Directors", "Anastasia Vasilievna Konstantinopoulos")],
      "cremated-fdp": [fun("Northern Virginia Cremation and Memorial Society", "Reginald Worthington-Ashcombe", "13A")],
    },
  },
  {
    id: "05-merged-and-rush",
    title: "Multiple merged entries and multiple rush deliveries",
    why: "Rush ordering holds the top; merged people share one funeral-home line with + separators.",
    entries: {
      "human-deliver": [
        merged("McGuire", [["Priority Family", "13A", "Rush delivery"]], true),
        merged("Crescent", [["Ableman", "17B", "Rush - before 6am"]], true),
        merged("Greene", [["Johnson", "TRL"], ["Whitfield", "TRL"], ["Okonkwo", "SSR"]]),
        merged("Inman", [["Lassahn", "13A"], ["Prentice", "13A"]]),
      ],
      "human-fdp": [merged("Moloney", [["Rivera", "SSR"], ["Delgado", "SSR"], ["Marchetti", "PR"]])],
      "cremated-deliver": [fhOnly("Collins", true), fhOnly("Barber")],
    },
  },
  {
    id: "06-pinned-bottom",
    title: "Entry pinned to the bottom of a section",
    why: "The separating rule above a pinned line must read on paper without looking like a highlight.",
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A"), fun("Greene", "Johnson", "TRL"), plain("Road trip - Ron", true)],
      "human-fdp": [fun("Crescent", "Wanzer", "13A"), fun("Inman", "Lassahn", "SSR"), plain("Held for Monday run", true)],
    },
  },
  {
    id: "07-cremated-widths",
    title: "Cremated card at default width beside one expanded by a name",
    why: "Cremated cards start at 1.62in and grow only for the edge case that needs it.",
    entries: {
      "cremated-deliver": [fhOnly("Collins"), fhOnly("Barber")],
      "cremated-mail": [fhOnly("Nova Jewish")],
      "cremated-fdp": [fun("Beltway Crematory", "Margarethe Sandoval-Whitaker", "17B"), plain("Covenant")],
      "cremated-certs": [fhOnly("Reese")],
    },
  },
];

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

const seedInPage = (page, entriesByKey) => page.evaluate(async (byKey) => {
  const data = await window.nightShift.bootstrap();
  const report = data.report;
  for (const section of report.sections) section.entries = byKey[section.key] ?? [];
  await window.nightShift.saveReport(report, report.version);
}, entriesByKey);

/**
 * Everything about the rendered page that can be judged without paper. Deliberately measured on
 * the print-only copy under print media: that is the artifact that reaches the printer, and unlike
 * the live canvas copy it carries no width-drag handles — those sit at right:-7px and would inflate
 * every card's scrollWidth into a false clipping report.
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
      await seedInPage(page, testCase.entries);
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
      if (report.cards !== 9) problems.push(`${report.cards} cards, expected 9`);
      if (report.clipped.length) problems.push(`clipped: ${report.clipped.join(", ")}`);
      if (report.strayed.length) problems.push(`wrong column: ${report.strayed.join(", ")}`);
      if (report.widestCardIn > 3.56) problems.push(`card ${report.widestCardIn}in exceeds the 3.55in ceiling`);
      if (overflowWarning) problems.push("printing paused: does not fit one page");
      if (testCase.expectCompact && report.compact !== "compact-1") problems.push(`expected compact-1, got ${report.compact}`);
      if (!testCase.expectCompact && report.compact !== "compact-0") problems.push(`unexpected ${report.compact}`);
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
    await page.screenshot({ path: join(outDir, "08-rule-weights.png"), clip: { x: 0, y: 0, width: 816, height: 1056 } });
    const rulePdf = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const buffer = await contents.printToPDF({ pageSize: { width: 8.5, height: 11 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true });
      return buffer.toString("base64");
    });
    await writeFile(join(outDir, "08-rule-weights.pdf"), Buffer.from(rulePdf, "base64"));
    await page.emulateMedia({ media: "screen" });
    console.log("08-rule-weights      ok  (print and pick the hairline that reads best)");

    await writeFile(join(outDir, "CHECKLIST.md"), checklist(), "utf-8");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nPrint pack: ${outDir}`);
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
that compaction engages only where intended. **None of that can approve this gate.** What follows
only exists on paper.

## Before printing

- [ ] Print \`00-calibration.pdf\` first. **All four dashed edges must be visible.** If any edge is
      missing or cut, open **Tools > Print setup** in the app and adjust page margin and the
      horizontal/vertical offsets for this printer, then regenerate and reprint.
- [ ] Print from the app itself (**Print report**) for at least one case as well as from the PDF.
      The PDF and the app's own print path use different drivers, and it is the app's path that
      ships.

## Each case, beside the current Word report

${CASES.map((c) => `### ${c.id} — ${c.title}\n${c.why}\n\n- [ ] No text clipped at any card edge\n- [ ] Borders and rules crisp, not fuzzy or doubled\n- [ ] No card has moved to the wrong column\n- [ ] Not worse than the Word document\n`).join("\n")}

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
- [ ] **Pinned entry** (case 06) — the heavier rule above it reads as a separator, not a smudge.

## Sign-off

- [ ] Every case above is at least as good as the Word document.
- [ ] Print setup offsets recorded, if any were changed: ______________________
- [ ] Date and printer: ______________________
`;

await run();
