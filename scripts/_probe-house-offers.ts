// Are the house offers the ONLY offers, and can nothing mint a new one?
//
// Run:
//   bun run scripts/_probe-house-offers.ts                            (pure, offline)
//   bun run --env-file=.env.local scripts/_probe-house-offers.ts --live   (adds the table checks)
//
// ‼️ THIS REPLACED _probe-magnet-drafts.ts, AND IT ASSERTS THE OPPOSITE INVARIANT. That probe
// proved the per-page magnet lane worked: five candidates per page, one approved, minted into
// lead_magnets with the right scope. The lane was removed on 2026-09-29 because a page does not
// get its own invented offer, so the thing worth checking inverted: nothing in src/ may write to
// lead_magnets at all, and the rows that remain must be the house offers.
//
// It is a SOURCE GREP for the same reason the Day 0 wall and the quality gate use greps: the
// property is "no code path does X", and the only way to check that is to read the code as text.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = walk("src");

/** Source with comments stripped, so a rule QUOTED in a comment never satisfies or breaks a check. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ── 1. ‼️ NOTHING IN src/ WRITES TO lead_magnets ────────────────────────────
//
// The table is seeded by docs/2026-09-29-tool-lane.sql and edited by hand. The day this check
// goes red, per-page invention has come back under a new name.
section("1. nothing in src/ writes to lead_magnets");

const WRITE_VERBS = /\.(insert|upsert|update|delete)\s*\(/;
const offenders: string[] = [];

for (const f of FILES) {
  const src = code(f);
  // Find each `.from("lead_magnets")` and look at what is chained onto it.
  for (const m of src.matchAll(/\.from\(\s*["'`]lead_magnets["'`]\s*\)([\s\S]{0,120})/g)) {
    if (WRITE_VERBS.test(m[1])) offenders.push(`${f}: ${m[1].trim().slice(0, 60)}`);
  }
}

ok("no insert, upsert, update or delete against lead_magnets", offenders.length === 0, offenders.join(" | "));

// ── 2. The minting lane is gone, by name ────────────────────────────────────
section("2. the minting lane is gone, by name");

const GONE = [
  "approveMagnetCandidate",
  "draftMagnetsForPage",
  "draftMagnetsForClient",
  "draftMagnetsForPlan",
  "stageFrameCandidate",
  "rejectAllDrafts",
  "draftsForPage",
  "draftsByPageFor",
  "draftsForClient",
  "page_magnet_candidates",
];

for (const name of GONE) {
  const hits = FILES.filter((f) => code(f).includes(name));
  ok(`\`${name}\` appears in no live code path`, hits.length === 0, hits.join(", "));
}

ok(
  "src/lib/concierge/magnet-drafts.ts is deleted",
  !FILES.some((f) => f.replace(/\\/g, "/").endsWith("src/lib/concierge/magnet-drafts.ts"))
);

// ── 3. What survived it still exists ────────────────────────────────────────
//
// anchorFor, readFrame, CTA_MAX and PlannedFrame were never part of the minting lane and are read
// by six modules. Deleting the module they lived in must not have taken them with it.
section("3. what survived the deletion still exists");

const ANCHOR = "src/lib/concierge/magnet-anchor.ts";
const anchorSrc = readFileSync(ANCHOR, "utf8");
for (const name of ["CTA_MAX", "PlannedFrame", "readFrame", "anchorFor"]) {
  ok(`magnet-anchor exports ${name}`, new RegExp(`export (async function|function|interface|const) ${name}\\b`).test(anchorSrc));
}
ok("CTA_MAX is still 28", /export const CTA_MAX = 28;/.test(anchorSrc));
ok(
  "magnet-anchor itself writes nothing",
  !WRITE_VERBS.test(anchorSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))
);

// ── 4. The page pointer survived, which is the mechanism that did not change ─
section("4. the per-page pointer survived");

const pagesSrc = code("src/lib/hub/pages.ts");
ok("setPageMagnet still exists", /export async function setPageMagnet/.test(pagesSrc));
ok(
  "client_pages.lead_magnet_key is still read somewhere",
  FILES.some((f) => code(f).includes("lead_magnet_key"))
);

// ── 5. Live: the house offers, and only the house offers ────────────────────
async function live(): Promise<void> {
  section("5. LIVE: the house offers, and only the house offers");

  const { supabaseAdmin } = await import("../src/lib/db");
  const { data, error } = await supabaseAdmin
    .from("lead_magnets")
    .select("magnet_key, audience, title, cta_label, client_id, vertical, treatment, category, active");

  if (error) {
    ok("lead_magnets is readable", false, error.message);
    return;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  ok("there are rows", rows.length > 0, `${rows.length}`);

  // ‼️ THE WHOLE POINT. A house offer is client-null and vertical-null, which is rung zero: it
  // matches every query and adds no weight, so it catches whatever nothing more specific claims.
  // A row scoped to a client or a vertical is, by definition, something invented for one of them.
  const scoped = rows.filter((r) => r.client_id !== null || r.vertical !== null);
  ok("no row is scoped to a client or a vertical", scoped.length === 0, scoped.map((r) => r.magnet_key).join(", "));

  // The same table-wide rules _probe-concierge-lane.ts §9 and §9b enforce, checked here too so a
  // house offer that breaks them is caught by the probe that OWNS them rather than by a lane
  // probe that happens to read the same table.
  const active = rows.filter((r) => r.active === true);
  ok("at least one offer is active", active.length > 0);

  for (const r of active) {
    const label = String(r.cta_label ?? "").trim() || String(r.title ?? "");
    ok(`"${label}" is within the pill budget`, label.length <= 28, `${label.length} chars`);
    for (const field of ["title", "promise", "cta_label", "concierge_entry"] as const) {
      const v = r[field];
      if (typeof v === "string") {
        ok(`${r.magnet_key}.${field} carries no banned dash`, !v.includes("—"), v);
      }
    }
  }

  // Both lanes have somewhere to hand over to, or a page of that audience offers nothing.
  for (const audience of ["owner", "patient"] as const) {
    ok(
      `the ${audience} lane has a house offer`,
      active.some((r) => r.audience === audience),
      "none"
    );
  }

  // page_magnet_candidates is dropped by the migration. A live table with no code is the
  // "reader with no writer" shape this repo records five other instances of, inverted.
  const { error: candErr } = await supabaseAdmin.from("page_magnet_candidates").select("id").limit(1);
  ok("page_magnet_candidates no longer exists", candErr !== null, candErr ? "" : "the table is still there");
}

async function main(): Promise<void> {
  if (process.argv.includes("--live")) {
    try {
      await live();
    } catch (e) {
      ok("the live half ran", false, (e as Error).message);
    }
  } else {
    console.log("\n(pure half only. Add --env-file=.env.local and --live for the table checks.)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
