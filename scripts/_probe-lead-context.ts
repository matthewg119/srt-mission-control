// Does the lead context know what it holds, and does it refuse to invent the rest?
//
//   bunx tsx --env-file=.env.local scripts/_probe-lead-context.ts
//
// Sections 1 to 6 are pure: they read this repo's own source and a synthetic context. Section 7 reads
// production for one client. Nothing writes, ever.
//
// ‼️ THE CHECKS THAT MATTER ARE THE TWO STRUCTURAL ONES. leadContext exists so that six competing
// assemblies of "what we know about this client" do not become seven, and so that a null meaning
// "never asked" stops being the same value as a null meaning "asked and empty". Both of those are
// properties of the SOURCE, not of one call's output, so both are grepped rather than exercised:
// a test that only ran the happy path would pass on the day somebody added a seventh query.

import { readFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";
import {
  ALL_SLICES,
  CARD_SLICES,
  held,
  isHeld,
  leadContext,
  missing,
  stale,
  type Held,
  type LeadSlice,
} from "@/lib/clients/lead-context";
import { withLeadScope } from "@/lib/clients/lead-scope";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const SRC = readFileSync("src/lib/clients/lead-context.ts", "utf8");
const LINES = SRC.split("\n");

/**
 * The same source with comments blanked out.
 *
 * ‼️ THE GREPS BELOW MUST NOT READ THE DOC COMMENTS. lead-context.ts documents the rules it follows by
 * quoting the very thing it refuses to do, so a grep over the raw text fails on a file that is correct
 * BECAUSE it says so. Newlines are preserved so reported line numbers still point at real lines.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

async function main() {
  // ── 1. It is not a seventh assembly ───────────────────────────────────────
  console.log("\n1. the only table this file selects from");

  // ‼️ client_datasets IS THE WHOLE ALLOWANCE. Nothing else reads the paid-pull cache back, so there
  // is no existing reader to call. Every other table has an owner, and the owner is what gets called.
  const ALLOWED = ["client_datasets"];
  const tables = [...CODE.matchAll(/supabaseAdmin\s*\.\s*from\(\s*["'`]([a-z_]+)["'`]/g)].map((m) => m[1]);
  const strays = [...new Set(tables)].filter((t) => !ALLOWED.includes(t));
  check("no table outside the allowance is queried here", strays.length === 0, strays.join(", "));
  check("it does query the one it owns", tables.includes("client_datasets"));

  // A write here would make a card change the board it is describing.
  const writes = [...CODE.matchAll(/\.\s*(insert|update|upsert|delete|rpc)\s*\(/g)].map((m) => m[1]);
  check("it never writes", writes.length === 0, writes.join(", "));
  check(
    "it does not call reachableCursor, which seeds rows",
    !/reachableCursor\s*\(/.test(CODE),
    "that function writes; board.reachable is the read-only walk"
  );

  // ── 2. No default can be written ──────────────────────────────────────────
  console.log("\n2. a missing field cannot be defaulted");

  // The type does the real work: on the `missing` arm there is no `value` key at all, so
  // `h.value ?? ""` is a compile error rather than a silent empty string.
  const gone = missing("never_asked", "nothing asks for this yet");
  check("a missing Held carries no value key", !("value" in gone));
  check("a missing Held is not reported as held", !isHeld(gone));
  const there = held("srtagency.com", { source: "clients.domain", why: "no domain is on file" });
  check("a present Held carries its value", there.state === "present" && there.value === "srtagency.com");
  const blank = held("   ", { source: "clients.domain", why: "no domain is on file" });
  check("whitespace is empty, not a value", blank.state === "missing");
  const none = held([], { source: "client_offers.terms", why: "no terms" });
  check("an empty array is empty, not a value", none.state === "missing");

  // The escape hatch this design exists to refuse.
  check("there is no unwrap() helper", !/export function unwrap/.test(CODE));
  const coalesced = [...CODE.matchAll(/\.value\s*\?\?/g)].length;
  check("no .value is coalesced away", coalesced === 0, `${coalesced} sites`);

  // ── 3. Staleness is only claimed where it is computable ───────────────────
  console.log("\n3. stale is never a guess");

  // ‼️ AN AGE THRESHOLD WOULD BE AN INVENTED NUMBER. Staleness may only be claimed where a stored
  // fingerprint, a supersession column, an expiry or a completion ordering makes it a fact.
  const SIGNALS = ["supersededAt", "offerFingerprint", "documentFingerprint", "fingerprints", "expiresAt", "completedAt"];
  const staleSites: number[] = [];
  const CODE_LINES = CODE.split(/\r?\n/);
  CODE_LINES.forEach((l, i) => {
    if (/(?:^|[^a-zA-Z])stale\(/.test(l) && !/^export function stale/.test(l)) staleSites.push(i);
  });
  check("stale() is actually called", staleSites.length > 0);
  for (const i of staleSites) {
    const window = LINES.slice(Math.max(0, i - 12), i + 12).join("\n");
    const signal = SIGNALS.find((s) => window.includes(s));
    check(`line ${i + 1} claims stale from a real signal`, Boolean(signal), "no fingerprint, supersession or expiry nearby");
  }

  // ── 4. Slices ─────────────────────────────────────────────────────────────
  console.log("\n4. slices");

  const all = new Set<string>(ALL_SLICES);
  const cardOutside = CARD_SLICES.filter((s) => !all.has(s));
  check("every card slice is a real slice", cardOutside.length === 0, cardOutside.join(", "));
  const declared = [...(SRC.match(/export type LeadSlice =([^;]+);/)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  const notListed = declared.filter((d) => !all.has(d));
  check("ALL_SLICES lists every declared slice", notListed.length === 0, notListed.join(", "));

  // ── 5. The copy ───────────────────────────────────────────────────────────
  console.log("\n5. what it says");

  const whys = [...SRC.matchAll(/why:\s*"([^"]+)"/g)].map((m) => m[1]);
  check("every field explains itself", whys.length > 10, `${whys.length}`);
  const dashed = whys.filter((w) => w.includes("—"));
  check("no em dash in any reason", dashed.length === 0, dashed[0] ?? "");
  const shouty = whys.filter((w) => w.length > 160);
  check("no reason is longer than a card line", shouty.length === 0, shouty[0]?.slice(0, 40) ?? "");

  // ── 6. This probe does not pin an id ──────────────────────────────────────
  console.log("\n6. the probe itself");

  const self = readFileSync("scripts/_probe-lead-context.ts", "utf8");
  const uuids = self.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  // SRT has been re-onboarded twice and every id written down for it in this repo is dead.
  check("no client id is pinned in this file", uuids.length === 0, uuids[0] ?? "");

  // ── 7. Live ───────────────────────────────────────────────────────────────
  console.log("\n7. against the real client");

  const { data: srt } = await supabaseAdmin.from("clients").select("id").eq("slug", "srt-agency-llc").maybeSingle();
  if (!srt) {
    check("srt-agency-llc resolves", false, "no row for that slug");
    done();
    return;
  }
  check("srt-agency-llc resolves", true);
  const clientId = (srt as { id: string }).id;

  // ‼️ THE QUERY BUDGET IS MEASURED, NOT ASSERTED IN A COMMENT. A card that quietly became twenty
  // round trips would still pass every other check in this file.
  const origFrom = supabaseAdmin.from.bind(supabaseAdmin);
  let hits: string[] = [];
  (supabaseAdmin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    hits.push(t);
    return origFrom(t as never);
  };

  hits = [];
  const card = await leadContext(clientId);
  const cardReads = hits.length;
  // ‼️ MEASURED 2026-09-17 AT 14, AND THE CEILING IS THE MEASUREMENT PLUS ONE. Not an aspiration: a
  // budget nobody can meet gets raised until it means nothing. Six of the fourteen are known
  // duplicates, and they are owed work rather than accidents:
  //   client_audiences twice - loadOffer resolves the primary audience itself
  //   client_offers    twice - loadOffer, then loadOfferForAudience for the same audience
  //   avatar_briefs    three - lead-context reads the brief, completenessFor's avatarState reads it again
  // Removing them means teaching loadOffer and avatarState to take what they need as parameters, the
  // same lever CompletenessInputs already is. Until then this holds the line at fourteen.
  check("a card context stays within its budget", cardReads <= 15, `${cardReads} selects: ${hits.join(", ")}`);
  console.log(`        card slices read ${cardReads} times`);

  hits = [];
  const full = await leadContext(clientId, { include: ALL_SLICES });
  const fullReads = hits.length;
  check("a full context stays within its budget", fullReads <= 24, `${fullReads} selects`);
  console.log(`        all slices read ${fullReads} times`);

  // The scope memoizes a unit of work; outside one, every call is a real read.
  hits = [];
  await withLeadScope(async () => {
    await leadContext(clientId);
    await leadContext(clientId);
    await leadContext(clientId);
  });
  const scoped = hits.length;
  check("three reads in one scope cost one", scoped <= cardReads, `${scoped} vs ${cardReads} for one`);

  (supabaseAdmin as unknown as { from: unknown }).from = origFrom;

  // ── The tri-state, on the one client that has data ──
  check("the context knows which slices it loaded", card.loaded.has("core") && !card.loaded.has("history"));
  check("a healthy read reports no errors", full.readErrors.length === 0, full.readErrors.join(" | "));

  // SRT holds deep_research and awareness_ladder, and nothing else. Two nulls, two different facts.
  const dr = full.documents.deep_research;
  const sheet = full.documents.avatar_sheet;
  check("the research on file is held", isHeld(dr), describe(dr));
  check("the avatar sheet is missing", sheet.state === "missing", describe(sheet));
  check(
    "and it is missing because nobody answered, not because nobody asked",
    sheet.state === "missing" && sheet.because === "asked_unanswered",
    describe(sheet)
  );

  // A slice nobody asked for is unknown, never absent.
  check(
    "an unloaded slice is unreadable, not missing-because-empty",
    card.history.state === "missing" && card.history.because === "unreadable",
    describe(card.history)
  );

  // ‼️ unreadable MUST BE REACHABLE, or the state is decorative. A select against a column that does
  // not exist is the real shape of this failure, and supabase-js RETURNS it rather than throwing.
  const { error: broken } = await supabaseAdmin.from("audience_documents").select("no_such_column").limit(1);
  check("a bad select returns an error rather than throwing", Boolean(broken), "it threw or succeeded");

  console.log(`\n        ${full.identity.name}: ${full.audiences.length} audience(s), ${full.offers.length} offer(s)`);
  console.log(`        board cursor: ${full.board.cursor.state === "present" ? full.board.cursor.value : "none"}`);
  console.log(`        keywords: ${describe(full.keywords)}`);
  console.log(`        audits:   ${describe(full.audits)}`);
  console.log(`        research: ${describe(full.research)}`);
  console.log(`        beliefs:  ${describe(full.beliefs)}`);

  done();
}

function describe<T>(h: Held<T>): string {
  if (h.state === "missing") return `missing (${h.because})`;
  const v = h.value;
  const n = Array.isArray(v) ? `${v.length} row(s)` : typeof v === "object" && v ? "held" : String(v).slice(0, 40);
  return `${h.state}: ${n}`;
}

function done(): void {
  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
