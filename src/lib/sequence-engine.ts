/**
 * Email sequence engine — manages drip campaigns.
 *
 * Sequences are stored in Supabase:
 *   email_sequences       → defines a sequence (trigger tag, cancel tag)
 *   email_sequence_steps   → ordered emails with delays
 *   sequence_enrollments   → per-contact progress tracking
 *
 * A cron job calls processScheduledEmails() every 5 minutes.
 */

import { supabaseAdmin } from "@/lib/db";
import { ghl } from "@/lib/ghl";
import { renderTemplate, type TemplateContext } from "@/lib/template-renderer";

// ── Types ──

interface SequenceStep {
  id: string;
  sequence_id: string;
  step_number: number;
  delay_minutes: number;
  subject: string;
  body: string;
}

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

// ── Enrollment ──

/**
 * Enroll a contact in an email sequence.
 * If already enrolled (active), skips silently.
 */
export async function enrollContact(
  sequenceSlug: string,
  contactId: string,
  contactEmail: string,
  contactName: string,
  metadata?: Record<string, unknown>,
): Promise<{ enrolled: boolean; reason?: string }> {
  // Find the sequence
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

  // Check if already enrolled and active
  const { data: existing } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("id, status")
    .eq("sequence_id", sequence.id)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { enrolled: false, reason: "Already enrolled" };
  }

  // Get step 1 to calculate first send time
  const { data: firstStep } = await supabaseAdmin
    .from("email_sequence_steps")
    .select("delay_minutes")
    .eq("sequence_id", sequence.id)
    .eq("step_number", 1)
    .single();

  const delayMs = (firstStep?.delay_minutes || 3) * 60 * 1000;
  const nextSendAt = new Date(Date.now() + delayMs).toISOString();

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
      metadata: metadata || null,
    });

  if (insertError) {
    console.error("[Sequence] Enrollment failed:", insertError.message);
    return { enrolled: false, reason: insertError.message };
  }

  console.log(`[Sequence] Enrolled ${contactName} in "${sequenceSlug}" — first email at ${nextSendAt}`);
  return { enrolled: true };
}

// ── Cancellation ──

/**
 * Cancel all active enrollments for a contact in sequences that have this cancel_tag.
 * Called when a contact receives a tag (e.g., "application" cancels abandonment sequences).
 */
export async function cancelByTag(
  contactId: string,
  tag: string,
): Promise<number> {
  // Find sequences where cancel_tag matches
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

// ── Processing (called by cron) ──

/**
 * Process all scheduled emails that are due.
 * This is the main function called by the cron job.
 */
export async function processScheduledEmails(): Promise<{
  processed: number;
  sent: number;
  errors: number;
  cancelled: number;
}> {
  const now = new Date().toISOString();
  const stats = { processed: 0, sent: 0, errors: 0, cancelled: 0 };

  // Find enrollments that are due
  const { data: dueEnrollments, error: fetchError } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("*")
    .eq("status", "active")
    .lte("next_send_at", now)
    .order("next_send_at", { ascending: true })
    .limit(50); // Process max 50 per run to avoid timeouts

  if (fetchError || !dueEnrollments || dueEnrollments.length === 0) {
    return stats;
  }

  for (const enrollment of dueEnrollments as Enrollment[]) {
    stats.processed++;

    // Load the sequence to check cancel_tag
    const { data: sequence } = await supabaseAdmin
      .from("email_sequences")
      .select("*")
      .eq("id", enrollment.sequence_id)
      .single();

    if (!sequence || !sequence.is_active) {
      // Sequence was deactivated — cancel enrollment
      await supabaseAdmin
        .from("sequence_enrollments")
        .update({ status: "cancelled", cancelled_at: now })
        .eq("id", enrollment.id);
      stats.cancelled++;
      continue;
    }

    const seq = sequence as Sequence;

    // Check if contact has the cancel tag (query GHL or check recent tags)
    if (seq.cancel_tag) {
      try {
        const contactData = await ghl.searchContacts(enrollment.contact_email);
        const contacts = (contactData.contacts as Array<Record<string, unknown>>) || [];
        if (contacts.length > 0) {
          const tags = (contacts[0].tags as string[]) || [];
          if (tags.includes(seq.cancel_tag)) {
            await supabaseAdmin
              .from("sequence_enrollments")
              .update({ status: "cancelled", cancelled_at: now })
              .eq("id", enrollment.id);
            stats.cancelled++;
            console.log(`[Sequence] Cancelled for ${enrollment.contact_name} — has tag "${seq.cancel_tag}"`);
            continue;
          }
        }
      } catch {
        // Can't check tags — proceed with sending anyway
      }
    }

    // Get the next step
    const nextStepNumber = enrollment.current_step + 1;
    const { data: step } = await supabaseAdmin
      .from("email_sequence_steps")
      .select("*")
      .eq("sequence_id", enrollment.sequence_id)
      .eq("step_number", nextStepNumber)
      .single();

    if (!step) {
      // No more steps — mark as completed
      await supabaseAdmin
        .from("sequence_enrollments")
        .update({ status: "completed" })
        .eq("id", enrollment.id);
      continue;
    }

    const emailStep = step as SequenceStep;

    // Build template context
    const context: TemplateContext = {
      contact_name: enrollment.contact_name,
      first_name: enrollment.contact_name?.split(" ")[0] || "",
      business_name: (enrollment.metadata?.businessName as string) || "",
      funding_amount: (enrollment.metadata?.amountNeeded as string) || "",
      approved_amount: "",
      approved_lender: "",
      agent_name: "Benjamin",
      agent_phone: "(555) 123-4567",
      agent_email: "benjamin@srtagency.com",
      company_name: "SRT Agency",
      stage_name: "",
      pipeline_name: "",
    };

    const renderedSubject = renderTemplate(emailStep.subject, context);
    const renderedBody = renderTemplate(emailStep.body, context);

    // Send via GHL
    try {
      await ghl.sendEmail(enrollment.contact_id, renderedSubject, renderedBody);
      stats.sent++;
      console.log(`[Sequence] Sent step ${nextStepNumber} to ${enrollment.contact_name} (${seq.name})`);
    } catch (err) {
      stats.errors++;
      console.error(`[Sequence] Failed to send to ${enrollment.contact_name}:`, err instanceof Error ? err.message : err);

      // Log the error but don't cancel — will retry next cron run
      await supabaseAdmin.from("system_logs").insert({
        event_type: "sequence_error",
        description: `Failed to send step ${nextStepNumber} of "${seq.name}" to ${enrollment.contact_name}`,
        metadata: { enrollmentId: enrollment.id, step: nextStepNumber, error: err instanceof Error ? err.message : String(err) },
      });
      continue;
    }

    // Advance to next step
    const { data: nextNextStep } = await supabaseAdmin
      .from("email_sequence_steps")
      .select("delay_minutes")
      .eq("sequence_id", enrollment.sequence_id)
      .eq("step_number", nextStepNumber + 1)
      .maybeSingle();

    if (nextNextStep) {
      // Calculate next send time relative to enrollment (not from now)
      const nextSendAt = new Date(
        Date.now() + (nextNextStep.delay_minutes - emailStep.delay_minutes) * 60 * 1000
      ).toISOString();

      await supabaseAdmin
        .from("sequence_enrollments")
        .update({
          current_step: nextStepNumber,
          next_send_at: nextSendAt,
        })
        .eq("id", enrollment.id);
    } else {
      // This was the last step — mark completed
      await supabaseAdmin
        .from("sequence_enrollments")
        .update({
          current_step: nextStepNumber,
          status: "completed",
        })
        .eq("id", enrollment.id);
    }

    // Log the send
    await supabaseAdmin.from("automation_logs").insert({
      contact_id: enrollment.contact_id,
      action_type: "send_email",
      template_slug: `${seq.slug}-step-${nextStepNumber}`,
      status: "success",
      metadata: {
        sequence: seq.name,
        step: nextStepNumber,
        subject: renderedSubject,
        rendered_body: renderedBody.slice(0, 500),
      },
    });
  }

  return stats;
}
