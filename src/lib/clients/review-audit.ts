// The review audit — delivery step 8, Runner v3 section 8 / SOP 2.2.
//
// Per review-bearing platform, for this client AND each of the three competitors picked at
// step 7: total reviews, average rating, date of the most recent one, how often the owner
// replies, and the themes in the negatives. It is findings section 3.
//
// ‼️ THIS STEP IS auto_then_manual, AND IT WAS DECLARED PLAIN `auto`. THAT WAS THE BUG.
//
// src/config/presence-platforms.ts records `api: false` on all eighteen platforms, and its
// header documents that Google Places, Bing Maps, Foursquare and Yelp Fusion were each checked
// on 2026-08-18 with no key available in this environment. Runner v3's own how-to-work section
// says the same thing in one line: "Presence-sweep keys: none."
//
// So there is no automated path to a review count, and there was never going to be one on this
// step's own terms. Ticking it as `auto` would mark a MEASUREMENT complete that measured
// nothing, and findings section 3 — a document that goes to the client — would print a
// placeholder table under a checklist claiming the review audit was done.
//
// What this runner does instead is the honest half: seed the capture rows, compose the exact
// search string for every subject on every platform, and post the card. A person fills the
// numbers in. That is exactly the shape `nap_sweep` already has, for exactly the same reason.
//
// ‼️ SEEDED ROWS READ "NOT RECORDED", NEVER ZERO.
// Zero reviews and un-checked are opposite claims about a business, and the one place that
// distinction gets destroyed is a nullable integer defaulted to 0. review_count stays NULL
// until somebody types a number.
//
// ‼️ NO MODEL WRITES "THEMES IN THE NEGATIVES" IN V1.
// It is the obvious place to put a Claude call and it is the wrong place. That sentence lands
// verbatim in a client-facing PDF, and a hallucinated theme in that document cannot be walked
// back. A person types what they read.

import { supabaseAdmin } from "@/lib/db";
import { CORE_SIX, platformByKey, type PresencePlatform } from "@/config/presence-platforms";
import { selectedCompetitors, REQUIRED_SELECTIONS } from "./competitors";
import { canonicalFor } from "./presence-sweep";

/**
 * The platforms that actually carry public reviews.
 *
 * A subset of CORE_SIX, and deliberately not all eighteen: Bing Places and the extended tier
 * are presence records, not review corpora. Asking somebody to screenshot a review count on
 * Hotfrog is how a sweep stops getting done at all.
 */
export const REVIEW_PLATFORMS: PresencePlatform[] = CORE_SIX.filter((p) =>
  ["google", "yelp", "facebook", "realself"].includes(p.key)
);

export interface ReviewAuditRow {
  id: string;
  subjectType: "client" | "competitor";
  competitorId: string | null;
  subjectName: string;
  platform: string;
  reviewCount: number | null;
  averageRating: number | null;
  mostRecentReviewAt: string | null;
  ownerResponseRate: number | null;
  negativeThemes: string[];
  checkedBy: string | null;
  checkedAt: string | null;
}

/** A row nobody has filled in yet. The whole point of the tri-state. */
export function isRecorded(row: ReviewAuditRow): boolean {
  return row.checkedAt !== null && row.reviewCount !== null;
}

/**
 * Seed one row per subject per review platform.
 *
 * Idempotent, the same way seedPresenceSweep is: upsert with ignoreDuplicates, so re-running
 * adds rows for a competitor picked later without resetting a number a human already typed.
 *
 * ‼️ Called from BOTH the runner and step-engine's instructionsFor, because once this step is
 * `auto_then_manual` either path can post the card first. Same precedent as competitor_shortlist
 * calling buildShortlist from inside instructionsFor.
 */
export async function seedReviewAudit(
  clientId: string
): Promise<{ ok: boolean; seeded: number; competitors: number; error?: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, seeded: 0, competitors: 0, error: "Client not found." };

  const clientName = (client.dba_name || client.legal_name || "Client") as string;
  const competitors = await selectedCompetitors(clientId);

  const subjects: Array<{ type: "client" | "competitor"; id: string | null; name: string }> = [
    { type: "client", id: null, name: clientName },
    ...competitors.map((c) => ({ type: "competitor" as const, id: c.id, name: c.name })),
  ];

  const rows = subjects.flatMap((s) =>
    REVIEW_PLATFORMS.map((p) => ({
      client_id: clientId,
      subject_type: s.type,
      competitor_id: s.id,
      subject_name: s.name,
      platform: p.key,
      source: "manual",
    }))
  );

  const { error } = await supabaseAdmin
    .from("review_audit_rows")
    .upsert(rows, { onConflict: "client_id,subject_type,competitor_key,platform", ignoreDuplicates: true });

  if (error) return { ok: false, seeded: 0, competitors: competitors.length, error: error.message };

  return { ok: true, seeded: rows.length, competitors: competitors.length };
}

export async function loadReviewAudit(clientId: string): Promise<ReviewAuditRow[]> {
  const { data } = await supabaseAdmin
    .from("review_audit_rows")
    .select(
      "id, subject_type, competitor_id, subject_name, platform, review_count, average_rating, most_recent_review_at, owner_response_rate, negative_themes, checked_by, checked_at"
    )
    .eq("client_id", clientId);

  return (data ?? []).map((d) => ({
    id: d.id as string,
    subjectType: d.subject_type as "client" | "competitor",
    competitorId: (d.competitor_id as string | null) ?? null,
    subjectName: (d.subject_name as string) ?? "",
    platform: d.platform as string,
    reviewCount: (d.review_count as number | null) ?? null,
    averageRating: (d.average_rating as number | null) ?? null,
    mostRecentReviewAt: (d.most_recent_review_at as string | null) ?? null,
    ownerResponseRate: (d.owner_response_rate as number | null) ?? null,
    negativeThemes: (d.negative_themes as string[] | null) ?? [],
    checkedBy: (d.checked_by as string | null) ?? null,
    checkedAt: (d.checked_at as string | null) ?? null,
  }));
}

/**
 * The capture card. Runner v3 section 3: the exact string to search, never "check the reviews".
 *
 * Modelled line for line on formatSweepCard, because the person doing this is copying and
 * pasting rather than deciding anything, and two cards for the same kind of work should not
 * read differently.
 */
export function formatReviewAuditCard(args: {
  clientName: string;
  city: string;
  state: string;
  competitors: Array<{ name: string }>;
  rows: ReviewAuditRow[];
}): string {
  const recorded = args.rows.filter(isRecorded).length;
  const total = args.rows.length;

  const lines: string[] = [
    `*Review audit — ${recorded} of ${total} recorded*`,
    "No review provider is keyed (Google Places, Yelp Fusion, Foursquare all unkeyed), so every",
    "one of these is a manual read. Read-only, official pages only. Never a scrape.",
    "",
  ];

  if (args.competitors.length < REQUIRED_SELECTIONS) {
    lines.push(
      `:warning: Only ${args.competitors.length} of ${REQUIRED_SELECTIONS} competitors are picked, so this` +
        ` card covers the client${args.competitors.length ? " and those" : " only"}.` +
        ` Pick the rest at the shortlist card and this refreshes.`,
      ""
    );
  }

  const subjects = [
    { name: args.clientName, label: "THE CLIENT" },
    ...args.competitors.map((c) => ({ name: c.name, label: "COMPETITOR" })),
  ];

  let n = 0;
  for (const subject of subjects) {
    lines.push(`*${subject.label}: ${subject.name}*`);
    for (const p of REVIEW_PLATFORMS) {
      n++;
      const search = p.search({ name: subject.name, city: args.city, state: args.state });
      lines.push(` ${n}. ${p.label} — search: \`${search}\`  <${p.url}|open>`);
    }
    lines.push("");
  }

  lines.push(
    "For each one, reply in this thread with:",
    "  • total reviews · average rating · date of the most recent one",
    "  • how many of the last 10 got an owner reply",
    "  • the themes you see in the negative ones, in their words",
    "",
    "*A platform you cannot find a listing on is a finding.* Say so, and screenshot the empty result.",
    "A row you skip renders as \"not recorded\", never as zero reviews. Those are opposite claims."
  );

  return lines.join("\n");
}

/**
 * The auto half: seed and describe. The numbers are a person's job.
 *
 * ‼️ It returns ok:true with fewer than three competitors rather than failing. An
 * auto_then_manual step that returns ok:false lands in terminal `error`, where nothing retries
 * it and the card never posts — so a shortlist that is one pick short would silently cost the
 * whole review audit. The card says how many are missing instead.
 */
export async function runReviewAudit(
  clientId: string
): Promise<{ ok: boolean; error?: string; note: string }> {
  const seeded = await seedReviewAudit(clientId);
  if (!seeded.ok) return { ok: false, error: seeded.error, note: "" };

  const canonical = await canonicalFor(clientId);

  return {
    ok: true,
    note:
      `Review audit seeded: ${seeded.seeded} rows across ${REVIEW_PLATFORMS.length} platforms for ` +
      `the client and ${seeded.competitors} competitor${seeded.competitors === 1 ? "" : "s"}. ` +
      `Nothing is measured yet — no review API is keyed, so every row is a manual read.` +
      (canonical ? "" : " No canonical NAP on file, so the search strings use the client record as-is."),
  };
}

/** Platform label for the artifacts, so findings and the card cannot disagree. */
export function reviewPlatformLabel(key: string): string {
  return platformByKey(key)?.label ?? key;
}
