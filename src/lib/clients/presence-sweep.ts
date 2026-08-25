// The presence sweep — delivery steps 4 (automated tier) and 5 (manual tier).
//
// Eighteen platforms in two tiers. Runner v3 section 6.
//
// ‼️ THE AUTOMATED TIER IS EMPTY AND THIS FILE SAYS SO OUT LOUD.
// Google Places, Bing Maps, Foursquare and Yelp Fusion are all unkeyed. Runner v3 section 6:
// "Report which of these are ACTUALLY KEYED before building against them... Do not build
// against a key that does not exist." So `nap_sweep` seeds nineteen rows at 'not_checked' and
// completes immediately, having honestly checked nothing, and the manual card does the work.
// That is not a stub — it is the correct behaviour for the keys that exist today, and the shape
// is already right for the day one lands.
//
// ‼️ A SEEDED ROW SAYS 'not_checked', WHICH IS A REAL ANSWER AND NOT A PLACEHOLDER.
// It renders on the PDF as "not checked" and never as "no issues found". Those two sentences
// look alike and mean opposite things: one is evidence of correctness, the other is an absence
// of evidence being dressed up as one.

import { supabaseAdmin } from "@/lib/db";
import {
  ALL_PLATFORMS,
  CORE_SIX,
  EXTENDED,
  PLATFORM_COUNT,
  RECOMMENDED,
  RECOMMENDED_KEYS,
  SWEEP_GATE_COUNT,
} from "@/config/presence-platforms";
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
 * ‼️ THIS HAS NOW FAILED TWO DIFFERENT WAYS AND THE FIX FOR THE FIRST IS WHAT CAUSED THE SECOND.
 * Both are written down because the third attempt looks like a partial revert of the second.
 *
 * FAILURE ONE, every run from ship day to 2026-08-22: 42P10 at PLAN time.
 *
 *   there is no unique or exclusion constraint matching the ON CONFLICT specification
 *
 * It passed onConflict "client_id,platform,listing_url" against the only unique index on the
 * table, which was keyed on the EXPRESSION coalesce(listing_url, ''). ON CONFLICT infers an
 * arbiter by matching the inference spec against the index's key expressions, and a bare column
 * name never matches an expression. Not a data collision: the statement could not be PLANNED,
 * so it could not succeed even once. Production had zero rows in nap_discrepancies.
 *
 * FAILURE TWO, introduced by the fix for failure one, and the state this was found in:
 *
 *   duplicate key value violates unique constraint "nap_discrepancies_platform_listing_key"
 *
 * That fix removed the onConflict option entirely, which cleared 42P10 and let the FIRST seed
 * write eighteen rows. But with no conflict target there is no arbiter to skip on, so the second
 * seed for a client was a plain INSERT of eighteen rows that already existed. nap_sweep went to
 * a terminal 'error' and stayed there. The production test that "proved" the fix inserted a
 * single row into an empty table and therefore never exercised a duplicate at all.
 *
 * THE FIX, docs/2026-08-24-step-board-fixes.sql: a unique index on the COLUMNS
 * (client_id, platform, listing_url) declared NULLS NOT DISTINCT, and the target back here.
 *
 * ‼️ NULLS NOT DISTINCT IS THE ENTIRE REASON THIS IS SAFE, AND THE COMMENT THAT USED TO SIT
 * HERE WAS RIGHT TO FORBID THE INDEX WITHOUT IT. Every seeded row has a null listing_url. Under
 * Postgres's default nulls compare distinct, so a plain unique index on those three columns
 * constrains none of these rows and every re-run inserts eighteen fresh duplicates. NULLS NOT
 * DISTINCT makes two nulls collide, which is exactly the semantics coalesce(listing_url,'') had,
 * spelled as columns so ON CONFLICT can infer it and so PostgREST's on_conflict parameter, which
 * takes column NAMES only and can never spell a coalesce, can name it. The two indexes are
 * semantically the same; only one of them is inferrable from a column list.
 *
 * ignoreDuplicates is still required and is a separate thing from the target: it is what makes
 * this DO NOTHING rather than DO UPDATE, so a row somebody has already filled in is never reset.
 * A merge upsert would overwrite the manual sweep with eighteen blanks.
 *
 * ‼️ THE RETURN VALUE IS A MEASUREMENT, NOT A RESTATEMENT OF THE INPUT. It used to return
 * `seeded: rows.length`, i.e. 18, on every call whatever happened, which is how a run that
 * inserted nothing reported eighteen. `.select("id")` makes PostgREST hand back only the rows
 * DO NOTHING actually inserted. `seeded` and `onFile` are both returned because "0 inserted"
 * and "0 rows exist" are opposite outcomes and one field cannot carry both.
 */
export async function seedPresenceSweep(
  clientId: string
): Promise<{ ok: boolean; seeded: number; onFile: number; error?: string }> {
  const rows = ALL_PLATFORMS.map((p) => ({
    client_id: clientId,
    platform: p.key,
    tier: p.tier,
    source: "manual" as const,
    status: "not_checked" as const,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("nap_discrepancies")
    .upsert(rows, { onConflict: "client_id,platform,listing_url", ignoreDuplicates: true })
    .select("id");

  if (error) return { ok: false, seeded: 0, onFile: 0, error: error.message };

  const { count, error: countError } = await supabaseAdmin
    .from("nap_discrepancies")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  if (countError) {
    return { ok: false, seeded: inserted?.length ?? 0, onFile: 0, error: countError.message };
  }

  return { ok: true, seeded: inserted?.length ?? 0, onFile: count ?? 0 };
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
 *
 * ‼️ THREE GROUPS, AND ONLY ONE OF THEM IS A TIER.
 *
 * RECOMMENDED is where to start and closes nothing by itself: it is a display concept, and
 * Matthew's own four. CORE SIX and EXTENDED are the REMEDIATION tiers and still mean exactly
 * what they meant — a core-six mismatch and a Manta mismatch are not equivalent in a document a
 * client reads. The GATE is neither: any four distinct platforms, of any tier, his choice.
 *
 * ‼️ IT RUNS PAST 2,900 CHARACTERS AND THAT IS HANDLED, NOT IGNORED. The eighteen-platform
 * version measured 2,988 for a short business name, and the name is interpolated into every
 * search string. bodySections() in step-engine.ts splits this on LINE boundaries into as many
 * Slack sections as it needs, never mid-line, because these lines are search strings and URLs
 * somebody pastes.
 */
export function formatSweepCard(client: { name: string; city: string; state: string }, canonical: Canonical): string {
  const state = normalizeState(client.state || "");
  const args = { name: client.name, city: client.city, state };
  const line = (n: number, p: (typeof ALL_PLATFORMS)[number]) =>
    ` ${n}. ${p.label} — search: \`${p.search(args)}\`  <${p.url}|open>`;

  const restOfCore = CORE_SIX.filter((p) => !RECOMMENDED_KEYS.includes(p.key));
  const restOfExtended = EXTENDED.filter((p) => !RECOMMENDED_KEYS.includes(p.key));

  const lines: string[] = [
    `*Presence sweep — 0 of ${PLATFORM_COUNT} done automatically*`,
    "No presence provider is keyed (Google Places, Bing, Foursquare, Yelp all unkeyed), so every one is manual.",
    "",
    `*Canonical:* ${canonicalLine(canonical)}`,
    "",
    "Search the string, screenshot what you see, reply in this thread.",
    "",
    `*[Done] closes on any ${SWEEP_GATE_COUNT} DISTINCT platforms, and which ${SWEEP_GATE_COUNT} is your choice.*`,
    `Not four named ones: any ${SWEEP_GATE_COUNT} of the ${PLATFORM_COUNT} below. The first four are where I would start.`,
    "",
    "*Two ways a screenshot gets attributed, and one of them needs nothing typed:*",
    "  • name the platform in the message: type `Yelp` and attach the image, or",
    "  • leave the Chrome address bar in the shot and the URL in the picture is read for you.",
    "One platform per message either way. A screenshot nothing can attribute is still filed and",
    "still kept, it just does not count toward the four, and the thread says which one it was.",
    "",
    "*START WITH THESE FOUR*",
  ];

  RECOMMENDED.forEach((p, i) => {
    lines.push(line(i + 1, p));
    if (p.note) lines.push(`     ${p.note}`);
  });

  lines.push(
    "",
    "*THE REST OF THE CORE SIX* — the remediation tier. A mismatch here is week-one cleanup work."
  );
  restOfCore.forEach((p, i) => {
    lines.push(line(RECOMMENDED.length + i + 1, p));
    if (p.note) lines.push(`     ${p.note}`);
  });

  lines.push(
    "",
    "*EXTENDED* — context. Findings, not week-one cleanup. Any of these still counts toward the four."
  );
  restOfExtended.forEach((p, i) => {
    lines.push(line(RECOMMENDED.length + restOfCore.length + i + 1, p));
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
 * Step 4. Seeds the nineteen rows and reports honestly that it checked none of them.
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
      `${seeded.onFile} of ${PLATFORM_COUNT} platforms are on file at "not checked" ` +
      `(${seeded.seeded} written on this run). ` +
      `Nothing was checked automatically: no presence provider is keyed. The manual sweep is the sweep.`,
  };
}
