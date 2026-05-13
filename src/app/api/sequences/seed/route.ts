export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { MATTHEW, SRT_COMPANY } from "@/config/rep-profile";

/**
 * Seeds all 4 email sequences with their steps.
 * Safe to call multiple times — uses upsert on slug.
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
const SIGNATURE_MATTHEW = `<p>— ${MATTHEW_FIRST}</p>`;
const SIGNATURE_MATTHEW_FULL = `<p>— ${MATTHEW_FIRST}<br>&nbsp;&nbsp;${MATTHEW.phone}</p>`;
const SIGNATURE_MATTHEW_SRT = `<p>— ${MATTHEW_FIRST}<br>&nbsp;&nbsp;${SRT_COMPANY.name}</p>`;

const APPLY_LINK = `https://srtagency.com/apply`;

const SEQUENCES: SequenceDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 1: Website Lead Nurture (4 emails, 21 days)
  // Trigger: website-lead | Cancels on: application-completed
  // ═══════════════════════════════════════════════════════════
  {
    name: "Website Lead Nurture",
    slug: "website-lead-nurture",
    trigger_tag: "website-lead",
    cancel_tag: "application-completed",
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "Your funding clock just started",
        body: `<p>Hi {{first_name}},</p>
<p>Your info came through. The sooner you finish the full application, the sooner you get funded.</p>
<p>Finish here (about 5 min): <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
<p>Every day of delay pushes your funding date back by one.</p>
${SIGNATURE_MATTHEW_FULL}`,
      },
      {
        delay_minutes: 4 * DAYS,
        subject: "Don't wait on this, {{first_name}}",
        body: `<p>Hi {{first_name}},</p>
<p>Reality check: the businesses that get funded fastest are the ones that move on the application the same week they apply.</p>
<p>This-week delays turn into next-month delays.</p>
<p>5 minutes, no hard credit pull: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Tip: check your deposit count",
        body: `<p>Hi {{first_name}},</p>
<p>Quick tip before you apply — approval strength is heavily influenced by how many business deposits land in your account each month.</p>
<p>If you're running Zelle or Venmo into a personal account, start routing through your business account now.</p>
<ul>
<li>10 deposits/month is the floor</li>
<li>20+ opens more doors</li>
</ul>
<p>Ready? <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 21 * DAYS,
        subject: "I'm about to close your file",
        body: `<p>Hi {{first_name}},</p>
<p>I'm about to archive your file. If funding isn't needed right now, no problem.</p>
<p>If you still want to move — last chance to keep your spot: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 2: Website Lead → Application (3 emails, 7 days)
  // Trigger: website-lead | Cancels on: application-completed
  // ═══════════════════════════════════════════════════════════
  {
    name: "Website Lead to Application",
    slug: "website-lead-to-application",
    trigger_tag: "website-lead",
    cancel_tag: "application-completed",
    steps: [
      {
        delay_minutes: 2 * HOURS,
        subject: "5 minutes stands between you and funding",
        body: `<p>Hi {{first_name}},</p>
<p>The only thing between you and funding is the full application. 5 minutes. Soft credit only.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 2 * DAYS,
        subject: "Time-sensitive, {{first_name}}",
        body: `<p>Hi {{first_name}},</p>
<p>Applications are processed in the order they come in. Every day you wait, the queue grows.</p>
<p>Finish now and you're still in this week's batch: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Final call",
        body: `<p>Hi {{first_name}},</p>
<p>Final email from me. If you want to move, one more time:</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 3: Application Abandoned (3 emails, 5 days)
  // Trigger: (enrolled programmatically at 25%) | Cancels on: application-completed
  // ═══════════════════════════════════════════════════════════
  {
    name: "Application Abandoned",
    slug: "application-abandoned",
    trigger_tag: null,
    cancel_tag: "application-completed",
    steps: [
      {
        delay_minutes: 30 * MINUTES,
        subject: "Saved your spot — finish today",
        body: `<p>Hi {{first_name}},</p>
<p>Saved everything you filled in. Pick up where you left off: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
<p>3 more minutes. Finishing today keeps you in this week's funding queue.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "Stuck? Reply and I'll help",
        body: `<p>Hi {{first_name}},</p>
<p>If something in the application wasn't clear, reply and I'll walk you through it.</p>
<p>Otherwise, finish here: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Closing it out soon",
        body: `<p>Hi {{first_name}},</p>
<p>I'll leave your spot open 48 more hours, then the application expires.</p>
<p>Finish: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
<p>Need more time? Reply "keep it open" and I'll hold it.</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 4: Application Completed (4 emails, 10 days)
  // Trigger: application-completed | No cancel tag (stewardship, let it run)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Application Completed Nurture",
    slug: "application-completed-nurture",
    trigger_tag: "application-completed",
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 5 * MINUTES,
        subject: "Application received — what happens now",
        body: `<p>Hi {{first_name}},</p>
<p>Your application is in. Here's the timeline:</p>
<ul>
<li><strong>Today/tomorrow</strong> — file reviewed, funding options prepared</li>
<li><strong>24–48 hours</strong> — you'll see what's available</li>
<li><strong>Your call</strong> — pick what fits, we finalize, funds move</li>
</ul>
<p>To keep us moving at full speed, have your last 3 months of business bank statements ready. Nothing else needed from you right now.</p>
<p>Questions: reply, or call/text 786-282-2937.</p>
${SIGNATURE_MATTHEW_SRT}`,
      },
      {
        delay_minutes: 2 * DAYS,
        subject: "Speed this up, {{first_name}}",
        body: `<p>Hi {{first_name}},</p>
<p>Quick update — your file is being worked on. The more detail we have, the faster you get funded.</p>
<p>If you haven't sent your last 3 months of business bank statements yet, that's the single biggest thing that will speed this up.</p>
<p>Just reply with them attached.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Bank statements unlock the next step",
        body: `<p>Hi {{first_name}},</p>
<p>The fastest way to move your application forward is having your last 3 months of business bank statements ready.</p>
<p><strong>How to get them:</strong></p>
<ol>
<li>Log into your online banking</li>
<li>Go to Statements or Documents</li>
<li>Download the last 3 months as PDF</li>
</ol>
<p>Reply with them attached and I'll add them to your file.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Checking in",
        body: `<p>Hi {{first_name}},</p>
<p>Checking in — if you've seen your options and are deciding, take your time.</p>
<p>If something shifted and you want to pause or speed up, reply and let me know. I can shape things around whatever you need.</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 5: FU — New Inbound Lead (6 emails, 30 days)
  // AI-drafted at send time — step bodies are fallback placeholders only.
  // Trigger: manual enrollment | Slug used by sequence-engine.ts
  // ═══════════════════════════════════════════════════════════
  {
    name: "FU — New Inbound Lead",
    slug: "fu-new-inbound",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      { delay_minutes: 1 * DAYS, subject: "Following up on your inquiry", body: `<p>Hi {{first_name}},</p><p>Just following up on your inquiry. Let me know if you have any questions.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 3 * DAYS, subject: "Still here when you're ready", body: `<p>Hi {{first_name}},</p><p>Checking in — still here if you want to talk funding options.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 7 * DAYS, subject: "Quick question", body: `<p>Hi {{first_name}},</p><p>Quick question — what's the biggest thing holding you back right now?</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 14 * DAYS, subject: "Funding options update", body: `<p>Hi {{first_name}},</p><p>Programs have changed — wanted to make sure you have the latest info.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 21 * DAYS, subject: "Still thinking it over?", body: `<p>Hi {{first_name}},</p><p>No pressure, but wanted to check in one more time.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 30 * DAYS, subject: "Last check-in", body: `<p>Hi {{first_name}},</p><p>Last note from me — if things change and you need capital, I'm here.</p>${SIGNATURE_MATTHEW}` },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 6: Awaiting Bank Statements (4 emails, 14 days)
  // AI-drafted at send time — step bodies are fallback placeholders only.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Awaiting Bank Statements",
    slug: "awaiting-statements",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      { delay_minutes: 1 * DAYS, subject: "One thing needed to move forward", body: `<p>Hi {{first_name}},</p><p>We just need your last 3 months of bank statements to move forward.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 3 * DAYS, subject: "Still waiting on statements", body: `<p>Hi {{first_name}},</p><p>Just a reminder — your application is on hold pending bank statements.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 7 * DAYS, subject: "Getting your statements is easy", body: `<p>Hi {{first_name}},</p><p>Log into your bank → Statements → Download last 3 months → reply with attachments.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 14 * DAYS, subject: "Final request for statements", body: `<p>Hi {{first_name}},</p><p>This is my final follow-up on statements. Let me know if you need help.</p>${SIGNATURE_MATTHEW}` },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 7: Pre-Approved Nurture (3 emails, 10 days)
  // AI-drafted at send time — step bodies are fallback placeholders only.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Pre-Approved Nurture",
    slug: "pre-approved-nurture",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      { delay_minutes: 1 * DAYS, subject: "You're pre-approved — here's what's next", body: `<p>Hi {{first_name}},</p><p>Great news — you're pre-approved. Here's what we need to finalize your offer.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 4 * DAYS, subject: "Your pre-approval is waiting", body: `<p>Hi {{first_name}},</p><p>Your pre-approval is still active. Let's get this across the finish line.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 10 * DAYS, subject: "Pre-approval expires soon", body: `<p>Hi {{first_name}},</p><p>Pre-approvals don't last forever — let me know if you want to lock in your offer.</p>${SIGNATURE_MATTHEW}` },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 8: Post-Call Follow-Up (3 emails, 7 days)
  // AI-drafted at send time — step bodies are fallback placeholders only.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Post-Call Follow-Up",
    slug: "post-call-followup",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      { delay_minutes: 1 * DAYS, subject: "Great talking with you", body: `<p>Hi {{first_name}},</p><p>Great connecting today. Here's a summary of what we discussed and next steps.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 3 * DAYS, subject: "Following up from our call", body: `<p>Hi {{first_name}},</p><p>Checking in after our call — any questions as you think it over?</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 7 * DAYS, subject: "Still a fit?", body: `<p>Hi {{first_name}},</p><p>Just wanted to circle back after our conversation. Still a good time to move forward?</p>${SIGNATURE_MATTHEW}` },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 9: Approved — Renewal Nurture (ongoing, +30 days each)
  // AI-drafted at send time — step bodies are fallback placeholders only.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Approved — Renewal Nurture",
    slug: "approved-nurture",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      { delay_minutes: 30 * DAYS, subject: "Renewal check-in", body: `<p>Hi {{first_name}},</p><p>Checking in — how's business going? When you're ready for a renewal or top-up, I'm here.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 30 * DAYS, subject: "How's the capital working for you?", body: `<p>Hi {{first_name}},</p><p>Just checking in on how things are going since your last funding.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 30 * DAYS, subject: "Renewal options available", body: `<p>Hi {{first_name}},</p><p>New programs are available — wanted to make sure you have the latest options.</p>${SIGNATURE_MATTHEW}` },
      { delay_minutes: 30 * DAYS, subject: "Quarterly check-in", body: `<p>Hi {{first_name}},</p><p>Quarterly check-in — anything I can help with on the business financing side?</p>${SIGNATURE_MATTHEW}` },
    ],
  },
];
