export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The audit pipeline is awaited end to end inside waitUntil (see below), and Vercel
// only keeps the lambda alive for as long as this route is allowed to run.
export const maxDuration = 300;

// The workflow buttons on the lead page.
//
// Every one of these already existed and already had a home: the audit is
// runAuditPipeline(), and draft / avatars / call / loom are thread commands that
// handleAuditThreadReply() has routed since the audit engine shipped. This route is a
// doorway to them from the CRM, not a second implementation of any of them.
//
// ‼️ THAT IS THE POINT AND IT MUST STAY THAT WAY. The draft linter, format-guard,
// lintSpoken, the price gates, the loom wizard's state machine and the no-fabrication
// rules all live inside those handlers. A button that assembled its own prompt would
// bypass every one of them, silently, and the failure would look like slightly worse
// copy rather than like a bug.
//
// Nothing streams back to the browser. Slack is where the work is watched; the CRM
// gets a note saying it started, and the finished report writes its own timeline entry
// through writeAuditToLead().

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { addNote } from "@/lib/crm";
import { slack, slackThreadLink } from "@/lib/slack-bot";
import { runAuditPipeline, RUN_IN_FLIGHT_MINUTES } from "@/lib/audit-engine/run-audit-pipeline";
import { handleAuditThreadReply } from "@/lib/audit-engine/thread-assistant";

/** The four thread commands reachable from a button, and what to call them. */
const THREAD_ACTIONS = {
  draft: { label: "Draft email", command: "draft" },
  avatars: { label: "Avatars", command: "avatars" },
  // `call` is ALWAYS the follow-up script. `close` is the selling one and is
  // deliberately NOT a button: the verb picks the script and nothing else does, and
  // one control meaning "a gentle follow-up" on Monday and "a price conversation" on
  // Thursday is not a thing to discover with the phone already ringing. See the
  // auto-escalation note in call-script.ts.
  call: { label: "Call script", command: "call" },
  // Step 1 only. Steps 2 and 3 are a numbered menu whose digits ARE the command, so
  // they stay in the thread where the menu is.
  loom: { label: "Loom", command: "loom" },
} as const;

type ThreadAction = keyof typeof THREAD_ACTIONS;

function isThreadAction(v: string): v is ThreadAction {
  return Object.prototype.hasOwnProperty.call(THREAD_ACTIONS, v);
}

interface ContactRow {
  id: string;
  website: string | null;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  biz_city: string | null;
  biz_state: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Read off the session HERE. Everything below runs in waitUntil, after the response
  // has gone out, where there is no request and therefore no session to read.
  const actor = session.user.email ?? session.user.name ?? "mission_control";

  const { id: contactId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();

  if (action === "audit") return startAudit(contactId, actor);
  if (isThreadAction(action)) return runThreadCommand(contactId, action, actor);

  return NextResponse.json(
    { error: `Unknown workflow "${action}"`, field: "action" },
    { status: 400 }
  );
}

// ─────────────────────────────────────────────────────────────────────
// Run the AI visibility audit
// ─────────────────────────────────────────────────────────────────────

async function startAudit(contactId: string, actor: string) {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, website, business_name, first_name, last_name, email, biz_city, biz_state")
    .eq("id", contactId)
    .maybeSingle();

  const contact = data as ContactRow | null;
  if (!contact) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const website = contact.website?.trim();
  if (!website) {
    // Name-mode audits (a business with a Google profile and no site at all) live on
    // the client-hubs branch, not here. Until that merges a website is required, and
    // saying so beats a run that fails four minutes in.
    return NextResponse.json(
      { error: "Add a website to this lead first — the audit crawls it.", field: "website" },
      { status: 400 }
    );
  }

  // Claim guard. Nothing here is transactional, but a run is a classification call
  // plus 40 engine calls, so a double click or an impatient second press must not buy
  // two of them. Same doctrine as the fulfillment_state claim in medspa/fulfillment.ts.
  const cutoff = new Date(Date.now() - RUN_IN_FLIGHT_MINUTES * 60_000).toISOString();
  const { data: inFlight } = await supabaseAdmin
    .from("audit_reports")
    .select("id, created_at")
    .eq("contact_id", contactId)
    .in("status", ["classifying", "running"])
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    return NextResponse.json(
      { error: "An audit is already running for this lead. Give it a few minutes." },
      { status: 409 }
    );
  }

  // Written before the slow part, so the timeline says something is happening rather
  // than staying blank for five minutes.
  await addNote({
    contactId,
    title: "AI visibility audit started",
    content: `Scanning ${website}. The report and every follow-up card land in #ai-visibility-audits, and the score comes back onto this timeline when it finishes.`,
    origin: "mission_control",
    actor,
  }).catch(() => {});

  waitUntil(
    runAuditPipeline({
      website,
      // "Homestead, FL" — the pipeline takes the city as free text and classify.ts
      // reads the state off it. Undefined rather than an empty string, so an unset
      // city is absent instead of being a city named "".
      city: [contact.biz_city, contact.biz_state].filter(Boolean).join(", ") || undefined,
      // The whole reason to run this from a lead rather than from Slack: it is what
      // links the report to this contact, which is what makes writeAuditToLead() fire
      // and the AI visibility card appear on this page.
      contactId,
      requesterName:
        [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
        contact.business_name ||
        undefined,
      // There is no thread here to ask a follow-up question in, so onNeedsCity has
      // nobody to ask. Same call the Meta Lead Ads route makes.
      allowLowConfidenceCity: true,
      onError: async (message) => {
        console.error("[crm/workflow] audit failed:", message);
        await addNote({
          contactId,
          title: "AI visibility audit failed",
          content: message,
          origin: "mission_control",
          actor,
        }).catch(() => {});
      },
    }).catch(async (e) => {
      const message = (e as Error)?.message ?? String(e);
      console.error("[crm/workflow] audit threw:", message);
      await addNote({
        contactId,
        title: "AI visibility audit failed",
        content: message,
        origin: "mission_control",
        actor,
      }).catch(() => {});
      return { ok: false };
    })
  );

  // 202, immediately. runAuditPipeline does not resolve until the ENTIRE run is over
  // — it awaits the /api/audit/process kick-off, which runs every batch and then
  // finishReport before it answers — so waiting on it here would hold the button for
  // four to six minutes and then time out. Its return value is documented as useless
  // for progress at run-audit-pipeline.ts, and /scan's first stepped UI was dead code
  // for exactly this reason.
  return NextResponse.json(
    { ok: true, running: true, message: "Audit started. Watch it in #ai-visibility-audits." },
    { status: 202 }
  );
}

// ─────────────────────────────────────────────────────────────────────
// Fire a thread command into the lead's existing audit thread
// ─────────────────────────────────────────────────────────────────────

async function runThreadCommand(contactId: string, action: ThreadAction, actor: string) {
  const { label, command } = THREAD_ACTIONS[action];

  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id, slack_channel_id, slack_thread_ts, intake_answers")
    .eq("contact_id", contactId)
    .eq("status", "done")
    .not("slack_thread_ts", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const report = data as {
    id: string;
    slack_channel_id: string | null;
    slack_thread_ts: string | null;
    intake_answers: string | null;
  } | null;

  if (!report?.slack_channel_id || !report.slack_thread_ts) {
    return NextResponse.json(
      {
        error:
          "No finished audit for this lead yet. Run the visibility audit first — every one of these reads the report.",
      },
      { status: 409 }
    );
  }

  const channel = report.slack_channel_id;
  const threadTs = report.slack_thread_ts;
  const text = await commandText(action, command, report.intake_answers, contactId);
  const threadUrl = slackThreadLink(channel, threadTs);

  // Said out loud in the thread, so a card appearing on its own is explained. Safe to
  // post: the events route drops anything carrying a bot_id before it reaches the
  // router, so this cannot come back around as a command.
  await slack
    .postThreadReply(channel, threadTs, `:arrow_forward: *${label}* — run from the CRM by ${actor}`)
    .catch(() => {});

  waitUntil(
    handleAuditThreadReply({ channel, threadTs, text })
      .then(async () => {
        await addNote({
          contactId,
          title: `${label} posted in Slack`,
          content: `Run from the lead page. ${threadUrl}`,
          origin: "mission_control",
          actor,
          // logActivity is unique on (source, external_id), so a double click leaves
          // one note. The action is part of the key because two DIFFERENT workflows on
          // the same report are two real entries.
          externalId: `crm-workflow-${report.id}-${action}`,
        }).catch(() => {});
      })
      .catch(async (e) => {
        // handleAuditThreadReply catches its own failures and posts them into the
        // thread, so this only fires on something it could not reach at all.
        const message = (e as Error)?.message ?? String(e);
        console.error(`[crm/workflow] ${action} threw:`, message);
        await addNote({
          contactId,
          title: `${label} failed`,
          content: `${message}\n${threadUrl}`,
          origin: "mission_control",
          actor,
        }).catch(() => {});
      })
  );

  return NextResponse.json({ ok: true, running: true, threadUrl, label }, { status: 202 });
}

/**
 * What to actually type into the thread.
 *
 * Only `draft` needs more than the bare verb, and it needs it defensively:
 * `draft <text>` stores <text> as intake_answers, which every later drafter and the
 * live call brief read as instructions that outrank everything generic. So the button
 * must never send a BARE draft over answers that already exist.
 *
 * When there are none, the CRM can supply the two the intake card asks for first,
 * which is the real advantage of pressing this here instead of in Slack: the recipient
 * and their address are already on the record.
 */
async function commandText(
  action: ThreadAction,
  command: string,
  intakeAnswers: string | null,
  contactId: string
): Promise<string> {
  if (action !== "draft") return command;

  const existing = intakeAnswers?.trim();
  if (existing) return `${command} ${existing}`;

  const { data } = await supabaseAdmin
    .from("contacts")
    .select("first_name, last_name, email")
    .eq("id", contactId)
    .maybeSingle();

  const contact = data as Pick<ContactRow, "first_name" | "last_name" | "email"> | null;
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  const email = contact?.email?.trim();

  const seeded = [
    name ? `The recipient is ${name}.` : null,
    email ? `Their email is ${email}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return seeded ? `${command} ${seeded}` : command;
}
