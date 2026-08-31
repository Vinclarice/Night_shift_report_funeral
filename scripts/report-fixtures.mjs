/**
 * The report fixtures the print harnesses share: builders, the cases the physical gate lists,
 * and the helper that seeds one into a running app.
 *
 * Shared because two harnesses now render the same reports for different purposes — print-gate
 * prints them through Electron, print-spike exports them as standalone HTML for a browser — and
 * a case that drifted between the two would quietly invalidate the comparison between them.
 */
import { randomUUID } from "node:crypto";
// Fixtures are built here as plain data and handed to the renderer as JSON. The app ships a
// script-src 'self' policy with no 'unsafe-eval', so serialising builder functions into the page
// is not an option — and weakening that policy for a test harness would be the wrong trade.
export const base = () => ({ id: randomUUID(), rush: false, keepSeparate: false, pinnedBottom: false, createdAt: new Date().toISOString() });
export const person = ([name, locationCode = "", specialRequest = ""]) => ({ id: randomUUID(), name, locationCode, specialRequest });
export const fun = (home, name, code = "", special = "", rush = false) => ({ ...base(), type: "funeral", funeralHome: home, rush, deceased: [person([name, code, special])] });
export const merged = (home, names, rush = false) => ({ ...base(), type: "funeral", funeralHome: home, rush, deceased: names.map(person) });
export const fhOnly = (home, rush = false) => ({ ...base(), type: "funeralHomeOnly", funeralHome: home, rush });
export const plain = (text, pinnedBottom = false) => ({ ...base(), type: "plain", text, pinnedBottom });
export const count = (text, n) => ({ ...base(), type: "count", text, count: n });
export const combined = (leftText, rightText, n) => ({ ...base(), type: "combined", leftText, rightText, count: n });

/**
 * A realistic busy night, scaled by how many rows the two long sections carry. The three
 * compaction cases differ only in that scale: same shape of report, more of it, so the sheets can
 * be compared to each other at the printer and the only variable is the step that engaged.
 */
export const busyNight = (humanRows, cremRows) => ({
  "human-deliver": [fun("McGuire", "Priority Family", "13A", "Rush delivery", true)],
  "human-fdp": Array.from({ length: humanRows }, (_, i) => fun(`Funeral Home ${i + 1}`, `Family ${i + 1}`, `${i + 1}A`)),
  "human-pending": [fun("Brown/PA", "Helwig", "", "Roadtrip - Ron OK"), fun("Beltway Crem", "Hernandez", "", "FH will call")],
  "human-ship-outs": [fun("NMS", "Nicholas"), fun("NMS", "Curry", "", "FDP or S/O?")],
  "cremated-fdp": Array.from({ length: cremRows }, (_, i) => count(`Additional cremains ${i + 1}`, (i % 3) + 1)),
});

/** Each case's `entries` maps a section key to the rows that section should hold. */
export const CASES = [
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
    id: "03-compacted-1",
    title: "Busy night — first compaction step",
    why: "The cheapest step: type and leading tighten. The writing rows and notes block are untouched — as they are at every step.",
    expectCompact: 1,
    entries: busyNight(16, 10),
  },
  {
    id: "04-compacted-2",
    title: "Busier night — second compaction step",
    why: "Tightens type and leading again and gives back most of the notes area. The blank writing rows stay: every section still shows its full complement.",
    expectCompact: 2,
    extra: [
      "Notes block still usable — ruled, and deep enough to write a line in by hand",
      "Every section still shows its full complement of blank writing rows — three under DELIVER and FDP",
    ],
    entries: busyNight(22, 12),
  },
  {
    id: "05-compacted-3",
    title: "Busiest night that still prints — third compaction step",
    why: "The emergency setting at 7.8pt. Everything tightens again, but the writing rows are still there — nothing the crew writes on is ever traded away for fit. This is the sheet most likely to fail on paper, and the one this gate exists for.",
    expectCompact: 3,
    extra: [
      "**Read a location code and a deceased name at arm's length.** 7.8pt body with 6.4pt chips is deliberately uncomfortable; the question is whether a dispatcher can still work from it under the loading-bay lights, not whether it looks good",
      "Rows have not collided — each line clears the hairline above and below it",
      "The RUSH chip and its deadline are still legible at 6pt",
      "Notes block has lost its rules but is still visibly a block, not a stray gap",
    ],
    // Tuned by running this gate: 36/19 tips into "does not fit one page" and 34/18 fills the
    // column with a couple of rows to spare. Deliberately near the ceiling — a step-three sheet
    // with inches of white space left on it would not be the page this case exists to judge. If a
    // layout change ever flips this to a page-fit failure, retune it rather than reading it as a
    // regression; what it is asserting is that step three still fits a night this size.
    //
    // Retuned down from 42/22 when the writing rows stopped being reclaimed by compaction. Holding
    // ten blank rows down the Human column at every step costs roughly seven rows of capacity, and
    // that is the trade this app makes on purpose: a dispatcher who cannot hand-write on the sheet
    // is worse off than one who prints a rare second page.
    entries: busyNight(34, 18),
  },
  {
    id: "06-compacted-4",
    title: "Night that only the backstop fits — fourth compaction step",
    why: "7.2pt, the smallest the sheet ever goes. Reached only after three steps have already failed, so it should be rare — but a night this size prints instead of being refused.",
    expectCompact: 4,
    extra: [
      "**Read a location code and a deceased name at a desk under office light.** 7.2pt body with 6pt chips is smaller than any sheet should routinely be; the question is whether a dispatcher can work from it at a desk, not whether it looks good",
      "Rows have not collided — each line clears the hairline above and below it",
      "The RUSH chip and its deadline are still legible at 5.6pt",
      "Every section still shows its full complement of blank writing rows — three under DELIVER and FDP",
    ],
    // Tuned by running this gate: 43/23 tips into "does not fit one page" and 40/21 fills the
    // column with a couple of rows to spare. Near the ceiling for the same reason 05 is: a
    // backstop sheet with white space left on it proves nothing.
    entries: busyNight(40, 21),
  },
  {
    id: "07-road-trips",
    title: "Road trips card shown",
    why: "The toggled ROAD TRIPS card in place between AIRPORT DROPS and FDP. Off on most nights, so this is the only sheet in the pack that carries it — and the only one with ten cards.",
    roadTripsVisible: true,
    expectCards: 10,
    extra: [
      "ROAD TRIPS sits between AIRPORT DROPS and FDP, not at the foot of the column",
      "Its header and rules match the cards around it — nothing about it reads as bolted on",
      "It shows two blank writing rows",
    ],
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A", "Rush delivery", true)],
      "human-road-trips": [fun("Brown/PA", "Helwig", "", "Ron OK"), fun("Crescent", "Wanzer", "13A", "Meet at 0600")],
      "human-fdp": [fun("Greene", "Johnson", "TRL"), fun("MD Crem", "Rumer", "17B"), fun("Inman", "Lassahn", "SSR")],
      "human-pending": [fun("Beltway Crem", "Hernandez", "", "FH will call")],
      "cremated-fdp": [count("Reese", 3), plain("Covenant")],
    },
  },
  {
    id: "08-long-names",
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
    id: "09-merged-and-rush",
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
    id: "10-pinned-bottom",
    title: "Entry pinned to the bottom of a section",
    why: "The separating rule above a pinned line must read on paper without looking like a highlight.",
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A"), fun("Greene", "Johnson", "TRL"), plain("Road trip - Ron", true)],
      "human-fdp": [fun("Crescent", "Wanzer", "13A"), fun("Inman", "Lassahn", "SSR"), plain("Held for Monday run", true)],
    },
  },
  {
    id: "11-cremated-widths",
    title: "Cremated card at default width beside one expanded by a name",
    why: "Cremated cards start at 1.62in and grow only for the edge case that needs it.",
    entries: {
      "cremated-deliver": [fhOnly("Collins"), fhOnly("Barber")],
      "cremated-mail": [fhOnly("Nova Jewish")],
      "cremated-fdp": [fun("Beltway Crematory", "Margarethe Sandoval-Whitaker", "17B"), plain("Covenant")],
      "cremated-certs": [fhOnly("Reese")],
    },
  },
  {
    id: "12-notes-filled",
    title: "Notes written in the footer",
    why: "Typed notes take height from the columns, so the block has to read cleanly when full.",
    notes: [
      "Ron on 2nd truck; Jayden covering the airport run.",
      "Call Beltway re: Hernandez before 07:00 — family collecting in person.",
    ].join("\n"),
    entries: {
      "human-deliver": [fun("McGuire", "Priority Family", "13A", "Rush delivery", true)],
      "human-fdp": [fun("Greene", "Johnson", "TRL"), fun("Crescent", "Wanzer", "13A")],
      "cremated-fdp": [count("Reese", 3), plain("Covenant")],
    },
  },
];

export const seedInPage = (page, entriesByKey, notes = "", roadTripsVisible = false) => page.evaluate(async ({ byKey, notes, roadTripsVisible }) => {
  const data = await window.nightShift.bootstrap();
  const report = data.report;
  for (const section of report.sections) section.entries = byKey[section.key] ?? [];
  report.notes = notes;
  report.roadTripsVisible = roadTripsVisible;
  await window.nightShift.saveReport(report, report.version);
}, { byKey: entriesByKey, notes, roadTripsVisible });
