// Where ammo comes from. The supply side of the model already declared in followup-operator/types.ts.
//
// ‼️ THIS DOES NOT INTRODUCE A SECOND AMMO MODEL. AmmoSpent { kind, detail, step } already exists
// and outreach_prospects.ammo_used already has the column. What was missing was anything that
// PRODUCED a value: repo-wide, before this lane, no AmmoSpent was ever constructed, the column was
// never written, and the "one unspent finding per touch" rule in operator-rules.ts was prose with
// no mechanism under it. This file supplies "competitor" and "signal". "finding" stays with the
// audit engine, which already has its own seed ledger for exactly that.
//
// ‼️ EVERY SENTENCE THIS FILE PRODUCES MUST TRACE TO A MEASURED ROW. There is no model call here
// and there must never be one. A competitor line is a count of audit_runs rows that named that
// business; a signal line is a component the scraper actually attempted. The two rules that keep
// it honest:
//
//   1. A signal is only built from a component with attempted === true. A component that was not
//      measured earns zero, and zero-because-unknown is indistinguishable from zero-because-bad if
//      you only look at `earned`. Saying "you have no photos" when the truth is "we could not find
//      your profile" is the exact class of invented claim this repo bans everywhere else.
//   2. A competitor is never the recipient. Being named is the good outcome, and telling a business
//      that it is beaten by itself is the fastest way to prove nothing was measured.

import { supabaseAdmin } from "@/lib/db";
import { hasBannedDash } from "@/lib/copy-guard";
import { normalizeNameForCompare, stripEntitySuffix } from "@/lib/clients/nap-compare";
import { displayPlace, type Place } from "@/lib/market/place";
import { marketKeys } from "@/lib/market/service-synonyms";
import type { AmmoSpent } from "@/lib/followup-operator/types";

/**
 * A piece of ammo that has not been spent yet, so it has no step.
 *
 * `step` is what makes an AmmoSpent spent, and it is not knowable until a touch actually uses the
 * line. Modelling the candidate as a partial rather than defaulting step to 0 keeps "considered"
 * and "spent" impossible to confuse, which is the entire job of the ledger.
 */
export type AmmoCandidate = Omit<AmmoSpent, "step">;

/** How many competitor lines to offer for one market. More than a handful is not a shortlist. */
const MAX_COMPETITOR_AMMO = 5;

/** A competitor named only once is a coincidence, not a market position. */
const MIN_TIMES_NAMED = 2;

export interface CompetitorAmmoInput {
  place: Place;
  service: string;
  /** Names that mean the recipient. They are never returned as their own competitor. */
  excludeNames?: Array<string | null | undefined>;
}

interface MarketRow {
  display_name: string;
  normalized_name: string;
  times_named: number;
  run_count: number;
  cited_domains: string[] | null;
  last_seen: string;
}

/**
 * Who the engines name in this market, as ammo, strongest first.
 *
 * Reads the market_competitors view, which is a rollup of market_mentions, every row of which is
 * anchored to an audit_runs row by a NOT NULL foreign key. There is no path from here to a name
 * that no engine produced.
 *
 * Returns [] rather than throwing for the ordinary cases: a city we have never audited, a service
 * we have no runs for, a market where everyone was named once. About 80 percent of the leads in
 * this database are in a city with no audit behind it, so empty is the COMMON answer and callers
 * must degrade to signal ammo rather than treating it as a failure.
 */
export async function competitorAmmo(input: CompetitorAmmoInput): Promise<AmmoCandidate[]> {
  const service = input.service.trim().toLowerCase();
  if (!service || !input.place.city) return [];

  // Matched on the normalized key, never the raw slug (market/service.ts says why), and widened
  // across the curated synonym cluster rather than pinned to one key (market/service-synonyms.ts
  // says why, and carries the row counts Matthew signed off on).
  let query = supabaseAdmin
    .from("market_competitors")
    .select("display_name, normalized_name, times_named, run_count, cited_domains, last_seen")
    .eq("city", input.place.city)
    .in("service_key", marketKeys(service))
    .gte("times_named", MIN_TIMES_NAMED)
    .order("times_named", { ascending: false })
    .limit(MAX_COMPETITOR_AMMO * 2);

  // A null state on the stored row means the source never said one. Matching it as well as the
  // known state is the same tolerance sameMarket() applies, and refusing it would discard every
  // market built from a report that wrote its city without a postal code.
  query = input.place.state
    ? query.or(`state.eq.${input.place.state},state.is.null`)
    : query;

  const { data, error } = await query;
  if (error || !data) return [];

  const excluded = new Set(
    (input.excludeNames ?? [])
      .filter((n): n is string => !!n && n.trim().length > 0)
      .map((n) => stripEntitySuffix(normalizeNameForCompare(n)))
      .filter((n) => n.length > 0)
  );

  const where = displayPlace(input.place);
  const out: AmmoCandidate[] = [];

  for (const row of data as MarketRow[]) {
    if (out.length >= MAX_COMPETITOR_AMMO) break;
    if (excluded.has(row.normalized_name)) continue;

    const detail = competitorLine(row, service, where);
    // A name with a dash in it would fail guard() downstream at the worst moment, inside a draft.
    // Dropping the line is right: there are four more behind it and none of them is load-bearing.
    if (hasBannedDash(detail)) continue;

    out.push({ kind: "competitor", detail });
  }

  return out;
}

/**
 * One competitor, said as a fact with its own denominator attached.
 *
 * ‼️ THE DENOMINATOR IS NOT DECORATION. "ChatGPT names them" is unfalsifiable and sounds like
 * marketing. "named in 10 of the 20 answers we measured" is a claim with a method behind it, it is
 * the number actually stored, and it is the difference between a sentence we can defend on a call
 * and one we cannot.
 */
function competitorLine(row: MarketRow, service: string, where: string): string {
  const readable = service.replace(/[-_]+/g, " ");
  return (
    `When we asked ChatGPT for ${readable} in ${where}, it named ${row.display_name} ` +
    `in ${row.run_count} of the answers we measured.`
  );
}

/** One entry inside score_components / optimization_components. */
interface ScoreComponent {
  note?: unknown;
  earned?: unknown;
  weight?: unknown;
  attempted?: unknown;
}

export interface SignalAmmoInput {
  scoreComponents?: unknown;
  optimizationComponents?: unknown;
}

/**
 * The scraper's own measurements, as ammo.
 *
 * These numbers are computed today by scraper/score.ts and gbp-audit.ts, rendered into a Slack
 * card and a CSV, and then dropped. This is the first thing that turns one into a sentence.
 *
 * ‼️ ONLY components with attempted === true, and only where they fell short of their weight.
 * The blob also carries a top-level `measured: "4 of 6"` string alongside the components, which is
 * not a component and is skipped by the shape check rather than by name, so a future key added
 * next to it cannot slip through as a finding.
 */
export function signalAmmo(input: SignalAmmoInput): AmmoCandidate[] {
  const out: AmmoCandidate[] = [];
  for (const blob of [input.scoreComponents, input.optimizationComponents]) {
    out.push(...signalsFromBlob(blob));
  }
  return out;
}

function signalsFromBlob(blob: unknown): AmmoCandidate[] {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return [];

  const out: AmmoCandidate[] = [];
  for (const value of Object.values(blob as Record<string, unknown>)) {
    // The `measured` sibling is a string, so anything that is not an object is not a component.
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const c = value as ScoreComponent;
    if (c.attempted !== true) continue;

    const earned = typeof c.earned === "number" ? c.earned : null;
    const weight = typeof c.weight === "number" ? c.weight : null;
    if (earned === null || weight === null || earned >= weight) continue;

    const note = typeof c.note === "string" ? c.note.trim() : "";
    if (!note) continue;
    // A note that starts this way is the scraper saying it could not look, which `attempted`
    // should already have caught. Belt and braces: it is one string compare against shipping an
    // unknown as a finding.
    if (note.toLowerCase().startsWith("not measured")) continue;
    if (hasBannedDash(note)) continue;

    out.push({ kind: "signal", detail: capitalize(note) + "." });
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
