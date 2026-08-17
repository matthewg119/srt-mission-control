import { supabaseAdmin } from "@/lib/db";
import type { LeadContext } from "./lead-context";
import type { MarketingCampaignKey, CadenceTrack } from "./types";

// ── New-lead cadence ─────────────────────────────────────────────────────
// Matt's schedule:
//   Day 1: 2–3 emails (we target 3, back off to 2 if prior sends flagged)
//   Day 2: 2 emails
//   Day 3: 1 email
//   Day 4+: 1 email/day — "confirmation phase" (runs until Matt opts a lead
//           out by flipping do_not_contact or pausing cadence_state).

const NEW_LEAD_LADDER: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const CONFIRMATION_DAILY = 1;

// Minimum hours between sends within the same day so same-day follow-ups
// don't land in the same minute. Matt's D1=3-emails across a waking day.
const MIN_HOURS_BETWEEN_SENDS = 3;

export interface CadenceDecision {
  should_draft: boolean;
  reason: string;
  campaign_key?: MarketingCampaignKey;
  cadence_day?: number;
  sequence_position?: number;
  track?: CadenceTrack;
}

function campaignKeyForTrack(track: CadenceTrack, day: number): MarketingCampaignKey {
  if (track === "awaiting_statements") return "awaiting_statements";
  if (track === "approved_nurture") return "approved_nurture";
  if (track === "confirmation") return "confirmation_daily";
  if (day === 1) return "new_lead_d1";
  if (day === 2) return "new_lead_d2";
  if (day === 3) return "new_lead_d3";
  return "confirmation_daily";
}

export function decideCadence(ctx: LeadContext): CadenceDecision {
  // No cadence row yet → first touch, Day 1 sequence 1.
  const now = Date.now();
  if (!ctx.cadence) {
    return {
      should_draft: true,
      reason: "new lead, cadence not started — kickoff D1/1",
      campaign_key: "new_lead_d1",
      cadence_day: 1,
      sequence_position: 1,
      track: "new_lead",
    };
  }

  const { track, current_day, sends_today, started_at, last_send_at } = ctx.cadence;
  const startedMs = new Date(started_at).getTime();
  const dayFromStart = Math.max(1, Math.floor((now - startedMs) / 86_400_000) + 1);

  // Advance current_day if a fresh calendar day has rolled over.
  const effectiveDay = Math.max(current_day, dayFromStart);
  const isSameDayAsLastSend = last_send_at
    ? new Date(last_send_at).getUTCDate() === new Date(now).getUTCDate()
    : false;
  const sendsAlreadyToday = isSameDayAsLastSend ? sends_today : 0;

  const hoursSinceLastSend = last_send_at
    ? (now - new Date(last_send_at).getTime()) / 3_600_000
    : Infinity;

  if (hoursSinceLastSend < MIN_HOURS_BETWEEN_SENDS) {
    return {
      should_draft: false,
      reason: `sent ${hoursSinceLastSend.toFixed(1)}h ago, min gap ${MIN_HOURS_BETWEEN_SENDS}h`,
    };
  }

  // New-lead ladder days 1-3.
  if (track === "new_lead" && effectiveDay <= 3) {
    const allowed = NEW_LEAD_LADDER[effectiveDay] ?? 1;
    if (sendsAlreadyToday >= allowed) {
      return { should_draft: false, reason: `new_lead D${effectiveDay} cap ${allowed} reached` };
    }
    return {
      should_draft: true,
      reason: `new_lead D${effectiveDay} sequence ${sendsAlreadyToday + 1}/${allowed}`,
      campaign_key: campaignKeyForTrack("new_lead", effectiveDay),
      cadence_day: effectiveDay,
      sequence_position: sendsAlreadyToday + 1,
      track: "new_lead",
    };
  }

  // Day 4+ → confirmation phase (one email per day).
  if (sendsAlreadyToday >= CONFIRMATION_DAILY) {
    return { should_draft: false, reason: `confirmation daily cap reached` };
  }
  return {
    should_draft: true,
    reason: `confirmation D${effectiveDay} daily 1/1`,
    campaign_key: campaignKeyForTrack("confirmation", effectiveDay),
    cadence_day: effectiveDay,
    sequence_position: 1,
    track: "confirmation",
  };
}

/**
 * Idempotent upsert of cadence_state after a successful send. Bumps
 * `current_day`, `sends_today`, and `last_send_at`. Safe to call twice with
 * the same inputs (will update in place).
 */
export async function recordSend(opts: {
  contactId: string;
  track: CadenceTrack;
  cadenceDay: number;
  sentAt?: string;
}): Promise<void> {
  const sentAt = opts.sentAt ?? new Date().toISOString();
  const { data: existing } = await supabaseAdmin
    .from("cadence_state")
    .select("sends_today, last_send_at, current_day, track")
    .eq("contact_id", opts.contactId)
    .maybeSingle();

  const sameDay = existing?.last_send_at
    ? new Date(existing.last_send_at as string).getUTCDate() === new Date(sentAt).getUTCDate()
    : false;
  const sendsToday = sameDay ? Number(existing?.sends_today ?? 0) + 1 : 1;

  await supabaseAdmin
    .from("cadence_state")
    .upsert(
      {
        contact_id: opts.contactId,
        track: opts.track,
        current_day: opts.cadenceDay,
        sends_today: sendsToday,
        last_send_at: sentAt,
        updated_at: sentAt,
      },
      { onConflict: "contact_id" }
    );
}

/** Flip a contact's cadence to paused (Matt replied 🚫 on a draft, etc.). */
export async function pauseCadence(contactId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("cadence_state")
    .upsert(
      { contact_id: contactId, track: "paused", paused: true, paused_reason: reason, updated_at: new Date().toISOString() },
      { onConflict: "contact_id" }
    );
}

/** Move a contact onto a specific non-new-lead track (e.g. awaiting_statements). */
export async function setCadenceTrack(contactId: string, track: CadenceTrack, reason?: string): Promise<void> {
  await supabaseAdmin
    .from("cadence_state")
    .upsert(
      {
        contact_id: contactId,
        track,
        paused: false,
        paused_reason: reason ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id" }
    );
}
