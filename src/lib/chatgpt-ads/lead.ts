// The chatgpt_ads_leads row, and the two things everything else needs from it.
//
// SERVER ONLY. It imports supabaseAdmin. The client never sees this file.

import { supabaseAdmin } from "@/lib/db";
import type { SignupPath } from "@/config/chatgpt-ads";

export interface ChatgptAdsLeadRow {
  id: string;
  created_at: string;
  updated_at: string;

  website: string | null;
  email: string;
  phone: string | null;
  business_name: string | null;
  city: string | null;

  revenue: string | null;
  branch: string | null;
  channels: string[] | null;
  patient_volume: string | null;
  one_service: string | null;
  gbp_access: string | null;
  website_host: string | null;
  website_access: string | null;

  ai_visibility_score: number | null;
  competitor_name: string | null;
  user_showed_count: number | null;
  comp_showed_count: number | null;
  report_slug: string | null;

  signup_path: SignupPath;
  call_requested_at: string | null;
  call_completed_at: string | null;
  fallback_slot_shown_at: string | null;
  booked_slot_at: string | null;
  calendly_event_uri: string | null;
  intake_token_hash: string | null;

  contact_id: string | null;
  slack_thread_ts: string | null;
  ip_hash: string | null;
  source_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbc: string | null;
  fbp: string | null;
  fbclid: string | null;
}

/**
 * How ready this lead is to be installed, at a glance.
 *
 * The whole reason Q5 and Q6 exist. Green means the work can start on the kickoff call.
 * Amber means they own it but have not looked at it, which is a nudge, not a blocker. Red
 * means somebody else holds the keys and the first conversation is about getting them, which
 * is a completely different call to plan for.
 *
 * "unsure" is deliberately RED and not amber. Not knowing whether an agency controls your
 * Google listing is functionally the same as an agency controlling it: either way nothing can
 * be published until somebody finds out, and the optimistic reading is the one that wastes
 * the kickoff call.
 */
export type AccessFlag = "green" | "amber" | "red";

export function accessFlag(value: string | null | undefined): AccessFlag {
  switch (value) {
    case "full_access":
    case "owner_full":
      return "green";
    case "stale_access":
    case "host_full":
      return "amber";
    default:
      return "red";
  }
}

export function flagEmoji(flag: AccessFlag): string {
  return flag === "green" ? "\u{1F7E2}" : flag === "amber" ? "\u{1F7E1}" : "\u{1F534}";
}

/**
 * Upsert on email.
 *
 * ON EMAIL, AND THE CONSTRAINT HAS TO BE A REAL ONE. PostgREST can only name a column or a
 * named constraint in onConflict, never a lower(email) expression index, which is the trap
 * medspa_optins documents and the reason the migration uses a plain UNIQUE on the column.
 * The email is lowercased before it ever gets here so the plain constraint is enough.
 *
 * PATCH SEMANTICS, NOT REPLACE. A visitor who taps Call Me Now, cancels, and then books has
 * two writes against one row, and the second must not blank what the first recorded. Every
 * undefined key is stripped before the write for exactly that reason; null is still allowed
 * through, because "clear this" and "do not touch this" are different instructions.
 */
export async function upsertLead(
  patch: Partial<ChatgptAdsLeadRow> & { email: string }
): Promise<ChatgptAdsLeadRow | null> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("chatgpt_ads_leads")
    .upsert(clean, { onConflict: "email" })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[chatgpt-ads] upsertLead", error.message);
    return null;
  }
  return (data as ChatgptAdsLeadRow) ?? null;
}

export async function findLeadByEmail(email: string): Promise<ChatgptAdsLeadRow | null> {
  const { data, error } = await supabaseAdmin
    .from("chatgpt_ads_leads")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.error("[chatgpt-ads] findLeadByEmail", error.message);
    return null;
  }
  return (data as ChatgptAdsLeadRow) ?? null;
}
