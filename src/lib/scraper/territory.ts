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
// ‼️ THE ONE REASON NORMALISER, SHARED RATHER THAN RE-IMPLEMENTED. groupDrops and the
// drop-review card already fold reasons with this; a second fold here would be a second
// answer to "are these two reasons the same" and the page would disagree with the card.
import { normalizeReason } from "./qualify";

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

/**
 * How many rows PostgREST will return from one request, whatever anybody asks for.
 *
 * ‼️ MEASURED, AND IT SILENTLY TRUNCATED THE MAP. Supabase sets `db-max-rows` to 1000 and the
 * cap is applied by the SERVER: the function was asked for 4,000 rows, returned 1,546, and
 * supabase-js handed back exactly 1,000. `.range(0, 3999)` does not lift it either, measured.
 *
 * ‼️ AND THE FAILURE WAS INVISIBLE, WHICH IS THE PART WORTH REMEMBERING. `territory_dots` orders
 * by cluster size descending, so the 1,000 rows that came back were the BIGGEST ones: the map
 * looked full, the dots were in the right places, and 546 businesses were missing from the quiet
 * edges of the metro, which is exactly where "unworked" is read off. The page's own capped warning
 * could not fire either, because it compares the row count against DOT_LIMIT and 1,000 is not 4,000.
 * Caught by the probe asserting that clustering must not change the LEAD total: 1,204 against 1,750.
 */
const POSTGREST_MAX_ROWS = 1000;

export async function territoryDots(vertical: string, round: number): Promise<TerritoryDot[]> {
  const out: TerritoryDot[] = [];

  // ‼️ PAGED WITH .range(), WHICH IS THE ONE THING THAT DOES WORK. An explicit range cannot
  // exceed the server cap but it can MOVE, so the rows come back a thousand at a time. The server
  // side `p_limit` still bounds the total, so this loop is bounded by DOT_LIMIT rather than by the
  // data: a vertical with a million leads returns DOT_LIMIT rows and the page says it capped.
  for (let from = 0; from < DOT_LIMIT; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, DOT_LIMIT) - 1;
    const { data, error } = await supabaseAdmin
      .rpc("territory_dots", { p_vertical: vertical, p_round: round, p_limit: DOT_LIMIT })
      .range(from, to);
    if (error) {
      throw new Error(
        "territory_dots: " + error.message +
          ". If that names the function, docs/2026-10-08-territory-rollups.sql has not been run."
      );
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        lat: Number(r.lat),
        lon: Number(r.lon),
        stage: String(r.stage) as Stage,
        n: Number(r.n),
      });
    }
    // A short page is the last page. Checked against the window actually asked for, not against
    // POSTGREST_MAX_ROWS, because the final window is narrower when DOT_LIMIT is not a round
    // multiple of it.
    if (rows.length < to - from + 1) break;
  }

  return out;
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

// ── the drops ────────────────────────────────────────────────────────────────────────────────────

/** One (metro, judge, route, reason) bucket, straight off the rollup. */
export interface DropRow {
  metro: string | null;
  /** 'rule' for a free rule, else the model that judged it. */
  judge: string;
  /** 'call' or 'drop'. A called row is not a binned one. */
  route: string;
  /** Null on every drop today, by construction. Read first anyway; see groupDropRows. */
  judgedVertical: string | null;
  reason: string;
  n: number;
}

/**
 * Every lead the ICP did not keep, bucketed, paged.
 *
 * ‼️ PAGED, FOR THE REASON territoryDots IS PAGED AND IT IS THE SAME MEASURED TRAP. PostgREST caps a
 * response at 1,000 rows SERVER SIDE and `.range(0, 3999)` does not lift it, it only moves the
 * window. That silently truncated the territory map: 1,546 rows became 1,000 and 546 businesses went
 * missing from the quiet edges while the map looked full. This grouping is per (metro, model, route,
 * reason) over free text, so sixteen worked metros can exceed the cap the same way.
 */
export async function dropRows(vertical: string): Promise<{ rows: DropRow[]; capped: boolean }> {
  const out: DropRow[] = [];

  for (let from = 0; from < DOT_LIMIT; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, DOT_LIMIT) - 1;
    const { data, error } = await supabaseAdmin
      .rpc("territory_drop_rollup", { p_vertical: vertical, p_limit: DOT_LIMIT })
      .range(from, to);
    // ‼️ A MISSING FUNCTION READS AS NO DROPS RATHER THAN THROWING, because the drops are a SECTION
    // of a page whose other sections are the operational ones. A territory page that 500s because
    // one reporting function has not been migrated yet is a worse outcome than a section that says
    // it has nothing to show.
    if (error) return { rows: out, capped: false };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        metro: (r.source_metro as string | null) ?? null,
        judge: String(r.qualify_model ?? "unrecorded"),
        route: String(r.route ?? "unrouted"),
        judgedVertical: (r.judged_vertical as string | null) ?? null,
        reason: String(r.qualify_reason ?? ""),
        n: Number(r.n ?? 0),
      });
    }
    if (rows.length < to - from + 1) return { rows: out, capped: false };
  }

  return { rows: out, capped: true };
}

export interface DropBucket {
  /** What to print. The judged vertical when there is one, else the first spelling of the reason. */
  label: string;
  n: number;
  /** How many distinct spellings of this reason were folded together. 1 means none were. */
  spellings: number;
}

export interface MetroDrops {
  metro: string;
  /** Decided by a free rule: no website, platform-only domain, chain by shared domain, duplicate. */
  byRule: number;
  /** Decided by the model. */
  byModel: number;
  /** Of the above, still has somebody to ring. These are DOORS, not leftovers. */
  called: number;
  /** Of the above, genuinely binned. */
  binned: number;
  ruleBuckets: DropBucket[];
  modelBuckets: DropBucket[];
}

/**
 * Collapse the raw buckets into something readable, per metro.
 *
 * ‼️ BUCKETED ON judged_vertical WHERE IT EXISTS AND ON THE REASON OTHERWISE, NEVER THE REVERSE. The
 * reasons are model prose and the stored rows carry nine spellings of "Instagram only";
 * `normalizeReason` folds them and even that is fuzzy. A stored vertical is a controlled vocabulary
 * the registry owns, so where one exists it is the real answer and the prose is a description of it.
 * Today every dropped row has a null vertical (qualifyChunk writes null on a drop by construction),
 * so in practice this always falls through to the reason, and the page says so rather than letting
 * a reader take the buckets for a taxonomy.
 *
 * ‼️ AND IT REUSES normalizeReason RATHER THAN RE-FOLDING. That function is already the one
 * implementation `groupDrops` and the drop-review card share. A second fold here would be a second
 * answer to "are these two reasons the same", and the two cards would disagree about the same run.
 */
export function groupDropRows(rows: readonly DropRow[]): MetroDrops[] {
  const byMetro = new Map<string, MetroDrops>();

  for (const r of rows) {
    const metro = r.metro ?? "(no metro)";
    const m =
      byMetro.get(metro) ??
      { metro, byRule: 0, byModel: 0, called: 0, binned: 0, ruleBuckets: [], modelBuckets: [] };

    const isRule = r.judge === "rule";
    if (isRule) m.byRule += r.n;
    else m.byModel += r.n;
    if (r.route === "call") m.called += r.n;
    else if (r.route === "drop") m.binned += r.n;

    byMetro.set(metro, m);
  }

  // Second pass for the buckets, so the folding key is computed once per row rather than per metro.
  const bucketsFor = (metro: string, isRule: boolean): DropBucket[] => {
    const folded = new Map<string, { label: string; n: number; spellings: Set<string> }>();
    for (const r of rows) {
      if ((r.metro ?? "(no metro)") !== metro) continue;
      if ((r.judge === "rule") !== isRule) continue;
      const vertical = (r.judgedVertical ?? "").trim();
      const key = vertical ? "v:" + vertical.toLowerCase() : "r:" + normalizeReason(r.reason);
      const g = folded.get(key) ?? { label: vertical || r.reason, n: 0, spellings: new Set<string>() };
      g.n += r.n;
      g.spellings.add(vertical || r.reason);
      folded.set(key, g);
    }
    return [...folded.values()]
      .map((g) => ({ label: g.label, n: g.n, spellings: g.spellings.size }))
      .sort((a, b) => b.n - a.n);
  };

  for (const m of byMetro.values()) {
    m.ruleBuckets = bucketsFor(m.metro, true);
    m.modelBuckets = bucketsFor(m.metro, false);
  }

  return [...byMetro.values()].sort((a, b) => b.byRule + b.byModel - (a.byRule + a.byModel));
}

/**
 * The metro circles somebody has paid to count, by METROS key.
 *
 * ‼️ THIS IS THE HALF `territory_metro_rollup` CANNOT ANSWER, AND THE GAP IS STRUCTURAL RATHER THAN
 * AN OVERSIGHT. That function derives `remaining` from list_pipeline_runs.metro_total_count joined
 * through raw_leads.run_id, so it needs LEADS: a metro nobody has pulled from has no row, no
 * denominator and no remainder. 15 of the 16 planned metros were in exactly that state on
 * 2026-10-09, which is every metro except Dallas. An auto-planner that could not tell "Houston is
 * empty" from "nobody has looked at Houston" would send a budget to a city holding 40 businesses.
 *
 * ‼️ A MISSING TABLE READS AS EMPTY RATHER THAN THROWING, the same way cellsMeasured does. The
 * honest consequence of docs/2026-10-09-pull-plan.sql not having been run is a planner that offers
 * to measure Dallas again for a penny, not a page that 500s.
 */
export async function metroCircles(vertical: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const c of await metroCircleRows(vertical)) {
    // Raised, never assigned, for the reason every other count in this lane is: the vendor's index
    // is live and the unique index means there is only one row anyway, so this is belt and braces.
    out.set(c.metroKey, Math.max(out.get(c.metroKey) ?? 0, c.totalCount));
  }
  return out;
}

export interface MetroCircle {
  metroKey: string;
  metroLabel: string;
  locationName: string;
  lat: number;
  lon: number;
  radiusKm: number;
  totalCount: number;
  costUsd: number;
  measuredAt: string | null;
}

/**
 * The measured circles in full, for the page, the tools and a re-measurement.
 *
 * ‼️ `measured_at` IS THE FIELD THAT MAKES A COUNT READABLE RATHER THAN JUST TRUE. DataForSEO's
 * index is live: the same Dallas circle read 1,765 and then 1,990 ten days later, which is 12.7%
 * growth. A remainder computed against a count from three weeks ago is not wrong, but it is old,
 * and the only way a reader can tell is if the page says when it was taken.
 *
 * ‼️ AND THE COORDINATE IS HERE SO A RE-MEASURE DOES NOT RE-GEOCODE. The centre of Houston does not
 * move. Once a circle has been measured, its lat/lon ARE the circle, and re-resolving the name
 * through Nominatim could quietly pick a different point and silently change what "Houston" means
 * between two counts.
 */
export async function metroCircleRows(vertical: string): Promise<MetroCircle[]> {
  const { data, error } = await supabaseAdmin
    .from("scraper_metro_circles")
    .select(
      "metro_key, metro_label, location_name, latitude, longitude, radius_km, total_count, cost_usd, measured_at"
    )
    .eq("vertical_slug", vertical);
  // ‼️ A MISSING TABLE READS AS EMPTY RATHER THAN THROWING, the same way cellsMeasured does. The
  // honest consequence of docs/2026-10-09-pull-plan.sql not having been run is a planner that offers
  // to measure Dallas again for a penny, not a page that 500s.
  if (error) return [];
  return (data ?? [])
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        metroKey: String(r.metro_key ?? ""),
        metroLabel: String(r.metro_label ?? ""),
        locationName: String(r.location_name ?? ""),
        lat: Number(r.latitude ?? 0),
        lon: Number(r.longitude ?? 0),
        radiusKm: Number(r.radius_km ?? 0),
        totalCount: Number(r.total_count ?? 0),
        costUsd: Number(r.cost_usd ?? 0),
        measuredAt: (r.measured_at as string | null) ?? null,
      };
    })
    .filter((c) => c.metroKey);
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
  /**
   * The vendor's count for this metro's circle, when one has been bought, else null.
   *
   * ‼️ SEPARATE FROM `remaining` SO THE PLANNER CAN SAY WHICH MEASUREMENT IT IS USING. "measured at
   * 1,990, 1,750 pulled" and "never measured" are the two states a plan card has to distinguish,
   * and a lone remainder cannot carry that.
   */
  circleTotal: number | null;
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
export function metroPlan(
  rows: readonly MetroRow[],
  /**
   * Metro circles bought with a `measure` step, by METROS key, from `metroCircles`.
   *
   * ‼️ OPTIONAL, AND ITS ABSENCE MEANS "no metro has been measured on its own", never "every metro
   * is empty". The dashboard passes it; a caller that does not simply gets the pre-2026-10-09
   * behaviour, where a metro's remainder can only come from a run that pulled it.
   */
  circles?: ReadonlyMap<string, number>
): PlanRow[] {
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
    const pulled = agg?.pulled ?? 0;
    const circleTotal = circles?.get(m.key) ?? null;

    // ‼️ THE GREATER OF THE TWO MEASUREMENTS, AND NEVER THE SUM. Both answer "how many are left
    // here" and they are derived differently: the run path sums (metro_total - pulled) over every
    // source_metro string that matched this metro, and the circle path is one count for one circle
    // less everything pulled under the whole metro. For Dallas today they agree exactly, at 240.
    // They can drift once two sub-circles of one metro have been pulled separately, and the maximum
    // is the safe direction: it can leave a metro looking unfinished for one more plan, which costs
    // a chunk that returns nothing, where the minimum would mark it finished and leave real
    // businesses unbought forever.
    const fromCircle = circleTotal === null ? null : Math.max(0, circleTotal - pulled);
    const fromRuns = agg?.remaining ?? null;
    const remaining =
      fromCircle === null ? fromRuns : fromRuns === null ? fromCircle : Math.max(fromCircle, fromRuns);

    return {
      key: m.key,
      label: m.label,
      priority: m.priority,
      matched: agg?.matched ?? [],
      pulled,
      sendable: agg?.sendable ?? 0,
      remaining,
      daysOfSupply: remaining === null ? null : Math.round((remaining / burn) * 10) / 10,
      worked: pulled > 0,
      circleTotal,
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
