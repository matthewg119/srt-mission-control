// Pure checks over the skin's shape traits and faces. No key, no network, no DB, no Slack.
//
//   bunx tsx scripts/_probe-hub-traits.ts
//
// ‼️ THE CHECK THIS FILE EXISTS FOR IS THE LAST ONE: the markup is byte-identical under any skin.
// The screenshot lane was widened on 2026-09-11 to carry fonts, a masthead, a navigation style and
// a background. The hub is sold on its JSON-LD, its single <h1> and its NAP block, and none of
// that may move because somebody pasted a nice-looking page. A skin changes .hub-root's class and
// style and nothing inside it, so the bodies must render the same string whatever skin is on.
//
// Separate from _probe-hub-skin.ts, which is not edited: its template and forbidden-declaration
// checks already cover the trait rules, because they sit below hub.css's TEMPLATES banner.

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HubIndexBody,
  HubAnswerBody,
  HubReplicaBody,
  HubReplicaIndexBody,
} from "../src/components/hub/hub-bodies";
import {
  readSkin,
  skinClass,
  skinTraits,
  hubRootClass,
  EMPTY_SKIN,
  SKIN_TRAITS,
  type StoredSkin,
} from "../src/lib/hub/skin";
import { HUB_FACES, FACE_STACKS } from "../src/lib/hub/faces";
import { safeFontFamily } from "../src/lib/hub/theme";
import type { HubClient } from "../src/lib/hub/resolve";

// tsconfig sets jsx:"preserve" for Next, so tsx compiles the components with the classic
// transform and expects React in scope. Same shim as _probe-hub-skin-live.ts.
(globalThis as unknown as { React: unknown }).React = React;

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("Every trait value has a rule a person wrote");
// ─────────────────────────────────────────────────────────────────────────────

const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "hub", "[host]", "hub.css"), "utf8");

// A value in the union with no rule renders as nothing and looks like the model chose badly,
// which is the afternoon-long kind of bug _probe-hub-skin.ts's template check exists to prevent.
for (const t of SKIN_TRAITS) {
  for (const v of t.values) {
    ok(`hub.css carries .hub-root.${t.prefix}-${v}`, css.includes(`.hub-root.${t.prefix}-${v}`));
  }
}

// Restated here for the trait block alone, so a future edit that moves it above the TEMPLATES
// banner (out of _probe-hub-skin.ts's scan) is still caught.
const traitCss = css.slice(css.indexOf("SHAPE TRAITS")).replace(/\/\*[\s\S]*?\*\//g, "");
const declares = (prop: string, value: string): RegExp =>
  new RegExp(`(^|[\\s;{])${prop}\\s*:\\s*${value}`, "m");
ok("the trait block exists", css.indexOf("SHAPE TRAITS") > css.indexOf("TEMPLATES"));
ok("no trait sets display:none", !declares("display", "none").test(traitCss));
ok("no trait sets visibility:hidden", !declares("visibility", "hidden").test(traitCss));
ok("no trait inserts content", !declares("content", '"').test(traitCss));
ok("no trait reorders with `order:`", !declares("order", "-?\\d").test(traitCss));
ok("no trait positions anything out of flow", !declares("position", "(absolute|fixed)").test(traitCss));
// ‼️ A BACKGROUND IS GENERATED, NEVER FETCHED. The only url() allowed is our own inline SVG, and
// it is removed WHOLE before looking, because the SVG carries its own `filter='url(%23n)'` inside
// the data URI, which a lookahead on the outer url( counts as a second, external one.
const urls = traitCss.replace(/url\("data:image\/svg\+xml[^"]*"\)/g, "").match(/url\(/g) ?? [];
ok("no trait loads an image from anywhere", urls.length === 0, `${urls.length} external url()`);

// ─────────────────────────────────────────────────────────────────────────────
section("Traits are gated and only ever produce classes we ship");
// ─────────────────────────────────────────────────────────────────────────────

for (const t of SKIN_TRAITS) {
  const bad = readSkin({ [t.field]: `${t.values[0]}" onload="alert(1)` }) as unknown as Record<string, unknown>;
  ok(`an injected ${t.field} is refused`, bad[t.field] === null);
}

const maximal = readSkin({
  template: "bold",
  nav: "pill",
  hero: "split",
  surface: "dots",
  headingScale: "display",
  headingWeight: "medium",
  headingTracking: "tight",
  headingFace: "system",
  labelFace: "mono",
  bg: "#0a0a0a",
  fg: "#ffffff",
});
ok("skinClass still returns exactly the template class", skinClass(maximal) === "hub-tpl-bold");
const classes = hubRootClass(maximal).split(" ");
const shipped = new Set([
  "hub-root",
  "hub-tpl-bold",
  ...SKIN_TRAITS.flatMap((t) => t.values.map((v) => `${t.prefix}-${v}`)),
]);
ok("every class on the root is one hub.css has a rule for", classes.every((c) => shipped.has(c)), classes.join(" "));
ok("a skin that skipped readSkin still cannot write a class", !skinTraits({ ...EMPTY_SKIN, nav: "x y" as never }).includes("x"));

// ─────────────────────────────────────────────────────────────────────────────
section("Faces are code-owned stacks that survive the theme's gate");
// ─────────────────────────────────────────────────────────────────────────────

for (const f of HUB_FACES) {
  ok(`the ${f} stack passes safeFontFamily unchanged`, safeFontFamily(FACE_STACKS[f]) === FACE_STACKS[f]);
}

// ─────────────────────────────────────────────────────────────────────────────
section("THE MARKUP IS BYTE-IDENTICAL UNDER ANY SKIN");
// ─────────────────────────────────────────────────────────────────────────────

const client = (skin: StoredSkin | null): HubClient => ({
  id: "c",
  displayName: "SRT Agency",
  legalName: "SRT Agency LLC",
  domain: "srtagency.com",
  website: "https://srtagency.com",
  addressLine1: "100 Main St",
  addressLine2: null,
  city: "Greensboro",
  state: "NC",
  postalCode: "27401",
  phone: "(336) 833-2303",
  email: null,
  hours: null,
  language: "en",
  reviewDestinationPrimary: null,
  reviewWorkflow: null,
  theme: { logoUrl: "https://srtagency.com/logo.svg", accent: null, accentSoft: null, fontFamily: null },
  skin,
});

const host = "learn.srtagency.com";
const pages = [{ id: "1", slug: "a", title: "A question", question: "A question, asked" }];
const answer = { slug: "a", title: "A question", question: "A question, asked", answerMd: "## Why\n\nBecause.", publishedAt: "2026-09-11T00:00:00Z" };
const replica = [
  { id: "r0", path: "", navLabel: "Home", title: "Home", bodyMd: "Welcome." },
  { id: "r1", path: "about", navLabel: "About", title: "About", bodyMd: "Us." },
];
const href = (p: string) => `/x/${p}`;

const render = (skin: StoredSkin | null) => ({
  index: renderToStaticMarkup(React.createElement(HubIndexBody, { client: client(skin), host, pages })),
  answer: renderToStaticMarkup(React.createElement(HubAnswerBody, { client: client(skin), host, page: answer })),
  replica: renderToStaticMarkup(
    React.createElement(HubReplicaBody, { client: client(skin), page: replica[1], pages: replica, href })
  ),
  replicaIndex: renderToStaticMarkup(
    React.createElement(HubReplicaIndexBody, { client: client(skin), home: replica[0], pages: replica, href })
  ),
});

const plain = render(null);
const dressed = render(maximal);
for (const k of Object.keys(plain) as Array<keyof typeof plain>) {
  ok(`${k}: identical markup under the default and a maximal skin`, plain[k] === dressed[k]);
  ok(`${k}: exactly one h1`, (dressed[k].match(/<h1/g) ?? []).length === 1);
}
ok("the index still carries LocalBusiness JSON-LD", dressed.index.includes("application/ld+json"));
ok("the answer still carries its JSON-LD", dressed.answer.includes("application/ld+json"));
ok("the index still carries the NAP block", dressed.index.includes('class="hub-nap"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
