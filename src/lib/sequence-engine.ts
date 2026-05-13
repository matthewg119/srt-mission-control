/**
 * Email sequence engine — manages drip campaigns.
 *
 * Sequences are stored in Supabase:
 *   email_sequences       → defines a sequence (trigger tag, cancel tag)
 *   email_sequence_steps   → scheduling anchors (delay_minutes, step_number)
 *   sequence_enrollments   → per-contact progress tracking
 *
 * processScheduledEmails() is called by the cron every 5 minutes.
 * For each due enrollment it:
 *   1. Re-checks Zoho status (stops if funded/declined/etc.)
 *   2. AI-drafts the email via Claude (email-director.ts draftEmail())
 *   3. Posts a Slack approval card (#vektor-email-director)
 *   4. Marks the enrollment pending_action_id so it's not re-drafted
 * After the card is approved, execute-action.ts calls advanceEnrollment().
 */

import { supabaseAdmin } from "@/lib/db";
import { buildMerchantContext } from "@/lib/ai-intel/merchant-context";
import { draftEmail } from "@/lib/ai-intel/email-director";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import type { MarketingCampaignKey, PendingActionPayload } from "@/lib/ai-intel/types";

// ── Types ──

interface Enrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  contact_email: string;
  contact_name: string;
  current_step: number;
  next_send_at: string;
  status: string;
  enrolled_at: string;
  pending_action_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface Sequence {
  id: string;
  name: string;
  slug: string;
  trigger_tag: string | null;
  cancel_tag: string | null;
  is_active: boolean;
}

// ── Stop-list (Zoho statuses that halt all sequences) ──────────────────────

const SEQUENCE_STOP_STATUSES = new Set([
  "Not Interested", "DNQ", "Take Off List", "Dead Declined", "Declined",
  "Junk Lead", "Lost", "Funded", "Closed - Not Converted", "Closed - Converted",
  "Unresponsive", "Bad Lead", "Wrong Number", "Duplicate",
]);

function shouldStopForZohoStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  if (SEQUENCE_STOP_STATUSES.has(status)) return true;
  const s = status.toLowerCase();
  return ["funded", "declined", "dead", "dnq", "not interested", "junk", "lost", "converted"].some(
    (k) => s.includes(k)
  );
}

// ── Campaign key resolution ────────────────────────────────────────────────

function resolveSequenceCampaignKey(slug: string, stepNumber: number): MarketingCampaignKey {
  if (slug === "fu-new-inbound") {
    if (stepNumber <= 1) return "new_lead_d1";
    if (stepNumber === 2) return "new_lead_d2";
    if (stepNumber === 3) return "new_lead_d3";
    return "confirmation_daily";
  }
  if (slug === "awaiting-statements") return "awaiting_statements";
  if (slug === "pre-approved-nurture" || slug === "approved-nurture") return "approved_nurture";
  return "custom";
}

// Hours to wait after a send before the next step (indexed by step that was just sent).
// step index 0 = gap after step 1 was sent, etc.
const STEP_GAPS_HOURS: Record<string, number[]> = {
  "fu-new-inbound":       [48, 96, 168, 168, 168, 168],  // D1→D3, D3→D7, D7→D14, D14→D21, D21→D28
  "awaiting-statements":  [48, 96, 168],                  // D1→D3, D3→D7, D7→D14
  "pre-approved-nurture": [72, 144],                      // D1→D4, D4→D10
  "post-call-followup":   [48, 96],                       // D1→D3, D3→D7
  "approved-nurture":     [720, 720, 720, 720],           // 30d each
};

// ── Enrollment ──────────────────────────────────────────────────────────────

export async function enrollContact(
  sequenceSlug: string,
  contactId: string,
  contactEmail: string,
  contactName: string,
  metadata?: Record<string, unknown>,
): Promise<{ enrolled: boolean; reason?: string }> {
  if (!contactEmail || !contactEmail.includes("@")) {
    console.warn(`[Sequence] Skipping enrollment for ${contactName} — invalid email: "${contactEmail}"`);
    return { enrolled: false, reason: "Invalid email address" };
  }

  const { data: sequence, error: seqError } = await supabaseAdmin
    .from("email_sequences")
    .select("*")
    .eq("slug", sequenceSlug)
    .eq("is_active", true)
    .single();

  if (seqError || !sequence) {
    console.warn(`[Sequence] Sequence "${sequenceSlug}" not found or inactive`);
    return { enrolled: false, reason: "Sequence not found or inactive" };
  }

  // Block if already active or pending
  const { data: existing } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("id, status")
    .eq("sequence_id", sequence.id)
    .eq("contact_id", contactId)
    .in("status", ["active"])
    .maybeSingle();

  if (existing) {
    return { enrolled: false, reason: "Already enrolled" };
  }

  // First email fires after a short delay (5 min) so the caller's Slack confirm shows first
  const nextSendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error: insertError } = await supabaseAdmin
    .from("sequence_enrollments")
    .insert({
      sequence_id: sequence.id,
      contact_id: contactId,
      contact_email: contactEmail,
      contact_name: contactName,
      current_step: 0,
      next_send_at: nextSendAt,
      status: "active",
      enrolled_at: new Date().toISOString(),
      enrolled_by: (metadata?.enrolled_by as string | undefined) ?? "system",
      metadata: metadata || null,
    });

  if (insertError) {
    console.error("[Sequence] Enrollment failed:", insertError.message);
    return { enrolled: false, reason: insertError.message };
  }

  console.log(`[Sequence] Enrolled ${contactName} in "${sequenceSlug}" — first email at ${nextSendAt}`);
  return { enrolled: true };
}

// ── Cancellation ────────────────────────────────────────────────────────────

export async function cancelByTag(
  contactId: string,
  tag: string,
): Promise<number> {
  const { data: sequences } = await supabaseAdmin
    .from("email_sequences")
    .select("id")
    .eq("cancel_tag", tag);

  if (!sequences || sequences.length === 0) return 0;

  const sequenceIds = sequences.map((s: { id: string }) => s.id);

  const { data: cancelled, error } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("contact_id", contactId)
    .eq("status", "active")
    .in("sequence_id", sequenceIds)
    .select("id");

  if (error) {
    console.error("[Sequence] Cancel by tag failed:", error.message);
    return 0;
  }

  const count = cancelled?.length || 0;
  if (count > 0) {
    console.log(`[Sequence] Cancelled ${count} enrollment(s) for contact ${contactId} (tag: ${tag})`);
  }
  return count;
}

export async function stopAllForContact(
  contactId: string,
  reason: string,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ status: "stopped", stopped_at: now, stop_reason: reason, pending_action_id: null })
    .eq("contact_id", contactId)
    .in("status", ["active"])
    .select("id");

  if (error) {
    console.error("[Sequence] stopAllForContact failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// ── Enrollment advancement (called by execute-action after approved send) ───

export async function advanceEnrollment(enrollmentId: string, sequenceSlug: string): Promise<void> {
  const { data: enrollment } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("id, current_step, sequence_id")
    .eq("id", enrollmentId)
    .maybeSingle();

  if (!enrollment) return;

  const nextStep = enrollment.current_step + 1;
  const gaps = STEP_GAPS_HOURS[sequenceSlug] ?? [];
  const gapHours = gaps[enrollment.current_step] ?? 0;

  if (gapHours === 0) {
    // No more steps defined → complete
    await supabaseAdmin
      .from("sequence_enrollments")
      .update({ status: "completed", current_step: nextStep, pending_action_id: null })
      .eq("id", enrollmentId);
    return;
  }

  const nextSendAt = new Date(Date.now() + gapHours * 3_600_000).toISOString();
  await supabaseAdmin
    .from("sequence_enrollments")
    .update({ current_step: nextStep, next_send_at: nextSendAt, pending_action_id: null })
    .eq("id", enrollmentId);
}

/** Reset a pending draft (user clicked 🚫) so the sequence retries in 3 days. */
export async function resetEnrollmentAfterCancel(enrollmentId: string): Promise<void> {
  const retryAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await supabaseAdmin
    .from("sequence_enrollments")
    .update({ pending_action_id: null, next_send_at: retryAt })
    .eq("id", enrollmentId);
}

// ── Processing (called by cron every 5 minutes) ────────────────────────────

export async function processScheduledEmails(): Promise<{
  processed: number;
  drafted: number;
  stopped: number;
  errors: number;
}> {
  const now = new Date().toISOString();
  const stats = { processed: 0, drafted: 0, stopped: 0, errors: 0 };

  // Only pull enrollments with no pending draft already waiting
  const { data: dueEnrollments, error: fetchError } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("*")
    .eq("status", "active")
    .lte("next_send_at", now)
    .is("pending_action_id", null)
    .order("next_send_at", { ascending: true })
    .limit(20);

  if (fetchError || !dueEnrollments || dueEnrollments.length === 0) {
    return stats;
  }

  for (const enrollment of dueEnrollments as Enrollment[]) {
    stats.processed++;

    try {
      const { data: sequence } = await supabaseAdmin
        .from("email_sequences")
        .select("id, slug, name, is_active, cancel_tag")
        .eq("id", enrollment.sequence_id)
        .single();

      if (!sequence || !(sequence as Sequence).is_active) {
        await supabaseAdmin
          .from("sequence_enrollments")
          .update({ status: "cancelled", cancelled_at: now })
          .eq("id", enrollment.id);
        continue;
      }

      const seq = sequence as Sequence;

      // ── 1. Build merchant context + re-check Zoho status ──────────────
      const ctx = await buildMerchantContext({ contactId: enrollment.contact_id });
      if (!ctx) {
        console.warn(`[Sequence] No context for contact ${enrollment.contact_id} — skipping`);
        stats.errors++;
        continue;
      }

      const zohoStatus = ctx.zoho?.lead_status ?? null;
      if (ctx.contact.do_not_contact || shouldStopForZohoStatus(zohoStatus)) {
        await supabaseAdmin
          .from("sequence_enrollments")
          .update({
            status: "stopped",
            stopped_at: now,
            stop_reason: ctx.contact.do_not_contact ? "do_not_contact" : `Zoho status: ${zohoStatus}`,
            pending_action_id: null,
          })
          .eq("id", enrollment.id);
        stats.stopped++;
        continue;
      }

      if (!ctx.contact.email) {
        console.warn(`[Sequence] Contact ${enrollment.contact_id} has no email — skipping`);
        stats.errors++;
        continue;
      }

      // ── 2. Map sequence slug → campaign key ───────────────────────────
      const nextStepNumber = enrollment.current_step + 1;
      const campaignKey = resolveSequenceCampaignKey(seq.slug, nextStepNumber);

      // ── 3. AI-draft the email ─────────────────────────────────────────
      const draft = await draftEmail(ctx, campaignKey, nextStepNumber);
      if (!draft) {
        console.error(`[Sequence] Draft failed for ${enrollment.contact_id} in ${seq.slug}`);
        stats.errors++;
        continue;
      }

      // ── 4. Build approval payload ─────────────────────────────────────
      const payload: PendingActionPayload = {
        action_type: "send_marketing_email",
        to: ctx.contact.email,
        subject: draft.subject,
        body: draft.body,
        is_html: true,
        contact_id: ctx.contact.id,
        zoho_id: ctx.contact.zoho_lead_id ?? undefined,
        campaign_key: campaignKey,
        cadence_day: nextStepNumber,
        sequence_position: nextStepNumber,
        magic_link_redirect: draft.redirectPath,
        enrollment_id: enrollment.id,
      };

      const who = ctx.contact.business_name ?? ctx.contact.first_name ?? "Merchant";
      const summary = [
        `*${who}* — Sequence: ${seq.name} (step ${nextStepNumber})`,
        ``,
        `*To:* ${ctx.contact.email}`,
        `*Subject:* ${draft.subject}`,
        `*Zoho status:* ${zohoStatus ?? "—"}`,
        ``,
        "```",
        draft.body.replace(/<[^>]+>/g, "").slice(0, 900),
        "```",
        `_Angle:_ ${draft.hook}`,
      ].join("\n");

      // ── 5. Post Slack approval card ───────────────────────────────────
      const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
      const result = await postApprovalRequest({
        summary,
        payload,
        merchantId: ctx.contact.id,
        zohoId: ctx.contact.zoho_lead_id ?? undefined,
        category: "marketing_email",
        channel,
      });

      if (!result.pendingActionId) {
        console.error(`[Sequence] Slack approval post failed for ${enrollment.contact_id}`);
        stats.errors++;
        continue;
      }

      // ── 6. Mark enrollment as pending (won't re-draft until cleared) ──
      await supabaseAdmin
        .from("sequence_enrollments")
        .update({ pending_action_id: result.pendingActionId })
        .eq("id", enrollment.id);

      stats.drafted++;
    } catch (e) {
      console.error(`[Sequence] Unhandled error for enrollment ${enrollment.id}:`, (e as Error).message);
      stats.errors++;
    }
  }

  return stats;
}
