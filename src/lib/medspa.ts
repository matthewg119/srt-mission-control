// Med-spa prospecting config + record mappers, filter, and scorer. Parallel to the
// pest-control mapper in src/lib/outscraper.ts, but med-spa specific: a static
// 10-city target list, 7 search terms, a derm/plastic-surgeon/hospital filter,
// richer enrichment (Instagram / photos / hours / booking link), and a 1..10
// lead_score. The generic Outscraper transport (submitMapsSearch / toGroups /
// normalizePhone) is reused as-is from ./outscraper.
//
// Records land in the `med_spa_leads` shape below (docs/2026-07-10-medspa-pipeline.sql).

import { SupabaseClient } from "@supabase/supabase-js";
import { OutscraperRecord, normalizePhone } from "./outscraper";

// --- Targeting (the "top of the script") ------------------------------------

/** Highest med-spa-density US markets. Parameterized here on purpose. */
export const CITIES: { city: string; state: string }[] = [
  { city: "Miami", state: "FL" },
  { city: "Dallas", state: "TX" },
  { city: "Houston", state: "TX" },
  { city: "Phoenix", state: "AZ" },
  { city: "Charlotte", state: "NC" },
  { city: "Atlanta", state: "GA" },
  { city: "Nashville", state: "TN" },
  { city: "Tampa", state: "FL" },
  { city: "Austin", state: "TX" },
  { city: "Scottsdale", state: "AZ" },
];

/** All seven queried per city to maximize coverage; overlap collapses via dedupe. */
export const SEARCH_TERMS: string[] = [
  "med spa",
  "medical spa",
  "botox clinic",
  "aesthetic clinic",
  "injectables clinic",
  "medspa",
  "cosmetic clinic",
];

/** Build the Outscraper query string for one (term, city). */
export function buildQuery(term: string, city: string, state: string): string {
  return `${term} ${city}, ${state}`;
}

// --- Filtering (requirement #2) ---------------------------------------------

/** Primary types we drop — hospital systems / dermatology / plastic-surgery groups. */
const EXCLUDED_TYPES = new Set(["dermatologist", "plastic_surgeon", "hospital"]);

/** ...unless the business name signals it's actually an owner-operated med spa. */
const NAME_OVERRIDES = ["med spa", "medspa", "aesthetics"];

/** National franchise / chain domains — a chain website should NOT earn the +2. */
const CHAIN_DOMAINS = [
  "idealimage.com",
  "milanlaser.com",
  "sonobello.com",
  "laseraway.com",
  "sonobellobodycontouring.com",
  "europeanwax", // europeanwaxcenter.com and friends
  "skinlaundry.com",
  "restore-hyper-wellness",
  "restorehyperwellness.com",
  "dripbar.com",
  "hydromassage.com",
];

// --- Row shape ---------------------------------------------------------------

export interface MedSpaLeadRow {
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
  instagram_handle: string | null;
  photo_count: number | null;
  hours: Record<string, unknown> | null;
  days_open: number | null;
  has_booking_link: boolean;
  lead_score: number | null;
  search_term: string | null;
  search_city: string | null;
  source: string;
}

// --- Small local coercers (str/num aren't exported from ./outscraper) --------

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

/** Normalize a Google/Outscraper type label to a snake_case key ("Plastic surgeon" -> "plastic_surgeon"). */
function typeKey(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// --- Enrichment helpers ------------------------------------------------------

/**
 * Pull an Instagram handle from the record without fetching the website.
 * Uses Outscraper's `instagram` field when present, else recognizes a website
 * that is itself an instagram.com link. Deeper HTML parsing is a separate,
 * opt-in enrichment pass (see scripts) so the webhook stays fast.
 */
export function extractInstagram(rec: OutscraperRecord): string | null {
  const candidates = [rec.instagram, rec.instagram_url, rec.site, rec.website].map((v) =>
    str(v)
  );
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (m && m[1] && !["p", "reel", "explore", "stories"].includes(m[1].toLowerCase())) {
      return `@${m[1].replace(/\/$/, "")}`;
    }
    // A bare "@handle" already stored by Outscraper.
    if (/^@?[A-Za-z0-9_.]{2,30}$/.test(c) && c.startsWith("@")) return c;
  }
  return null;
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

function isChainDomain(website: string | null): boolean {
  const host = hostname(website);
  if (!host) return false;
  return CHAIN_DOMAINS.some((c) => host.includes(c));
}

// --- Mapping -----------------------------------------------------------------

/** Map one raw Outscraper record into a med_spa_leads row (unscored). */
export function mapMedSpaRecord(
  r: OutscraperRecord,
  city: string,
  state: string,
  term: string
): MedSpaLeadRow | null {
  const business_name = str(r.name);
  if (!business_name) return null; // skip junk rows with no name

  const phone = str(r.phone) ?? str(r.phone_1);
  const website = str(r.site) ?? str(r.website);
  const hoursRaw = (r.working_hours ?? r.working_hours_old_format) as Record<string, unknown> | undefined;
  const bookingLink = str(r.booking_appointment_link) ?? str(r.reservation_links);

  const row: MedSpaLeadRow = {
    business_name,
    phone,
    phone_normalized: normalizePhone(phone),
    website,
    full_address: str(r.full_address),
    city: str(r.city) ?? city,
    state: str(r.state) ?? str(r.us_state) ?? state,
    postal_code: str(r.postal_code),
    categories: str(r.category) ?? str(r.type) ?? str(r.subtypes),
    primary_type: str(r.type) ?? str(r.category),
    rating: num(r.rating),
    review_count: num(r.reviews) ?? num(r.reviews_count),
    google_place_id: str(r.place_id) ?? str(r.google_id),
    instagram_handle: extractInstagram(r),
    photo_count: num(r.photos_count) ?? num(r.photos),
    hours: hoursRaw && typeof hoursRaw === "object" ? hoursRaw : null,
    days_open: daysOpen(hoursRaw),
    has_booking_link: Boolean(bookingLink),
    lead_score: null,
    search_term: term,
    search_city: city,
    source: "outscraper",
  };
  row.lead_score = scoreLead(row);
  return row;
}

/**
 * Keep owner-operated med spas; drop dermatology / plastic-surgery / hospital
 * groups UNLESS the name itself signals a med spa (requirement #2).
 */
export function passesFilter(row: MedSpaLeadRow): boolean {
  const key = typeKey(row.primary_type);
  if (!EXCLUDED_TYPES.has(key)) return true;
  const name = row.business_name.toLowerCase();
  return NAME_OVERRIDES.some((o) => name.includes(o));
}

/**
 * 1..10 lead score (requirement #4):
 *   +2 review_count in [50, 500]   +2 rating >= 4.5
 *   +2 website present & not chain  +2 instagram handle found
 *   +1 photo_count >= 20            +1 days_open >= 5
 * Clamped to the 1..10 range.
 */
export function scoreLead(row: MedSpaLeadRow): number {
  let score = 0;
  if (row.review_count != null && row.review_count >= 50 && row.review_count <= 500) score += 2;
  if (row.rating != null && row.rating >= 4.5) score += 2;
  if (row.website && !isChainDomain(row.website)) score += 2;
  if (row.instagram_handle) score += 2;
  if (row.photo_count != null && row.photo_count >= 20) score += 1;
  if (row.days_open != null && row.days_open >= 5) score += 1;
  return Math.min(10, Math.max(1, score));
}

// --- Results processing (shared by the webhook + the Charlotte test) ----------

export interface CityProcessResult {
  requested: number;      // raw records across all term groups
  filteredOut: number;    // dropped by passesFilter (derm/plastic/hospital)
  newLeads: number;       // rows inserted (or insertable, in dry-run)
  duplicates: number;     // deduped out (in-batch + already in DB)
  inserted: MedSpaLeadRow[];
}

/** Columns med_spa_leads accepts (drops any transient keys before insert). */
const LEAD_COLUMNS: (keyof MedSpaLeadRow)[] = [
  "business_name", "phone", "phone_normalized", "website", "full_address",
  "city", "state", "postal_code", "categories", "primary_type", "rating",
  "review_count", "google_place_id", "instagram_handle", "photo_count", "hours",
  "days_open", "has_booking_link", "lead_score", "search_term", "search_city", "source",
];

function pickColumns(row: MedSpaLeadRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LEAD_COLUMNS) out[k] = row[k];
  return out;
}

/** Insert med-spa rows (chunked, columns filtered). Shared by the webhook + test script. */
export async function insertMedSpaLeads(supabase: SupabaseClient, rows: MedSpaLeadRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(pickColumns);
    const { error } = await supabase.from("med_spa_leads").insert(chunk);
    if (error) throw error;
  }
}

/**
 * Map -> filter -> dedupe (in-batch + DB, by place_id/phone) -> optionally insert.
 * Groups arrive one-per-term, in SEARCH_TERMS order. Reused by both the webhook
 * (write=true) and the Charlotte test (write defaults to false).
 */
export async function processCityResults(
  supabase: SupabaseClient,
  groups: OutscraperRecord[][],
  city: string,
  state: string,
  opts: { write?: boolean } = {}
): Promise<CityProcessResult> {
  // 1. Map every record, tagged with the term whose group produced it.
  let requested = 0;
  const mapped: MedSpaLeadRow[] = [];
  groups.forEach((group, i) => {
    const term = SEARCH_TERMS[i] ?? SEARCH_TERMS[0];
    const list = Array.isArray(group) ? group : [];
    requested += list.length;
    for (const rec of list) {
      const row = mapMedSpaRecord(rec as OutscraperRecord, city, state, term);
      if (row) mapped.push(row);
    }
  });

  // 2. Filter (requirement #2).
  const kept = mapped.filter(passesFilter);
  const filteredOut = mapped.length - kept.length;

  // 3. Dedupe against the DB (place_id + phone), chunked to stay under URL limits.
  const placeIds = Array.from(new Set(kept.map((m) => m.google_place_id).filter(Boolean) as string[]));
  const phones = Array.from(new Set(kept.map((m) => m.phone_normalized).filter(Boolean) as string[]));

  const existingPlace = new Set<string>();
  const existingPhone = new Set<string>();
  for (let i = 0; i < placeIds.length; i += 200) {
    const chunk = placeIds.slice(i, i + 200);
    const { data } = await supabase.from("med_spa_leads").select("google_place_id").in("google_place_id", chunk);
    (data ?? []).forEach((r) => r.google_place_id && existingPlace.add(r.google_place_id));
  }
  for (let i = 0; i < phones.length; i += 200) {
    const chunk = phones.slice(i, i + 200);
    const { data } = await supabase.from("med_spa_leads").select("phone_normalized").in("phone_normalized", chunk);
    (data ?? []).forEach((r) => r.phone_normalized && existingPhone.add(r.phone_normalized));
  }

  // 4. In-batch dedupe (the 7 terms overlap heavily by design).
  const seenPlace = new Set<string>();
  const seenPhone = new Set<string>();
  const toInsert: MedSpaLeadRow[] = [];
  for (const m of kept) {
    const pid = m.google_place_id;
    const ph = m.phone_normalized;
    if (pid && (existingPlace.has(pid) || seenPlace.has(pid))) continue;
    if (ph && (existingPhone.has(ph) || seenPhone.has(ph))) continue;
    if (pid) seenPlace.add(pid);
    if (ph) seenPhone.add(ph);
    toInsert.push(m);
  }

  // 5. Insert the genuinely new rows (chunked).
  if (opts.write && toInsert.length) {
    await insertMedSpaLeads(supabase, toInsert);
  }

  return {
    requested,
    filteredOut,
    newLeads: toInsert.length,
    duplicates: kept.length - toInsert.length,
    inserted: toInsert,
  };
}
