/**
 * Renders one page through the shared PDF kit so the palette can be LOOKED AT.
 *
 *   bun scripts/_probe-pdf-palette.ts [outPath]
 *
 * Every artifact in the system (findings, page candidates, citation cleanup, the
 * audit scorecard) is painted by src/lib/pdf/kit.ts, so a constant changed there
 * repaints all of them at once. That is exactly the kind of change that should not
 * be shipped on the strength of a hex value looking right in a diff.
 *
 * Writes to the scratchpad by default, not into the repo.
 */

import { writeFileSync } from "node:fs";
import {
  startDoc,
  finishDoc,
  coverHeading,
  sectionHeading,
  paragraph,
  bulletList,
  keyValueTable,
  plainFooter,
  drawBrandIcon,
  setColor,
  MIDNIGHT,
  BRAND_BAR,
  REEF,
  WHITE,
  MUTED,
  CARD_BORDER,
  RED,
  AMBER,
  MARGIN,
  type RGB,
} from "../src/lib/pdf/kit";

const OUT =
  process.argv[2] ||
  "C:/Users/matth/AppData/Local/Temp/claude/c--Users-matth-Desktop-Code/6da7911e-c480-46a7-8bda-46561db80e0b/scratchpad/palette.pdf";

const hex = (c: RGB) => "#" + c.map((n) => n.toString(16).padStart(2, "0")).join("");

function main(): void {
  const state = startDoc({
    title: "Palette probe",
    footer: plainFooter("Palette probe - not a client artifact"),
  });

  coverHeading(state, {
    eyebrow: "Palette probe",
    title: "Artifact palette",
    subtitle: "Every artifact in the system is painted by pdf/kit.ts",
  });

  sectionHeading(state, "The page background");
  paragraph(
    state,
    `The background of this page is MIDNIGHT ${hex(MIDNIGHT)}. It was ${"#0b1426"}, a near-black navy, ` +
      `which read as black on a screenshot and as blue next to anything else. It now matches the ` +
      `dashboard background in globals.css exactly.`
  );

  sectionHeading(state, "Swatches");
  const swatches: [string, RGB][] = [
    ["MIDNIGHT (page)", MIDNIGHT],
    ["BRAND_BAR (icon)", BRAND_BAR],
    ["REEF (accent)", REEF],
    ["WHITE (body)", WHITE],
    ["MUTED (secondary)", MUTED],
    ["CARD_BORDER", CARD_BORDER],
    ["RED", RED],
    ["AMBER", AMBER],
  ];

  // Draw the actual colours as filled chips, so the eye checks the values, not the labels.
  let y = state.y;
  for (const [label, colour] of swatches) {
    setColor(state.doc, "fill", colour);
    state.doc.roundedRect(MARGIN, y, 24, 7, 1, 1, "F");
    setColor(state.doc, "text", WHITE);
    state.doc.setFontSize(9);
    state.doc.setFont("helvetica", "normal");
    state.doc.text(`${label}  ${hex(colour)}`, MARGIN + 28, y + 5);
    y += 10;
  }
  state.y = y + 4;

  sectionHeading(state, "The brand mark");
  paragraph(state, "Two short bars plus one taller reef bar. The short bars were the last blue in the system.");
  drawBrandIcon(state.doc, MARGIN, state.y, 2.4);
  state.y += 22;

  sectionHeading(state, "Type and furniture");
  bulletList(state, [
    "A bullet, to check the dot colour against the new background.",
    "A second bullet, longer, so the wrap and the leading can be judged at real size.",
  ]);
  keyValueTable(state, [
    { label: "Neutral row", value: "no tone" },
    { label: "Good row", value: "reads as a win", tone: "good" },
    { label: "Bad row", value: "reads as a problem", tone: "bad" },
    { label: "Warn row", value: "reads as a caution", tone: "warn" },
  ]);

  writeFileSync(OUT, finishDoc(state));
  console.log(`wrote ${OUT}`);
  console.log(`MIDNIGHT   ${hex(MIDNIGHT)}`);
  console.log(`BRAND_BAR  ${hex(BRAND_BAR)}`);
  console.log(`REEF       ${hex(REEF)}`);
}

main();
