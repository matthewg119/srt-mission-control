// TRT-clinic prospecting record mapper, filter, scorer, and results processor.
// Clones the med-spa vertical (src/lib/medspa.ts) but rotates METRO x QUERY
// instead of ZIP x single-query: TRT clinics are sparse, so we run ~17 query
// phrasings anchored on Sun-Belt metro cities. Core queries seed active; the
// expansion set activates per metro once every core query there is exhausted.
//
// TRT-specific rules: hospital systems / pharmacies / big urology-endocrinology
// groups / telehealth nationals are DROPPED; suspected franchises (Low T Center
// etc.) are KEPT but flagged multi_location_flag. Phones are verified to dialer
// grade (10-digit NANP, bad area codes rejected) and stored "(AAA) EEE-NNNN".
//
// Rows land in `trt_leads` (docs/2026-07-20-trt-pipeline.sql). The generic
// Outscraper transport (submitMapsSearch / toGroups / normalizePhone) is reused
// from ./outscraper.

import { SupabaseClient } from "@supabase/supabase-js";
import { OutscraperRecord, normalizePhone } from "./outscraper";
import { INVALID_AREA_CODES } from "./lead-validation";

// --- Targeting ----------------------------------------------------------------

/** Core query set — every metro starts with these (seeded active). */
export const CORE_QUERIES = [
  "TRT clinic",
  "testosterone replacement therapy",
  "men's health clinic",
  "low testosterone clinic",
  "low T center",
  "hormone clinic",
  "hormone optimization",
  "testosterone clinic",
  "men's hormone clinic",
  "HRT clinic",
];

/** Expansion set — seeded inactive, activated per metro when its core runs dry. */
export const EXPANSION_QUERIES = [
  "andrology clinic",
  "sexual health clinic men",
  "erectile dysfunction clinic",
  "anti-aging clinic",
  "age management medicine",
  "peptide therapy clinic",
  "regenerative medicine men",
];

export interface MetroDef {
  key: string;
  label: string;
  priority: number;
  /** Maps text search anchors on the named city — sprawling metros get 2 anchors. */
  anchors: { city: string; state: string }[];
}

/** Sun Belt first, in Matthew's priority order; then the expansion metros. */
export const METROS: MetroDef[] = [
  { key: "dfw", label: "Dallas-Fort Worth", priority: 1, anchors: [{ city: "Dallas", state: "TX" }, { city: "Fort Worth", state: "TX" }] },
  { key: "houston", label: "Houston", priority: 2, anchors: [{ city: "Houston", state: "TX" }] },
  { key: "phoenix", label: "Phoenix-Scottsdale", priority: 3, anchors: [{ city: "Phoenix", state: "AZ" }, { city: "Scottsdale", state: "AZ" }] },
  { key: "tampa", label: "Tampa", priority: 4, anchors: [{ city: "Tampa", state: "FL" }] },
  { key: "miami", label: "Miami", priority: 5, anchors: [{ city: "Miami", state: "FL" }] },
  { key: "san_diego", label: "San Diego", priority: 6, anchors: [{ city: "San Diego", state: "CA" }] },
  { key: "austin", label: "Austin", priority: 7, anchors: [{ city: "Austin", state: "TX" }] },
  { key: "san_antonio", label: "San Antonio", priority: 8, anchors: [{ city: "San Antonio", state: "TX" }] },
  { key: "atlanta", label: "Atlanta", priority: 9, anchors: [{ city: "Atlanta", state: "GA" }] },
  { key: "orlando", label: "Orlando", priority: 10, anchors: [{ city: "Orlando", state: "FL" }] },
  { key: "jacksonville", label: "Jacksonville", priority: 11, anchors: [{ city: "Jacksonville", state: "FL" }] },
  { key: "las_vegas", label: "Las Vegas", priority: 12, anchors: [{ city: "Las Vegas", state: "NV" }] },
  { key: "charlotte", label: "Charlotte", priority: 13, anchors: [{ city: "Charlotte", state: "NC" }] },
  { key: "nashville", label: "Nashville", priority: 14, anchors: [{ city: "Nashville", state: "TN" }] },
  { key: "denver", label: "Denver", priority: 15, anchors: [{ city: "Denver", state: "CO" }] },
  { key: "los_angeles", label: "Los Angeles", priority: 16, anchors: [{ city: "Los Angeles", state: "CA" }] },
];

/** Build the Outscraper query string for one (base query, anchor city) pair. */
export function buildQuery(base: string, city: string, state: string): string {
  return `${base} ${city} ${state}`;
}

// --- Filtering ----------------------------------------------------------------

/** Primary types we drop — hospital systems, pharmacies, big specialist groups. */
const EXCLUDED_TYPES = new Set(["hospital", "pharmacy", "drug_store", "urologist", "endocrinologist"]);

/**
 * ...unless the name signals an actual TRT shop (a urology group named
 * "Dallas Low T Clinic" is exactly the buyer). Never rescues type=hospital.
 */
const TRT_NAME_RESCUE = ["trt", "testosterone", "low t", "hormone", "men's health", "mens health"];

/** Hospital-affiliation cues — dropped regardless of Google type. */
const HOSPITAL_NAME_CUES = [
  "hospital", "health system", "medical center", "regional medical",
  "university health", "veterans", "va medical",
];

/** Telehealth-only nationals — no local clinic to sell to (rarely have pins anyway). */
const TELEHEALTH_DOMAINS = [
  "hims.com", "forhims.com", "ro.co", "getroman.com", "petermd.com",
  "trtnation.com", "marekhealth.com", "honehealth.com", "hone.health",
  "maximustribe.com", "fountaintrt.com",
];
const TELEHEALTH_NAMES = [
  "hims", "peter md", "petermd", "trt nation", "marek health", "hone health",
  "maximus tribe", "fountain trt",
];

/** Known TRT franchise brands — kept but flagged multi_location_flag. */
const FRANCHISE_BRANDS = [
  "low t center", "ageless men's health", "gameday men's health",
  "craft men's clinic", "men's t clinic", "limitless male", "evexias",
  "testosterone centers of texas",
];

// --- Row shape ------------------------------------------------------------------

export interface TrtLeadRow {
  business_name: string;
  phone: string | null;
  phone_normalized: string | null;
  website: string | null;
  full_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  categories: string | null;
  primary_type: string | null;
  rating: number | null;
  review_count: number | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  owner_name: string | null;
  hours: Record<string, unknown> | null;
  days_open: number | null;
  multi_location_flag: boolean;
  lead_score: number | null;
  search_query: string;
  search_metro: string;
  source: string;
}

// --- Small coercers -------------------------------------------------------------

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Normalize a Google/Outscraper type label to a snake_case key ("Drug store" -> "drug_store"). */
function typeKey(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Lowercase + straighten curly apostrophes so "Men’s" matches "men's". */
function normName(name: string): string {
  return name.toLowerCase().replace(/[‘’]/g, "'");
}

/** Count days/week the listing is open, from Outscraper's working_hours object. */
export function daysOpen(hours: unknown): number | null {
  if (!hours || typeof hours !== "object") return null;
  const values = Array.isArray(hours) ? hours : Object.values(hours as Record<string, unknown>);
  let open = 0;
  for (const v of values) {
    const s = String(v ?? "").toLowerCase();
    if (s && !s.includes("closed")) open++;
  }
  return open || null;
}

function hostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.toLowerCase();
  }
}

// --- Phone verification (dialer-grade) ------------------------------------------

/**
 * Verify + format a scraped phone for the dialer. Digits-only via normalizePhone,
 * strip a leading 1, then require a valid-looking 10-digit NANP number: known-bad
 * area codes rejected (see lead-validation.ts), area code / exchange can't start
 * with 0 or 1, all-one-digit numbers rejected. Invalid -> both null (the row still
 * inserts on place_id; it just isn't callable and skips the Zoho push).
 */
export function verifyPhone(raw?: string | null): { phone: string | null; normalized: string | null } {
  let digits = normalizePhone(raw);
  if (!digits) return { phone: null, normalized: null };
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return { phone: null, normalized: null };
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (INVALID_AREA_CODES.has(area)) return { phone: null, normalized: null };
  if (area[0] === "0" || area[0] === "1") return { phone: null, normalized: null };
  if (exchange[0] === "0" || exchange[0] === "1") return { phone: null, normalized: null };
  if (/^(\d)\1{9}$/.test(digits)) return { phone: null, normalized: null };
  return { phone: `(${area}) ${exchange}-${digits.slice(6)}`, normalized: digits };
}

// --- Mapping --------------------------------------------------------------------

/** Map one raw Outscraper record into a trt_leads row (scored after flagging). */
export function mapTrtRecord(r: OutscraperRecord, searchQuery: string, metroKey: string): TrtLeadRow | null {
  const business_name = str(r.name);
  if (!business_name) return null; // skip junk rows with no name

  const rawPhone = str(r.phone) ?? str(r.phone_1);
  const { phone, normalized } = verifyPhone(rawPhone);
  const website = str(r.site) ?? str(r.website);
  const hoursRaw = (r.working_hours ?? r.working_hours_old_format) as Record<string, unknown> | undefined;

  return {
    business_name,
    phone,
    phone_normalized: normalized,
    website,
    full_address: str(r.full_address),
    city: str(r.city),
    state: str(r.state) ?? str(r.us_state),
    postal_code: str(r.postal_code),
    categories: str(r.category) ?? str(r.type) ?? str(r.subtypes),
    primary_type: str(r.type) ?? str(r.category),
    rating: num(r.rating),
    review_count: num(r.reviews) ?? num(r.reviews_count),
    google_place_id: str(r.place_id) ?? str(r.google_id),
    google_maps_url: str(r.location_link),
    owner_name: null, // filled by the website scrape (medspa-owner-scrape)
    hours: hoursRaw && typeof hoursRaw === "object" ? hoursRaw : null,
    days_open: daysOpen(hoursRaw),
    multi_location_flag: false, // decided batch-wide in flagMultiLocation
    lead_score: null,
    search_query: searchQuery,
    search_metro: metroKey,
    source: "outscraper",
  };
}

/**
 * Keep independent cash-pay TRT clinics; drop hospital systems, pharmacies,
 * big urology/endocrinology groups (unless the NAME is TRT-flavored), and
 * telehealth-only nationals. Franchises are NOT dropped here — they get
 * flagged in flagMultiLocation instead.
 */
export function passesFilter(row: TrtLeadRow): boolean {
  const name = normName(row.business_name);
  const rescued = TRT_NAME_RESCUE.some((cue) => name.includes(cue));

  const key = typeKey(row.primary_type);
  if (key === "hospital") return false; // never rescued
  if (EXCLUDED_TYPES.has(key) && !rescued) return false;

  if (!rescued && HOSPITAL_NAME_CUES.some((cue) => name.includes(cue))) return false;

  const host = hostname(row.website);
  if (host && TELEHEALTH_DOMAINS.some((d) => host.includes(d))) return false;
  if (TELEHEALTH_NAMES.some((t) => name === t || name.startsWith(`${t} `))) return false;

  return true;
}

/**
 * Flag suspected chains/franchises on the kept batch (mutates multi_location_flag,
 * returns how many were flagged). Two signals: the known TRT franchise brand list,
 * and the same normalized name appearing in >= 3 distinct cities within the batch.
 */
export function flagMultiLocation(rows: TrtLeadRow[]): number {
  const citiesByName = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = normName(row.business_name).replace(/[^a-z0-9]+/g, " ").trim();
    if (!citiesByName.has(key)) citiesByName.set(key, new Set());
    if (row.city) citiesByName.get(key)!.add(row.city.toLowerCase());
  }

  let flagged = 0;
  for (const row of rows) {
    const name = normName(row.business_name);
    const key = name.replace(/[^a-z0-9]+/g, " ").trim();
    const isBrand = FRANCHISE_BRANDS.some((b) => name.includes(b));
    const manyCities = (citiesByName.get(key)?.size ?? 0) >= 3;
    if (isBrand || manyCities) {
      row.multi_location_flag = true;
      flagged++;
    }
  }
  return flagged;
}

/**
 * 1..10 lead score:
 *   +2 rating >= 4.5            +2 review_count in [20, 500]
 *   +2 website present          +2 verified phone
 *   +1 days_open >= 5           +1 single-location (not flagged)
 */
export function scoreLead(row: TrtLeadRow): number {
  let score = 0;
  if (row.rating != null && row.rating >= 4.5) score += 2;
  if (row.review_count != null && row.review_count >= 20 && row.review_count <= 500) score += 2;
  if (row.website) score += 2;
  if (row.phone_normalized) score += 2;
  if (row.days_open != null && row.days_open >= 5) score += 1;
  if (!row.multi_location_flag) score += 1;
  return Math.min(10, Math.max(1, score));
}

// --- Results processing (shared by the webhook + the poll runner) ---------------

/** One submitted query's identity — order-aligned with the result groups. */
export interface TrtJob {
  rotationId: number;
  query: string;
  metroKey: string;
}

export interface QueryProcessResult {
  requested: number;    // raw records across all query groups
  filteredOut: number;  // dropped by passesFilter
  newLeads: number;     // rows inserted (or insertable, dry-run)
  duplicates: number;   // deduped out (in-batch + already in DB)
  invalidPhone: number; // inserted rows whose phone failed verification
  flaggedChains: number;// inserted rows flagged multi_location_flag
  withPhone: number;
  withWebsite: number;
  withOwner: number;
  perQueryCount: Record<string, number>; // raw count per full query (for exhaustion)
  inserted: (TrtLeadRow & { id?: string })[];
}

/** Columns trt_leads accepts (drops transient keys before insert). */
const LEAD_COLUMNS: (keyof TrtLeadRow)[] = [
  "business_name", "phone", "phone_normalized", "website", "full_address",
  "city", "state", "postal_code", "categories", "primary_type", "rating",
  "review_count", "google_place_id", "google_maps_url", "owner_name", "hours",
  "days_open", "multi_location_flag", "lead_score", "search_query",
  "search_metro", "source",
];

function pickColumns(row: TrtLeadRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LEAD_COLUMNS) out[k] = row[k];
  return out;
}

/** Insert TRT rows (chunked, columns filtered). Returns the inserted ids. */
export async function insertTrtLeads(
  supabase: SupabaseClient,
  rows: TrtLeadRow[]
): Promise<{ id: string }[]> {
  const ids: { id: string }[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(pickColumns);
    const { data, error } = await supabase.from("trt_leads").insert(chunk).select("id");
    if (error) throw error;
    ids.push(...((data ?? []) as { id: string }[]));
  }
  return ids;
}

/**
 * Map -> filter -> flag chains -> dedupe (in-batch + DB, by place_id/phone) ->
 * score -> optionally insert. `groups` arrive one-per-query in the submitted
 * order; `jobs` carries each query's rotation row + metro, same order. Reused by
 * the webhook (write=true) and the poll runner.
 */
export async function processQueryResults(
  supabase: SupabaseClient,
  groups: OutscraperRecord[][],
  jobs: TrtJob[],
  opts: { write?: boolean } = {}
): Promise<QueryProcessResult> {
  let requested = 0;
  const perQueryCount: Record<string, number> = {};
  const mapped: TrtLeadRow[] = [];

  groups.forEach((group, i) => {
    const job = jobs[i] ?? jobs[0] ?? { rotationId: 0, query: "", metroKey: "" };
    const list = Array.isArray(group) ? group : [];
    perQueryCount[job.query] = (perQueryCount[job.query] ?? 0) + list.length;
    requested += list.length;
    for (const rec of list) {
      const row = mapTrtRecord(rec as OutscraperRecord, job.query, job.metroKey);
      if (row) mapped.push(row);
    }
  });

  const kept = mapped.filter(passesFilter);
  const filteredOut = mapped.length - kept.length;
  flagMultiLocation(kept);
  for (const row of kept) row.lead_score = scoreLead(row);

  // Dedupe against the DB (place_id + phone), chunked.
  const placeIds = Array.from(new Set(kept.map((m) => m.google_place_id).filter(Boolean) as string[]));
  const phones = Array.from(new Set(kept.map((m) => m.phone_normalized).filter(Boolean) as string[]));
  const existingPlace = new Set<string>();
  const existingPhone = new Set<string>();
  for (let i = 0; i < placeIds.length; i += 200) {
    const { data } = await supabase.from("trt_leads").select("google_place_id").in("google_place_id", placeIds.slice(i, i + 200));
    (data ?? []).forEach((r) => r.google_place_id && existingPlace.add(r.google_place_id));
  }
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await supabase.from("trt_leads").select("phone_normalized").in("phone_normalized", phones.slice(i, i + 200));
    (data ?? []).forEach((r) => r.phone_normalized && existingPhone.add(r.phone_normalized));
  }

  // In-batch dedupe.
  const seenPlace = new Set<string>();
  const seenPhone = new Set<string>();
  const toInsert: TrtLeadRow[] = [];
  for (const m of kept) {
    const pid = m.google_place_id;
    const ph = m.phone_normalized;
    if (pid && (existingPlace.has(pid) || seenPlace.has(pid))) continue;
    if (ph && (existingPhone.has(ph) || seenPhone.has(ph))) continue;
    if (pid) seenPlace.add(pid);
    if (ph) seenPhone.add(ph);
    toInsert.push(m);
  }

  let insertedIds: { id: string }[] = [];
  if (opts.write && toInsert.length) {
    insertedIds = await insertTrtLeads(supabase, toInsert);
  }
  const inserted = toInsert.map((r, i) => ({ ...r, id: insertedIds[i]?.id }));

  return {
    requested,
    filteredOut,
    newLeads: toInsert.length,
    duplicates: kept.length - toInsert.length,
    invalidPhone: toInsert.filter((r) => !r.phone_normalized).length,
    flaggedChains: toInsert.filter((r) => r.multi_location_flag).length,
    withPhone: toInsert.filter((r) => r.phone_normalized).length,
    withWebsite: toInsert.filter((r) => r.website).length,
    withOwner: toInsert.filter((r) => r.owner_name).length,
    perQueryCount,
    inserted,
  };
}

// --- Expansion activation --------------------------------------------------------

/**
 * For each metro whose CORE queries are all exhausted (or inactive), activate its
 * EXPANSION queries. Returns the metro keys that were newly activated (for the
 * Slack report). Idempotent — already-active expansion rows are left alone.
 */
export async function activateExpansionForMetros(
  supabase: SupabaseClient,
  metroKeys: string[]
): Promise<string[]> {
  const activated: string[] = [];
  for (const key of Array.from(new Set(metroKeys))) {
    const { count: coreLeft } = await supabase
      .from("trt_rotation")
      .select("*", { count: "exact", head: true })
      .eq("metro_key", key)
      .eq("tier", "core")
      .eq("active", true)
      .eq("exhausted", false);
    if ((coreLeft ?? 0) > 0) continue;

    const { data: flipped } = await supabase
      .from("trt_rotation")
      .update({ active: true })
      .eq("metro_key", key)
      .eq("tier", "expansion")
      .eq("active", false)
      .select("id");
    if (flipped && flipped.length > 0) activated.push(key);
  }
  return activated;
}
