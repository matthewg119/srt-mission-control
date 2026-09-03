// The skin-analysis provider seam.
//
// ‼️ THE VENDOR IS NOT DECIDED YET, AND THIS FILE IS WHY THAT IS NOT BLOCKING ANYTHING.
// Everything downstream — the widget, the results view, the concierge prompt, the magnet
// routing, the lead handoff — reads the CANONICAL shape below and has never heard of DermIQ or
// Perfect Corp. Choosing a vendor is a value in concierge_configs.analysis_provider and one new
// file in this folder. It is deliberately not a refactor.
//
// ‼️ HIGHER IS BETTER. ALL OF THEM. NO EXCEPTIONS.
//
// This is the single most dangerous line in the lane and it is a convention, not a fact about
// any vendor. A provider that scores SEVERITY (100 = worst acne) and one that scores CONDITION
// (100 = clearest skin) both hand back "acne: 82", and nothing in the payload says which. If an
// adapter forgets to invert, the concierge tells a person with excellent skin that their face is
// in trouble, on a clinic's own domain, under the clinic's name. Every adapter is responsible
// for normalising INTO this convention, and every adapter states in its own header which
// direction the vendor uses and where it inverts.
//
// ‼️ NOTHING HERE PERSISTS OR LOGS THE IMAGE BYTES. Providers receive a Buffer, send it, and
// return numbers. The bytes are the caller's problem and the caller's alone (see purge.ts).
// A console.log of an input here would put a face in a log aggregator with no retention story.

import { createHash } from "crypto";

/**
 * The canonical metric keys.
 *
 * A provider that cannot measure one OMITS it. It never writes 0, and it never writes 50 as a
 * "neutral" guess: the concierge reads a missing metric as "not measured" and does not mention
 * it, which is honest, while a fabricated midpoint becomes a sentence spoken to a patient about
 * their face. Same tri-state doctrine as dominance_score in the scraper lane.
 */
export const CANONICAL_METRICS = [
  "acne",
  "wrinkles",
  "pores",
  "redness",
  "oiliness",
  "texture",
  "dark_circles",
  "firmness",
  "hydration",
  "pigmentation",
] as const;

export type MetricKey = (typeof CANONICAL_METRICS)[number];

/** 0-100, higher is better, and a key is ABSENT rather than zero when it was not measured. */
export type SkinScores = Partial<Record<MetricKey, number>>;

export interface ScanInput {
  bytes: Buffer;
  mediaType: string;
}

export interface ScanOk {
  ok: true;
  scores: SkinScores;
  /** The vendor's estimate. Null when it does not offer one, never a computed stand-in. */
  skinAge: number | null;
  /**
   * How many heat-map overlays came back.
   *
   * ‼️ A COUNT, NEVER THE URLS. Storing a vendor CDN link to a face-derived image would be a
   * second retention obligation on an expiry we do not control and cannot audit. The frame
   * composites the masks it received over the blob it is already holding, and both die with
   * the tab.
   */
  maskCount: number;
  costUsd: number;
  latencyMs: number;
  httpStatus: number | null;
}

export interface ScanFailed {
  ok: false;
  /** Safe to write to concierge_scan_ledger.error_detail. Never contains image data. */
  error: string;
  latencyMs: number;
  httpStatus: number | null;
  /**
   * ‼️ A FAILURE CAN STILL COST MONEY. Providers that charge on submission bill for a call that
   * then times out, so this is not hardcoded to zero. Under-reporting exactly the retries is
   * how a unit-cost estimate ends up wrong in the direction that matters.
   */
  costUsd: number;
}

export type ScanResult = ScanOk | ScanFailed;

export interface AnalysisProvider {
  /** Matches concierge_configs.analysis_provider and the check constraint on that column. */
  readonly name: string;
  analyse(input: ScanInput): Promise<ScanResult>;
}

/**
 * Clamp into the canonical range and drop anything that is not a real measurement.
 *
 * Shared so every adapter rounds and bounds identically. A vendor returning 100.4, -2 or NaN
 * must not put those into the payload the concierge reasons over.
 */
export function normaliseScore(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Invert a severity scale into the condition scale this module mandates.
 *
 * Exists so an adapter says `invertSeverity(v)` at the call site rather than `100 - v`, which
 * reads as arithmetic and gets "simplified" away by somebody tidying up six months from now.
 */
export function invertSeverity(raw: unknown): number | null {
  const n = normaliseScore(raw);
  return n === null ? null : 100 - n;
}

/** A stable, non-reversible fingerprint of the bytes. Used by the mock, never stored. */
export function fingerprint(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Pick the provider for this client.
 *
 * ‼️ THE FALLBACK IS `mock`, AND THAT IS THE SAFE DIRECTION. An unrecognised or unconfigured
 * value produces obviously-synthetic scores and spends nothing, rather than reaching for a
 * vendor with credentials that may not be set. A widget showing plausible-looking numbers it
 * did not measure would be the worst outcome available, so the mock is loud about what it is:
 * every result it returns carries `synthetic: true` in the ledger's error_detail column.
 */
export function selectProvider(name: string | null | undefined): AnalysisProvider {
  switch ((name ?? "").trim().toLowerCase()) {
    case "dermiq":
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("./dermiq").dermiqProvider as AnalysisProvider;
    case "perfectcorp":
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("./perfectcorp").perfectCorpProvider as AnalysisProvider;
    default:
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("./mock").mockProvider as AnalysisProvider;
  }
}
