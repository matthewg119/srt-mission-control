// The presence sweep — delivery steps 4 (automated tier) and 5 (manual tier).
//
// Eighteen platforms in two tiers. Runner v3 section 6.
//
// ‼️ THE AUTOMATED TIER IS EMPTY AND THIS FILE SAYS SO OUT LOUD.
// Google Places, Bing Maps, Foursquare and Yelp Fusion are all unkeyed. Runner v3 section 6:
// "Report which of these are ACTUALLY KEYED before building against them... Do not build
// against a key that does not exist." So `nap_sweep` seeds eighteen rows at 'not_checked' and
// completes immediately, having honestly checked nothing, and the manual card does the work.
// That is not a stub — it is the correct behaviour for the keys that exist today, and the shape
// is already right for the day one lands.
//
// ‼️ A SEEDED ROW SAYS 'not_checked', WHICH IS A REAL ANSWER AND NOT A PLACEHOLDER.
// It renders on the PDF as "not checked" and never as "no issues found". Those two sentences
// look alike and mean opposite things: one is evidence of correctness, the other is an absence
// of evidence being dressed up as one.

import { supabaseAdmin } from "@/lib/db";
import { ALL_PLATFORMS, CORE_SIX, EXTENDED, PLATFORM_COUNT } from "@/config/presence-platforms";
import { canonicalLine, type Canonical } from "./nap-compare";
import { normalizeState } from "./normalize";

export interface SweepRow {
  id: string;
  platform: string;
  tier: "core_six" | "extended";
  source: "api" | "manual";
  status: "match" | "mismatch" | "duplicate" | "missing" | "not_checked";
  rawName: string | null;
  rawAddress: string | null;
  rawPhone: string | null;
  listingUrl: string | null;
  claimed: boolean | null;
  screenshotRef: string | null;
  proposedStatus: string | null;
  confirmedStatus: string | null;
  skipReason: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
}

export async function canonicalFor(clientId: string): Promise<Canonical | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, address_line1, address_line2, city, state, postal_code, phone")
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;
  return {
    name: ((data.dba_name || data.legal_name) as string) ?? "",
    addressLine1: (data.address_line1 as string | null) ?? null,
    addressLine2: (data.address_line2 as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    postalCode: (data.postal_code as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  };
}

/**
 * Create one row per platform at 'not_checked'.
 *
 * Idempotent via the unique index on (client_id, platform, coalesce(listing_url,'')), so
 * re-running the step never duplicates and — more importantly — never resets a row somebody has
 * already filled in. Runner v3 section 2: "Every auto task is idempotent. Re-running writes a
 * new output_ref and supersedes; it never duplicates rows in nap_discrepancies."
 *
 * ‼️ NO `onConflict` TARGET, DELIBERATELY, AND PUTTING ONE BACK BREAKS THIS STEP OUTRIGHT.
 *
 * It used to pass `onConflict: "client_id,platform,listing_url"` and this step failed on every
 * run since it shipped, first one included, with:
 *
 *   there is no unique or exclusion constraint matching the ON CONFLICT specification
 *
 * ON CONFLICT infers an index by matching the inference spec against the index's key
 * EXPRESSIONS. The index above is keyed on `coalesce(listing_url, '')`, and a bare column name
 * does not match an expression, so Postgres found no candidate and raised 42P10. Not a data
 * collision — an inference failure, which is why it could never succeed even once. Production
 * proved it: nap_discrepancies had zero rows.
 *
 * PostgREST's `on_conflict` parameter takes column NAMES only, so `coalesce(listing_url,'')`
 * cannot be spelled there at all. Omitting it makes PostgREST emit `ON CONFLICT DO NOTHING`
 * with no target, which needs no inference and honours EVERY unique index on the table,
 * including the expression one. Works only because `ignoreDuplicates` is true; a merge upsert
 * would still need a target.
 *
 * Do NOT "fix" this by adding a plain unique index on (client_id, platform, listing_url). These
 * seeded rows have a null listing_url, nulls compare distinct by default, and every re-run
 * would insert eighteen fresh duplicates — the exact thing this function promises not to do.
 */
export async function seedPresenceSweep(clientId: string): Promise<{ ok: boolean; seeded: number; error?: string }> {
  const rows = ALL_PLATFORMS.map((p) => ({
    client_id: clientId,
    platform: p.key,
    tier: p.tier,
    source: "manual" as const,
    status: "not_checked" as const,
  }));

  const { error } = await supabaseAdmin
    .from("nap_discrepancies")
    .upsert(rows, { ignoreDuplicates: true });

  if (error) return { ok: false, seeded: 0, error: error.message };
  return { ok: true, seeded: rows.length };
}

export async function loadSweep(clientId: string): Promise<SweepRow[]> {
  const { data, error } = await supabaseAdmin
    .from("nap_discrepancies")
    .select("*")
    .eq("client_id", clientId);

  if (error) {
    console.error("[clients/presence-sweep] load failed:", error.message);
    return [];
  }

  const order = new Map(ALL_PLATFORMS.map((p, i) => [p.key, i]));
  return (data ?? [])
    .map((d) => ({
      id: d.id as string,
      platform: d.platform as string,
      tier: d.tier as "core_six" | "extended",
      source: d.source as "api" | "manual",
      status: d.status as SweepRow["status"],
      rawName: (d.raw_name as string | null) ?? null,
      rawAddress: (d.raw_address as string | null) ?? null,
      rawPhone: (d.raw_phone as string | null) ?? null,
      listingUrl: (d.listing_url as string | null) ?? null,
      claimed: (d.claimed as boolean | null) ?? null,
      screenshotRef: (d.screenshot_ref as string | null) ?? null,
      proposedStatus: (d.proposed_status as string | null) ?? null,
      confirmedStatus: (d.confirmed_status as string | null) ?? null,
      skipReason: (d.skip_reason as string | null) ?? null,
      checkedBy: (d.checked_by as string | null) ?? null,
      checkedAt: (d.checked_at as string | null) ?? null,
    }))
    .sort((a, b) => (order.get(a.platform) ?? 99) - (order.get(b.platform) ?? 99));
}

/**
 * ‼️ THE STATUS THAT COUNTS IS THE CONFIRMED ONE, AND ITS ABSENCE IS NOT A NEUTRAL DEFAULT.
 *
 * Runner v3 section 6: "NEVER auto-mark a listing verified. The tool proposes; I confirm."
 * A row whose confirmed_status is null has not been confirmed, so it reads as 'not_checked'
 * regardless of what the comparison proposed. This is what stops a string comparison sending
 * somebody to edit a client's live Google listing.
 */
export function effectiveStatus(row: SweepRow): SweepRow["status"] {
  return (row.confirmedStatus as SweepRow["status"] | null) ?? "not_checked";
}

export interface SweepCounts {
  match: number;
  mismatch: number;
  duplicate: number;
  missing: number;
  not_checked: number;
}

export function countByStatus(rows: SweepRow[]): SweepCounts {
  const counts: SweepCounts = { match: 0, mismatch: 0, duplicate: 0, missing: 0, not_checked: 0 };
  for (const r of rows) counts[effectiveStatus(r)] += 1;
  return counts;
}

/** Worst first: a duplicate outranks a wrong phone outranks a name variant outranks missing. */
const SEVERITY: Record<SweepRow["status"], number> = {
  duplicate: 0,
  mismatch: 1,
  missing: 2,
  not_checked: 3,
  match: 4,
};

export function worstFirst(rows: SweepRow[]): SweepRow[] {
  return rows.slice().sort((a, b) => SEVERITY[effectiveStatus(a)] - SEVERITY[effectiveStatus(b)]);
}

/**
 * The manual sweep card. Runner v3 section 3: imperative sentences and the EXACT string to
 * search. Never "check the listing".
 *
 * This replaces the CSV worksheet entirely, which is why every platform gets its own numbered
 * line with the search string already composed — the person doing this is copying and pasting,
 * not deciding anything.
 */
export function formatSweepCard(client: { name: string; city: string; state: string }, canonical: Canonical): string {
  const state = normalizeState(client.state || "");
  const args = { name: client.name, city: client.city, state };

  const lines: string[] = [
    `*Presence sweep — 0 of ${PLATFORM_COUNT} done automatically*`,
    "No presence provider is keyed (Google Places, Bing, Foursquare, Yelp all unkeyed), so all eighteen are manual.",
    "",
    `*Canonical:* ${canonicalLine(canonical)}`,
    "",
    "Search the string, screenshot what you see, reply in this thread.",
    "",
    "*CORE SIX* — the findings gate, and the only tier we fix in week one",
  ];

  CORE_SIX.forEach((p, i) => {
    lines.push(` ${i + 1}. ${p.label} — search: \`${p.search(args)}\`  <${p.url}|open>`);
    if (p.note) lines.push(`     ${p.note}`);
  });

  lines.push("", "*EXTENDED* — context only. Findings, not week-one cleanup.");
  EXTENDED.forEach((p, i) => {
    lines.push(` ${CORE_SIX.length + i + 1}. ${p.label} — search: \`${p.search(args)}\`  <${p.url}|open>`);
    if (p.note) lines.push(`     ${p.note}`);
  });

  lines.push(
    "",
    "For each: a screenshot showing name, address and phone.",
    "*If there is no listing, screenshot the empty search result.* That IS the evidence for \"missing\".",
    "Anything you skip renders on the client PDF as \"not checked\", never as \"no issues found\"."
  );

  return lines.join("\n");
}

/**
 * Step 4. Seeds the eighteen rows and reports honestly that it checked none of them.
 *
 * It completes rather than erroring, because seeding IS the whole of the automated tier while no
 * provider is keyed, and leaving the step in error would block step 5 behind a thing that is
 * working as designed.
 */
export async function runAutomatedSweep(
  clientId: string
): Promise<{ ok: boolean; error?: string; note: string }> {
  const canonical = await canonicalFor(clientId);
  if (!canonical) return { ok: false, error: "client not found", note: "" };

  if (!canonical.addressLine1 || !canonical.phone) {
    return {
      ok: false,
      error: "no canonical address or phone on the client record, so there is nothing to compare listings against",
      note: "",
    };
  }

  const seeded = await seedPresenceSweep(clientId);
  if (!seeded.ok) return { ok: false, error: seeded.error, note: "" };

  return {
    ok: true,
    note:
      `Seeded ${PLATFORM_COUNT} platforms at "not checked". ` +
      `Nothing was checked automatically: no presence provider is keyed. The manual sweep is the sweep.`,
  };
}
