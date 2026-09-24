// ONE AGENT, TWO SURFACES, AND NO SHARED FILE. Executable.
//
//   bun --no-env-file run scripts/_probe-virtual-agent-grammar.ts
//
// The Virtual Agent exists in two places that cannot share code:
//
//   src/app/hub/[host]/hub.css          the review tool's panel. React, the app bundle, the
//                                       client's own skin tokens.
//   src/app/w/[slug]/route.ts           the concierge widget. A hand-written HTML string on
//                                       another origin, no bundle, no imports, deliberately so:
//                                       nothing in this app may end up on a client's website.
//
// Matthew wants ONE product he can put on a client's whole site and charge for. Two independently
// styled chat panels is two products, and the drift would arrive one reasonable edit at a time.
// So they share the VOCABULARY and nothing else: the same class names, the same token names, in
// both files. This probe fails when one grows a name the other does not have.
//
// ‼️ IT DOES NOT COMPARE THE VALUES, AND THAT IS THE POINT OF THE ARRANGEMENT. They must differ.
// The widget is SRT's product and carries SRT's accent as a literal; the review panel resolves
// --va-accent to var(--hub-accent) so it carries the CLIENT's. A probe that asserted the values
// matched would be asserting the opposite of the design.
//
// ‼️ AND THE CHROME MUST STAY THE AGENT'S. The last check is the one with teeth: a .va-* rule in
// hub.css may read --hub-accent and --hub-on-accent and NOTHING ELSE. The moment one reads
// --hub-bg or --hub-heading-family, the panel starts dissolving into whatever site it is on, and
// the thing being sold stops being recognisable from one client to the next.

import fs from "node:fs";
import path from "node:path";

const CSS = "src/app/hub/[host]/hub.css";
const FRAME = "src/app/w/[slug]/route.ts";

/**
 * The classes both surfaces must carry.
 *
 * Not every .va-* class is here. `va-shell`, `va-scrim`, `va-mic`, `va-skip` and `va-connecting`
 * belong to the review panel alone, because the widget IS the panel and has no page behind it, no
 * microphone and no handover. `va-att`, `va-slot`, `va-dots` and `va-progress` belong to the
 * widget alone. This list is the shape a person recognises across both: a header with an avatar,
 * bubbles from two sides, a typing indicator, chips, and a composer.
 */
const SHARED_CLASSES = [
  "va-panel",
  "va-head",
  "va-avatar",
  "va-title",
  "va-msgs",
  "va-msg",
  "va-typing",
  "va-chips",
  "va-chip",
  "va-composer",
  "va-bar",
  "va-send",
] as const;

/** The state modifiers, which are as much of the grammar as the nouns are. */
const SHARED_MODIFIERS = ["is-them", "is-her", "is-pair"] as const;

/** The eight custom properties. Declared in both, with values that must not match. */
const SHARED_TOKENS = [
  "--va-bg",
  "--va-ink",
  "--va-mut",
  "--va-line",
  "--va-card",
  "--va-radius",
  "--va-accent",
  "--va-on-accent",
] as const;

/** The only two client tokens a .va-* rule may read. */
const ALLOWED_HUB_TOKENS = ["--hub-accent", "--hub-on-accent"];

let failures = 0;

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

const css = read(CSS);
const frame = read(FRAME);

// ── 1. Both surfaces carry every shared name. ───────────────────────────────
for (const name of [...SHARED_CLASSES, ...SHARED_MODIFIERS]) {
  const inCss = css.includes(`.${name}`);
  const inFrame = frame.includes(name);
  check(
    inCss && inFrame,
    `${name} exists in both surfaces`,
    inCss && inFrame ? undefined : `hub.css: ${inCss ? "yes" : "NO"}, widget: ${inFrame ? "yes" : "NO"}`
  );
}

// ── 2. Both DECLARE every shared token. ─────────────────────────────────────
//
// Declared, not merely mentioned: a surface that reads --va-accent without declaring it resolves
// against nothing and the browser silently drops the rule.
for (const token of SHARED_TOKENS) {
  const declared = (src: string) => new RegExp(`${token}\\s*:`).test(src);
  const inCss = declared(css);
  const inFrame = declared(frame);
  check(
    inCss && inFrame,
    `${token} is declared in both surfaces`,
    inCss && inFrame ? undefined : `hub.css: ${inCss ? "yes" : "NO"}, widget: ${inFrame ? "yes" : "NO"}`
  );
}

// ── 3. The accent comes from opposite places, on purpose. ───────────────────
check(
  /--va-accent:\s*var\(--hub-accent\)/.test(css),
  "the review panel takes its accent from the client",
  "--va-accent resolves to var(--hub-accent), so the panel is theirs where it should be"
);
check(
  /--va-accent:\s*#[0-9a-fA-F]{3,8}/.test(frame),
  "the widget's accent is a literal",
  "it is SRT's product on SRT's terms and has no client skin to read"
);

// ── 4. The chrome stays the agent's. ────────────────────────────────────────
//
// The check with teeth. Every .va-* rule in hub.css, and what it is allowed to reach for.
const bodies: Array<{ selector: string; body: string }> = [];
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  bodies.push({ selector: m[1].trim(), body: m[2] });
}
const leaks: string[] = [];
for (const rule of bodies) {
  if (!/(^|[\s,>+~])\.va-/.test(rule.selector)) continue;
  for (const use of rule.body.matchAll(/var\(\s*(--hub-[a-z-]+)/g)) {
    if (!ALLOWED_HUB_TOKENS.includes(use[1])) leaks.push(`${rule.selector} reads ${use[1]}`);
  }
}
check(
  leaks.length === 0,
  "no .va-* rule reads a client token other than the accent",
  leaks.length
    ? leaks.join(" | ")
    : "ground, bubbles, avatar and hairlines are the same on every client, which is what makes it one product"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed. The two surfaces have drifted.`);
  process.exit(1);
}
console.log("All checks passed. One agent, two surfaces, same grammar.");

export {};
