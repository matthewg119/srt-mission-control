import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { MATTHEW } from "@/config/rep-profile";
import type { LeadContext } from "./lead-context";

// ── Touch policy ───────────────────────────────────────────────────────────
// Decides whether VeKtor should email a given contact right now.
//
// Matt's rule: "actively being followed up with" = any human activity in the
// last 7 days OR an open task. If a lead has been worked for >7 days with no
// open task, VeKtor should NOT email — instead hand it off to a rep to clean.

const ACTIVE_WINDOW_DAYS = 7;

export type TouchDecision =
  | { kind: "proceed" }
  | { kind: "skip_recent_touch"; reason: string; lastTouchAt: string }
  | { kind: "handoff_to_rep"; reason: string };

export async function decideTouch(ctx: LeadContext): Promise<TouchDecision> {
  if (ctx.contact.do_not_contact) {
    return { kind: "skip_recent_touch", reason: "do_not_contact flag", lastTouchAt: "" };
  }
  if (ctx.cadence?.paused) {
    return { kind: "skip_recent_touch", reason: ctx.cadence.paused_reason ?? "cadence paused", lastTouchAt: "" };
  }

  const sinceISO = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000).toISOString();

  // 1. Open task → skip (someone is already handling).
  if (ctx.open_tasks.length > 0) {
    return {
      kind: "skip_recent_touch",
      reason: `${ctx.open_tasks.length} open task(s), newest: "${ctx.open_tasks[0].title}"`,
      lastTouchAt: "",
    };
  }

  // 2. Recent human call.
  const recentCall = await fetchRecentCall(ctx.contact.id, sinceISO);
  if (recentCall) {
    return { kind: "skip_recent_touch", reason: `call logged ${recentCall.outcome ?? "?"}`, lastTouchAt: recentCall.created_at };
  }

  // 3. Recent human email in MS Graph sent folder (Matt → merchant).
  if (ctx.contact.email) {
    const lastHumanEmailAt = await fetchRecentHumanEmailTo(ctx.contact.email, sinceISO);
    if (lastHumanEmailAt) {
      return { kind: "skip_recent_touch", reason: "human email sent in last 7d", lastTouchAt: lastHumanEmailAt };
    }
  }

  // 4. Been worked (has any historical touch) but no touch in 7d AND no open task
  //    → handoff to rep to clean. lead_activities is the unified touch log the
  //    original version of this check said we didn't have yet.
  const hasAnyHistoricalTouch =
    ctx.recent_sends.length > 0 || ctx.recent_activity.length > 0;
  const daysSinceUpdated = ctx.days_since_updated ?? 999;
  if (hasAnyHistoricalTouch && daysSinceUpdated > ACTIVE_WINDOW_DAYS) {
    return {
      kind: "handoff_to_rep",
      reason: `worked before, no activity in ${daysSinceUpdated}d, no open task`,
    };
  }

  return { kind: "proceed" };
}

async function fetchRecentCall(contactId: string, sinceISO: string): Promise<{ created_at: string; outcome: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("call_log")
    .select("created_at, outcome")
    .eq("contact_id", contactId)
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { created_at: data.created_at as string, outcome: (data.outcome as string | null) ?? null };
}

async function fetchRecentHumanEmailTo(recipientEmail: string, sinceISO: string): Promise<string | null> {
  const matthewEmail = MATTHEW.email;
  if (!matthewEmail) return null;
  try {
    // MS Graph $filter doesn't support toRecipients/any in all tenants; we grab
    // the most recent ~25 sent messages and check toRecipients client-side.
    // This trades a couple extra bytes for robustness across tenants.
    let checked = 0;
    for await (const msg of microsoft.listMessages({
      mailbox: matthewEmail,
      folder: "sentitems",
      filter: `sentDateTime ge ${sinceISO}`,
      top: 25,
      select: ["id", "toRecipients", "sentDateTime"],
    }) as AsyncIterable<{ toRecipients?: Array<{ emailAddress?: { address?: string } }>; sentDateTime?: string }>) {
      checked++;
      if (checked > 50) break;
      const match = (msg.toRecipients ?? []).some(
        (r) => (r.emailAddress?.address ?? "").toLowerCase() === recipientEmail.toLowerCase()
      );
      if (match) return msg.sentDateTime ?? null;
    }
  } catch (e) {
    console.error("[touch-policy] Graph sent scan failed:", (e as Error).message);
  }
  return null;
}
