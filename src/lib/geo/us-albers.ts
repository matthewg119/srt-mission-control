// A US map projection, in 90 lines, with no map library.
//
// ‼️ WHY NOT d3-geo OR react-simple-maps. This repo has no mapping dependency and the territory page
// needs exactly two things from one: project a latitude and longitude to a pixel, and draw state
// outlines. The projection is a closed-form formula from 1805 and the outlines are generated once
// into src/data/us-outline.ts, so the dependency would buy a tree-shaken 40KB of code to do what the
// function below does, plus a topojson decoder for data we can pre-project at generate time.
//
// ‼️ EQUAL AREA, AND THAT IS THE POINT RATHER THAN A DETAIL. The page's job is "which part of the
// country is unworked", which is a question about AREA. Web Mercator, the default everywhere,
// inflates the northern states: Washington would look half again the size of Georgia and the eye
// would read unworked ground where there is less of it. Albers conic with standard parallels at
// 29.5 and 45.5 is the projection the US Census uses for exactly this reason.
//
// ‼️ AND ALASKA AND HAWAII ARE SEPARATE PROJECTIONS, NOT A WIDER ONE. A single conic wide enough to
// hold Aleutian Islands at -179 and Florida at -80 puts the lower 48 in a quarter of the frame.
// Every US map solves this by insetting the two, which means three projections and a rule for which
// one a coordinate belongs to. The rule is `regionOf` below and it is a BOX TEST, never a state
// name, because a lead's state column holds "Texas", "TX" or nothing (520 / 10 / 20 of the stored
// 550) while its coordinate is always a coordinate.

const RAD = Math.PI / 180;

export interface AlbersParams {
  /** Reference longitude. The vertical line the cone is centred on. */
  lon0: number;
  /** Reference latitude. Sets where y is zero; cosmetic, since the fit re-centres anyway. */
  lat0: number;
  /** The two parallels where the cone touches the sphere, so scale there is exact. */
  lat1: number;
  lat2: number;
}

/** Which inset a coordinate belongs to. */
export type UsRegion = "lower48" | "alaska" | "hawaii";

/**
 * The three projections.
 *
 * Lower 48: the US Census standard, parallels 29.5 and 45.5 on a -96 centre.
 * Alaska and Hawaii: their own conics, because a parallel pair chosen for Kansas is wrong at 64 N
 * and wrong again at 20 N, and an inset drawn on the mainland's cone comes out visibly sheared.
 */
export const ALBERS: Record<UsRegion, AlbersParams> = {
  lower48: { lon0: -96, lat0: 37.5, lat1: 29.5, lat2: 45.5 },
  alaska: { lon0: -152, lat0: 60, lat1: 55, lat2: 65 },
  hawaii: { lon0: -157, lat0: 20, lat1: 8, lat2: 18 },
};

/**
 * Which projection a coordinate uses.
 *
 * ‼️ A BOX TEST ON THE COORDINATE, NEVER A LOOKUP ON THE STATE NAME. `raw_leads.state` holds
 * "Texas" on 520 of the stored 550 rows, "TX" on 10 and nothing on 20, so a name-keyed rule would
 * silently send 30 leads to the wrong projection or to none. The coordinate is the one field that
 * is always in one shape, which is why Phase 1 lifted it into a column.
 *
 * ‼️ THE ALEUTIANS CROSS THE ANTIMERIDIAN, so the Alaska box accepts BOTH signs of longitude. Attu
 * is at 172.9 EAST. Without the second clause the western Aleutians would fail every box and be
 * dropped as unmappable, which is correct-looking and wrong.
 */
export function regionOf(lat: number, lon: number): UsRegion | null {
  if (lat >= 18.6 && lat <= 22.5 && lon >= -160.5 && lon <= -154.5) return "hawaii";
  if (lat >= 51 && lat <= 72 && (lon <= -129 || lon >= 172)) return "alaska";
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) return "lower48";
  return null;
}

/**
 * Albers equal-area conic, unfitted. Returns map units, not pixels.
 *
 * ‼️ IT RETURNS null RATHER THAN NaN ON A COORDINATE OUTSIDE THE CONE. `C - 2 n sin(phi)` goes
 * negative on the far side of the sphere and Math.sqrt then yields NaN, which propagates into an SVG
 * attribute as the string "NaN" and makes the whole path silently vanish. A refusal is visible.
 *
 * y increases NORTHWARD here, the way a map does and the way SVG does not. The flip is folded into
 * the fit, which is where the pixel coordinate system is decided.
 */
export function albers(lat: number, lon: number, p: AlbersParams): { x: number; y: number } | null {
  const phi1 = p.lat1 * RAD;
  const phi2 = p.lat2 * RAD;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  if (n === 0) return null; // Degenerate cone: the parallels are mirror images.

  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const inner = C - 2 * n * Math.sin(lat * RAD);
  const inner0 = C - 2 * n * Math.sin(p.lat0 * RAD);
  if (inner < 0 || inner0 < 0) return null;

  const rho = Math.sqrt(inner) / n;
  const rho0 = Math.sqrt(inner0) / n;
  // Longitude difference wrapped into (-180, 180], so the Aleutians at +173 do not come out a
  // whole turn away from a reference longitude of -152.
  let dLon = lon - p.lon0;
  while (dLon > 180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  const theta = n * dLon * RAD;

  return { x: rho * Math.sin(theta), y: rho0 - rho * Math.cos(theta) };
}

/**
 * How one region's map units become pixels.
 *
 * ‼️ y IS SUBTRACTED, NOT ADDED, AND THAT IS THE NORTH-SOUTH FLIP. Albers y grows northward and SVG
 * y grows downward. Written as an addition with a negative scale it works too, and then somebody
 * computes a dot radius from `scale` and gets a negative radius.
 */
export interface RegionFit {
  scale: number;
  dx: number;
  dy: number;
}

export type UsFit = Record<UsRegion, RegionFit>;

/** Map units to pixels. */
export function applyFit(pt: { x: number; y: number }, fit: RegionFit): { x: number; y: number } {
  return { x: fit.dx + pt.x * fit.scale, y: fit.dy - pt.y * fit.scale };
}

/**
 * A latitude and longitude to a pixel in the generated viewBox, or null.
 *
 * ‼️ null MEANS "NOT ON THIS MAP", AND EVERY CALLER MUST RENDER NOTHING RATHER THAN A ZERO. A lead
 * in Ontario or Baja (which the national cell crawl's 384km seed circles genuinely straddle) has a
 * real coordinate and no place on a US map. Coercing that to 0,0 would stack unrelated dots in the
 * top-left corner, which reads as a cluster.
 */
export function projectUs(
  lat: number | null | undefined,
  lon: number | null | undefined,
  fit: UsFit
): { x: number; y: number } | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const region = regionOf(lat, lon);
  if (!region) return null;
  const raw = albers(lat, lon, ALBERS[region]);
  if (!raw) return null;
  return applyFit(raw, fit[region]);
}
