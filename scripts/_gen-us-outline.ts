/**
 * Regenerates src/data/us-outline.ts: state outlines, pre-projected into SVG path data.
 *
 *   bun run scripts/_gen-us-outline.ts
 *
 * ‼️ THE OUTPUT IS CHECKED IN AND THE GEOJSON IS NOT, THE SAME TRADE refresh-disposable-domains.ts
 * MAKES AND FOR THE SAME REASON. Fetching 89KB of geometry at request time means the territory map
 * depends on GitHub being reachable from a lambda, and the failure mode is a page that renders dots
 * on a blank rectangle with no error anywhere. Checked in, the file can only go STALE, which is
 * visible in git and fixed by running this. State borders also do not move.
 *
 * ‼️ AND IT IS PRE-PROJECTED, NOT STORED AS COORDINATES. The page would otherwise ship 89KB of
 * latitude and longitude pairs and project 10,000 points in the browser on every render. Projected
 * at generate time, each state is one `d` string and the whole file is a quarter the size.
 *
 * ‼️ THE PROJECTION IS IMPORTED, NEVER REIMPLEMENTED HERE. The dots on the page are projected by
 * `projectUs` at request time and the outlines by this script at generate time, and if those two
 * disagreed by a single constant every dot would sit slightly off its state with nothing to say so.
 * One `albers`, used twice. The FIT is computed here and emitted, so the page reads back the exact
 * numbers these outlines were drawn with.
 *
 * Source: the US Census state boundaries as published in PublicaMundi/MappingAPI, the file the
 * Leaflet choropleth example uses. US Census TIGER derivatives are public domain.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALBERS, applyFit, regionOf, albers, type RegionFit, type UsRegion } from "../src/lib/geo/us-albers";

const SOURCE =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";

const OUT = resolve(import.meta.dirname ?? __dirname, "../src/data/us-outline.ts");

/** The frame. 960x600 is the d3 albersUsa convention and the aspect the lower 48 wants. */
const WIDTH = 960;
const HEIGHT = 600;

/**
 * Where each region sits in the frame, as a rectangle to fit into.
 *
 * ‼️ ALASKA AND HAWAII GO BOTTOM LEFT, WHICH IS EMPTY OCEAN ON THIS PROJECTION. Anywhere else and an
 * inset overlaps a state somebody needs to click. Alaska is drawn at a THIRD of true scale, which is
 * the convention every US map uses: at true scale it is a fifth of the frame and dwarfs Texas, and
 * the page is about where the clinics are, not about land area.
 */
const BOXES: Record<UsRegion, { x: number; y: number; w: number; h: number }> = {
  lower48: { x: 14, y: 14, w: WIDTH - 28, h: HEIGHT - 110 },
  alaska: { x: 20, y: HEIGHT - 190, w: 220, h: 170 },
  hawaii: { x: 258, y: HEIGHT - 120, w: 130, h: 95 },
};

interface Feature {
  properties: { name: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

/** Every ring of a feature, whichever geometry type it used. One shape to walk. */
function ringsOf(f: Feature): number[][][] {
  return f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
}

/**
 * Which region a whole state belongs to.
 *
 * ‼️ DECIDED BY MAJORITY VOTE OF ITS OWN POINTS, NOT BY ITS NAME. The box test in regionOf is about
 * one coordinate; a state is thousands, and some of them fall outside every box (Alaska's Aleutians
 * reach past -180, Florida's keys sit at 24.4). A single sample point would put a state in the wrong
 * inset on a bad draw. A majority cannot.
 */
function regionOfFeature(f: Feature): UsRegion | null {
  const votes = new Map<UsRegion, number>();
  for (const ring of ringsOf(f)) {
    for (const [lon, lat] of ring) {
      const r = regionOf(lat, lon);
      if (r) votes.set(r, (votes.get(r) ?? 0) + 1);
    }
  }
  let best: UsRegion | null = null;
  let bestN = 0;
  for (const [r, n] of votes) {
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`state boundary fetch failed: ${res.status} ${res.statusText}`);
  const geo = (await res.json()) as { features: Feature[] };

  // Puerto Rico is in the source and is not on this map: no metro in METROS, no supply, and it
  // would need a fourth inset. Dropped by name rather than by falling out of a box silently.
  const features = geo.features.filter((f) => f.properties.name !== "Puerto Rico");
  if (features.length < 50) {
    // A truncated response is worse than a stale file: it would silently delete states.
    throw new Error(`refusing to write ${features.length} states, the source is too short`);
  }

  // --- pass 1: project every point and learn each region's extent -------------------------------
  type Projected = { name: string; region: UsRegion; rings: Array<Array<{ x: number; y: number }>> };
  const projected: Projected[] = [];
  const extent = new Map<UsRegion, { minX: number; maxX: number; minY: number; maxY: number }>();

  for (const f of features) {
    const region = regionOfFeature(f);
    if (!region) {
      console.warn(`[us-outline] ${f.properties.name} fell outside every region box and was skipped`);
      continue;
    }
    const params = ALBERS[region];
    const rings: Array<Array<{ x: number; y: number }>> = [];
    for (const ring of ringsOf(f)) {
      const pts: Array<{ x: number; y: number }> = [];
      for (const [lon, lat] of ring) {
        const p = albers(lat, lon, params);
        if (!p) continue;
        pts.push(p);
        const e = extent.get(region) ?? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        e.minX = Math.min(e.minX, p.x);
        e.maxX = Math.max(e.maxX, p.x);
        e.minY = Math.min(e.minY, p.y);
        e.maxY = Math.max(e.maxY, p.y);
        extent.set(region, e);
      }
      // A ring of fewer than three points is a line, not an area, and emits a degenerate path.
      if (pts.length >= 3) rings.push(pts);
    }
    projected.push({ name: f.properties.name, region, rings });
  }

  // --- the fit: one scale and offset per region, from its own extent ----------------------------
  const fit: Record<UsRegion, RegionFit> = {} as Record<UsRegion, RegionFit>;
  for (const region of ["lower48", "alaska", "hawaii"] as UsRegion[]) {
    const e = extent.get(region);
    const box = BOXES[region];
    if (!e) throw new Error(`no geometry landed in ${region}, so it cannot be fitted`);
    // ‼️ ONE SCALE FOR BOTH AXES, NEVER TWO. Two would fill the box exactly and stretch the country.
    const scale = Math.min(box.w / (e.maxX - e.minX), box.h / (e.maxY - e.minY));
    const drawnW = (e.maxX - e.minX) * scale;
    const drawnH = (e.maxY - e.minY) * scale;
    fit[region] = {
      scale,
      dx: box.x + (box.w - drawnW) / 2 - e.minX * scale,
      // y is SUBTRACTED by applyFit, so the offset is measured from the box's BOTTOM edge.
      dy: box.y + (box.h + drawnH) / 2 - (e.maxY - e.minY) * scale + e.maxY * scale,
    };
  }

  // --- pass 2: path data, and a label anchor per state ------------------------------------------
  const out: Array<{ name: string; region: UsRegion; d: string; labelX: number; labelY: number }> = [];
  for (const s of projected) {
    const parts: string[] = [];
    let biggest = { area: -1, cx: 0, cy: 0 };
    for (const ring of s.rings) {
      const px = ring.map((p) => applyFit(p, fit[s.region]));
      // 1dp is about a tenth of a pixel at this size. Full precision triples the file for a
      // difference no screen can show.
      parts.push("M" + px.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L") + "Z");

      // ‼️ THE LABEL GOES ON THE BIGGEST RING'S CENTROID, NOT ON THE STATE'S. Michigan's two
      // peninsulas and Hawaii's islands average out to a point in open water, and the label then
      // floats off the state it names. The shoelace area is signed, so it is taken absolute: ring
      // winding order is not something this source guarantees.
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < px.length; i++) {
        const a = px[i];
        const b = px[(i + 1) % px.length];
        const cross = a.x * b.y - b.x * a.y;
        area += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
      }
      area /= 2;
      if (Math.abs(area) > biggest.area) {
        biggest = { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
      }
    }
    out.push({
      name: s.name,
      region: s.region,
      d: parts.join(""),
      labelX: Number(biggest.cx.toFixed(1)),
      labelY: Number(biggest.cy.toFixed(1)),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));

  const body = `// GENERATED by scripts/_gen-us-outline.ts. Do not edit by hand.
//
// State outlines, already projected into the viewBox below by the same \`albers\` the territory page
// uses for its dots. Regenerate with: bun run scripts/_gen-us-outline.ts
//
// Source: US Census state boundaries via PublicaMundi/MappingAPI (public domain).
// ${out.length} states, generated ${new Date().toISOString().slice(0, 10)}.

import type { UsFit } from "@/lib/geo/us-albers";

export const US_VIEWBOX = { width: ${WIDTH}, height: ${HEIGHT} } as const;

/**
 * The fit these outlines were drawn with.
 *
 * ‼️ THE PAGE MUST PROJECT ITS DOTS WITH THESE EXACT NUMBERS. They come out of the generator's
 * own measurement of the geometry's extent, so a hand-edited value here puts every dot off its
 * state by a constant, which looks like a data problem rather than a layout one.
 */
export const US_FIT: UsFit = ${JSON.stringify(fit, null, 2)
    .replace(/"(\w+)":/g, "$1:")
    .replace(/\n/g, "\n")};

export interface StateOutline {
  /** The full name, as \`canonicalStateName\` in src/lib/scraper/geo.ts returns it. */
  name: string;
  region: "lower48" | "alaska" | "hawaii";
  /** SVG path data, already in viewBox coordinates. */
  d: string;
  /** Centroid of the state's LARGEST ring, for a label that lands on land. */
  labelX: number;
  labelY: number;
}

export const US_STATES: readonly StateOutline[] = ${JSON.stringify(out, null, 2)};
`;

  writeFileSync(OUT, body, "utf8");
  console.log(`wrote ${OUT}`);
  console.log(`  ${out.length} states, ${(body.length / 1024).toFixed(0)}KB`);
  for (const r of ["lower48", "alaska", "hawaii"] as UsRegion[]) {
    console.log(`  ${r.padEnd(8)} scale ${fit[r].scale.toFixed(1)}  dx ${fit[r].dx.toFixed(1)}  dy ${fit[r].dy.toFixed(1)}`);
  }
}

await main();
