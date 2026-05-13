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
  // Trigger: manual enrollment | Slug used by sequence-engine.ts
  // ═══════════════════════════════════════════════════════════
  {
    name: "FU — New Inbound Lead",
    slug: "fu-new-inbound",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "Following up on your inquiry",
        body: `<p>Hi {{first_name}},</p>
<p>Saw your inquiry come through. Next step is a quick 5-minute application — no hard credit pull, and it's the only thing standing between you and a funding decision.</p>
<p>Apply here: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Still here when you're ready",
        body: `<p>Hi {{first_name}},</p>
<p>Quick check-in. We process applications in batches — the sooner you're in, the sooner you hear back. Applications submitted this week go into this week's batch.</p>
<p>5 minutes: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Quick question",
        body: `<p>Hi {{first_name}},</p>
<p>What's holding you back right now — is it timing, or something about the process you're unsure about?</p>
<p>Just reply. I read every response.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 14 * DAYS,
        subject: "Funding programs update",
        body: `<p>Hi {{first_name}},</p>
<p>A few programs changed this month — better terms on shorter paybacks for certain industries. Not sure if it applies to you, but worth checking before they close out.</p>
<p>Takes 5 minutes to find out: <a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 21 * DAYS,
        subject: "Still thinking it over?",
        body: `<p>Hi {{first_name}},</p>
<p>No pressure — just wanted to check in one more time. If you're still weighing it, just reply "yes" and I'll send you exactly what the next step looks like.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 30 * DAYS,
        subject: "Last check-in from me",
        body: `<p>Hi {{first_name}},</p>
<p>Last note from me. If capital comes back on the table, I'm easy to find — just reach out and we'll pick up from here.</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 6: Awaiting Bank Statements (4 emails, 14 days)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Awaiting Bank Statements",
    slug: "awaiting-statements",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "One thing needed to move forward",
        body: `<p>Hi {{first_name}},</p>
<p>Your application looks good — the only thing we're waiting on is your last 3 months of business bank statements. Once we have those, I can start submitting to lenders.</p>
<p>Upload here: <a href="{magic_link}">{magic_link}</a> — or reply with them attached.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Statements — quick reminder",
        body: `<p>Hi {{first_name}},</p>
<p>Still waiting on statements before I can move your file. Once received, they go out to lenders the same day.</p>
<p>Upload: <a href="{magic_link}">{magic_link}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "How to get your statements in 2 minutes",
        body: `<p>Hi {{first_name}},</p>
<p>Quick walkthrough:</p>
<ol>
<li>Log into your bank online</li>
<li>Go to Statements or Documents</li>
<li>Download the last 3 months as PDF</li>
<li>Upload at <a href="{magic_link}">{magic_link}</a> — or reply with them attached</li>
</ol>
<p>That's it. No other documents needed right now.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 14 * DAYS,
        subject: "Last request before I close your file",
        body: `<p>Hi {{first_name}},</p>
<p>Archiving your file at the end of this week if I don't hear back. If you still want to move forward — bank statements are all I need: <a href="{magic_link}">{magic_link}</a></p>
<p>If timing isn't right, no problem. You can always come back when it is.</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 7: Pre-Approved Nurture (3 emails, 10 days)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Pre-Approved Nurture",
    slug: "pre-approved-nurture",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "You're pre-approved — here's what's next",
        body: `<p>Hi {{first_name}},</p>
<p>Your file has been reviewed and you're pre-approved. A lender has looked at your application and expressed interest — all we need now is your confirmation to finalize the offer.</p>
<p>Log in to see the offer details: <a href="{magic_link}">{magic_link}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 4 * DAYS,
        subject: "Your offer is waiting",
        body: `<p>Hi {{first_name}},</p>
<p>Your pre-approval is still active, but these don't stay on the table indefinitely. Log in to review your offer: <a href="{magic_link}">{magic_link}</a></p>
<p>Any questions, just reply.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Last chance on this offer",
        body: `<p>Hi {{first_name}},</p>
<p>This offer is about to expire. If you have questions before you decide, I'm available for a quick call — just reply and I'll find a time.</p>
<p>Last chance to lock it in: <a href="{magic_link}">{magic_link}</a></p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 8: Post-Call Follow-Up (3 emails, 7 days)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Post-Call Follow-Up",
    slug: "post-call-followup",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "Good talking with you",
        body: `<p>Hi {{first_name}},</p>
<p>Good talking with you today. Based on what we discussed, the next step is to get the application in — 5 minutes, no hard credit pull.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Following up from our call",
        body: `<p>Hi {{first_name}},</p>
<p>Checking in after our call — have you had a chance to look at the next step? Let me know if anything changed or if you have questions.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Circling back",
        body: `<p>Hi {{first_name}},</p>
<p>Still interested, or did the timing shift? Just a yes or no works.</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 9: Approved — Renewal Nurture (4 emails, monthly)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Approved — Renewal Nurture",
    slug: "approved-nurture",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 30 * DAYS,
        subject: "Checking in",
        body: `<p>Hi {{first_name}},</p>
<p>Congrats on getting funded — just checking in to see how things are going. How's the capital working for the business?</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 30 * DAYS,
        subject: "How's business going?",
        body: `<p>Hi {{first_name}},</p>
<p>Quick check-in. When you're ready for a renewal or need a top-up, the process is faster the second time — same-day decisions in most cases.</p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 30 * DAYS,
        subject: "Renewal programs available",
        body: `<p>Hi {{first_name}},</p>
<p>A few new renewal programs came through this month that might be a fit depending on where your revenue is now. Want me to run the numbers? Just reply or log in to see current options.</p>
<p><a href="{magic_link}">{magic_link}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 30 * DAYS,
        subject: "Quarterly check-in",
        body: `<p>Hi {{first_name}},</p>
<p>Quarterly check-in — anything I can help with on the financing side?</p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 10: Post-Call Daily Drip (4 emails over 3 days)
  // Enrolled by extension when "Nice Speaking" SMS is sent.
  // After completing step 4, sequence-engine auto-enrolls in fu-new-inbound.
  // ═══════════════════════════════════════════════════════════
  {
    name: "Post-Call Daily",
    slug: "post-call-daily",
    trigger_tag: null,
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 2 * HOURS,
        subject: "Nice talking with you",
        body: `<p>Hi {{first_name}},</p>
<p>Enjoyed our conversation. The next step is a quick application — 5 minutes, no hard credit pull. That's what gets you an actual number from lenders.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "Following up",
        body: `<p>Hi {{first_name}},</p>
<p>Wanted to follow up on our conversation. Have you had a chance to look at the application? That's the fastest path to an actual offer.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "One thing I didn't mention",
        body: `<p>Hi {{first_name}},</p>
<p>Funding timelines are tighter right now — lenders are processing applications in weekly batches. Getting your application in this week puts you in the current round.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
      {
        delay_minutes: 1 * DAYS,
        subject: "Last one this week",
        body: `<p>Hi {{first_name}},</p>
<p>Last email from me this week. If you want to move, the application is always open — I'll be here when you're ready.</p>
<p><a href="${APPLY_LINK}">${APPLY_LINK}</a></p>
${SIGNATURE_MATTHEW}`,
      },
    ],
  },
];
