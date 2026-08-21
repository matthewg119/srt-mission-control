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
import {
  runMiniVisibilityCheck,
  draftNoWebsitePitch,
  formatNoWebsitePitchNote,
  createPitchDraft,
} from "@/lib/audit-engine/no-website-pitch";

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
  if (action === "nowebsite") return startNoWebsitePitch(contactId, actor);
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
    // Name-mode audits landed on main with the no-website work, so runAuditPipeline COULD take
    // this lead by businessName now. This button deliberately still does not.
    //
    // A full audit is a classification call plus 40 engine calls plus five minutes, and pointing
    // it at a business nobody has identified yet spends all of that before anyone knows whether
    // the prospect is worth it. The No website button is the cheap version of the same question:
    // three questions, one email, ninety seconds. Run the real audit after they say yes.
    return NextResponse.json(
      {
        error:
          "This lead has no website, so there is nothing to crawl. Use the No website button, which researches them and drafts the pitch.",
        field: "website",
      },
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
// No website: mini visibility check, then one permission email
// ─────────────────────────────────────────────────────────────────────

/**
 * The cheap pitch for a business with a Google profile and nothing else.
 *
 * Not a smaller audit and not a replacement for one. The audit is 20 questions, 40 engine calls
 * and five minutes, aimed at a prospect who is worth that; this is three questions and one email,
 * aimed at deciding whether they are. Run the real audit afterwards once they say yes.
 *
 * ‼️ It refuses when the lead HAS a website, and that is not tidiness. Every angle it can write
 * rests on the premise that nothing describing this business was written by them, and that
 * premise is false the moment a site exists. Told about a site it cannot see, the drafter would
 * write the same email anyway.
 *
 * ‼️ THE OUTPUT GOES TO OUTLOOK AND TO THIS LEAD'S TIMELINE, AND NOWHERE ELSE. It used to post a
 * card into #ai-visibility-audits, which is the audit lane's channel — and this lead has no audit
 * and can never have one, because an audit needs a site to crawl. So the note said "the draft
 * lands in #ai-visibility-audits" while the CRM showed only a subject and a body, and the draft
 * that was already being placed in Outlook was never linked from the page the button is on.
 */
async function startNoWebsitePitch(contactId: string, actor: string) {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, website, business_name, first_name, last_name, email, biz_city, biz_state")
    .eq("id", contactId)
    .maybeSingle();

  const contact = data as ContactRow | null;
  if (!contact) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (contact.website?.trim()) {
    return NextResponse.json(
      {
        error:
          "This lead has a website, so the no-website pitch would be false. Run the visibility audit instead.",
        field: "website",
      },
      { status: 400 }
    );
  }

  const businessName = contact.business_name?.trim();
  if (!businessName) {
    return NextResponse.json(
      { error: "Add a business name to this lead first — there is nothing to research without one.", field: "business_name" },
      { status: 400 }
    );
  }

  await addNote({
    contactId,
    title: "No-website pitch started",
    content: `Researching ${businessName} and asking three buyer questions. The draft goes straight into your Outlook drafts, and the link lands on this timeline in about 90 seconds.`,
    origin: "mission_control",
    actor,
  }).catch(() => {});

  waitUntil(
    (async () => {
      try {
        const city = [contact.biz_city, contact.biz_state].filter(Boolean).join(", ") || null;
        const outcome = await runMiniVisibilityCheck(businessName, city);

        // ‼️ ONLY A FAILED RESEARCH CALL STOPS THIS, and the distinction is the whole fix. The
        // three misses that mean "nothing public describes this business" come back as a real
        // check with identity: null, because that is not an error, it is the finding — and it is
        // the strongest one this lane can carry. See ResearchMiss in claude-research.ts.
        if (!outcome.ok) {
          await addNote({
            contactId,
            title: "No-website pitch failed",
            content: `${outcome.detail} Nothing was drafted, and this says nothing about the prospect. Press No website again.`,
            origin: "mission_control",
            actor,
          }).catch(() => {});
          return;
        }

        const check = outcome.check;
        const draft = await draftNoWebsitePitch(check, businessName, contact.first_name);
        // Signed with the same Outlook block every other SRT email uses, and left as a DRAFT.
        // Nothing on this lane sends: microsoft.sendDraft is not imported here and must not be.
        //
        // ‼️ THE MAILBOX IS PICKED BY THE ROTATION, INSIDE createPitchDraft. This route must
        // never read OUTREACH_MAILBOX or submissionsMailbox() itself — chooseOutreachMailbox()
        // is the only thing that decides, and a second selection here is how wrap-card.ts ended
        // up outside the rotation. When every mailbox is at its cap it places nothing and says
        // so in mailboxNote, which the note below prints in every state.
        const made = await createPitchDraft(draft, contact.email);

        await addNote({
          contactId,
          title: draft.rejectedFindings.length
            ? "No-website pitch REJECTED by the linter"
            : made.placed.length
              ? "No-website pitch drafted"
              : "No-website pitch written, but no draft was placed",
          content: formatNoWebsitePitchNote(businessName, check, draft, made.placed, made.mailboxNote),
          origin: "mission_control",
          actor,
        }).catch(() => {});
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        console.error("[crm/workflow] no-website pitch threw:", message);
        await addNote({
          contactId,
          title: "No-website pitch failed",
          content: message,
          origin: "mission_control",
          actor,
        }).catch(() => {});
      }
    })()
  );

  return NextResponse.json(
    { ok: true, running: true, message: "Researching. The draft lands in your Outlook drafts in about 90 seconds, and on this timeline." },
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
    .select("id, slack_channel_id, slack_thread_ts, intake_answers, outlook_drafts")
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
    outlook_drafts: Array<{ mailbox: string | null; id: string; url: string }> | null;
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

  // Read before the command runs, so the note below can tell a draft this run made from
  // one left over from a previous one. See the comparison in the .then().
  const draftUrlBefore = report.outlook_drafts?.[0]?.url ?? null;

  // Said out loud in the thread, so a card appearing on its own is explained. Safe to
  // post: the events route drops anything carrying a bot_id before it reaches the
  // router, so this cannot come back around as a command.
  await slack
    .postThreadReply(channel, threadTs, `:arrow_forward: *${label}* — run from the CRM by ${actor}`)
    .catch(() => {});

  waitUntil(
    handleAuditThreadReply({ channel, threadTs, text })
      .then(async () => {
        // Every card that posts one finished email now drafts it straight into Outlook, so
        // the answer to "I pressed Draft email, where is it" should be a link to the draft
        // and not only a link to Slack. handleAuditThreadReply returns a bare boolean and
        // should stay that way, so the url is read back off the row it just wrote.
        //
        // Compared against the value from BEFORE the run rather than just read after it.
        // Two of these buttons (avatars, loom) produce no email at all, and an unchanged
        // url is a draft some earlier run made: linking to it here would tell him his
        // avatars are sitting in Outlook. Only a url that MOVED belongs on this note.
        //
        // The link is to the draft THIS run made. Redrafting in the thread replaces it,
        // which leaves this note pointing at a message that no longer exists; the thread
        // always carries the current one. A timeline entry records what happened when it
        // happened, so that is the right trade.
        const { data: after } = await supabaseAdmin
          .from("audit_reports")
          .select("outlook_drafts")
          .eq("id", report.id)
          .maybeSingle();
        // Rotation places ONE draft, so entry 0 is the draft, and its mailbox is whichever one had
        // headroom today rather than always the connected account. Emails used to be mirrored into
        // the shared submissions box as well; that is gone, and so is the second link.
        const placedDraft =
          (after as { outlook_drafts: Array<{ url: string; mailbox: string | null }> | null } | null)
            ?.outlook_drafts?.[0] ?? null;
        const draftUrl = placedDraft?.url ?? null;
        // Naming the mailbox is the point: "your Outlook drafts" no longer says where to look
        // once there is more than one mailbox in play.
        const draftWhere = placedDraft?.mailbox ?? "your inbox";
        const madeADraft = Boolean(draftUrl) && draftUrl !== draftUrlBefore;
        await addNote({
          contactId,
          title: `${label} posted in Slack`,
          content: madeADraft
            ? `Run from the lead page. The email is in ${draftWhere} drafts: ${draftUrl}\n${threadUrl}`
            : `Run from the lead page. ${threadUrl}`,
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
