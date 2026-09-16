// The universes change the look and never the semantics. No network.
//
//   bunx tsx scripts/_probe-hub-universes.ts

import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { UniverseBand, UniverseTop } from "../src/components/hub/universe-chrome";
import { HUB_UNIVERSES, UNIVERSES, threeUniverses, axesOfRead } from "../src/lib/hub/universes";
import { hubRootClass, readSkin } from "../src/lib/hub/skin";
import { hasBannedDash } from "../src/lib/copy-guard";

// The JSX in src/components is compiled by tsx's classic transform, which expects React in scope.
(globalThis as unknown as { React: unknown }).React = React;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src/app/hub/[host]/universes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// 1. The chrome: decoration only.
for (const u of HUB_UNIVERSES) {
  const html =
    renderToStaticMarkup(createElement(UniverseTop, { universe: u, name: "Acme Med Spa", where: "Greensboro, NC", pages: 6 })) +
    renderToStaticMarkup(createElement(UniverseBand, { universe: u, name: "Acme Med Spa", where: null, pages: 6 }));
  check(`${u}: chrome has no heading`, !/<h[1-6]/i.test(html));
  check(`${u}: chrome has no link`, !/<a[\s>]/i.test(html));
  check(`${u}: chrome carries no JSON-LD`, !/ld\+json/i.test(html));
  check(`${u}: chrome is aria-hidden`, (html.match(/aria-hidden="true"/g) ?? []).length === 2);
  check(`${u}: chrome text has no dash`, !hasBannedDash(html.replace(/<[^>]+>/g, " ")));
  check(`${u}: every rule block exists in universes.css`, css.includes(`.hub-u-${u} `) || css.includes(`.hub-u-${u}\n`));
}
check("an uncounted page total prints nothing", !renderToStaticMarkup(createElement(UniverseTop, { universe: "noir", name: "A", where: null, pages: -1 })).includes("answer"));

// 2. The stylesheet never hides or removes a semantic element, and content: lives only on pseudo elements.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const semantic = /(h1|h2|h3|\.hub-head|\.hub-list|\.hub-nap|\.hub-answer|\.hub-lede|\.hub-eyebrow|\.hub-q|\.hub-links|\.hub-part)/;
for (const r of rules) {
  if (semantic.test(r.sel) && !/::(before|after)|::first-letter/.test(r.sel)) {
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/.test(r.body)) check(`never hides: ${r.sel}`, false, r.body.trim());
    if (/(^|;)\s*order\s*:/.test(r.body)) check(`never reorders with order: ${r.sel}`, false);
  }
  if (/(^|;|\s)content\s*:/.test(r.body) && !/::(before|after)/.test(r.sel)) check(`content: only on a pseudo element: ${r.sel}`, false);
  if (/content\s*:/.test(r.body) && (r.body.includes(String.raw`\2014`) || r.body.includes("—"))) check(`no dash glyph as an ornament: ${r.sel}`, false);
}
check("universe rules are scoped to two classes", rules.filter((r) => r.sel.includes("hub-u-")).every((r) => r.sel.split(",").every((s) => !s.includes("hub-u-") || s.trim().startsWith(".hub-root.hub-u") || s.trim().startsWith("body:has"))));

// 3. The class is gated.
check("an unknown universe never reaches a class", !hubRootClass(readSkin({ universe: "x onload=alert(1)" })).includes("hub-u"));
check("a known universe does", hubRootClass(readSkin({ universe: "blueprint" })).includes("hub-u-blueprint"));
check("six universes, all described", UNIVERSES.length === 6 && UNIVERSES.every((u) => u.blurb.length > 20 && !hasBannedDash(u.blurb)));
const three = threeUniverses(axesOfRead({ bg: "#ffffff", headingFace: "serif-book" }));
check("three distinct universes for a reference", new Set(three).size === 3, three.join(","));

// 4. Sample text never reaches a client's own domain.
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const live = walk(path.join(root, "src/app/hub/[host]")).filter((f) => /\.(tsx?|css)$/.test(f));
check("nothing under src/app/hub/[host] imports the lorem ipsum pages", !live.some((f) => fs.readFileSync(f, "utf8").includes("ghost-content")));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall universe checks pass");
