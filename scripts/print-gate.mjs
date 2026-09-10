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
import { readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { launchApp, projectRoot } from "./launch-app.mjs";
import { CASES, fun, seedInPage } from "./report-fixtures.mjs";

/** The page as the printer receives it: Letter, no margins, backgrounds included. */
const printPdf = async (page) => {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send("Page.printToPDF", {
      paperWidth: 8.5, paperHeight: 11, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, printBackground: true,
    });
    return Buffer.from(data, "base64");
  } finally {
    await session.detach();
  }
};
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
    tighten: Number(el.dataset.tighten ?? 0),
    clipped,
    strayed,
    widestHumanIn: +(Math.max(0, ...cards.filter((c) => c.closest(".human-column")).map((c) => c.getBoundingClientRect().width)) / scale / 96).toFixed(2),
    widestCrematedIn: +(Math.max(0, ...cards.filter((c) => c.closest(".cremated-column")).map((c) => c.getBoundingClientRect().width)) / scale / 96).toFixed(2),
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
  const app = await launchApp({ prefix: "night-shift-print-gate-" });
  const failures = [];
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1500, height: 1400 });
    await page.waitForSelector(".studio-canvas");

    for (const testCase of CASES) {
      await seedInPage(page, testCase.entries, testCase.notes, testCase.hiddenSections ?? ["human-road-trips"]);
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
      // The two columns have different ceilings. A Human card may be dragged out until it reaches
      // the Cremated column, which at the default margin is 5.02in; Cremated keeps its 3.55in.
      if (report.widestHumanIn > 5.03) problems.push(`human card ${report.widestHumanIn}in exceeds the 5.02in ceiling`);
      if (report.widestCrematedIn > 3.56) problems.push(`cremated card ${report.widestCrematedIn}in exceeds the 3.55in ceiling`);
      if (overflowWarning) problems.push("printing paused: does not fit one page");
      // Compaction is continuous now, so a case cannot assert an exact setting — a hairline change
      // anywhere moves every density slightly. Each case instead names the band it is meant to
      // land in, wide enough not to be brittle and narrow enough that a sheet sliding from
      // comfortable to nearly-illegible still fails rather than quietly passing.
      const [low, high] = testCase.expectTighten ?? [0, 0];
      if (report.tighten < low || report.tighten > high) {
        problems.push(`tightened ${report.tighten.toFixed(3)}, expected ${low}-${high}`);
      }
      if (problems.length) failures.push(`${testCase.id}: ${problems.join("; ")}`);

      await page.screenshot({ path: join(outDir, `${testCase.id}.png`), clip: { x: 0, y: 0, width: 816, height: 1056 } });
      await page.emulateMedia({ media: "screen" });

      await writeFile(join(outDir, `${testCase.id}.pdf`), await printPdf(page));

      const status = problems.length ? `FAIL — ${problems.join("; ")}` : `ok  (tightened ${(report.tighten * 100).toFixed(0)}%, ${report.bottomClearanceIn}in clear, widest human ${report.widestHumanIn}in, cremated ${report.widestCrematedIn}in)`;
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
    await writeFile(join(outDir, "00-calibration.pdf"), await printPdf(page));
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
    await writeFile(join(outDir, "13-rule-weights.pdf"), await printPdf(page));
    await page.emulateMedia({ media: "screen" });
    console.log("13-rule-weights      ok  (print and pick the hairline that reads best)");

    await writeFile(join(outDir, "CHECKLIST.md"), checklist(), "utf-8");
  } finally {
    await app.close();
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
count, no clipped text, no card in the wrong column, the card ceilings, one-page fit, and
that each sheet is squeezed about as hard as it is meant to be. **None of that can approve this gate.**
What follows only exists on paper.

Cases 03 through 06 are one busy night at four densities. The sheet is not drawn at four fixed
sizes any more — it is squeezed by exactly as much as it needs, anywhere between its natural size
and the smallest it is ever drawn — so these four are samples along that range rather than settings
you could land on. Print them together and compare them against each other as well as against the
Word report: they are how a busy night reaches paper, and 06 is the smallest the sheet ever gets.
No amount of squeezing takes away a blank writing row or a rule from the notes block; type and
spacing are all that give.

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

The masthead, the tags and the rows changed, so these are new on paper and have never been printed:

- [ ] **Masthead** — the heavy rule and the hairline under it print as two distinct lines, not one
      thick smear; the date reads as the large line with FRIDAY small above it.
- [ ] **Location codes** (13A, SSR, TRL) — now an outline in the condensed face; the outline is not
      lost, and a code can be read at arm's length.
- [ ] **Special requests** (FH WILL CALL) — the grey fill prints as a light grey, with the dark text
      fully legible on it.
- [ ] **Counts** (x 2) and **rush** (RUSH DELIVERY) — the same height as a code beside them; rush's
      red outline and left bar still jump out of the page.
- [ ] **Rows without the alternate tint** — rows still separate cleanly on the hairlines alone.
- [ ] **Cremated Remains banner** (warm stone) — still clearly *lighter* than the Human banner on a
      black-and-white printer. Unchanged, but it is what the columns are told apart by.
- [ ] **Pinned entry** (case ${CASES.find((c) => c.id.endsWith("pinned-bottom")).id}) — the heavier
      rule above it reads as a separator, not a smudge.

## Sign-off

- [ ] Every case above is at least as good as the Word document.
- [ ] Print setup offsets recorded, if any were changed: ______________________
- [ ] Date and printer: ______________________
`;

await run();
