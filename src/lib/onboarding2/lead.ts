// The funnel row. One per email, patched as somebody moves through.
//
// Same shape and the same reasoning as src/lib/chatgpt-ads/lead.ts: the question "how many
// people opened the agreement and did not sign it" cannot be answered by a jsonb blob in
// system_logs without a scan, and that is the only question this funnel exists to answer.

import { supabaseAdmin } from "@/lib/db";
import type { Attribution, Onboarding2LeadRow, Onboarding2SigningRow } from "./types";
import { clean } from "@/lib/medspa/validate";

/**
 * Which address keys the lead row. THE SCREEN-ONE ONE, ALWAYS.
 *
 * ‼️ ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. `email` is what they typed on screen one and
 * it is the key the lead row was created under, carrying the utm and fb attribution. The
 * signature block's `contact_email` is "best contact email" and is frequently a DIFFERENT
 * address: somebody starts on their own address and signs with the front desk's. Preferring
 * contact_email here would upsert a SECOND lead row on the new address and orphan the first,
 * taking the attribution with it, so the funnel would report a signature that arrived from
 * nowhere.
 *
 * Provisioning deliberately does the opposite (see provision.ts): `clients.email` should be the
 * address they nominated to be contacted on. These are two different questions and the two
 * answers are allowed to differ.
 */
export function leadEmailFor(row: Onboarding2SigningRow): string {
  return (row.email || row.contact_email || "").toLowerCase();
}

/**
 * Insert or patch, keyed on email.
 *
 * ‼️ onConflict NAMES THE CONSTRAINT'S COLUMN, AND THE APPLICATION LOWERCASES FIRST. PostgREST
 * can only conflict on a column or a real constraint, never on lower(email), which is why the
 * migration carries a plain unique constraint rather than an expression index. medspa_optins hit
 * this wall at runtime rather than at deploy.
 */
export async function upsertLead(
  patch: Partial<Onboarding2LeadRow> & { email: string }
): Promise<Onboarding2LeadRow | null> {
  const row = { ...patch, email: patch.email.toLowerCase(), updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin
    .from("onboarding2_leads")
    .upsert(row, { onConflict: "email" })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[onboarding2/lead] upsert failed:", error.message);
    return null;
  }
  return (data as Onboarding2LeadRow) ?? null;
}

export async function findLeadByEmail(email: string): Promise<Onboarding2LeadRow | null> {
  const { data } = await supabaseAdmin
    .from("onboarding2_leads")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return (data as Onboarding2LeadRow) ?? null;
}

/**
 * Attribution, cleaned, as column names.
 *
 * ‼️ NOTHING HERE DECIDES WHETHER A VISITOR IS ATTRIBUTABLE. It stores what arrived. The rule
 * that only fbc or fbclid counts, and that _fbp alone never does, lives in hasMetaAttribution()
 * in src/lib/medspa/pixel.ts and is applied where an event is reported, not where a row is
 * written. Storing fbp anyway is what lets that call be re-made later against real data.
 */
export function attributionColumns(a: Attribution | undefined): Partial<Onboarding2LeadRow> {
  if (!a) return {};
  return {
    source_url: clean(a.sourceUrl, 500) || null,
    referrer: clean(a.referrer, 500) || null,
    utm_source: clean(a.utmSource, 80) || null,
    utm_medium: clean(a.utmMedium, 80) || null,
    utm_campaign: clean(a.utmCampaign, 120) || null,
    utm_content: clean(a.utmContent, 120) || null,
    fbc: clean(a.fbc, 255) || null,
    fbp: clean(a.fbp, 255) || null,
    fbclid: clean(a.fbclid, 255) || null,
  };
}

/** The same attribution, as the signing row's column names. */
export function attributionForSigning(a: Attribution | undefined): Record<string, unknown> {
  if (!a) return {};
  const n = (v: unknown): number | null => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.trunc(x) : null;
  };
  return {
    ...attributionColumns(a),
    ai_visibility_score: n(a.score),
    competitor_name: clean(a.competitor, 160) || null,
    user_showed_count: n(a.userShowed),
    comp_showed_count: n(a.compShowed),
    report_slug: clean(a.reportSlug, 120) || null,
  };
}
