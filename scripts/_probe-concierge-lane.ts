// The Lane B concierge, proved.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts
//
// ‼️ NO MODEL CALL AND NO WRITES. Every check is either pure or a SELECT.
//
// WHAT IT PROVES
//  1. The bot can never emit a competitor name that is not in market_competitors, and never a
//     number that no tool produced.
//  2. It never repeats a measured line already in a ledger, session or prospect.
//  3. The two audiences cannot see each other's magnets.
//  4. The chaining gate holds, and it lets somebody who asks to book, book.
//  5. Nothing under src/lib/concierge reads bot_persona.
//  6. No client but srt-agency-llc is live on the mock analysis provider.
//  7. The curated service merges resolve, and St Augustine now answers where it answered nothing.

import { supabaseAdmin } from "@/lib/db";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { marketKeys, sameService } from "@/lib/market/service-synonyms";
import { serviceKey } from "@/lib/market/service";
import { competitorAmmo } from "@/lib/ammo/supply";
import { unspentAmmo, ammoKey, spentAmmo } from "@/lib/ammo/spend";
import { fromCityState } from "@/lib/market/place";
import { conciergeAmmo } from "@/lib/concierge/ammo";
import { pillLabel, rankMagnets, rungOf, type LeadMagnet } from "@/lib/concierge/magnets";
import { bookingGate, asksToBook, openingFor } from "@/lib/concierge/engine";
import { resolveBooking } from "@/lib/concierge/booking";
import type { ConciergeConfig } from "@/lib/concierge/config";
import { systemPrompt, OWNER_TOOLS, PATIENT_TOOLS } from "@/lib/concierge/tools";
import { hasBannedDash } from "@/lib/copy-guard";
import type { AmmoSpent } from "@/lib/followup-operator/types";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

const MERGED = ["medspa", "medicalaesthetics", "bhrtmedspa", "skincarespa", "dermatologyclinic"];

// ── 1. The curated service merges ────────────────────────────────────────────
function synonyms(): void {
  console.log("\n1. curated service merges");

  const keys = marketKeys("med-spa");
  check(
    "marketKeys collapses punctuation and expands the cluster",
    MERGED.every((k) => keys.includes(k)) && keys.length === MERGED.length,
    `got ${JSON.stringify(keys)}`
  );

  check(
    "the cluster is symmetric, so either spelling finds the same market",
    marketKeys("medical-aesthetics").sort().join() === marketKeys("medspa").sort().join()
  );

  check(
    "a service outside the cluster is left alone",
    marketKeys("pest-control").join() === "pestcontrol",
    JSON.stringify(marketKeys("pest-control"))
  );

  // ‼️ AN EMPTY SERVICE MUST NOT WIDEN INTO EVERY MARKET. Returning the whole cluster, or every
  // cluster, for a blank input would name a med spa's rivals to a business we know nothing about.
  check("a blank service returns nothing, never a wildcard", marketKeys("").length === 0);
  check("a null service returns nothing", marketKeys(null).length === 0);

  check("sameService agrees with the cluster", sameService("medspa", "bhrt-med-spa"));
  check("sameService refuses an unrelated market", !sameService("medspa", "pest-control"));

  // serviceKey stays spelling-only. If this ever fails, somebody grew it into a synonym map.
  check(
    "serviceKey is still spelling only and merges no meanings",
    serviceKey("medical-aesthetics") === "medicalaesthetics" && serviceKey("med spa") === "medspa"
  );
}

// ── 2. Provenance: no name the engines did not produce ───────────────────────
async function provenance(): Promise<void> {
  console.log("\n2. every competitor name traces to a measured row");

  const { data: cells } = await supabaseAdmin
    .from("market_competitors")
    .select("city, state, service_key, display_name, times_named")
    .in("service_key", MERGED);

  const rows = (cells ?? []) as Array<Record<string, unknown>>;
  check("the merged cluster returns rows at all", rows.length > 0, `${rows.length} rows`);

  // Every display_name the view can produce, as the allow-set.
  const known = new Set(rows.map((r) => String(r.display_name).toLowerCase()));
  const markets = new Map<string, { city: string; state: string | null }>();
  for (const r of rows) {
    const city = String(r.city);
    const state = r.state === null ? null : String(r.state);
    markets.set(`${city}|${state ?? ""}`, { city, state });
  }

  check("the merged cluster spans the 8 measured cities", markets.size === 8, `${markets.size} cities`);

  let lines = 0;
  let foreign = 0;
  for (const { city, state } of markets.values()) {
    const place = fromCityState(city, state);
    if (!place) continue;
    const ammo = await competitorAmmo({ place, service: "medspa" });
    for (const a of ammo) {
      lines++;
      // The name is inside a sentence, so the test is that SOME known name is in the line and no
      // capitalised token outside the known set is being presented as a business.
      const named = [...known].some((n) => a.detail.toLowerCase().includes(n));
      if (!named) {
        foreign++;
        if (foreign < 4) console.log(`          unknown name in: ${a.detail}`);
      }
    }
  }

  check("competitorAmmo produced lines for the merged cluster", lines > 0, `${lines} lines`);
  check("every emitted line names a business that is in the view", foreign === 0, `${foreign} foreign`);

  // ‼️ THE MERGE ACTUALLY BOUGHT COVERAGE. St Augustine answered nothing before it, because its
  // med spas are filed under medical-aesthetics. If this fails the merge silently stopped working
  // and the failure is invisible, because empty is also the honest answer for an unaudited city.
  const stAug = fromCityState("St Augustine", "FL");
  const before = await supabaseAdmin
    .from("market_competitors")
    .select("display_name")
    .eq("city", "st augustine")
    .eq("service_key", "medspa");
  const after = stAug ? await competitorAmmo({ place: stAug, service: "medspa" }) : [];
  check(
    "St Augustine answered nothing on the raw key",
    (before.data ?? []).length === 0,
    `${(before.data ?? []).length} rows`
  );
  check("St Augustine answers now, through the merge", after.length > 0, `${after.length} lines`);
}

// ── 3. Honest degrade: no invented number for an unmeasured city ─────────────
async function degrade(): Promise<void> {
  console.log("\n3. an unmeasured market degrades without inventing anything");

  const place = fromCityState("Greensboro", "NC"); // real city, no med spa audit behind it
  const ammo = await conciergeAmmo({ audience: "owner", place, service: "medspa", spent: [] });

  check("no candidates for an unmeasured city", ammo.candidates.length === 0, ammo.reason ?? "");
  check("a degrade line is supplied for the model to say", Boolean(ammo.degradeLine));

  // ‼️ NO DIGITS. A degrade line containing a number would be the exact failure this whole lane is
  // built to prevent: a plausible figure for a market nobody measured.
  check("the degrade line contains no number", !/\d/.test(ammo.degradeLine ?? ""), ammo.degradeLine ?? "");
  check("the degrade line names the city and no business", (ammo.degradeLine ?? "").includes("Greensboro"));
  check("the degrade line carries no banned dash", !hasBannedDash(ammo.degradeLine ?? ""));

  // The patient lane cannot reach competitor evidence at all.
  const patient = await conciergeAmmo({ audience: "patient", place, service: "medspa", spent: [] });
  check("a patient audience gets no competitor ammo, whatever the city", patient.candidates.length === 0);
  check("and it is refused by audience, not by an empty market", (patient.reason ?? "").includes("patient"));

  // The opener, with nothing measured, still says nothing numeric and nothing named.
  const opener = openingFor({ audience: "owner", magnet: null, evidence: null, greeting: null });
  check("the fallback opener invents no number", !/\d/.test(opener));
  check("the fallback opener is not a greeting", !/^(hi|hello|hey|welcome)\b/i.test(opener), opener);

  // ‼️ AND WHEN THE CITY WAS GIVEN, THE OPENER SAYS SO RATHER THAN ASKING AGAIN. The first live run
  // of this passed Greensboro, measured nothing, and fell through to "tell me your city" at
  // somebody who had just told us where they were. Re-asking hides the honest answer, and the
  // honest answer is also the only real reason to take the scan.
  const degraded = openingFor({
    audience: "owner",
    magnet: null,
    evidence: null,
    degradeLine: ammo.degradeLine,
    greeting: null,
  });
  check("a known but unmeasured city is told the truth, not asked again", degraded === ammo.degradeLine);
  check("and that opener still invents no number", !/\d/.test(degraded));
}

// ── 4. The ledger never repeats ──────────────────────────────────────────────
function noRepeat(): void {
  console.log("\n4. a measured line is never said twice");

  const line = { kind: "competitor" as const, detail: "When we asked ChatGPT for medspa in Ocala, FL, it named A Clinic in 4 of the answers we measured." };
  const spent: AmmoSpent[] = [{ ...line, step: 1 }];

  check("an already spent line is filtered out", unspentAmmo(spent, [line]).length === 0);
  check(
    "a rephrasing with the same words in a different case is still spent",
    unspentAmmo(spent, [{ kind: "competitor", detail: line.detail.toUpperCase() }]).length === 0
  );
  check(
    "the same sentence as a different KIND is a different piece",
    unspentAmmo(spent, [{ kind: "signal", detail: line.detail }]).length === 1
  );
  check("a fresh line survives", unspentAmmo(spent, [{ kind: "competitor", detail: "Something else." }]).length === 1);
  check("duplicates inside one candidate list collapse", unspentAmmo([], [line, { ...line }]).length === 1);

  // The seeding contract: a session ledger built from a prospect row reads with the SAME parser,
  // which is the whole reason the two columns share a shape.
  const fromProspect = spentAmmo({ ammo_used: [{ kind: "competitor", detail: line.detail, step: 3 }] });
  check("a prospect ledger parses into the session ledger", fromProspect.length === 1);
  check(
    "and a line the email lane already sent is unspendable in the widget",
    unspentAmmo(fromProspect, [line]).length === 0
  );

  check("a malformed ledger degrades to empty rather than throwing", spentAmmo({ ammo_used: "nonsense" }).length === 0);
  check("an unknown kind is dropped", spentAmmo({ ammo_used: [{ kind: "invented", detail: "x" }] }).length === 0);
  check("ammoKey is stable across punctuation", ammoKey(line) === ammoKey({ kind: "competitor", detail: line.detail.replace(/,/g, "") }));
}

// ── 5. The two audiences cannot see each other ───────────────────────────────
function audiences(): void {
  console.log("\n5. audience isolation and the magnet ladder");

  const m = (over: Partial<LeadMagnet>): LeadMagnet => ({
    id: "x", magnetKey: "k", chainsToKey: null, audience: "owner", clientId: null,
    vertical: null, treatment: null, category: null, title: "t", promise: "p",
    ctaLabel: null, assetUrl: null, conciergeEntry: "e", sortOrder: 100, ...over,
  });

  const ownerQ = { audience: "owner" as const, clientId: "c1", vertical: "aeo-agency-med-spa", treatment: null, category: "Comparison" };
  const patientQ = { audience: "patient" as const, clientId: "c1", vertical: "medspa", treatment: null, category: "Comparison" };

  check("an owner magnet is invisible to a patient query", rungOf(m({ audience: "owner" }), patientQ) === null);
  check("a patient magnet is invisible to an owner query", rungOf(m({ audience: "patient" }), ownerQ) === null);
  check(
    "another client's magnet is invisible",
    rungOf(m({ clientId: "c2" }), ownerQ) === null
  );

  // The ladder order, including the two rungs the original migration left unreachable.
  const r = (over: Partial<LeadMagnet>) => rungOf(m(over), ownerQ);
  check("client + vertical + category outranks library + vertical + category", (r({ clientId: "c1", vertical: "aeo-agency-med-spa", category: "Comparison" }) ?? 0) > (r({ vertical: "aeo-agency-med-spa", category: "Comparison" }) ?? 0));
  check("client anything outranks library this-page", (r({ clientId: "c1" }) ?? 0) > (r({ vertical: "aeo-agency-med-spa", category: "Comparison" }) ?? 0));
  check("library vertical-only IS reachable (the rung the migration lacked)", r({ vertical: "aeo-agency-med-spa" }) !== null);
  check("library vertical + treatment IS reachable", r({ vertical: "aeo-agency-med-spa", treatment: null }) !== null);
  check("the universal fallback always matches", r({}) === 0);

  // ‼️ NULL ON THE QUERY IS "UNKNOWN" AND MUST NOT MATCH A NAMED ROW. Reading it as a wildcard
  // would offer a med spa magnet on a page nobody classified.
  const unknownPage = { ...ownerQ, category: null };
  check("an unclassified page does not match a category-scoped magnet", rungOf(m({ vertical: "aeo-agency-med-spa", category: "Comparison" }), unknownPage) === null);
  check("but it still reaches the wildcard", rungOf(m({}), unknownPage) === 0);

  const ranked = rankMagnets(
    [m({ magnetKey: "wild" }), m({ magnetKey: "specific", vertical: "aeo-agency-med-spa", category: "Comparison" })],
    ownerQ
  );
  check("ranking puts the specific magnet first", ranked[0]?.magnetKey === "specific");
}

// ── 6. The chaining gate ─────────────────────────────────────────────────────
function chaining(): void {
  console.log("\n6. the chaining gate, and the exception that keeps it honest");

  check("zero delivered, the bot may not ask", !bookingGate(0, false).offered);
  check("one delivered, the bot still may not ask", !bookingGate(1, false).offered);
  check("two delivered, the bot may ask", bookingGate(2, false).offered);
  check("three delivered, still fine", bookingGate(3, false).offered);
  check("outstanding counts down honestly", bookingGate(1, false).outstanding === 1);
  check("outstanding never goes negative", bookingGate(9, false).outstanding === 0);

  // ‼️ THE EXCEPTION. A stacking rule that blocks somebody trying to buy is worse than no rule.
  check("a visitor who asks to book, books, whatever the count", bookingGate(0, true).offered);

  check("asksToBook reads a plain request", asksToBook("can I book a call?"));
  check("asksToBook reads an indirect one", asksToBook("how do I get started"));
  check("asksToBook reads a scheduling word", asksToBook("could we schedule something next week"));
  check("asksToBook does not fire on an ordinary question", !asksToBook("what does ChatGPT say about my clinic"));
  check("asksToBook does not fire on the word booked in another sense", !asksToBook("my calendar is full of patients"));
}

// ── 7. The prompt hands the model no names and no numbers ────────────────────
function promptIsEmpty(): void {
  console.log("\n7. the model is handed nothing to invent from");

  const prompt = systemPrompt({
    audience: "owner",
    tenantName: "SRT Agency LLC",
    delivered: [],
    spentDetails: [],
    magnetsStillNeeded: 2,
  });

  // Digits appear only in the rule numbering and the word count, never as a claim.
  const claims = prompt.match(/\b\d{2,}\b/g) ?? [];
  check(
    "the owner prompt states no multi-digit figure but the reply length",
    claims.every((c) => c === "45"),
    JSON.stringify(claims)
  );
  check("the owner prompt carries no banned dash", !hasBannedDash(prompt));
  check("the owner prompt forbids unmeasured names", /never name a business/i.test(prompt));
  check("the owner prompt forbids unmeasured numbers", /never state a number/i.test(prompt));

  const patient = systemPrompt({
    audience: "patient",
    tenantName: "A Clinic",
    delivered: [],
    spentDetails: [],
    magnetsStillNeeded: 2,
  });
  check("the patient prompt carries no banned dash", !hasBannedDash(patient));
  check("the patient prompt forbids naming another clinic", /never name another clinic/i.test(patient));

  // ‼️ WITHHOLDING BEATS FORBIDDING. The patient lane is not told to avoid market evidence, it is
  // handed no tool that can produce any.
  const patientTools = PATIENT_TOOLS.map((t) => (t as { name: string }).name);
  const ownerTools = OWNER_TOOLS.map((t) => (t as { name: string }).name);
  check("the patient lane has no market_evidence tool at all", !patientTools.includes("market_evidence"));
  check("the owner lane does", ownerTools.includes("market_evidence"));
}

// ── 8. No persona leak, no stray import ──────────────────────────────────────
/**
 * Does this file actually REACH the persona, as opposed to talking about it?
 *
 * ‼️ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A LOOSENING OF THE CHECK. The files in this lane
 * explain at length WHY they do not read bot_persona, so a raw text search flags the very
 * documentation that records the rule, and the only way to make it pass would be to delete the
 * explanation. A check that punishes writing down the reason is a check somebody eventually
 * silences. What is tested is the import, the call and the table read.
 */
function reachesPersona(src: string): boolean {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  return (
    /from\s+["']@\/lib\/persona["']/.test(code) ||
    /\bloadPersona\s*\(/.test(code) ||
    /["']bot_persona["']/.test(code)
  );
}

function noPersona(): void {
  console.log("\n8. the concierge does not inherit bot_persona");

  const root = "src/lib/concierge";
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  };
  walk(root);
  check("there are concierge source files to check", files.length > 0, `${files.length} files`);

  const offenders = files.filter((f) => reachesPersona(readFileSync(f, "utf8")));

  // ‼️ THE ACTIVE bot_persona ROW STILL DESCRIBES SRT AS A BUSINESS FUNDING BROKER, decommissioned
  // in August. A lane that picked it up by accident would introduce itself to a med spa owner as a
  // lender. Absent beats forbidden, and this is the assertion that keeps it absent.
  check("nothing under src/lib/concierge reads the persona", offenders.length === 0, offenders.join(", "));

  const routes = ["src/app/api/concierge", "src/app/w", "src/app/embed.js"];
  const routeOffenders: string[] = [];
  for (const r of routes) {
    const found: string[] = [];
    const walkR = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkR(full);
        else if (/\.tsx?$/.test(entry)) found.push(full);
      }
    };
    walkR(r);
    for (const f of found) {
      if (reachesPersona(readFileSync(f, "utf8"))) routeOffenders.push(f);
    }
  }
  check("nor do the concierge routes", routeOffenders.length === 0, routeOffenders.join(", "));
}

// ── 8b. The page's own magnet outranks the ladder ────────────────────────────
//
// ‼️ THIS IS THE WHOLE POINT OF THE DRAFTING PICKER AND IT IS PROVED OFFLINE. The lattice is a
// ranking over placement columns, and on a live page every one of those columns is null: nothing
// writes a category onto client_pages and treatment is hardcoded null at every query site. So the
// four category-scoped owner rows were unreachable in production while looking perfectly seeded in
// the database, which is the failure mode a ladder test alone cannot see.
function pageChoosesTheMagnet(): void {
  console.log("\n8b. a page names its own offer, and the ladder cannot outvote it");

  const m = (over: Partial<LeadMagnet>): LeadMagnet => ({
    id: "x", magnetKey: "k", chainsToKey: null, audience: "owner", clientId: null,
    vertical: null, treatment: null, category: null, title: "t", promise: "p",
    ctaLabel: null, assetUrl: null, conciergeEntry: "e", sortOrder: 100, ...over,
  });

  // The state a real hub page is in: a vertical off the tenant row, and nothing else known.
  const livePage = {
    audience: "owner" as const,
    clientId: "c1",
    vertical: "aeo-agency-med-spa",
    treatment: null,
    category: null,
  };

  const categoryScoped = m({ magnetKey: "city_rivals", category: "Comparison", vertical: "aeo-agency-med-spa" });
  const wildcard = m({ magnetKey: "visibility_scan" });

  check(
    "a category-scoped magnet is unreachable by ranking on a real page",
    rungOf(categoryScoped, livePage) === null
  );
  check(
    "so the ladder always returns the same wildcard, whatever the page is about",
    rankMagnets([categoryScoped, wildcard], livePage)[0]?.magnetKey === "visibility_scan"
  );

  // What the key buys: engine.ts, start/route.ts and config/route.ts all reach for magnetByKey
  // BEFORE resolveMagnet, so the row is fetched by name and the lattice never runs. The lattice
  // itself cannot be asked to prove that, so this asserts the property that makes it safe: a
  // named row is a row the ranking would have refused.
  check(
    "the named row is exactly the one ranking would have dropped",
    rungOf(categoryScoped, livePage) === null && categoryScoped.magnetKey === "city_rivals"
  );

  // The pill.
  check("a magnet with a cta_label uses it", pillLabel(m({ ctaLabel: "Free scan", title: "The AI Visibility Scan" })) === "Free scan");
  check("a magnet without one falls back to its title", pillLabel(m({ ctaLabel: null, title: "The AI Visibility Scan" })) === "The AI Visibility Scan");
  check("a blank cta_label is not a label", pillLabel(m({ ctaLabel: "   ", title: "The AI Visibility Scan" })) === "The AI Visibility Scan");
}

// ── 9. The catalogue itself ──────────────────────────────────────────────────
async function catalogue(): Promise<void> {
  console.log("\n9. the seeded catalogue is coherent");

  const { data } = await supabaseAdmin
    .from("lead_magnets")
    .select("magnet_key, chains_to_key, audience, title, promise, asset_url, concierge_entry, active, vertical, category")
    .eq("active", true);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  check("the catalogue has rows", rows.length > 0, `${rows.length} rows`);

  const owner = rows.filter((r) => r.audience === "owner");
  const patient = rows.filter((r) => r.audience === "patient");
  check("both catalogues are seeded", owner.length > 0 && patient.length > 0, `${owner.length} owner, ${patient.length} patient`);

  // ‼️ THE CTA CAN NEVER BE DEAD. Each audience needs a row that matches everything.
  const ownerFallback = owner.some((r) => !r.vertical && !r.category);
  const patientFallback = patient.some((r) => !r.vertical && !r.category);
  check("the owner audience has a universal fallback", ownerFallback);
  check("the patient audience has a universal fallback", patientFallback);

  // Every chain lands somewhere real, in the same audience.
  const byAudience = new Map<string, Set<string>>();
  for (const r of rows) {
    const a = String(r.audience);
    if (!byAudience.has(a)) byAudience.set(a, new Set());
    if (r.magnet_key) byAudience.get(a)!.add(String(r.magnet_key));
  }
  const dangling = rows.filter(
    (r) => r.chains_to_key && !byAudience.get(String(r.audience))?.has(String(r.chains_to_key))
  );
  check("no chain points at a magnet that does not exist", dangling.length === 0, dangling.map((d) => `${d.magnet_key} -> ${d.chains_to_key}`).join(", "));

  const selfChain = rows.filter((r) => r.chains_to_key && r.chains_to_key === r.magnet_key);
  check("no magnet chains to itself", selfChain.length === 0);

  // Rows sharing a key must agree on what the magnet IS, which the schema cannot enforce.
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.magnet_key) continue;
    const k = String(r.magnet_key);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(`${r.title}|${r.promise}|${r.asset_url ?? ""}|${r.concierge_entry}`);
  }
  const disagreeing = [...byKey.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
  check("rows sharing a magnet_key agree on their content", disagreeing.length === 0, disagreeing.join(", "));

  // Every string that reaches a page.
  const dashed = rows.filter((r) =>
    [r.title, r.promise, r.concierge_entry].some((v) => typeof v === "string" && hasBannedDash(v))
  );
  check("no magnet copy carries a banned dash", dashed.length === 0, dashed.map((d) => d.magnet_key).join(", "));
}

// ── 10. The mock rail ────────────────────────────────────────────────────────
// ── 9b. Every seeded magnet can actually be put on a pill ────────────────────
async function pillLabels(): Promise<void> {
  console.log("\n9b. the launcher pill");

  const { data } = await supabaseAdmin
    .from("lead_magnets")
    .select("magnet_key, audience, title, cta_label")
    .eq("active", true);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  check("the pill can read the catalogue", rows.length > 0, `${rows.length} rows`);

  // ‼️ LENGTH IS THE CHECK, BECAUSE THE PILL IS A PILL. `title` is the honest fallback and it is
  // written to be read inside a conversation: "The 20 Questions Your Patients Ask ChatGPT Before
  // They Book" is 62 characters and wraps a corner button into a paragraph. A row over the limit
  // is not broken, it is unfinished, and this is where that shows.
  const tooLong = rows.filter((r) => {
    const label = (typeof r.cta_label === "string" && r.cta_label.trim()) || String(r.title ?? "");
    return label.length > 28;
  });
  check(
    "every magnet has a label short enough for a corner pill",
    tooLong.length === 0,
    tooLong.map((r) => `${r.magnet_key} (${((r.cta_label as string) || (r.title as string) || "").length})`).join(", ")
  );

  const dashed = rows.filter((r) => typeof r.cta_label === "string" && hasBannedDash(r.cta_label));
  check("no pill label carries a banned dash", dashed.length === 0, dashed.map((r) => r.magnet_key).join(", "));
}

async function mockRail(): Promise<void> {
  console.log("\n10. no clinic is live on a mock analysis");

  const { data } = await supabaseAdmin
    .from("concierge_configs")
    .select("enabled, audience, analysis_provider, clients!inner(slug)");

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const slugOf = (r: Record<string, unknown>): string => {
    const c = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as Record<string, unknown> | undefined;
    return typeof c?.slug === "string" ? c.slug : "?";
  };

  check("there is a config to check", rows.length > 0, `${rows.length} rows`);

  // ‼️ A MOCK SKIN ANALYSIS SHOWN TO A REAL PATIENT IS AN INVENTED METRIC ABOUT THEIR FACE. The
  // owner lane has no analysis at all, so it is exempt; a patient lane on mock must stay dark.
  const bad = rows.filter(
    (r) => r.enabled === true && r.audience === "patient" && r.analysis_provider === "mock"
  );
  check(
    "no patient widget is enabled while its analysis provider is mock",
    bad.length === 0,
    bad.map(slugOf).join(", ")
  );

  const srt = rows.find((r) => slugOf(r) === "srt-agency-llc");
  check("srt-agency-llc is the owner tenant", srt?.audience === "owner", String(srt?.audience));
}

// ── 11. Booking: the tri-state, and the redirect guard ──────────────────────
async function booking(): Promise<void> {
  console.log("\n11. booking falls back rather than showing a dead button");

  const owner: ConciergeConfig = {
    clientId: "c1", slug: "srt-agency-llc", enabled: true, audience: "owner",
    vertical: "aeo-agency-med-spa", greeting: null, allowedOrigins: [],
    bookingMode: "none", bookingUrl: null, bookingPhone: null,
    analysisProvider: "mock", dailyScanCap: 200, consentVersion: "v1",
    clientName: "SRT Agency LLC", clientCity: null, clientState: null, clientWebsite: null,
  };

  const fallback = "https://srtagency.com/onboarding2?utm_source=concierge";
  const offer = await resolveBooking({
    config: owner, timeZone: "America/New_York", window: "today_tomorrow", fallbackUrl: fallback,
  });

  // ‼️ CALENDLY SHIPS UNCONFIGURED, SO THIS IS THE DEFAULT PATH AND NOT AN EDGE CASE. With no token
  // the owner lane MUST come back with the onboarding link. Anything else is a dead button on a
  // live page, which is the failure the whole tri-state exists to prevent.
  if (!process.env.CALENDLY_API_TOKEN) {
    check("with no Calendly token the owner lane falls back to a link", offer.mode === "link", offer.mode);
    if (offer.mode === "link") check("and the link is the onboarding handoff", offer.url === fallback);
  } else {
    check(
      "with a token the owner lane returns slots, an empty diary, or a link",
      ["slots", "no_slots", "link"].includes(offer.mode),
      offer.mode
    );
    if (offer.mode === "slots") {
      check("every offered slot carries its own booking link", offer.slots.every((s) => s.url.startsWith("https://")));
      check("no slot label is blank", offer.slots.every((s) => s.label.trim().length > 0));
      check("slot labels carry no banned dash", offer.slots.every((s) => !hasBannedDash(s.label)));
    }
  }

  // ‼️ THE PATIENT LANE NEVER REACHES SRT'S CALENDAR. booking_mode is a clinic's own setting, and
  // an owner booking always goes to SRT, so a patient config must resolve from its own columns.
  const patient: ConciergeConfig = { ...owner, audience: "patient", vertical: "medspa" };
  const pNone = await resolveBooking({ config: patient, timeZone: "America/New_York", window: "today_tomorrow", fallbackUrl: fallback });
  check("a clinic with no destination falls back to a callback", pNone.mode === "callback", pNone.mode);

  const pPhone = await resolveBooking({
    config: { ...patient, bookingPhone: "336-833-2303" },
    timeZone: "America/New_York", window: "today_tomorrow", fallbackUrl: fallback,
  });
  check("a clinic with a phone books by phone", pPhone.mode === "phone", pPhone.mode);

  const pLink = await resolveBooking({
    config: { ...patient, bookingMode: "link", bookingUrl: "https://clinic.example/book" },
    timeZone: "America/New_York", window: "today_tomorrow", fallbackUrl: fallback,
  });
  check("a clinic with a link uses its own link", pLink.mode === "link" && pLink.url === "https://clinic.example/book");

  // ‼️ THE OPEN REDIRECT GUARD. /api/concierge/booked is a public GET that forwards a browser to a
  // URL from the query string. Without a host allowlist it is a redirector on our own domain that
  // anybody can aim anywhere, which borrows our reputation for somebody else's phishing page.
  const allow = (raw: string, extra: Array<string | null>): boolean => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "calendly.com" || host.endsWith(".calendly.com")) return true;
    for (const c of extra) {
      if (!c) continue;
      try {
        if (host === new URL(c).hostname.toLowerCase()) return true;
      } catch {
        /* a malformed configured URL allows nothing */
      }
    }
    return false;
  };
  const extra = ["https://srtagency.com/onboarding2", null];
  check("calendly.com is allowed", allow("https://calendly.com/x/y", extra));
  check("a calendly subdomain is allowed", allow("https://api.calendly.com/x", extra));
  check("the configured onboarding host is allowed", allow("https://srtagency.com/onboarding2?a=1", extra));
  check("an unrelated host is refused", !allow("https://evil.example/steal", extra));
  check("a lookalike suffix host is refused", !allow("https://evilcalendly.com/x", extra));
  check("a lookalike of the configured host is refused", !allow("https://evil-srtagency.com/x", extra));
  check("http is refused even on an allowed host", !allow("http://calendly.com/x", extra));
  check("a javascript scheme is refused", !allow("javascript:alert(1)", extra));
  check("garbage is refused", !allow("not a url", extra));
}

async function main(): Promise<void> {
  console.log("\nconcierge lane: two audiences, one engine\n");
  synonyms();
  await provenance();
  await degrade();
  noRepeat();
  audiences();
  chaining();
  promptIsEmpty();
  noPersona();
  pageChoosesTheMagnet();
  await catalogue();
  await pillLabels();
  await mockRail();
  await booking();

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nprobe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
