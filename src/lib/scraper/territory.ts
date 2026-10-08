// The reads behind /dashboard/territory, and the supply arithmetic on top of them.
//
// ‼️ NO NEW SOURCE OF TRUTH. Every number here comes out of raw_leads, sendable_leads,
// outreach_prospects, list_pipeline_runs or scraper_cells, through the four functions in
// docs/2026-10-08-territory-rollups.sql. There is no territory table, no nightly roll-up and no
// cache, because a second copy of "where have we been" is a second thing to be wrong.
//
// ‼️ THE PLAN IS THE POINT, NOT THE DASHBOARD. A page that reports what has happened is a report. A
// page that answers "which metro next, and is the one we are in finished" is a territory system,
// and the difference is `metroPlan` at the bottom of this file: it joins what has been pulled to
// the 16 Sun Belt metros already in src/lib/trt.ts and names the next one.
//
// ‼️ AND OVERLAP IS NOT RE-DETECTED HERE. place_id is uniquely indexed per run, raw_leads_place_created
// indexes it across runs, scraper_seen dedupes on domain, and dropCrossRunDuplicates already cut 35
// of the Dallas 500 as "already pulled under an earlier run". The map's job is to stop a metro being
// BOUGHT twice, not to find the duplicates afterwards.

import { supabaseAdmin } from "@/lib/db";
import { canonicalStateName } from "./geo";
import { METROS } from "@/lib/trt";
import { verticalDef, type VerticalDef } from "./verticals";

/** The six rungs, furthest first. Shared by the map legend, the table and the plan. */
export const STAGES = ["emailed", "sendable", "qualified", "call", "dropped", "pulled"] as const;
export type Stage = (typeof STAGES)[number];

export interface TerritoryDot {
  lat: number;
  lon: number;
  stage: Stage;
  n: number;
}

export interface MetroRow {
  verticalSlug: string | null;
  metro: string | null;
  pulled: number;
  judged: number;
  tierA: number;
  tierB: number;
  tierC: number;
  untiered: number;
  callable: number;
  qualified: number;
  sendable: number;
  emailed: number;
  lastPulledAt: string | null;
  /** The vendor's own count for the circle, or null when nothing ever measured it. */
  metroTotal: number | null;
  /** metroTotal minus pulled, or null. Null is "not measured", never zero. */
  remaining: number | null;
}

export interface StateRow {
  /** Canonical full name, e.g. "Texas". The bucket "TX" and "Texas" were merged into. */
  name: string;
  pulled: number;
  qualified: number;
  callable: number;
  sendable: number;
  emailed: number;
}

/**
 * How coarse the dot grid is, per zoom.
 *
 * ‼️ 0.5 DEGREES AT NATIONAL ZOOM IS NOT A ROUNDING CHOICE, IT IS THE PIXEL SIZE. The viewBox is 960
 * wide across 59 degrees of longitude, so one degree is about 16 pixels and half a degree is 8: the
 * size a readable dot wants to be anyway. Finer than that and the browser draws thousands of
 * overlapping circles to render one blob.
 *
 * ‼️ AND METRO ZOOM IS EXACT, WITH NO GRID AT ALL. The question changes with the zoom: nationally it
 * is "which city next", and inside a city it is "which part of this one is unworked", which needs
 * the actual pins. 0 means no rounding.
 */
export const DOT_GRID = { national: 0.5, metro: 0 } as const;

/** Hard cap on DOTS returned, never on leads counted. `n` stays true whatever the cap does. */
export const DOT_LIMIT = 4000;

export async function territoryDots(vertical: string, round: number): Promise<TerritoryDot[]> {
  const { data, error } = await supabaseAdmin.rpc("territory_dots", {
    p_vertical: vertical,
    p_round: round,
    p_limit: DOT_LIMIT,
  });
  if (error) {
    throw new Error(
      "territory_dots: " + error.message +
        ". If that names the function, docs/2026-10-08-territory-rollups.sql has not been run."
    );
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    stage: String(r.stage) as Stage,
    n: Number(r.n),
  }));
}

export async function metroRows(vertical: string): Promise<MetroRow[]> {
  const { data, error } = await supabaseAdmin.rpc("territory_metro_rollup", { p_vertical: vertical });
  if (error) {
    throw new Error(
      "territory_metro_rollup: " + error.message +
        ". If that names the function, docs/2026-10-08-territory-rollups.sql has not been run."
    );
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    verticalSlug: (r.vertical_slug as string | null) ?? null,
    metro: (r.source_metro as string | null) ?? null,
    pulled: Number(r.pulled ?? 0),
    judged: Number(r.judged ?? 0),
    tierA: Number(r.tier_a ?? 0),
    tierB: Number(r.tier_b ?? 0),
    tierC: Number(r.tier_c ?? 0),
    untiered: Number(r.untiered ?? 0),
    callable: Number(r.callable ?? 0),
    qualified: Number(r.qualified ?? 0),
    sendable: Number(r.sendable ?? 0),
    emailed: Number(r.emailed ?? 0),
    lastPulledAt: (r.last_pulled_at as string | null) ?? null,
    // ‼️ `?? null`, NEVER `?? 0`. "Nobody has measured this circle" and "this circle is exhausted"
    // are opposite facts and a zero would render the first as the second, marking an untouched
    // metro finished.
    metroTotal: r.metro_total === null || r.metro_total === undefined ? null : Number(r.metro_total),
    remaining: r.remaining === null || r.remaining === undefined ? null : Number(r.remaining),
  }));
}

/**
 * The state layer, with the raw buckets merged.
 *
 * ‼️ THE CANONICALISATION HAPPENS HERE AND NOT IN SQL, AND THIS IS WHY. raw_leads.state holds
 * "Texas" on 520 of the 550 stored rows, "TX" on 10 and nothing on 20, and `canonicalStateName` is
 * the one function that maps both spellings to one name AND refuses "Ontario" and "Chihuahua",
 * which a reverse geocoder returns for the national crawl's border-straddling 384km seed circles.
 * A 50 row VALUES list in SQL would be a second copy of that, and it would not refuse anything.
 *
 * ‼️ AN UNRECOGNISED BUCKET IS DROPPED FROM THE LAYER AND COUNTED, NEVER FOLDED INTO A STATE. The
 * page prints "20 leads have no state on file" rather than silently losing them, because a lead
 * with no state is a lead whose pull wrote no address region and that is worth knowing.
 */
export async function stateRows(
  vertical: string
): Promise<{ rows: StateRow[]; unplaced: number }> {
  const { data, error } = await supabaseAdmin.rpc("territory_state_rollup", { p_vertical: vertical });
  if (error) {
    throw new Error(
      "territory_state_rollup: " + error.message +
        ". If that names the function, docs/2026-10-08-territory-rollups.sql has not been run."
    );
  }

  const byState = new Map<string, StateRow>();
  let unplaced = 0;

  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    const name = canonicalStateName((r.state_raw as string | null) ?? null);
    const pulled = Number(r.pulled ?? 0);
    if (!name) {
      unplaced += pulled;
      continue;
    }
    const existing = byState.get(name) ?? {
      name,
      pulled: 0,
      qualified: 0,
      callable: 0,
      sendable: 0,
      emailed: 0,
    };
    existing.pulled += pulled;
    existing.qualified += Number(r.qualified ?? 0);
    existing.callable += Number(r.callable ?? 0);
    existing.sendable += Number(r.sendable ?? 0);
    existing.emailed += Number(r.emailed ?? 0);
    byState.set(name, existing);
  }

  return { rows: [...byState.values()].sort((a, b) => b.pulled - a.pulled), unplaced };
}

/** How many circles have been paid to be counted. Zero means the cell crawl has never been run. */
export async function cellsMeasured(vertical: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("scraper_cells")
    .select("id", { count: "exact", head: true })
    .eq("vertical_slug", vertical);
  // ‼️ A MISSING TABLE READS AS ZERO RATHER THAN THROWING, AND ZERO IS THE HONEST ANSWER ANYWAY.
  // scraper_cells is empty in production: the national crawl was built on 2026-09-28 and has never
  // been run. A page that 500s because a table it reports on is empty would be worse than one that
  // says "0 circles measured, here is the command".
  if (error) return 0;
  return count ?? 0;
}

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The sending arithmetic, in one place, so every number on the page comes from the same assumptions.
 *
 * ‼️ EVERY FIELD IS MEASURED OR DECIDED, AND THE COMMENTS SAY WHICH. The whole plan view is this
 * object multiplied out, so a reader who disagrees with one number needs to be able to find it.
 */
export const SENDING = {
  /** Decided: 30 mailboxes at 45 a day. */
  mailboxes: 30,
  perMailboxPerDay: 45,
  /** Decided: a three-day sequence, so one new contact carries three sends. */
  sequenceDays: 3,
  /**
   * Measured end to end on run c74a895d: 46 shippable addresses out of 500 raw records, 9.2%.
   *
   * ‼️ IT IS A RANGE AND THE LOW END IS THE ONE THE PLAN USES. 9.2% is one metro, one vertical and a
   * pre-tiering ICP. Planning off the top of a range is how a supply plan turns into a shortfall.
   */
  rawToSendableLow: 0.09,
  rawToSendableHigh: 0.13,
  /** 10,500 bulk credits, bought once. The real budget constraint, and it is not DataForSEO. */
  verifierCreditsLeft: 10500,
  /** $0.37 per 1,000 records plus $0.012 per task, one task per 1,000. */
  dfsPerThousand: 0.37,
  dfsPerTask: 0.012,
} as const;

export function sendsPerDay(): number {
  return SENDING.mailboxes * SENDING.perMailboxPerDay;
}

/** New contacts a day, which is sends divided by the sequence length. */
export function contactsPerDay(): number {
  return Math.round(sendsPerDay() / SENDING.sequenceDays);
}

/** Raw records a day, at the measured rate. A range, because the rate is a range. */
export function rawPerDay(): { low: number; high: number } {
  const contacts = contactsPerDay();
  return {
    low: Math.round(contacts / SENDING.rawToSendableHigh),
    high: Math.round(contacts / SENDING.rawToSendableLow),
  };
}

export interface PlanRow {
  key: string;
  label: string;
  priority: number;
  /** The metro strings in raw_leads that matched this metro, so a pull is never counted twice. */
  matched: string[];
  pulled: number;
  sendable: number;
  /** Null when no circle for this metro has ever been measured. */
  remaining: number | null;
  /**
   * Days of supply left at the current burn, or null when nothing has measured the circle.
   *
   * ‼️ COMPUTED FROM `remaining` AND THE LOW SENDABLE RATE, so it is the pessimistic answer. A metro
   * reported as having more days of supply than it has is the mistake that leaves 30 mailboxes with
   * nothing to send, and an idle mailbox hurts deliverability.
   */
  daysOfSupply: number | null;
  worked: boolean;
}

/**
 * Match a stored metro string to one of the planned metros.
 *
 * ‼️ MATCHED ON THE ANCHOR CITY, NOT ON THE METRO KEY, BECAUSE THE TWO VOCABULARIES ARE DIFFERENT.
 * `raw_leads.source_metro` holds what the operator typed ("Dallas TX"), and METROS keys are
 * `dfw` with anchors Dallas and Fort Worth. A key match would report Dallas as unworked forever.
 *
 * ‼️ AND A COORDINATE TRIPLE MATCHES NOTHING, ON PURPOSE. A cell pull's source_metro is
 * "32.7767,-96.7970,40", which belongs to the cell system's own geography. Guessing which named
 * metro a circle sits in is the kind of inference that puts a pull in the wrong column; the page
 * lists those rows separately as cell pulls.
 */
export function matchMetro(stored: string | null | undefined): string | null {
  const text = (stored || "").trim().toLowerCase();
  if (!text) return null;
  // A coordinate triple, which is a cell rather than a named metro.
  if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?,\s*\d+/.test(text)) return null;

  for (const m of METROS) {
    for (const a of m.anchors) {
      if (text.includes(a.city.toLowerCase())) return m.key;
    }
  }
  return null;
}

/**
 * The plan: every metro in priority order, with what is left in the ones already worked.
 *
 * ‼️ IT RETURNS THE UNWORKED ONES TOO, WHICH IS THE WHOLE VALUE. A table of what has been pulled
 * answers "where have we been". The question the operator actually has every morning is "where do I
 * go next", and that is answered by the rows with `worked: false`, in priority order, with a do-not-
 * pull marker on everything above them.
 */
export function metroPlan(rows: readonly MetroRow[]): PlanRow[] {
  const byKey = new Map<string, { pulled: number; sendable: number; remaining: number | null; matched: string[] }>();

  for (const r of rows) {
    const key = matchMetro(r.metro);
    if (!key) continue;
    const agg = byKey.get(key) ?? { pulled: 0, sendable: 0, remaining: null, matched: [] };
    agg.pulled += r.pulled;
    agg.sendable += r.sendable;
    // ‼️ SUMMED ONLY OVER THE ROWS THAT HAVE A MEASUREMENT, so one unmeasured pull of a metro does
    // not erase the measured remainder of another. Null plus a number is the number.
    if (r.remaining !== null) agg.remaining = (agg.remaining ?? 0) + r.remaining;
    if (r.metro) agg.matched.push(r.metro);
    byKey.set(key, agg);
  }

  const burn = rawPerDay().high; // The pessimistic burn: more records a day means fewer days left.

  return METROS.map((m) => {
    const agg = byKey.get(m.key);
    const remaining = agg?.remaining ?? null;
    return {
      key: m.key,
      label: m.label,
      priority: m.priority,
      matched: agg?.matched ?? [],
      pulled: agg?.pulled ?? 0,
      sendable: agg?.sendable ?? 0,
      remaining,
      daysOfSupply: remaining === null ? null : Math.round((remaining / burn) * 10) / 10,
      worked: (agg?.pulled ?? 0) > 0,
    };
  }).sort((a, b) => a.priority - b.priority);
}

/**
 * The commands to run for one metro, from the vertical's own registry.
 *
 * ‼️ GENERATED RATHER THAN TYPED FROM MEMORY, WHICH IS THE SECOND HALF OF "READ THE MAP BEFORE EVERY
 * PULL". A plan view that says "go to Houston next" and leaves the operator to remember the grammar
 * is a plan view that gets a limit or an offset wrong, and `limit 3000` for a metro holding 1,765 is
 * exactly how batch 7a472c40 died.
 *
 * ‼️ 300 AT A TIME, NOT 3000. Four chunks finish a Dallas-sized metro, and a chunk that fails costs
 * one chunk rather than the whole pull. The offset walks from whatever is already pulled, so running
 * these after a partial pull continues rather than re-buying the top of the list.
 */
export function pullCommands(vertical: VerticalDef | null, metroLabel: string, alreadyPulled: number): string[] {
  if (!vertical) return [];
  const anchor = METROS.find((m) => m.label === metroLabel)?.anchors[0];
  const where = anchor ? `${anchor.city} ${anchor.state}` : metroLabel;
  const CHUNK = 300;
  const start = Math.max(0, alreadyPulled);
  return [0, 1, 2, 3].map(
    (i) => `pull maps ${vertical.slug} | ${where} | ${vertical.searchQueries[0]} | limit ${CHUNK} | offset ${start + i * CHUNK}`
  );
}

/** The registry entry, for the page's header and its command generator. */
export function territoryVertical(slug: string): VerticalDef | null {
  return verticalDef(slug);
}
