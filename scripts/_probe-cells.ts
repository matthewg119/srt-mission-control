// Probe: the national cell grid, offline.
//
//   bunx tsx scripts/_probe-cells.ts     pure checks, no network, no DB, no Slack, no spend
//
// This file decides WHICH CIRCLES EXIST, so the question it answers is not "does the geometry look
// right" but "is there anywhere in the United States that no cell covers". A gap here does not
// produce a bad number, it produces businesses that are never fetched, and an unfetched row leaves
// nothing behind to notice it is missing. Three rails carry that weight and all three are asserted
// by name below:
//
//   1. A key has exactly one spelling. Two spellings of one circle means two probes bought, two rows
//      stored, and a paging depth that joins to neither.
//   2. Four children COVER their parent. The naive "half the parent's radius" rule does not, and the
//      slivers it leaves are measured in section 3 rather than argued about.
//   3. Every landmark in the country lands in some seed cell. This is the only check that would
//      actually catch a hole in the middle of Nebraska.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE, the same rule
// _probe-scraper.ts and _probe-scraper-dedup.ts state: checks written below them never run, and that
// has already happened once in this repo.

import {
  CELL_FLOOR_KM,
  CELL_KEY_DP,
  CELL_RADIUS_KM_MAX,
  KM_PER_DEG_LAT,
  SEED_RADIUS_KM,
  categoriesKey,
  cellBox,
  cellKey,
  childrenOf,
  containsPoint,
  halfSideKm,
  parseCellKey,
  radiusCovering,
  roundCell,
  seedGrid,
  type Cell,
} from "../src/lib/scraper/cells";
import {
  CELL_BUDGET_DEFAULT,
  attemptsAt,
  cellDepthFrom,
  cellPullCommand,
  isSplit,
  nextCellAction,
  pageableTo,
  parseCellsCommand,
  stateProgress,
  type CellPull,
  type CellRow,
} from "../src/lib/scraper/coverage";
import { parseMapsCommand, parseNextMetroCommand } from "../src/lib/scraper/maps-command";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

// ── 1. Keys: one circle, one string ──────────────────────────────────────────
{
  const dallas: Cell = { lat: 32.7767, lon: -96.797, radiusKm: 24 };
  eq("a key is lat,lon,radius at 4dp", cellKey(dallas), "32.7767,-96.7970,24");
  check("a negative longitude keeps its trailing zero", cellKey(dallas).endsWith(",-96.7970,24"));

  const round = parseCellKey("32.7767,-96.7970,24");
  eq("a key parses back to the same numbers", round, { lat: 32.7767, lon: -96.797, radiusKm: 24 });
  eq("and re-renders byte-identically", round ? cellKey(round) : null, "32.7767,-96.7970,24");

  // ‼️ THE ROUND TRIP IS WHAT THE BATCH LABEL RELIES ON. postPullEstimate re-reads the label and
  // cellDepthFrom joins on it as a STRING, so a key that does not survive the trip unchanged means a
  // cell whose paging depth is always zero: it would be pulled from offset 0 forever.
  for (const k of ["32.7767,-96.7970,24", "0.0000,0.0000,1", "-33.8688,151.2093,384", "71.2906,-156.7886,195"]) {
    const c = parseCellKey(k);
    eq("round trip survives " + k, c ? cellKey(c) : null, k);
  }

  eq("rounding pins the stored precision", roundCell({ lat: 32.77671234, lon: -96.79709876, radiusKm: 23.6 }), {
    lat: 32.7767,
    lon: -96.7971,
    radiusKm: 24,
  });
  eq("CELL_KEY_DP is 4", CELL_KEY_DP, 4);
}

// A refusal, never a guess. Each of these would otherwise become a circle nobody asked about.
{
  const bad: Array<[string, string]> = [
    ["a metro name is not a cell", "Dallas TX"],
    ["two numbers are not a cell", "32.7767,-96.7970"],
    ["four numbers are not a cell", "32.7767,-96.7970,24,9"],
    ["a latitude past the pole is refused", "91.0,0.0,10"],
    ["a longitude past the meridian is refused", "0.0,181.0,10"],
    ["a zero radius is refused rather than read as a point", "32.7767,-96.7970,0"],
    ["a fractional radius is refused rather than rounded", "32.7767,-96.7970,24.5"],
    ["a radius past the cap is refused", "0.0,0.0," + (CELL_RADIUS_KM_MAX + 1)],
    ["text in the radius is refused", "32.7767,-96.7970,x"],
    ["empty is refused", ""],
    ["an option token is not a cell", "limit 500"],
  ];
  for (const [label, text] of bad) check(label, parseCellKey(text) === null, "parsed " + text);
}

// ── 2. The box, and that containment is the box rather than the circle ───────
{
  const c: Cell = { lat: 0, lon: 0, radiusKm: 100 };
  const b = cellBox(c);
  const h = halfSideKm(100);
  check("half side is radius / sqrt 2", Math.abs(h - 100 / Math.SQRT2) < 1e-9);
  check("the box is symmetric in latitude", Math.abs((b.north - 0) - (0 - b.south)) < 1e-12);
  check(
    "the box's latitude half span is the half side in degrees",
    Math.abs((b.north - b.south) / 2 - h / KM_PER_DEG_LAT) < 1e-9
  );
  check("the centre is inside its own cell", containsPoint(c, 0, 0));
  check("a point just past the north edge is outside", !containsPoint(c, b.north + 0.001, 0));
  check("a point just past the east edge is outside", !containsPoint(c, 0, b.east + 0.001));

  // ‼️ THE CORNER IS THE POINT OF THE BOX/CIRCLE SPLIT. A corner of the box is sqrt2 times the half
  // side from the centre, which is exactly the radius, so it sits ON the circle. Anything beyond the
  // box but inside the circle is slop the cell does NOT own, and no containment test may claim it.
  check("a point beyond the box is not contained even though the circle reaches it", !containsPoint(c, b.north + 0.2, b.east + 0.2));
}

// Longitude degrees shrink with latitude. Inverting this is the mistake that silently leaves gaps,
// so the direction is pinned rather than assumed.
{
  const lo = cellBox({ lat: 25, lon: 0, radiusKm: 384 });
  const hi = cellBox({ lat: 49, lon: 0, radiusKm: 384 });
  const loSpan = lo.east - lo.west;
  const hiSpan = hi.east - hi.west;
  check(
    "the same radius spans MORE degrees of longitude at 49N than at 25N",
    hiSpan > loSpan,
    "49N " + hiSpan.toFixed(4) + " vs 25N " + loSpan.toFixed(4)
  );
  check(
    "while the latitude span is identical at both",
    Math.abs((lo.north - lo.south) - (hi.north - hi.south)) < 1e-12
  );
}

// ── 3. Children COVER their parent. This is the anti-gap rail ────────────────
{
  const parent: Cell = { lat: 32.7767, lon: -96.797, radiusKm: 384 };
  const kids = childrenOf(parent);
  eq("a cell splits into four", kids.length, 4);
  check("every child radius is a whole number", kids.every((k) => Number.isInteger(k.radiusKm)));
  check("every child is smaller than its parent", kids.every((k) => k.radiusKm < parent.radiusKm));
  check(
    "and roughly half, within the covering correction",
    kids.every((k) => k.radiusKm >= 192 && k.radiusKm <= 200),
    kids.map((k) => k.radiusKm).join(", ")
  );

  // ‼️ THE PROPERTY THAT MATTERS, ASSERTED AS COVERAGE RATHER THAN AS TILING. The naive rule
  // (child radius = parent radius / 2) passes a "four boxes tile the parent" test written in degrees
  // and still leaves 1.3 to 3.3 km of the parent uncovered, because a child's own box is computed at
  // the CHILD's latitude. So the assertion is the one that would have caught it: sample the parent's
  // box densely and require every sample to land in some child.
  for (const lat of [25, 30, 40, 49, 60, 71]) {
    const p = roundCell({ lat, lon: -100, radiusKm: SEED_RADIUS_KM });
    const box = cellBox(p);
    const children = childrenOf(p);
    let uncovered = 0;
    const N = 21;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const y = box.south + ((box.north - box.south) * i) / N;
        const x = box.west + ((box.east - box.west) * j) / N;
        if (!children.some((k) => containsPoint(k, y, x))) uncovered++;
      }
    }
    check(
      "every point of a " + lat + "N parent's box is covered by one of its four children",
      uncovered === 0,
      uncovered + " of " + (N + 1) ** 2 + " sample points fell through"
    );
  }

  // The children must also not wander outside the parent by more than the covering correction, or
  // the tree would drift off the country it was seeded from.
  for (const lat of [25, 49]) {
    const p = roundCell({ lat, lon: -100, radiusKm: SEED_RADIUS_KM });
    const box = cellBox(p);
    check(
      "children of a " + lat + "N cell stay near their parent's box",
      childrenOf(p).every((k) => k.lat > box.south && k.lat < box.north && k.lon > box.west && k.lon < box.east)
    );
  }
}

// The floor, and that the ladder terminates.
{
  eq("a cell at the floor does not split", childrenOf({ lat: 30, lon: -100, radiusKm: CELL_FLOOR_KM }), []);
  eq("nor does one below it", childrenOf({ lat: 30, lon: -100, radiusKm: CELL_FLOOR_KM - 1 }), []);
  check("a cell above the floor does split", childrenOf({ lat: 30, lon: -100, radiusKm: CELL_FLOOR_KM + 1 }).length === 4);

  // ‼️ TERMINATION IS NOT OBVIOUS AND IS THEREFORE ASSERTED. radiusCovering rounds UP, so a child is
  // not strictly half its parent, and a rounding rule that ever returned the parent's own radius
  // would make the walk split the same cell forever, buying four probes a tick.
  let deepest = 0;
  const walk = (c: Cell, depth: number): void => {
    deepest = Math.max(deepest, depth);
    if (depth > 12) return; // a runaway guard, so a broken rule fails the check rather than hanging
    for (const k of childrenOf(c)) {
      check("a child is strictly smaller than its parent at depth " + depth, k.radiusKm < c.radiusKm);
      walk(k, depth + 1);
    }
  };
  walk(roundCell({ lat: 32.7767, lon: -96.797, radiusKm: SEED_RADIUS_KM }), 0);
  check("the ladder from a seed terminates in at most 6 levels", deepest <= 6, "reached depth " + deepest);
}

// radiusCovering itself: the radius it returns must actually cover what was asked for.
{
  for (const lat of [0, 25, 40, 49, 71]) {
    const halfLat = 1.2;
    const halfLon = 1.4;
    const r = radiusCovering(lat, halfLat, halfLon);
    const b = cellBox({ lat, lon: 0, radiusKm: r });
    check(
      "radiusCovering(" + lat + ") covers the latitude span it was given",
      (b.north - b.south) / 2 >= halfLat - 1e-9
    );
    check(
      "radiusCovering(" + lat + ") covers the longitude span it was given",
      (b.east - b.west) / 2 >= halfLon - 1e-9
    );
    check("and returns a whole number", Number.isInteger(r));
  }
}

// ── 4. The seed grid covers the country ──────────────────────────────────────
{
  const seeds = seedGrid();
  check("the seed grid is a sane size", seeds.length > 40 && seeds.length < 140, "got " + seeds.length);
  check("every seed radius is a whole number", seeds.every((c) => Number.isInteger(c.radiusKm)));
  check(
    "every seed is at the seed radius",
    seeds.every((c) => c.radiusKm === SEED_RADIUS_KM),
    [...new Set(seeds.map((c) => c.radiusKm))].join(", ")
  );
  check(
    "no two seeds share a key",
    new Set(seeds.map(cellKey)).size === seeds.length,
    seeds.length - new Set(seeds.map(cellKey)).size + " duplicates"
  );
  check("every seed key round-trips", seeds.every((c) => cellKey(parseCellKey(cellKey(c))!) === cellKey(c)));

  // ‼️ THE CHECK THAT WOULD ACTUALLY CATCH A HOLE. One landmark per state plus the extremes in every
  // direction, because a grid that is subtly short in one row fails HERE and passes everything else.
  const landmarks: Array<[string, number, number]> = [
    ["Birmingham AL", 33.5186, -86.8104],
    ["Anchorage AK", 61.2181, -149.9003],
    ["Phoenix AZ", 33.4484, -112.074],
    ["Little Rock AR", 34.7465, -92.2896],
    ["Los Angeles CA", 34.0522, -118.2437],
    ["Denver CO", 39.7392, -104.9903],
    ["Hartford CT", 41.7658, -72.6734],
    ["Wilmington DE", 39.7391, -75.5398],
    ["Washington DC", 38.9072, -77.0369],
    ["Miami FL", 25.7617, -80.1918],
    ["Atlanta GA", 33.749, -84.388],
    ["Honolulu HI", 21.3069, -157.8583],
    ["Boise ID", 43.615, -116.2023],
    ["Chicago IL", 41.8781, -87.6298],
    ["Indianapolis IN", 39.7684, -86.1581],
    ["Des Moines IA", 41.5868, -93.625],
    ["Wichita KS", 37.6872, -97.3301],
    ["Louisville KY", 38.2527, -85.7585],
    ["New Orleans LA", 29.9511, -90.0715],
    ["Portland ME", 43.6591, -70.2568],
    ["Baltimore MD", 39.2904, -76.6122],
    ["Boston MA", 42.3601, -71.0589],
    ["Detroit MI", 42.3314, -83.0458],
    ["Minneapolis MN", 44.9778, -93.265],
    ["Jackson MS", 32.2988, -90.1848],
    ["Kansas City MO", 39.0997, -94.5786],
    ["Billings MT", 45.7833, -108.5007],
    ["Omaha NE", 41.2565, -95.9345],
    ["Las Vegas NV", 36.1699, -115.1398],
    ["Manchester NH", 42.9956, -71.4548],
    ["Newark NJ", 40.7357, -74.1724],
    ["Albuquerque NM", 35.0844, -106.6504],
    ["New York NY", 40.7128, -74.006],
    ["Charlotte NC", 35.2271, -80.8431],
    ["Fargo ND", 46.8772, -96.7898],
    ["Columbus OH", 39.9612, -82.9988],
    ["Oklahoma City OK", 35.4676, -97.5164],
    ["Portland OR", 45.5152, -122.6784],
    ["Philadelphia PA", 39.9526, -75.1652],
    ["Providence RI", 41.824, -71.4128],
    ["Charleston SC", 32.7765, -79.9311],
    ["Sioux Falls SD", 43.546, -96.7313],
    ["Nashville TN", 36.1627, -86.7816],
    ["Houston TX", 29.7604, -95.3698],
    ["Salt Lake City UT", 40.7608, -111.891],
    ["Burlington VT", 44.4759, -73.2121],
    ["Virginia Beach VA", 36.8529, -75.978],
    ["Seattle WA", 47.6062, -122.3321],
    ["Charleston WV", 38.3498, -81.6326],
    ["Milwaukee WI", 43.0389, -87.9065],
    ["Cheyenne WY", 41.14, -104.8202],
    // The extremes, which are where a short row shows up first.
    ["Key West FL (southernmost)", 24.5551, -81.78],
    ["Utqiagvik AK (northernmost)", 71.2906, -156.7886],
    ["Eastport ME (easternmost)", 44.9062, -66.99],
    ["Cape Alava WA (westernmost)", 48.1667, -124.7333],
    ["Point Roberts WA (border)", 48.9784, -123.0687],
    ["Brownsville TX (border)", 25.9017, -97.4975],
    ["Ketchikan AK (panhandle)", 55.3422, -131.6461],
    ["Lihue HI (west isles)", 21.9811, -159.3711],
    ["Hilo HI (east isles)", 19.7297, -155.09],
  ];
  const missed = landmarks.filter(([, lat, lon]) => !seeds.some((c) => containsPoint(c, lat, lon)));
  check(
    "every landmark in the United States lands in a seed cell",
    missed.length === 0,
    missed.map((m) => m[0]).join("; ")
  );

  // ‼️ THE NAMED GAPS STAY NAMED. If somebody later widens a box and accidentally covers these, the
  // comment in cells.ts becomes a lie, and a lie in a coverage comment is worse than the gap.
  const excluded: Array<[string, number, number]> = [
    ["Adak AK, west of 170W", 51.88, -176.65],
    ["San Juan PR", 18.4655, -66.1057],
    ["Hagatna GU", 13.4745, 144.7504],
  ];
  for (const [name, lat, lon] of excluded) {
    check(
      "the documented gap is genuinely a gap: " + name,
      !seeds.some((c) => containsPoint(c, lat, lon))
    );
  }

  // Nothing should be covered twice over by a wildly redundant grid: a rough sanity bound on cost.
  check(
    "the grid is not absurdly redundant",
    seeds.length * SEED_RADIUS_KM ** 2 < 40_000_000,
    seeds.length + " cells at " + SEED_RADIUS_KM + "km"
  );
}

// ── 5. The category key ──────────────────────────────────────────────────────
{
  eq("categories are sorted so order cannot make two questions", categoriesKey(["skin_care_clinic", "facial_spa", "medical_spa"]), "facial_spa+medical_spa+skin_care_clinic");
  eq("and the same list in another order is the same key", categoriesKey(["medical_spa", "facial_spa", "skin_care_clinic"]), "facial_spa+medical_spa+skin_care_clinic");
  eq("case and padding do not make a second key", categoriesKey([" Medical_Spa ", "FACIAL_SPA"]), "facial_spa+medical_spa");
  eq("an empty list is an empty key", categoriesKey([]), "");
  check("an added category CHANGES the key, which is the point", categoriesKey(["medical_spa", "day_spa"]) !== categoriesKey(["medical_spa"]));
}

// ── 6. The walk: one assertion per Definition-of-done bullet ─────────────────
const VERT = "medspa";
const CATS = categoriesKey(["medical_spa", "facial_spa", "skin_care_clinic"]);

function row(cell: Cell, totalCount: number, stateName: string | null = "Texas"): CellRow {
  return {
    ...cell,
    key: cellKey(cell),
    verticalSlug: VERT,
    categoriesKey: CATS,
    totalCount,
    stateName,
    parentKey: null,
    depth: 0,
  };
}

/** A landed pull of a cell, as a label plus its outcome, exactly as mapsPullHistory reports one. */
function pull(cell: Cell, offset: number, limit: number, finished = true, rawCount = limit): CellPull {
  return {
    label: cellPullCommand({ vertical: VERT, query: "med spa", cell, limit, offset, source: "dataforseo" }),
    rawCount,
    finished,
  };
}

const SEEDS = seedGrid();
const FIRST = SEEDS[0];

const act = (rows: readonly CellRow[], history: readonly CellPull[], limit = 500, probeBatch = 16) =>
  nextCellAction({ vertical: VERT, categoriesKey: CATS, rows, history, limit, probeBatch });

// With nothing measured, the first thing to do is measure, and it must not be a pull.
{
  const a = act([], []);
  eq("with no rows at all the walk probes", a.kind, "probe");
  check("and it starts at the first seed", a.kind === "probe" && cellKey(a.cells[0]) === cellKey(FIRST));
  check("a probe step is bounded by probeBatch", a.kind === "probe" && a.cells.length <= 16);
  check(
    "and it costs the measured probe price",
    a.kind === "probe" && Math.abs(a.costUsd - a.cells.length * 0.0124) < 1e-9
  );
}

// ‼️ BULLET 1. A cell whose total_count is 0 is DONE, not retried. This is the one no derive-only
// design can satisfy: an empty circle leaves behind no batch, no run and no lead row.
{
  const rows = SEEDS.map((s) => row(s, 0, "offshore"));
  const a = act(rows, []);
  eq("every cell measured at zero leaves nothing to do", a.kind, "done");
  eq("and all of them count as measured", a.kind === "done" ? a.cells : -1, SEEDS.length);
  eq("with no records claimed", a.kind === "done" ? a.records : -1, 0);
  // Asked again, it still does not buy anything. A zero cell is never re-probed.
  eq("and asking again still buys nothing", act(rows, []).kind, "done");
}

// A measured, under-budget cell is paged rather than split.
{
  const rows = [row(FIRST, 1766), ...SEEDS.slice(1).map((s) => row(s, 0, "offshore"))];
  const a = act(rows, []);
  eq("an under-budget cell is pulled", a.kind, "pull");
  eq("from the top", a.kind === "pull" ? a.offset : -1, 0);
  eq("at the asked-for limit", a.kind === "pull" ? a.limit : -1, 500);
  eq("and it reports which page of how many", a.kind === "pull" ? a.pageOf : null, [1, 4]);
}

// ‼️ BULLET 4. Paging stops EXACTLY at total_count, with no request past it.
{
  const rows = [row(FIRST, 1766), ...SEEDS.slice(1).map((s) => row(s, 0, "offshore"))];
  const history: CellPull[] = [];
  const offsets: number[] = [];
  const limits: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = act(rows, history);
    if (a.kind !== "pull") break;
    offsets.push(a.offset);
    limits.push(a.limit);
    history.push(pull(FIRST, a.offset, a.limit));
  }
  eq("1,766 pages at exactly these offsets", offsets, [0, 500, 1000, 1500]);
  eq("and the last page is trimmed so depth lands on the measurement", limits, [500, 500, 500, 266]);
  check("no offset is ever emitted at or past the count", offsets.every((o) => o < 1766));
  check("offset 2000 is never asked for", !offsets.includes(2000));
  eq("and then the cell is finished", act(rows, history).kind, "done");
  eq(
    "the records it claims are exactly its measurement",
    (() => { const a = act(rows, history); return a.kind === "done" ? a.records : -1; })(),
    1766
  );
}

// ‼️ BULLET 2. A cell over the budget splits, and its children become the next thing to measure.
{
  const rows = [row(FIRST, 50_000), ...SEEDS.slice(1).map((s) => row(s, 0, "offshore"))];
  const a = act(rows, []);
  eq("an over-budget cell is not pulled but probed", a.kind, "probe");
  const kids = childrenOf(FIRST).map(cellKey);
  check(
    "and what gets probed is its own four children",
    a.kind === "probe" && a.cells.length === 4 && a.cells.every((c) => kids.includes(cellKey(c))),
    a.kind === "probe" ? a.cells.map(cellKey).join(" ") : String(a.kind)
  );

  // ‼️ AND THE PARENT IS NEVER PULLED ONCE A CHILD EXISTS. This is the clause that makes the budget
  // safe to change: raising cellMax must not make the walk page a circle whose children are already
  // being worked, or the same businesses get bought twice under two different cells.
  const withOneChild = [...rows, row(childrenOf(FIRST)[0], 10)];
  const generous = { ...CELL_BUDGET_DEFAULT, cellMax: 1_000_000 };
  const a2 = nextCellAction({
    vertical: VERT, categoriesKey: CATS, rows: withOneChild, history: [], limit: 500,
    probeBatch: 16, budget: generous,
  });
  check(
    "a cell that was already split stays split even if the budget is raised past its count",
    a2.kind !== "pull" || a2.cell.key !== cellKey(FIRST),
    "walk offered " + (a2.kind === "pull" ? a2.cell.key : a2.kind)
  );
}

// ‼️ BULLET 3. A pull that ERRORS leaves its cell unfinished. The bug this replaces advanced the
// frontier over 500 records that were never bought, because the label survives a failed pull.
{
  const rows = [row(FIRST, 1766), ...SEEDS.slice(1).map((s) => row(s, 0, "offshore"))];
  const landed = [pull(FIRST, 0, 500)];
  eq(
    "after a landed pull the walk moves on to the next page",
    (() => { const a = act(rows, landed); return a.kind === "pull" ? a.offset : -1; })(),
    500
  );

  const errored = [pull(FIRST, 0, 500, false, 0)];
  eq(
    "after an ERRORED pull the SAME offset is offered again",
    (() => { const a = act(rows, errored); return a.kind === "pull" ? a.offset : -1; })(),
    0
  );
  // The precise regression: an errored pull that returned zero rows used to be indistinguishable
  // from an exhausted cell, so the whole cell got skipped.
  check("and the cell is not treated as finished", act(rows, errored).kind === "pull");

  // But it is not offered forever either.
  const thrice = [pull(FIRST, 0, 500, false, 0), pull(FIRST, 0, 500, false, 0), pull(FIRST, 0, 500, false, 0)];
  const a = act(rows, thrice);
  eq("three failures at one offset is a refusal, not a fourth attempt", a.kind, "refuse");
  check("and the refusal names the cell", a.kind === "refuse" && a.reason.includes(cellKey(FIRST)));
}

// ‼️ BULLET 5. No cell is ever paged past the offset ceiling; one that would need to is split.
{
  // Above the floor: the ceiling forces a split even though the count is under no other rule.
  const big = row(FIRST, 150_000);
  const byKey = new Map([[big.key, big]]);
  check("a cell past the offset ceiling is an interior node", isSplit(big, byKey));

  // At the floor: it cannot split, so it is refused rather than truncated at 100,000.
  const floorCell = { lat: 40.7, lon: -74.0, radiusKm: CELL_FLOOR_KM };
  const dense = row(floorCell, 150_000);
  const a = nextCellAction({
    vertical: VERT, categoriesKey: CATS,
    rows: [dense, ...SEEDS.map((s) => row(s, 0, "offshore"))],
    history: [], limit: 500, probeBatch: 16,
  });
  // The floor cell is not on the seed walk, so reaching it requires it to be a descendant; assert the
  // rule directly instead, which is what the walk consults.
  eq("a floor cell past the ceiling is never split", childrenOf(floorCell), []);
  check("and pageableTo clamps it to the ceiling rather than its count", pageableTo(dense) === 100_000);
  check("the seeds still resolve normally around it", a.kind === "done" || a.kind === "pull" || a.kind === "probe");

  // And the clamp holds for an ordinary cell too.
  check("pageableTo is the measurement when it is under the ceiling", pageableTo(row(FIRST, 1766)) === 1766);
}

// Depth arithmetic: the case a page number gets wrong, carried over from the metro queue.
{
  eq(
    "depth follows the limit each pull actually used, not the current one",
    cellDepthFrom(VERT, cellKey(FIRST), [pull(FIRST, 0, 50)]),
    50
  );
  eq(
    "a hand-typed deep offset does not rewind the frontier",
    cellDepthFrom(VERT, cellKey(FIRST), [pull(FIRST, 1000, 500), pull(FIRST, 0, 500)]),
    1500
  );
  eq(
    "another vertical's history does not count",
    cellDepthFrom("dentist", cellKey(FIRST), [pull(FIRST, 0, 500)]),
    0
  );
  eq(
    "another cell's history does not count",
    cellDepthFrom(VERT, cellKey(SEEDS[1]), [pull(FIRST, 0, 500)]),
    0
  );
  eq(
    "an unreadable label is ignored rather than crashing",
    cellDepthFrom(VERT, cellKey(FIRST), [{ label: "some nonsense somebody typed", rawCount: 400, finished: true }]),
    0
  );
  eq("an unfinished pull contributes no depth", cellDepthFrom(VERT, cellKey(FIRST), [pull(FIRST, 0, 500, false, 0)]), 0);
  eq("attemptsAt counts failures too", attemptsAt(VERT, cellKey(FIRST), 0, [pull(FIRST, 0, 500, false, 0)]), 1);
}

// ‼️ BULLET 7. Progress reads out by state, with the two non-state buckets kept honest.
{
  const kids = childrenOf(FIRST);
  const rows: CellRow[] = [
    row(FIRST, 50_000, "Texas"),          // interior: split, count NOT added
    row(kids[0], 1000, "Texas"),
    row(kids[1], 500, "Texas"),
    row(SEEDS[1], 300, "Oklahoma"),
    row(SEEDS[2], 0, "offshore"),
    row(SEEDS[3], 40, null),              // never reverse-geocoded
  ];
  const history = [pull(kids[0], 0, 500)];
  const prog = stateProgress({ vertical: VERT, categoriesKey: CATS, rows, history });
  const tx = prog.find((p) => p.state === "Texas");
  eq("Texas counts three cells", tx?.cells, 3);
  eq("one of which is split", tx?.split, 1);
  // ‼️ 1500, NOT 51500. A parent's count is not the sum of its children's, and adding both would
  // double count the entire subtree.
  eq("and the interior node's count is NOT added to the total", tx?.businesses, 1500);
  eq("paged reflects what actually landed", tx?.paged, 500);
  check("an unresolved centre is reported as unplaced rather than folded into a neighbour", prog.some((p) => p.state === "unplaced"));
  check("and a non-US centre is its own bucket", prog.some((p) => p.state === "offshore"));
  const tail = prog.map((p) => p.state);
  check(
    "the two bookkeeping buckets sort to the bottom",
    tail.indexOf("Texas") < tail.indexOf("offshore") && tail.indexOf("Texas") < tail.indexOf("unplaced")
  );
}

// ── 7. The `cells` command grammar ──────────────────────────────────────────
{
  check("ordinary chat is not a cells command", parseCellsCommand("how many cells are there") === null);
  check("and neither is a maps pull", parseCellsCommand("pull maps medspa") === null);
  const ok = parseCellsCommand("cells medspa");
  check("cells medspa parses", ok?.ok === true);
  eq("with the default probe batch", ok?.ok ? ok.command.probeBatch : -1, 16);
  eq("and the vertical", ok?.ok ? ok.command.vertical : "", "medspa");
  const backticked = parseCellsCommand("`cells medspa`");
  check("Slack code formatting is tolerated, as it is everywhere else in this lane", backticked?.ok === true);
  const withProbes = parseCellsCommand("cells medspa | probes 24");
  eq("probes n is honoured", withProbes?.ok ? withProbes.command.probeBatch : -1, 24);
  // ‼️ A BARE `cells` IS NOT A MEASUREMENT INSTRUCTION. It reads as a question about the map, so it
  // falls through to the coverage card rather than refusing. Returning a refusal here would make the
  // most natural thing to type an error message.
  check("a bare cells falls through rather than refusing", parseCellsCommand("cells") === null);
  check("an absurd probe count is refused rather than clamped", parseCellsCommand("cells medspa | probes 500")?.ok === false);
  check("an unknown option is refused", parseCellsCommand("cells medspa | radius 30")?.ok === false);
}

// ── 8. The grammar changes this build makes to maps-command ─────────────────
{
  // A coordinate triple in the metro slot, round-tripping byte-identically through a label.
  const text = "pull maps medspa | 32.7767,-96.7970,24 | med spa | limit 500 | offset 1500 | via dataforseo";
  const p = parseMapsCommand(text);
  check("a coordinate triple parses as a command", p.ok);
  if (p.ok) {
    eq("the metro slot holds the canonical key", p.command.metro, "32.7767,-96.7970,24");
    eq("the cell is carried", p.command.cell, { lat: 32.7767, lon: -96.797, radiusKm: 24 });
    eq("the radius comes from the triple", p.command.radiusKm, 24);
    eq("the offset survives", p.command.offset, 1500);
    // ‼️ THE PROPERTY cellDepthFrom DEPENDS ON. It joins labels to keys as strings.
    eq("and locationName is NOT decorated into a fake place", p.command.locationName, "32.7767,-96.7970,24");
  }

  // Sloppy precision is canonicalised, or depth would join to nothing.
  const sloppy = parseMapsCommand("pull maps medspa | 32.7767,-96.797,24 | med spa | limit 500");
  check("a triple written with fewer decimals still parses", sloppy.ok);
  eq(
    "and is re-canonicalised so the label matches the cell key",
    sloppy.ok ? sloppy.command.metro : null,
    "32.7767,-96.7970,24"
  );

  // Two radii is a refusal.
  check(
    "a triple plus a radius token is refused rather than reconciled",
    !parseMapsCommand("pull maps medspa | 32.7767,-96.7970,24 | med spa | radius 50").ok
  );

  // The offset ceiling, in the grammar.
  check("an offset past the ceiling is refused", !parseMapsCommand("pull maps medspa | Dallas TX | med spa | offset 110000").ok);
  check("and one at the ceiling is allowed", parseMapsCommand("pull maps medspa | Dallas TX | med spa | offset 100000").ok);

  // The raised radius cap, and the reason it is not unlimited.
  check("radius 384 is allowed, because a seed cell is paged at its own radius", parseMapsCommand("pull maps medspa | Dallas TX | med spa | radius 384").ok);
  check("radius 501 is refused", !parseMapsCommand("pull maps medspa | Dallas TX | med spa | radius 501").ok);
  check(
    "a triple whose radius cannot be paged under the ceiling is refused",
    !parseMapsCommand("pull maps medspa | 39.8,-98.5,3000 | med spa | limit 500").ok
  );

  // ‼️ THE isOptionToken BUG. Before this build, `offset` was not an option token, so this command
  // was read as a pull whose METRO IS NAMED "limit 500" and it reached the geocoder.
  const queue = parseNextMetroCommand("pull maps medspa | limit 500 | offset 500");
  check("the queue form with an offset is now recognised as the queue form", queue !== null);
  check("and it refuses the offset rather than fighting the walk", queue?.ok === false);
  const plain = parseMapsCommand("pull maps medspa | limit 500 | offset 500");
  check("the explicit parser no longer reads it as a metro named 'limit 500'", !plain.ok);

  // ‼️ A MEASUREMENT LABEL MUST NEVER PARSE AS A PULL. The SQL migration argues that `mapsprobe` is a
  // separate workflow value for CORRECTNESS: mapsPullHistory filters on 'mapspull', so a probe's label
  // is invisible to the depth arithmetic. That argument has a second leg worth pinning here, because it
  // is the cheap one to get wrong: even if a probe label DID reach the walk, it must not read as a page
  // of records and credit paging depth to a cell that was only counted.
  for (const label of ["cells medspa | probes 16", "cells dentist | probes 4", "cells medspa"]) {
    check("a measurement label does not parse as a pull: " + label, !parseMapsCommand(label).ok);
    check("nor as the queue form: " + label, parseNextMetroCommand(label) === null);
    eq("and it contributes no depth to any cell: " + label,
      cellDepthFrom(VERT, cellKey(FIRST), [{ label, rawCount: 0, finished: true }]), 0);
  }

  // An ordinary named metro still works and still has no cell.
  const named = parseMapsCommand("pull maps medspa | Dallas TX | med spa | limit 500");
  check("a named metro still parses", named.ok);
  eq("and carries no cell, because it has not been geocoded yet", named.ok ? named.command.cell : "x", null);
  eq("with the metro text untouched", named.ok ? named.command.metro : null, "Dallas TX");
}

// ‼️ The summary and the exit stay the last two statements. Nothing below them runs.
console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
