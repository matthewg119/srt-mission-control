export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { MATTHEW, SRT_COMPANY } from "@/config/rep-profile";

/**
 * Seeds the email sequences with their steps.
 * Safe to call multiple times — uses upsert on slug.
 *
 * These were ten business-funding drips ("Your funding clock just started",
 * "Bank statements unlock the next step", "You're pre-approved"). SRT sells AEO
 * now, so they are replaced rather than edited: the old copy pitched a product
 * we do not offer to contacts we are now approaching for something else.
 *
 * Deleting the old rows is a separate step. This route only upserts the
 * sequences it knows about, so the retired slugs survive in the table until the
 * migration in docs/2026-08-17-funding-decommission.sql removes them.
 */
export async function GET() {
  return POST();
}

export async function POST() {
  try {
    const results: Record<string, unknown>[] = [];

    for (const seq of SEQUENCES) {
      const { data: sequence, error: seqError } = await supabaseAdmin
        .from("email_sequences")
        .upsert(
          {
            name: seq.name,
            slug: seq.slug,
            trigger_tag: seq.trigger_tag,
            cancel_tag: seq.cancel_tag,
            is_active: true,
          },
          { onConflict: "slug" }
        )
        .select()
        .single();

      if (seqError || !sequence) {
        results.push({ slug: seq.slug, error: seqError?.message || "Failed to create" });
        continue;
      }

      await supabaseAdmin
        .from("email_sequence_steps")
        .delete()
        .eq("sequence_id", sequence.id);

      const stepRows = seq.steps.map((step, i) => ({
        sequence_id: sequence.id,
        step_number: i + 1,
        delay_minutes: step.delay_minutes,
        subject: step.subject,
        body: step.body,
      }));

      const { error: stepsError } = await supabaseAdmin
        .from("email_sequence_steps")
        .insert(stepRows);

      results.push({
        slug: seq.slug,
        id: sequence.id,
        steps: stepRows.length,
        error: stepsError?.message,
      });
    }

    return NextResponse.json({
      message: "Sequences seeded",
      results,
      total_sequences: SEQUENCES.length,
      total_emails: SEQUENCES.reduce((sum, s) => sum + s.steps.length, 0),
    });
  } catch (error) {
    console.error("Sequence seed error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seed failed" },
      { status: 500 }
    );
  }
}

// ── Sequence Definitions ──

interface SequenceStep {
  delay_minutes: number;
  subject: string;
  body: string;
}

interface SequenceDefinition {
  name: string;
  slug: string;
  trigger_tag: string | null;
  cancel_tag: string | null;
  steps: SequenceStep[];
}

const MINUTES = 1;
const HOURS = 60;
const DAYS = 60 * 24;

const MATTHEW_FIRST = MATTHEW.name.split(" ")[0] ?? "Matthew";
const SIGNATURE_MATTHEW = `<p>${MATTHEW_FIRST}</p>`;
const SIGNATURE_MATTHEW_FULL = `<p>${MATTHEW_FIRST}<br>&nbsp;&nbsp;${MATTHEW.phone}</p>`;
const SIGNATURE_MATTHEW_SRT = `<p>${MATTHEW_FIRST}<br>&nbsp;&nbsp;${SRT_COMPANY.name}</p>`;

// The offer, in one line, reused across every sequence. The free build is the
// ask; there is no link and no booking page, because the close is a reply.
const THE_ASK = `<p>Just reply "yes" and I'll get it started.</p>`;

const SEQUENCES: SequenceDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // New lead nurture (4 emails, 21 days)
  // Trigger: website-lead | Cancels on: replied
  // ═══════════════════════════════════════════════════════════
  {
    name: "New Lead Nurture",
    slug: "new-lead-nurture",
    trigger_tag: "website-lead",
    cancel_tag: "replied",
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "Can AI find {{business_name}}?",
        body: `<p>Hi {{first_name}},</p>
<p>More people are asking an AI assistant for a business like yours than are typing it into a search box. Most sites have nothing on them an assistant can actually read, so it names someone else.</p>
<p>We fix that by building one section of your own site that AI can read and cite. First one is free, no card, nothing to install.</p>
${THE_ASK}
${SIGNATURE_MATTHEW_FULL}`,
      },
      {
        delay_minutes: 4 * DAYS,
        subject: "What this actually looks like",
        body: `<p>Hi {{first_name}},</p>
<p>It is a page on your site, in your words, structured so an assistant can quote it: what you do, who you do it for, where, and what it costs.</p>
<p>You do not write it. We do. Then it is yours whether or not you work with us after.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Why free",
        body: `<p>Hi {{first_name}},</p>
<p>Because it is faster to show you than to explain it. You see whether an assistant starts naming you, and you decide from there.</p>
<p>Takes about a week and almost nothing from you.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 9 * DAYS,
        subject: "Closing this out",
        body: `<p>Hi {{first_name}},</p>
<p>I will stop here unless I hear from you. If the timing is wrong, that is a fine answer, just say so and I will leave it.</p>
${THE_ASK}
${SIGNATURE_MATTHEW_SRT}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Pitch follow-up (3 emails, 10 days)
  // Fires after the AEO pitch has gone out and nobody replied.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Pitch Follow-Up",
    slug: "pitch-followup",
    trigger_tag: "pitched",
    cancel_tag: "replied",
    steps: [
      {
        delay_minutes: 3 * DAYS,
        subject: "Following up on the free build",
        body: `<p>Hi {{first_name}},</p>
<p>Circling back on this. The offer stands: we build one section of your site that AI assistants can read and cite, at no cost.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 4 * DAYS,
        subject: "One question",
        body: `<p>Hi {{first_name}},</p>
<p>How do most of your customers find you right now? If the answer is word of mouth and a map listing, this is worth ten minutes of your attention.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Last one from me",
        body: `<p>Hi {{first_name}},</p>
<p>I will leave it here. If it becomes relevant later, reply to this and I will pick it back up.</p>
${SIGNATURE_MATTHEW_SRT}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Post-call follow-up (3 emails, 8 days)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Post-Call Follow-Up",
    slug: "post-call-followup",
    trigger_tag: null,
    cancel_tag: "replied",
    steps: [
      {
        delay_minutes: 30 * MINUTES,
        subject: "Good talking with you",
        body: `<p>Hi {{first_name}},</p>
<p>Good conversation. To recap: we build one section of {{business_name}}'s site that AI assistants can read and cite, first one free.</p>
${THE_ASK}
${SIGNATURE_MATTHEW_FULL}`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Still up for it?",
        body: `<p>Hi {{first_name}},</p>
<p>Checking in after our call. Nothing has changed on my end, the first build is still free and still takes almost nothing from you.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Closing the loop",
        body: `<p>Hi {{first_name}},</p>
<p>Last note on this. Say the word and I will start; otherwise I will leave you to it.</p>
${SIGNATURE_MATTHEW_SRT}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Post-call daily (3 emails, 2 days)
  // The tight cadence for a lead who was warm on the phone.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Post-Call Daily",
    slug: "post-call-daily",
    trigger_tag: null,
    cancel_tag: "replied",
    steps: [
      {
        delay_minutes: 2 * HOURS,
        subject: "Nice talking with you",
        body: `<p>Hi {{first_name}},</p>
<p>Enjoyed the conversation. Whenever you are ready, I just need a yes and I will build the first section for {{business_name}}.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "Following up",
        body: `<p>Hi {{first_name}},</p>
<p>Following up on where we left off. Anything you want to see before we start?</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "One thing I didn't mention",
        body: `<p>Hi {{first_name}},</p>
<p>The section is yours to keep either way. If we never work together after this, it stays on your site and keeps doing its job.</p>
${THE_ASK}
${SIGNATURE_MATTHEW}`,
      },
    ],
  },
];
