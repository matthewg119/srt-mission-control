// The country as a grid of circles: what to ask DataForSEO about, and how to split it when the
// answer is too big to page.
//
// ‼️ PURE. No Slack, no database, no network. Same split as rules.ts, filter.ts, geo.ts and
// score.ts, and for the strongest version of the same reason: this decides WHICH CIRCLES EXIST, so
// a mistake here does not produce a bad number, it produces a patch of the United States that no
// pull ever looks at. `scripts/_probe-cells.ts` proves it offline with no API key and no spend.
//
// ‼️ A CELL IS A BOX. THE CIRCLE IS ONLY HOW YOU QUERY IT. This is the one idea the whole design
// rests on, so it is stated first: a cell `(lat, lon, radiusKm)` IS the lat/lon box returned by
// `cellBox`, and the circle of `radiusKm` is the query that returns a superset of it. Boxes tile;
// circles cannot. Coverage is guaranteed by the boxes, and the circle merely has to contain its own
// box, which `radiusCovering` is what enforces.
//
// Why not four circles covering a circle: the optimal four-disc cover of a disc needs children of
// radius 0.7071r, whose union is TWICE the parent's area, and that factor COMPOUNDS at every level.
// With boxes the children tile the parent exactly and the circle-over-box slop is a constant
// pi/2 (about 1.57x) at every depth. Overlap stops compounding, and the leftover overlap is deduped
// downstream by the cross-run place_id rule.
//
// ‼️ THE OVER-COUNT IS IN THE SAFE DIRECTION AND MUST NOT BE "CORRECTED". `total_count` is measured
// over the CIRCLE, which is the box plus its corners, so a cell always reads slightly denser than it
// is. That makes it split slightly early, and it makes paging to the circle's count certainly
// exhaust the box. Scaling the count down by the box/circle area ratio would look tidier and would
// start losing rows at the bottom of every page.

/** A circle to ask about: a centre, and how far around it. The radius is always a whole number. */
export interface Cell {
  lat: number;
  lon: number;
  radiusKm: number;
}

/** The box a cell stands for, in degrees. Derived, never stored. */
export interface CellBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

/**
 * Four decimal places, about 11 metres.
 *
 * ‼️ THE KEY IS THE IDENTITY, SO IT HAS EXACTLY ONE SPELLING. A cell rounded to 4dp in one place and
 * 5dp in another is two cells: two probes bought, two rows stored, and a paging depth that joins to
 * neither. `roundCell` is the only thing allowed to make a storable cell, and `cellKey` the only
 * thing allowed to render one.
 */
export const CELL_KEY_DP = 4;

/**
 * Kilometres per degree of latitude. A constant, because latitude does not shrink.
 *
 * Longitude is the one that moves: a degree of longitude is `KM_PER_DEG_LAT * cos(latitude)` km, so
 * at 49N it is two thirds of what it is at 25N. Every longitude conversion below goes through
 * `kmPerDegLon` for that reason, and the probe pins the direction, because inverting it silently
 * leaves gaps rather than failing.
 */
export const KM_PER_DEG_LAT = 111.32;

/**
 * The radius every seed circle starts at.
 *
 * 384km is chosen against the measurements rather than for roundness: the contiguous US needs 57
 * circles at this size, which is $0.71 to measure once, and a 384km circle in open country is
 * comfortably under the 2,000-record cell budget so most of the empty half of the map is finished by
 * its very first probe and never split at all.
 */
export const SEED_RADIUS_KM = 384;

/**
 * Stop splitting at or below this radius.
 *
 * ‼️ MEASURED, NOT PICKED. Manhattan inside 10km holds 2,862 businesses matching the med spa
 * categories, which is above the 2,000 cell budget and is not a mistake: that neighbourhood really
 * is that dense, and four more probes there would each come back over budget too. A cell this size
 * is six pages at limit 500, nowhere near the offset ceiling, so paging it is simply the right
 * answer. Splitting below this buys probes instead of records.
 */
export const CELL_FLOOR_KM = 12;

/**
 * Nothing may ever ask for a circle larger than this.
 *
 * Belt and braces rather than a knob: every radius in the tree comes from `seedGrid` or
 * `childrenOf`, which are bounded by SEED_RADIUS_KM by construction. The assertion exists so a
 * hand-added cell cannot become a planet-wide query. Measured on 2026-09-28: a 3,000km circle from
 * the centre of the country reports 159,075, and a 5,000km one spills into Canada and Mexico.
 */
export const CELL_RADIUS_KM_MAX = 3000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Kilometres per degree of longitude at this latitude. Guarded at the poles, which the US is not. */
function kmPerDegLon(lat: number): number {
  const c = Math.cos(toRad(lat));
  // A degree of longitude is zero km at the pole, and dividing by it would produce Infinity rather
  // than an error. No US cell is anywhere near this; the floor keeps the arithmetic finite anyway.
  return KM_PER_DEG_LAT * Math.max(c, 1e-6);
}

/** Half the side of the box a radius stands for: the box inscribed in the circle. */
export function halfSideKm(radiusKm: number): number {
  return radiusKm / Math.SQRT2;
}

/**
 * The smallest whole radius whose box, AT THIS LATITUDE, covers the requested degree half-spans.
 *
 * ‼️ THIS FUNCTION IS THE ANTI-GAP RULE, AND THE PLAN THIS WAS BUILT FROM GOT IT WRONG. The obvious
 * rule is "a child's radius is half its parent's", and it leaves a sliver of the parent UNCOVERED,
 * because half of the parent's box measured in DEGREES OF LONGITUDE is wider than a box of half the
 * parent's kilometre half-side placed at the child's own latitude. Measured, for a 384km parent:
 *
 *   parent at 25N  ->  1.32 km sliver uncovered along each outer edge
 *   parent at 30N  ->  1.64 km
 *   parent at 40N  ->  2.39 km
 *   parent at 49N  ->  3.29 km
 *
 * A strip that thin sounds harmless and is not: it recurs at EVERY level of the tree, it is widest
 * exactly where the country is widest, and a 2km strip through a dense suburb holds clinics. The
 * failure mode is the worst kind, a row that was never fetched and so leaves nothing behind to
 * notice. So a child's radius is DERIVED from the box it has to cover, and rounded UP.
 *
 * The cost of being right is one to three extra kilometres of radius: a 384km parent at 30N has
 * children of 192 and 195 rather than 192 and 192.
 */
export function radiusCovering(lat: number, halfLatDeg: number, halfLonDeg: number): number {
  const neededKm = Math.max(halfLatDeg * KM_PER_DEG_LAT, halfLonDeg * kmPerDegLon(lat));
  return Math.ceil(Math.SQRT2 * neededKm);
}

/**
 * A cell with its numbers pinned to the stored precision.
 *
 * ‼️ THE ONLY PRODUCER OF A STORABLE CELL. Everything that invents a cell ends here, so a key can
 * never be written two ways. The radius is an integer for the same reason: "24" and "24.0" are one
 * circle and two strings.
 */
export function roundCell(c: Cell): Cell {
  const p = 10 ** CELL_KEY_DP;
  return {
    lat: Math.round(c.lat * p) / p,
    lon: Math.round(c.lon * p) / p,
    radiusKm: Math.round(c.radiusKm),
  };
}

/**
 * "32.7767,-96.7970,24".
 *
 * ‼️ BYTE-IDENTICAL TO DataForSEO'S `location_coordinate` PARAMETER, ON PURPOSE. One string is at
 * once the cell's identity in scraper_cells, the metro slot of scraper_batches.batch_label, the geo
 * filter sent to the vendor, and raw_leads.source_metro. Nothing is converted between those four, so
 * nothing can be converted wrongly, and a pull can be traced back to the circle that bought it with
 * a string comparison.
 */
export function cellKey(c: Cell): string {
  const r = roundCell(c);
  return r.lat.toFixed(CELL_KEY_DP) + "," + r.lon.toFixed(CELL_KEY_DP) + "," + r.radiusKm;
}

/**
 * A key back into a cell, or null when the text is not one.
 *
 * ‼️ NULL IS A REFUSAL, NOT A DEFAULT, the same rule geocodeMetro states. This is what tells a
 * coordinate triple apart from a metro name in the command grammar, so a loose reading here would
 * turn a typo into a circle somewhere nobody asked about. Every field is range-checked, and a radius
 * of zero is rejected rather than treated as "just the centre".
 */
export function parseCellKey(text: string): Cell | null {
  const parts = text.trim().split(",");
  if (parts.length !== 3) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  const radiusKm = Number(parts[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusKm)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  // A whole number, because that is the only shape cellKey writes. A "24.5" in a label means
  // somebody hand-edited it, and guessing which of 24 or 25 they meant is how a key stops matching.
  if (!Number.isInteger(radiusKm)) return null;
  if (radiusKm < 1 || radiusKm > CELL_RADIUS_KM_MAX) return null;

  return { lat, lon, radiusKm };
}

/** The box this cell stands for. Derived from the radius at the cell's OWN latitude. */
export function cellBox(c: Cell): CellBox {
  const h = halfSideKm(c.radiusKm);
  const halfLat = h / KM_PER_DEG_LAT;
  const halfLon = h / kmPerDegLon(c.lat);
  return {
    south: c.lat - halfLat,
    north: c.lat + halfLat,
    west: c.lon - halfLon,
    east: c.lon + halfLon,
  };
}

/**
 * Is this point inside the cell?
 *
 * ‼️ THE BOX, NEVER THE CIRCLE. Coverage is a claim about the boxes, because they are what tile. A
 * containment test against the circle would report a point in the corner slop as "covered" by a cell
 * that does not own it, and two neighbours would both disclaim the same point.
 */
export function containsPoint(c: Cell, lat: number, lon: number): boolean {
  const b = cellBox(c);
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

/**
 * The four cells that tile this one, or none at the floor.
 *
 * The parent's box is quartered in DEGREE space, which is exact, and each child's radius is then
 * derived by `radiusCovering` so its own box covers its quarter. See that function for the measured
 * reason the naive "half the parent's radius" is wrong.
 *
 * Order is NW, NE, SW, SE, and it is the campaign's order: `coverage.ts` walks children in the order
 * this returns them, so changing it changes which part of a metro is worked first.
 */
export function childrenOf(c: Cell): Cell[] {
  if (c.radiusKm <= CELL_FLOOR_KM) return [];

  const b = cellBox(c);
  const quarterLat = (b.north - b.south) / 4;
  const quarterLon = (b.east - b.west) / 4;

  const out: Cell[] = [];
  for (const latSign of [1, -1]) {
    for (const lonSign of [-1, 1]) {
      const lat = c.lat + latSign * quarterLat;
      const lon = c.lon + lonSign * quarterLon;
      out.push(roundCell({ lat, lon, radiusKm: radiusCovering(lat, quarterLat, quarterLon) }));
    }
  }
  return out;
}

/**
 * One box of the country, as rows of circles.
 *
 * Rows step by a full box height so they tile in latitude exactly. Within a row every cell shares
 * the row's centre latitude, so they share one longitude scale and tile in longitude exactly too.
 * That is the whole reason the grid is built per row rather than as one lat/lon loop.
 */
function gridFor(box: { south: number; north: number; west: number; east: number }): Cell[] {
  const h = halfSideKm(SEED_RADIUS_KM);
  const halfLat = h / KM_PER_DEG_LAT;
  const rows = Math.max(1, Math.ceil((box.north - box.south) / (halfLat * 2)));

  const out: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    const lat = box.south + halfLat + row * halfLat * 2;
    const halfLon = h / kmPerDegLon(lat);
    const cols = Math.max(1, Math.ceil((box.east - box.west) / (halfLon * 2)));
    for (let col = 0; col < cols; col++) {
      const lon = box.west + halfLon + col * halfLon * 2;
      out.push(roundCell({ lat, lon, radiusKm: radiusCovering(lat, halfLat, halfLon) }));
    }
  }
  return out;
}

/**
 * Where a national crawl starts.
 *
 * ‼️ ORDER IS THE PLAN, exactly as the fifty-metro list it replaces said. `coverage.ts` finishes one
 * seed's subtree before starting the next, so this order is the order the country gets worked, and
 * reordering it reorders the campaign. South to north, west to east.
 *
 * ‼️ TWO GAPS, NAMED RATHER THAN FUDGED. The Aleutians west of 170W are not covered, because a
 * longitude-stepping generator cannot cross the antimeridian without a special case and a special
 * case for Adak and Attu is worse than a stated gap. Puerto Rico, Guam and the US Virgin Islands are
 * not covered either, because geo.ts holds no state for them, so the progress card could not report
 * what it found. Both are reachable by hand and the probe asserts they are genuinely absent, so the
 * gap stays deliberate instead of quietly becoming a surprise:
 *
 *   pull maps medspa | 51.8800,-176.6500,200 | med spa
 */
export function seedGrid(): Cell[] {
  return [
    // The contiguous 48, from Key West to the Canadian border and from Maine to Washington.
    ...gridFor({ south: 24.4, north: 49.4, west: -125.0, east: -66.9 }),
    // Alaska, east of 170W. Utqiagvik at 71.29N is the northern edge that matters.
    ...gridFor({ south: 54.0, north: 71.5, west: -170.0, east: -129.9 }),
    // Hawaii, Lihue to Hilo.
    ...gridFor({ south: 18.4, north: 22.5, west: -160.4, east: -154.6 }),
  ];
}

/**
 * The category list as a single stable string, sorted.
 *
 * ‼️ PART OF A CELL'S IDENTITY, BECAUSE A COUNT IS THE ANSWER TO A QUESTION. The question is
 * "(this circle, these categories)". DFS_CATEGORIES.medspa is three keys today; adding `day_spa`
 * would turn every stored count into the answer to a question nobody is asking any more, and nothing
 * would say so. Sorted, so the same three keys written in a different order are one question.
 */
export function categoriesKey(categories: readonly string[]): string {
  return [...categories].map((c) => c.trim().toLowerCase()).filter(Boolean).sort().join("+");
}
