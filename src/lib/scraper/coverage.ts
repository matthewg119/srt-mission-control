// What to do next: measure a circle, page one, or stop.
//
// ‼️ PURE. No Slack, no database, no network. Every decision about spending money on the national
// crawl is made here, from rows and labels handed in, so `scripts/_probe-cells.ts` can prove the
// whole campaign offline with no API key. Same split as maps-command.ts and for a stronger version of
// the same reason: this one decides how much gets bought.
//
// ‼️ THE SPLIT OF AUTHORITY, WHICH IS THE WHOLE DESIGN. The lane it replaces had no queue table, on
// the stated grounds that a second copy of the intent is a second thing to drift, and answered "what
// is next" by re-parsing the commands themselves. That note is right, and it was CONDITIONAL on
// something that was invisible because it always held: the shape of the plan was a constant in code
// (fifty metro strings). A quadtree's shape is not. It is decided by DataForSEO's `total_count`,
// which costs money to learn and, for a circle holding nothing, leaves behind no batch, no run and
// no lead row to re-derive it from. So:
//
//   stored (scraper_cells)   total_count for one circle and one category list. A receipt.
//   derived (here)           how deep a cell is paged: offset + limit of its deepest LANDED pull,
//                            re-parsed out of the batch labels, the same arithmetic the metro queue
//                            used and for the same reason.
//   derived (here)           leaf or interior: the count against the budget, or a child row existing.
//   derived (cells.ts)       which cells exist at all: seedGrid() and childrenOf() are pure.
//
// Nothing here reads a stored status, because there is no stored status. A cell row means "we paid to
// count this circle and here is the answer", and every other question is computed from it.

import { parseMapsCommand, type MapsSource } from "./maps-command";
import {
  CELL_FLOOR_KM,
  cellKey,
  childrenOf,
  seedGrid,
  type Cell,
} from "./cells";

/** One measured circle, as stored. */
export interface CellRow extends Cell {
  /** `cellKey` of this cell. Carried so callers never re-derive it and risk a second spelling. */
  key: string;
  verticalSlug: string;
  categoriesKey: string;
  /** How many businesses DataForSEO reports inside the circle. Exact, and measured. */
  totalCount: number;
  /** Reverse-geocoded from the centre. Null is "not looked up or not resolvable", never a guess. */
  stateName: string | null;
  /**
   * ‼️ PROVENANCE ONLY. NOTHING IN THIS FILE MAY READ THESE TWO. They exist so a card can say "this
   * one split into four". Leaf-or-interior is computed from the count and from whether a child row
   * exists, so a wrong parent_key cannot change what gets bought.
   */
  parentKey: string | null;
  depth: number;
}

/** One past pull, as `mapsPullHistory` reports it. Structural, so MapsPull satisfies it. */
export interface CellPull {
  label: string;
  rawCount: number;
  finished: boolean;
}

export interface CellBudget {
  /** Above this, a cell is split rather than paged. */
  cellMax: number;
  /** At or below this radius, a cell is never split, however dense. */
  floorKm: number;
  /** The deepest offset the vendor will serve. */
  offsetCeiling: number;
  /** What one `limit 1` count probe costs. */
  probeUsd: number;
  /** How many times one offset may be attempted before the walk refuses and names the cell. */
  maxAttempts: number;
}

/**
 * ‼️ 2,000 IS A PAGING BUDGET, NOT A DENSITY OPINION. It is four pages at limit 500, which is a cell
 * a person can watch finish. Raising it makes cells slower to complete and cheaper to measure;
 * lowering it buys more probes. It is safe to change in either direction because a cell that has
 * ALREADY been split stays split (see `isSplit`), so a raise cannot strand an interior node.
 *
 * probeUsd is measured, not listed: $0.012 per task plus $0.00036 per record, and a count probe asks
 * for exactly one record.
 */
export const CELL_BUDGET_DEFAULT: CellBudget = {
  cellMax: 2000,
  floorKm: CELL_FLOOR_KM,
  offsetCeiling: 100_000,
  probeUsd: 0.0124,
  maxAttempts: 3,
};

export type CellAction =
  /** Measure these circles. They have no row yet, so nothing is known about them. */
  | { kind: "probe"; cells: Cell[]; costUsd: number }
  /** Buy records from this measured cell, starting here. */
  | { kind: "pull"; cell: CellRow; offset: number; limit: number; pageOf: [number, number] }
  /** Everything reachable is measured and paged. */
  | { kind: "done"; cells: number; records: number }
  /** Something is wrong that guessing would hide. */
  | { kind: "refuse"; reason: string };

/**
 * Is this cell an interior node rather than something to page?
 *
 * Three ways to be one, and the first is what makes the budget safe to change:
 *
 * 1. A child row already exists. Somebody paid to split this cell, so it stays split. Without this
 *    clause, RAISING cellMax would make the walk try to page a circle whose children are already
 *    measured and half-paged, and it would buy the same businesses twice under two different cells.
 * 2. It holds more than the paging budget, and it is above the floor.
 * 3. It holds more than the vendor will serve by offset, and it is above the floor. This is the
 *    ceiling enforced structurally: such a cell is never a leaf, so no offset past the cap is ever
 *    emitted for it in the first place.
 */
export function isSplit(
  row: CellRow,
  byKey: ReadonlyMap<string, CellRow>,
  budget: CellBudget = CELL_BUDGET_DEFAULT
): boolean {
  const kids = childrenOf(row);
  if (kids.length && kids.some((k) => byKey.has(cellKey(k)))) return true;
  if (row.radiusKm <= budget.floorKm) return false;
  return row.totalCount > budget.cellMax || row.totalCount > budget.offsetCeiling;
}

/**
 * How far into this cell the lane has already paged.
 *
 * ‼️ DEPTH IS `offset + limit` OF THE DEEPEST LANDED PULL. NOT A COUNT OF PULLS, AND NOT A SUM OF
 * ROWS DELIVERED. This arithmetic is carried over verbatim from the metro queue it replaces, along
 * with the reason: offset plus limit is where the vendor stopped looking, which is the only number
 * the next pull can safely start from. Summing rows delivered would drift below it the moment any
 * page came back short, and re-pull ground already covered.
 *
 * ‼️ AND THE DEEPEST WINS, NOT THE MOST RECENT. A human can name a deep offset by hand, so pulls
 * arrive out of order; the frontier is the maximum.
 *
 * ‼️ UNFINISHED PULLS ARE IGNORED ENTIRELY. See MapsPull.finished: a label survives a pull that
 * errored and bought nothing, so counting it would step the frontier over records that were never
 * purchased. This is the one line that satisfies "a pull that errors leaves its cell unfinished".
 */
export function cellDepthFrom(
  vertical: string,
  key: string,
  history: readonly CellPull[]
): number {
  let depth = 0;
  for (const pull of history) {
    if (!pull.finished) continue;
    const parsed = parseMapsCommand(pull.label);
    if (!parsed.ok) continue; // An unreadable label is skipped, never thrown on.
    if (parsed.command.vertical !== vertical) continue;
    // A string comparison, which is exactly why cellKey has one spelling and parseMapsCommand
    // re-canonicalises the triple before it is stored.
    if (parsed.command.metro !== key) continue;
    depth = Math.max(depth, parsed.command.offset + parsed.command.limit);
  }
  return depth;
}

/**
 * How many times this exact offset has been attempted, landed or not.
 *
 * The companion to `cellDepthFrom` ignoring failures: without a cap, a cell that fails every time
 * would be offered forever, and the lane would spend a reaction on it every tick.
 */
export function attemptsAt(
  vertical: string,
  key: string,
  offset: number,
  history: readonly CellPull[]
): number {
  let n = 0;
  for (const pull of history) {
    const parsed = parseMapsCommand(pull.label);
    if (!parsed.ok) continue;
    if (parsed.command.vertical !== vertical) continue;
    if (parsed.command.metro !== key) continue;
    if (parsed.command.offset === offset) n += 1;
  }
  return n;
}

/**
 * How far this cell can be paged: its measurement, clamped to what the vendor will serve.
 *
 * The clamp is the third of the three places the offset ceiling is enforced, and it is the one that
 * catches a cell at the floor which is too dense to split. `nextCellAction` refuses such a cell
 * rather than paging the first 100,000 and calling it finished, because silently truncating is how a
 * gap becomes invisible.
 */
export function pageableTo(row: CellRow, budget: CellBudget = CELL_BUDGET_DEFAULT): number {
  return Math.min(row.totalCount, budget.offsetCeiling);
}

/** A cell row is finished when it has been paged to its measurement. */
function isPaged(row: CellRow, depth: number, budget: CellBudget): boolean {
  return depth >= pageableTo(row, budget);
}

/**
 * The next thing to do, for one vertical and one category list.
 *
 * ‼️ ONE SEED SUBTREE AT A TIME, AND THAT IS WHAT MAKES PROGRESS READ BY STATE. Measuring the whole
 * country first and then paging it would be cheaper by a few probes and would leave the campaign
 * reporting a band of half-done cells across the map for weeks. Finishing one seed's subtree before
 * starting the next is what turns the readout into "Texas, then Florida", which is the question
 * somebody actually asks.
 *
 * ‼️ ORDER IS THE PLAN, exactly as the fifty-metro list said. seedGrid()'s order is the campaign's
 * order and childrenOf()'s order is the order inside a cell.
 */
export function nextCellAction(args: {
  vertical: string;
  categoriesKey: string;
  rows: readonly CellRow[];
  history: readonly CellPull[];
  /** The limit a pull would ask for. Trimmed down on the last page so depth lands exactly. */
  limit: number;
  /** How many circles one probe step may measure. */
  probeBatch: number;
  budget?: CellBudget;
}): CellAction {
  const budget = args.budget ?? CELL_BUDGET_DEFAULT;
  const mine = args.rows.filter(
    (r) => r.verticalSlug === args.vertical && r.categoriesKey === args.categoriesKey
  );
  const byKey = new Map(mine.map((r) => [r.key, r]));

  let measured = 0;
  let records = 0;

  // The frontier of unmeasured circles, gathered across the whole walk so one probe step can fill a
  // subtree rather than one cell at a time.
  const unmeasured: Cell[] = [];

  /** Depth-first, in seedGrid/childrenOf order. Returns a pull as soon as one is owed. */
  const visit = (cell: Cell): CellAction | null => {
    const key = cellKey(cell);
    const row = byKey.get(key);

    if (!row) {
      // Not measured. Collect it, and do NOT descend: what its children should be cannot be known
      // until its own count says whether it splits at all.
      if (unmeasured.length < args.probeBatch) unmeasured.push(cell);
      return null;
    }

    measured += 1;

    if (isSplit(row, byKey, budget)) {
      for (const kid of childrenOf(cell)) {
        const action = visit(kid);
        if (action) return action;
      }
      // ‼️ A CELL OVER THE BUDGET THAT CANNOT SPLIT IS REFUSED, NOT TRUNCATED. isSplit only returns
      // true above the floor, so reaching here with no children means the geometry and the budget
      // disagree, which is a bug rather than a business fact.
      if (!childrenOf(cell).length) {
        return {
          kind: "refuse",
          reason:
            "cell `" + key + "` holds " + row.totalCount + " and cannot be split, but the budget " +
            "says it must be. That is a contradiction in the geometry rather than a fact about the " +
            "map, so nothing was bought.",
        };
      }
      return null;
    }

    const depth = cellDepthFrom(args.vertical, key, args.history);
    const ceiling = pageableTo(row, budget);
    records += Math.min(depth, ceiling);

    // A cell at the floor holding more than the vendor will serve. Practically unreachable at 12km
    // (Manhattan's densest 10km is 2,862) but refusing beats quietly stopping at 100,000.
    if (row.totalCount > budget.offsetCeiling && row.radiusKm <= budget.floorKm) {
      return {
        kind: "refuse",
        reason:
          "cell `" + key + "` holds " + row.totalCount + ", which is past the offset ceiling of " +
          budget.offsetCeiling + ", and it is already at the " + budget.floorKm + "km floor so it " +
          "cannot be split. Paging it would silently stop short. Narrow the categories instead.",
      };
    }

    if (isPaged(row, depth, budget)) return null;

    const attempts = attemptsAt(args.vertical, key, depth, args.history);
    if (attempts >= budget.maxAttempts) {
      return {
        kind: "refuse",
        reason:
          "cell `" + key + "` has been tried " + attempts + " times at offset " + depth +
          " and has not landed. Nothing was bought. Look at why that pull is failing before the " +
          "campaign goes on, or name the cell by hand to retry it.",
      };
    }

    // ‼️ THE LAST PAGE IS ASKED FOR EXACTLY, WHICH IS WHAT "STOPS AT total_count" MEANS LITERALLY.
    // A cell holding 1,766 is paged 0, 500, 1000 and then `offset 1500 limit 266`, so depth lands on
    // 1,766 and no request is ever made past it. Asking for a full 500 there would work and would
    // leave depth at 2,000, which then reads as "paged past its own measurement" to anything
    // comparing the two.
    const limit = Math.min(args.limit, ceiling - depth);
    const pageIndex = Math.floor(depth / Math.max(1, args.limit)) + 1;
    const pageCount = Math.max(1, Math.ceil(ceiling / Math.max(1, args.limit)));
    return { kind: "pull", cell: row, offset: depth, limit, pageOf: [pageIndex, pageCount] };
  };

  for (const seed of seedGrid()) {
    const action = visit(seed);
    if (action) return action;
    // One subtree at a time: as soon as a seed has owed measurements, stop and go measure them,
    // rather than walking the rest of the country collecting a nationwide probe list.
    if (unmeasured.length) break;
  }

  if (unmeasured.length) {
    return {
      kind: "probe",
      cells: unmeasured,
      costUsd: unmeasured.length * budget.probeUsd,
    };
  }

  return { kind: "done", cells: measured, records };
}

export interface StateProgress {
  state: string;
  cells: number;
  measured: number;
  split: number;
  /** Leaf cells paged to their measurement. */
  done: number;
  /** What the measurements say is there, across leaf cells only, so nothing is double counted. */
  businesses: number;
  /** How many of those have been paged. */
  paged: number;
}

/**
 * Progress by state, from the reverse-geocoded cell centres.
 *
 * ‼️ TWO BUCKETS THAT ARE NOT STATES, AND BOTH ARE HONEST RATHER THAN TIDY. `unplaced` is a cell
 * whose centre has not been reverse-geocoded yet or could not be resolved: it is reported as such and
 * never folded into a neighbour. `offshore` is a centre that resolved outside the United States,
 * which is most of the ocean seeds, and collecting them under one name turns 20-odd zero cells from
 * noise into a useful line: measured, empty, finished, never looked at again.
 *
 * ‼️ AND A SEED'S STATE IS A BUCKET LABEL, NOT A BOUNDARY CLAIM. A 384km circle spans four states.
 * The label is near-exact at the 12km floor, which is where the records are, and the card says so in
 * words. How many LEADS are in each state is a different question, answered from raw_leads.state.
 */
export function stateProgress(args: {
  vertical: string;
  categoriesKey: string;
  rows: readonly CellRow[];
  history: readonly CellPull[];
  budget?: CellBudget;
}): StateProgress[] {
  const budget = args.budget ?? CELL_BUDGET_DEFAULT;
  const mine = args.rows.filter(
    (r) => r.verticalSlug === args.vertical && r.categoriesKey === args.categoriesKey
  );
  const byKey = new Map(mine.map((r) => [r.key, r]));

  const buckets = new Map<string, StateProgress>();
  const bucketOf = (row: CellRow): StateProgress => {
    const name = row.stateName ?? "unplaced";
    const existing = buckets.get(name);
    if (existing) return existing;
    const fresh: StateProgress = {
      state: name,
      cells: 0,
      measured: 0,
      split: 0,
      done: 0,
      businesses: 0,
      paged: 0,
    };
    buckets.set(name, fresh);
    return fresh;
  };

  for (const row of mine) {
    const b = bucketOf(row);
    b.cells += 1;
    b.measured += 1;
    if (isSplit(row, byKey, budget)) {
      b.split += 1;
      // ‼️ AN INTERIOR NODE'S COUNT IS NOT ADDED. A parent's total_count is not the sum of its
      // children's, and adding both would double count the whole subtree.
      continue;
    }
    const depth = cellDepthFrom(args.vertical, row.key, args.history);
    const ceiling = pageableTo(row, budget);
    b.businesses += ceiling;
    b.paged += Math.min(depth, ceiling);
    if (depth >= ceiling) b.done += 1;
  }

  // Most businesses first, because that is the order somebody works them in. The two non-state
  // buckets sort to the bottom regardless, since they are bookkeeping rather than territory.
  const rank = (s: StateProgress): number => (s.state === "unplaced" || s.state === "offshore" ? 1 : 0);
  return [...buckets.values()].sort(
    (a, b) => rank(a) - rank(b) || b.businesses - a.businesses || a.state.localeCompare(b.state)
  );
}

/**
 * The command string for a cell pull.
 *
 * ‼️ BUILT AS TEXT AND RE-PARSED BY THE CALLER, SO THERE IS EXACTLY ONE PARSER. The label stored on
 * the batch is the same shape a person would have typed, which is what lets `postPullEstimate` re-read
 * it and `cellDepthFrom` join on it. The metro slot is the cell key verbatim.
 */
export function cellPullCommand(args: {
  vertical: string;
  query: string;
  cell: Cell;
  limit: number;
  offset: number;
  source: MapsSource;
}): string {
  return (
    "pull maps " + args.vertical +
    " | " + cellKey(args.cell) +
    " | " + args.query +
    " | limit " + args.limit +
    " | offset " + args.offset +
    " | via " + args.source
  );
}

export type CellsParse =
  | { ok: true; command: { vertical: string; probeBatch: number } }
  | { ok: false; reason: string };

/** How many circles one `cells` step measures by default. */
export const PROBE_BATCH_DEFAULT = 16;

/**
 * ‼️ THE CAP IS THE LAMBDA, NOT THE MONEY. Each probe is a synchronous vendor call inside the
 * reaction handler, the same shape `pullFromDataForSeo` already has, and the route's budget is 300
 * seconds. 16 leaves generous headroom; 50 would not, and a step that times out half way leaves rows
 * stored and a batch to fail by hand.
 */
const PROBE_BATCH_MAX = 40;

/**
 * `cells medspa` or `cells medspa | probes 24`.
 *
 * Returns null when the text is not this shape at all, so the caller can fall through to the general
 * assistant, the same contract `parseNextMetroCommand` has.
 */
export function parseCellsCommand(text: string): CellsParse | null {
  const t = text.trim().replace(/^`+|`+$/g, "").trim();
  if (!/^cells\b/i.test(t)) return null;

  const parts = t.replace(/^cells\b/i, "").split("|").map((p) => p.trim()).filter(Boolean);
  // ‼️ A BARE `cells` FALLS THROUGH RATHER THAN REFUSING. It reads as a question about the map, not an
  // instruction to buy measurements of it, so the caller answers it with the coverage card. Refusing
  // here would make the most natural thing to type an error message.
  if (!parts.length) return null;

  const vertical = parts[0].toLowerCase().replace(/\s+/g, "");
  let probeBatch = PROBE_BATCH_DEFAULT;
  for (const tail of parts.slice(1)) {
    const m = /^probes\s+(\d{1,3})$/i.exec(tail);
    if (!m) {
      return { ok: false, reason: "I did not understand `" + tail + "`. The only option is `probes <n>`." };
    }
    probeBatch = Number(m[1]);
    if (probeBatch < 1 || probeBatch > PROBE_BATCH_MAX) {
      return {
        ok: false,
        reason:
          "`probes " + probeBatch + "` is outside 1 to " + PROBE_BATCH_MAX + ". Each probe is a " +
          "synchronous call inside one reaction, and the route has 300 seconds.",
      };
    }
  }

  return { ok: true, command: { vertical, probeBatch } };
}
