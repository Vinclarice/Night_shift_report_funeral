/**
 * Print-fidelity spike: can a browser reproduce the sheet Electron prints?
 *
 * The app dictates its own print job — `printBackground: true`, `marginType: "none"`, Letter — so
 * the operator only picks a printer. A browser cannot do that. `window.print()` opens Chrome's own
 * dialog and hands four decisions to whoever is standing there: background graphics (off by
 * default, which would drop every banner and column tint to white), scale, margins, and headers
 * and footers. Whether the sheet survives that is the one question that decides if this app can
 * become a web application, and it is answerable on paper today, before anything is ported.
 *
 * So this renders the same fixtures the physical gate uses through the real application, lifts the
 * print-only markup back out, and writes each one as a standalone HTML file carrying an inlined
 * copy of the real stylesheet. Those files have no application around them — no Electron, no
 * React, no IPC — so opening one in Chrome and printing it is exactly the fidelity a ported web
 * version would have. Print them beside the matching PDF in print-gate/ and compare.
 *
 * Each file is self-contained, so the whole print-spike/ directory can be copied to the production
 * computer on a stick and opened there. That matters: the comparison has to happen on the printer
 * the report is actually produced on.
 *
 *   pnpm build && node scripts/print-gate.mjs && node scripts/print-spike.mjs
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

import { CASES, seedInPage } from "./report-fixtures.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(projectRoot, "print-spike");
const stylesheetPath = resolve(projectRoot, "src", "renderer", "styles.css");

/**
 * The three sheets worth carrying to the printer, chosen for what each one puts at risk rather
 * than for coverage — this is a spike, and a stack of ten sheets nobody works through answers
 * nothing. Each names the gate PDF it is the counterpart of, since the comparison is the point.
 */
const counterpart = (spike) => spike.comparePdf ?? spike.caseId;

const SPIKES = [
  {
    id: "spike-1-calibration",
    caseId: "02-sample",
    calibration: true,
    // Seeded from the sample report, but the sheet it is the counterpart of is the gate's own
    // calibration sheet, which is that same report with the marks turned on.
    comparePdf: "00-calibration",
    title: "Calibration marks — do the page edges survive?",
    risk: "Margins. The dashed rules sit at the very edge of the sheet, so anything Chrome does to margins or to \"fit to printable area\" clips them. If all four edges print here exactly as they do from the app, the browser is honouring @page { margin: 0 } and the geometry is safe.",
  },
  {
    id: "spike-2-sample",
    caseId: "02-sample",
    title: "The everyday sheet — do the inks survive?",
    risk: "Background graphics, which Chrome leaves OFF by default. Both column banners, every card tint and the rush chip are backgrounds. Unticked, the banners lose their fill but keep their text colour, which is white — so HUMAN REMAINS and CREMATED REMAINS print white on white and vanish entirely, taking the mono-laser colour separation with them. Card headers are dark ink on a light tint and survive, so the sheet still looks like a report with its two column headings mysteriously blank. That is what makes it dangerous.",
  },
  {
    id: "spike-3-tightened-hard",
    caseId: "05-tightened-hard",
    title: "The dense sheet at 7.8pt — does the type survive?",
    risk: "Scale. This page has no slack anywhere, so any browser scaling that is not exactly 100% shows up first here, as collided rows or clipped location codes. It is also the hardest sheet to read on paper at the best of times.",
  },
];

/** Chrome's dialog, in the order it presents the four settings that matter. */
const PRINT_SETTINGS = [
  ["Destination", "the company printer — the same one the app prints to"],
  ["Margins", "None"],
  ["Scale", "100 (Custom), not \"Fit to printable area\""],
  ["Options > Background graphics", "TICKED — this is the one that silently ruins the sheet"],
  ["Options > Headers and footers", "unticked"],
];

/**
 * Rebuilds the DOM ancestry the print stylesheet expects. `@media print` targets
 * `html, body, #root, .studio-shell` together and shows `.print-only` inside them, so a page that
 * drops any link in that chain would print differently for reasons that have nothing to do with
 * the browser — and would make this spike lie.
 */
const wrap = (spike, markup, css) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${spike.id} — Night Shift Report print spike</title>
<style>
/* The application's own stylesheet, inlined verbatim so this file stands alone. Nothing below it
   is edited — the whole point is that the browser sees exactly the CSS the app renders with. */
${css}
</style>
<style>
/* Spike-only, and deliberately scoped to @media screen so it cannot reach the printed sheet.
   In the app the print copy is display:none until printing; here it has to be visible so the
   page can be checked on screen before paper is spent on it. */
@media screen {
  body { background: #dde2e8; padding: 24px 0 48px; overflow: auto; }
  .studio-shell { display: block; height: auto; }
  .print-only { display: block; width: 8.5in; margin: 0 auto; background: white; box-shadow: 0 6px 28px rgb(26 31 38 / 22%); }
  .spike-note { width: 8.5in; margin: 0 auto 20px; padding: 16px 20px; border-radius: 8px; background: #fbfcfd; border: 1px solid #c3c8cf; box-shadow: 0 2px 10px rgb(26 31 38 / 10%); font-family: "Segoe UI", system-ui, sans-serif; color: #1a1f26; }
  .spike-note h1 { margin: 0 0 6px; font-size: 17px; }
  .spike-note p { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: #454c56; }
  .spike-note table { border-collapse: collapse; font-size: 12.5px; }
  .spike-note th, .spike-note td { padding: 3px 14px 3px 0; text-align: left; vertical-align: top; }
  .spike-note th { font-weight: 600; white-space: nowrap; }
  .spike-note td { color: #454c56; }
  .spike-note strong { color: #8c2f39; }
}
@media print { .spike-note { display: none !important; } }
</style>
</head>
<body>
<div class="spike-note">
  <h1>${spike.title}</h1>
  <p><strong>What this sheet is testing:</strong> ${spike.risk}</p>
  <p>Print with Ctrl+P and compare against <code>print-gate/${counterpart(spike)}.pdf</code> printed from the app. Set the dialog to:</p>
  <table>
${PRINT_SETTINGS.map(([k, v]) => `    <tr><th>${k}</th><td>${v}</td></tr>`).join("\n")}
  </table>
</div>
<div id="root">
  <main class="studio-shell">
    <div class="print-only">${markup}</div>
  </main>
</div>
</body>
</html>
`;

const run = async () => {
  await mkdir(outDir, { recursive: true });
  const css = await readFile(stylesheetPath, "utf8");
  const dataDir = await mkdtemp(join(tmpdir(), "night-shift-print-spike-"));
  const app = await electron.launch({
    args: [join(projectRoot, "out", "main", "index.js")],
    env: { ...process.env, NIGHT_SHIFT_REPORT_DATA_DIR: dataDir, NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE: "1" },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1500, 1400));
    await page.waitForSelector(".studio-canvas");

    for (const spike of SPIKES) {
      const testCase = CASES.find((item) => item.id === spike.caseId);
      if (!testCase) throw new Error(`no gate case named ${spike.caseId}`);
      await seedInPage(page, testCase.entries, testCase.notes);
      await page.reload();
      await page.waitForSelector(".studio-canvas");
      // Compaction settles asynchronously: the hook measures, re-renders a step tighter, and
      // measures again. Lifting the markup before it has finished would capture a page at the
      // wrong step, which is precisely the thing this spike is meant to compare.
      await page.waitForTimeout(900);
      if (spike.calibration) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll(".report-page")) el.setAttribute("data-calibration", "true");
        });
      }

      const markup = await page.locator(".print-only").innerHTML();
      const compact = /compact-(\d)/.exec(markup)?.[1] ?? "0";
      await writeFile(join(outDir, `${spike.id}.html`), wrap(spike, markup, css), "utf8");
      console.log(`${spike.id.padEnd(22)} ok  (from ${spike.caseId}, compact-${compact}, ${Math.round(markup.length / 1024)}kb)`);
    }

    await writeFile(join(outDir, "COMPARE.md"), compareDoc(), "utf8");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nSpike pack: ${outDir}`);
  console.log("Copy the folder to the production computer, open each .html in Chrome, and work");
  console.log("through COMPARE.md at the printer beside the matching print-gate PDF.");
};

const compareDoc = () => `# Print-fidelity spike — can a browser print this report?

This answers one question, on paper, before any porting work is done: **does Chrome reproduce the
sheet the app prints?** If it does, Night Shift Report can become a web application and the whole
Windows code-signing and Smart App Control problem goes away with it. If it does not, it stays an
Electron app.

Each file here is a standalone HTML page — no Electron, no React, no application around it —
carrying the real markup the app renders and an inlined copy of the real stylesheet. What Chrome
does with these files is what a ported web version would do.

## Why this is in doubt

The app currently dictates its own print job: background graphics on, margins none, Letter. The
operator only picks a printer. A browser cannot be told any of that — \`window.print()\` opens
Chrome's dialog and the person standing there decides. Get one setting wrong and a **plausible
looking but wrong sheet still prints**, which is the real risk: nobody notices at 2am.

## Do this at the printer

Copy this folder to the production computer. For each sheet, open the \`.html\` in Chrome, press
Ctrl+P, and set the dialog to:

${PRINT_SETTINGS.map(([k, v]) => `- **${k}** — ${v}`).join("\n")}

Then print the matching PDF from \`print-gate/\` and hold the two sheets together.

${SPIKES.map((s) => `### ${s.id}\n\n${s.title}\n\n${s.risk}\n\nCompare against \`print-gate/${counterpart(s)}.pdf\`.\n\n- [ ] Ink coverage on the banners matches the app's sheet\n- [ ] Page geometry matches — cards the same size, in the same place, nothing shifted\n- [ ] No text clipped at any card edge\n- [ ] Nothing added by the browser (URL, date, page number)\n`).join("\n")}

## Then answer this

- [ ] **With the dialog set correctly, is the browser sheet indistinguishable from the app's?**
      If yes, the port is safe on the thing that matters and the remaining work is ordinary.
- [ ] **How badly does it fail with Background graphics left at its default?** Print
      \`spike-2-sample.html\` once with the box unticked on purpose — that is what the report looks
      like the first time anyone prints from a fresh Windows profile. Chromium says to expect the
      two column banners to disappear completely rather than merely lose their colour: the fill is
      dropped but the text stays white, so white-on-white. The card headers are dark ink on a pale
      tint and should survive, which leaves a sheet that still reads as a report while both column
      headings are blank. Confirm that on paper, because it decides whether a web version needs a
      card taped to the monitor or a refusal to print built into the page itself.
- [ ] **Do Chrome's settings persist** across a restart of the browser and of the computer?
      They are stored per user profile, so a second Windows account starts from the defaults again.

If the first box is ticked, the port comes down to replacing about 750 lines — the Electron main
process, the preload bridge, and the Prisma repository — behind the existing \`NightShiftApi\`
interface. Everything in \`src/domain\`, \`src/application\` and \`src/renderer\` carries over as-is.
`;

await run();
