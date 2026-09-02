// Pure checks over the hub skin. No key, no network, no DB, no Slack.
//
// Everything this proves is a rule that decides what renders on a hostname a CLIENT controls,
// so it has to be provable without asking anybody's permission to run it.
//
//   bunx tsx scripts/_probe-hub-skin.ts

import fs from "node:fs";
import path from "node:path";
import {
  readSkin,
  skinStyle,
  skinClass,
  activeSkin,
  skinLine,
  templateMenu,
  isTemplate,
  safeSkinColor,
  safeNumber,
  EMPTY_SKIN,
  HUB_TEMPLATES,
  TEMPLATE_CATALOGUE,
  DEFAULT_TEMPLATE,
  RADIUS_RANGE,
  MEASURE_RANGE,
  BASE_SIZE_RANGE,
} from "../src/lib/hub/skin";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("Colours: hex only, dropped never repaired");
// ─────────────────────────────────────────────────────────────────────────────

ok("a six-digit hex passes", safeSkinColor("#00705F") === "#00705f");
ok("a three-digit hex passes", safeSkinColor("#abc") === "#abc");
ok("whitespace is trimmed", safeSkinColor("  #123456 ") === "#123456");
ok("a named colour is dropped", safeSkinColor("red") === null);
ok("rgb() is dropped", safeSkinColor("rgb(1,2,3)") === null);
ok("var() is dropped", safeSkinColor("var(--x)") === null);
ok("a number is dropped", safeSkinColor(123) === null);

// ‼️ THE ONE THAT MATTERS. Every colour is interpolated into a style attribute, so a value
// carrying a semicolon and a brace could close the declaration and open a new rule.
ok(
  "a CSS breakout is dropped",
  safeSkinColor("red; } .hub-root { display: none } .x {") === null
);
ok("a quote is dropped", safeSkinColor('#fff" onload="x') === null);

// ─────────────────────────────────────────────────────────────────────────────
section("Numbers: refused out of range, never clamped");
// ─────────────────────────────────────────────────────────────────────────────

ok("in range passes", safeNumber(12, 0, 28) === 12);
ok("the low bound is inclusive", safeNumber(0, 0, 28) === 0);
ok("the high bound is inclusive", safeNumber(28, 0, 28) === 28);
ok("above the range is null, NOT clamped", safeNumber(200, 0, 28) === null);
ok("below the range is null, NOT clamped", safeNumber(-5, 0, 28) === null);
ok("NaN is null", safeNumber(Number.NaN, 0, 28) === null);
ok("Infinity is null", safeNumber(Number.POSITIVE_INFINITY, 0, 28) === null);
ok("a numeric string is read", safeNumber("14", 0, 28) === 14);
ok("a non-numeric string is null", safeNumber("wide", 0, 28) === null);

// ─────────────────────────────────────────────────────────────────────────────
section("readSkin: the one gate");
// ─────────────────────────────────────────────────────────────────────────────

ok("null reads as the empty skin", readSkin(null).template === DEFAULT_TEMPLATE);
ok("a string reads as the empty skin", readSkin("clinic").template === DEFAULT_TEMPLATE);
ok("no source reads as default", readSkin({}).source === "default");

// ‼️ CLASS INJECTION. skinClass interpolates the template into a class attribute, so an
// unvalidated value would be a class name somebody else gets to choose.
const evil = readSkin({ template: "document\" onload=\"alert(1)" });
ok("an unknown template falls back to the default", evil.template === DEFAULT_TEMPLATE);
ok(
  "so the class is always one we ship",
  HUB_TEMPLATES.some((t) => skinClass(evil) === `hub-tpl-${t}`)
);
ok("isTemplate refuses an unknown name", !isTemplate("brutalist"));
ok("isTemplate refuses a non-string", !isTemplate(3));

const mixed = readSkin({
  template: "clinic",
  bg: "#FBFAF8",
  fg: "not a colour",
  radius: 14,
  measure: 999,
  baseSize: 17,
  headingFamily: "Georgia, serif",
  source: "screenshot",
  sourceNote: "warm off-white, rounded cards",
});
ok("a good template survives", mixed.template === "clinic");
ok("a good colour survives, lowercased", mixed.bg === "#fbfaf8");
ok("a bad colour beside a good one is dropped alone", mixed.fg === null);
ok("a good number survives", mixed.radius === 14);
ok("a wildly wrong number is dropped, not clamped to the max", mixed.measure === null);
ok("a good font stack survives", mixed.headingFamily === "Georgia, serif");
ok("a known source survives", mixed.source === "screenshot");

ok(
  "a font stack with braces is dropped",
  readSkin({ headingFamily: "Georgia; } body { display:none" }).headingFamily === null
);
ok("an unknown source falls back to default", readSkin({ source: "magic" }).source === "default");
ok(
  "a long sourceNote is capped",
  (readSkin({ sourceNote: "x".repeat(900) }).sourceNote as string).length === 300
);

// ─────────────────────────────────────────────────────────────────────────────
section("skinStyle: custom properties only, nothing else");
// ─────────────────────────────────────────────────────────────────────────────

ok("no skin is an empty object", Object.keys(skinStyle(null)).length === 0);

const full = readSkin({
  template: "bold",
  bg: "#ffffff",
  fg: "#101418",
  muted: "#4d5560",
  faint: "#7f8894",
  rule: "#e1e5ea",
  card: "#fafafa",
  band: "#101418",
  bandFg: "#ffffff",
  headingFamily: "Georgia, serif",
  radius: 10,
  measure: 48,
  baseSize: 17,
});
const style = skinStyle(full) as Record<string, string>;

// ‼️ EVERY KEY IS A CUSTOM PROPERTY. A skin that could set a bare CSS property could set
// `position` or `display` and move or hide the markup, which is the line skin.ts draws.
ok(
  "every key skinStyle writes is a --hub-* custom property",
  Object.keys(style).every((k) => k.startsWith("--hub-"))
);
ok("the units are attached", style["--hub-radius"] === "10px");
ok("measure is rem, not px", style["--hub-measure"] === "48rem");
ok("baseSize is px", style["--hub-base"] === "17px");

// ‼️ NO ACCENT AND NO BODY FONT. Those are the theme's, and a second writer would be a
// precedence puzzle resolved differently in each of the four renderers.
ok("skinStyle never writes --hub-accent", !("--hub-accent" in style));
ok("skinStyle never writes --hub-accent-soft", !("--hub-accent-soft" in style));
ok("skinStyle never writes fontFamily", !("fontFamily" in style));

// A radius of 0 is a real choice (hard corners) and must not be dropped as falsy.
ok("radius 0 is written, not treated as absent", skinStyle(readSkin({ radius: 0 }))["--hub-radius" as never] === ("0px" as never));

// ─────────────────────────────────────────────────────────────────────────────
section("The confirmation gate");
// ─────────────────────────────────────────────────────────────────────────────

const chosen = readSkin({ template: "bold" });
ok("an unconfirmed skin is not active", activeSkin(chosen, null) === null);
ok("a confirmed skin is active", activeSkin(chosen, "2026-09-02T00:00:00Z") !== null);
ok(
  "an inactive skin still renders a shipped class",
  skinClass(activeSkin(chosen, null)) === `hub-tpl-${DEFAULT_TEMPLATE}`
);

// ─────────────────────────────────────────────────────────────────────────────
section("The catalogue and hub.css agree");
// ─────────────────────────────────────────────────────────────────────────────

ok(
  "every template has a catalogue entry",
  HUB_TEMPLATES.every((t) => TEMPLATE_CATALOGUE.some((c) => c.key === t))
);
ok("the catalogue has no extras", TEMPLATE_CATALOGUE.length === HUB_TEMPLATES.length);
ok(
  "every catalogue entry is in the menu",
  TEMPLATE_CATALOGUE.every((t) => templateMenu().includes(`template ${t.key}`))
);

// ‼️ THE STRUCTURAL CHECK THIS FILE EXISTS FOR. A template added to the union with no rules
// in hub.css renders as the default and looks like nothing happened — the shape of bug that
// takes an afternoon to find because every layer reports success.
const css = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "hub", "[host]", "hub.css"),
  "utf8"
);
for (const t of HUB_TEMPLATES) {
  ok(`hub.css carries a .hub-tpl-${t} block`, css.includes(`.hub-tpl-${t}`));
}

// The tokens skinStyle writes have to be declared on .hub-root, or an override resolves
// against nothing and the value is silently ignored by the browser.
for (const key of Object.keys(style)) {
  ok(`hub.css declares ${key} on .hub-root`, css.includes(`${key}:`));
}

// ‼️ NO TEMPLATE MAY HIDE OR MOVE MARKUP. The hub is sold on being crawled and quoted, so a
// template that set `display: none` would delete the product and look like a design choice.
//
// ‼️ COMMENTS ARE STRIPPED FIRST, and a property is only a property at a declaration
// boundary. Both were learned here: the prose above these rules says the words "display" and
// "order", and `border: 1px` contains the literal substring `order: 1`, so the naive greps
// failed on correct CSS. Same discipline as the payment-file grep, which strips comments for
// the same reason.
const templateCss = css.slice(css.indexOf("TEMPLATES")).replace(/\/\*[\s\S]*?\*\//g, "");
const declares = (prop: string, value: string): RegExp =>
  new RegExp(`(^|[\\s;{])${prop}\\s*:\\s*${value}`, "m");

ok("no template sets display:none", !declares("display", "none").test(templateCss));
ok("no template sets visibility:hidden", !declares("visibility", "hidden").test(templateCss));
ok("no template inserts content", !declares("content", '"').test(templateCss));
ok("no template reorders with `order:`", !declares("order", "-?\\d").test(templateCss));

// ─────────────────────────────────────────────────────────────────────────────
section("skinLine says what is stored");
// ─────────────────────────────────────────────────────────────────────────────

ok("the default reads as Document", skinLine(EMPTY_SKIN).includes("Document"));
ok(
  "a screenshot skin says where it came from",
  skinLine(readSkin({ template: "clinic", source: "screenshot", sourceNote: "warm cream" })).includes(
    "warm cream"
  )
);
ok(
  "a named template with no overrides claims no adjustments",
  !skinLine(readSkin({ template: "bold", source: "template" })).includes("Adjusted")
);

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
