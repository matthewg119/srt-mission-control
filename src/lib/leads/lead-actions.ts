// The doorways a #hot-leads lead thread can open.
//
// ‼️ DOORWAYS, NOT IMPLEMENTATIONS. Every one of these already had a home: the audit is
// runAuditPipeline(), and loom / call / close / avatars / brief / the numbered draft picks are
// thread commands handleAuditThreadReply() has routed since the audit engine shipped. This file is
// a second doorway to them from the channel the lead actually arrives in, the same way
// src/app/api/crm/leads/[id]/workflow/route.ts is a doorway to them from the CRM page.
//
// That is the point and it must stay that way. The draft linter, lintSpoken, the price gates, the
// loom wizard's state machine and the no-fabrication rules all live inside those handlers. Anything
// here that assembled its own prompt would bypass every one of them silently, and the failure would
// look like slightly worse copy rather than like a bug.
//
// WHY THE RESULTS ARE MIRRORED BACK RATHER THAN ONLY LINKED
// A lead has two live threads: this one in #hot-leads and the audit's own in
// #ai-visibility-audits. The audit thread stays the source of truth (it holds outreach_stage, the
// scorecard and every receipt); this one is a remote control. A remote control that only ever
// answers "go look over there" is worse than no remote control, so a proxied command reads the row
// back and posts whatever actually changed into the thread the command was typed in.

import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { addNote } from "@/lib/crm";
import { runAuditPipeline, RUN_IN_FLIGHT_MINUTES } from "@/lib/audit-engine/run-audit-pipeline";
import { handleAuditThreadReply } from "@/lib/audit-engine/thread-assistant";
import { bookingUrlForReport } from "@/lib/onboarding2-link";

/** Columns the lane reads. Narrow on purpose: select("*") on contacts drags ~90 columns
 *  through every message typed in #hot-leads. */
export const LEAD_COLUMNS =
  "id, first_name, last_name, email, phone, website, business_name, biz_city, biz_state, " +
  "source, application_stage, disposition, slack_channel, slack_thread_ts, zoho_lead_id";

export interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  business_name: string | null;
  biz_city: string | null;
  biz_state: string | null;
  source: string | null;
  application_stage: string | null;
  disposition: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  zoho_lead_id: string | null;
}

export function leadName(c: LeadRow): string {
  return (
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    c.business_name ||
    c.email ||
    "this lead"
  );
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/**
 * The router lookup: thread to contact.
 *
 * The reverse of every other read in lead-thread.ts, and the reason
 * docs/2026-09-23-lead-thread-index.sql exists. maybeSingle rather than single because a thread
 * under anything else in #hot-leads (a speed-to-lead notice, the daily digest) resolves nothing,
 * and that is not an error: the caller returns false and the message falls through untouched.
 */
export async function contactByThread(threadTs: string): Promise<LeadRow | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select(LEAD_COLUMNS)
    .eq("slack_thread_ts", threadTs)
    .maybeSingle();
  return (data as LeadRow | null) ?? null;
}

interface AuditRow {
  id: string;
  slug: string | null;
  score: number | null;
  city: string | null;
  client_name: string | null;
  status: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  pending_drafts: unknown;
  outlook_drafts: Array<{ mailbox: string | null; id: string; url: string }> | null;
  intake_answers: string | null;
}

const AUDIT_COLS =
  "id, slug, score, city, client_name, status, slack_channel_id, slack_thread_ts, pending_drafts, outlook_drafts, intake_answers";

/** The newest FINISHED audit for this lead that has a thread to talk to. Mirrors
 *  findUsableAudit in src/lib/reachinbox/actions.ts, minus the prospect branch. */
export async function findUsableAudit(contactId: string): Promise<AuditRow | null> {
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select(AUDIT_COLS)
    .eq("contact_id", contactId)
    .eq("status", "done")
    .not("slack_thread_ts", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AuditRow | null) ?? null;
}

/** Any audit for this lead, finished or not, so status can say what state it is in. */
export async function latestAudit(contactId: string): Promise<AuditRow | null> {
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select(AUDIT_COLS)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AuditRow | null) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Run the AI visibility audit for this lead
// ─────────────────────────────────────────────────────────────────────

export type AuditOutcome = "started" | "no_engine" | "no_website" | "in_flight";

/**
 * Lifted from startAudit() in src/app/api/crm/leads/[id]/workflow/route.ts, with the same guards
 * and the same refusals, because it is the same operation reached from a different surface.
 *
 * ONE DELIBERATE DIFFERENCE: this passes requesterEmail. The CRM button does not, and the
 * consequence is invisible until you look for it. finishReport gates the whole #hot-leads pitch
 * card on report.requester_email being set (see postScorecardAndOutreach), so an audit started
 * without it finishes, scores, uploads its PDF into the audit thread, and posts NOTHING back to
 * the lead. It also arms findRecentReport's 30 minute double-submit guard, which returns null on a
 * falsy email, and enrolLoomFollowup reads it later to put them on the D+3 / D+7 ladder.
 */
export async function runAuditForContact(args: {
  contact: LeadRow;
  channel: string;
  threadTs: string;
  by: string;
}): Promise<AuditOutcome> {
  const { contact, channel, threadTs, by } = args;
  const say = (s: string) => slack.postThreadReply(channel, threadTs, s);

  // The engine is ChatGPT only. Name the missing piece rather than letting the command look
  // broken for an unrelated reason: the same refusal runLoomForProspect makes.
  if (!process.env.OPENAI_API_KEY) {
    await say(
      "The audit engine has no key. `OPENAI_API_KEY` is empty in production. Set it and type `run audit` again."
    );
    return "no_engine";
  }

  const website = contact.website?.trim();
  if (!website) {
    // runAuditPipeline COULD take this lead by businessName since the no-website work landed.
    // This deliberately still does not, for the reason startAudit gives: a full audit is a
    // classification call plus 40 engine calls plus five minutes, and pointing it at a business
    // nobody has identified yet spends all of that before anyone knows whether the lead is worth
    // it. A run against the wrong business produces a confident report about somebody else.
    await say(
      [
        `I cannot audit *${leadName(contact)}* yet. There is no website on this lead, so there is nothing to crawl.`,
        `Add one here: <${appUrl()}/dashboard/leads/${contact.id}|open the lead>, then type \`run audit\` again.`,
        "If they genuinely have no site, use the *No website* button on that page instead. It researches them and drafts the pitch in ninety seconds.",
      ].join("\n")
    );
    return "no_website";
  }

  // Claim guard. Nothing here is transactional, but a run is a classification call plus 40 engine
  // calls, so an impatient second `run audit` must not buy two of them.
  const cutoff = new Date(Date.now() - RUN_IN_FLIGHT_MINUTES * 60_000).toISOString();
  const { data: inFlight } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("contact_id", contact.id)
    .in("status", ["classifying", "running"])
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    await say("An audit is already running for this lead. Give it a few minutes, it lands in this thread.");
    return "in_flight";
  }

  // Written before the slow part so the CRM timeline says something is happening rather than
  // staying blank for five minutes.
  await addNote({
    contactId: contact.id,
    title: "AI visibility audit started",
    content: `Scanning ${website}, started from the lead thread in #hot-leads by ${by}. The score comes back onto this timeline when it finishes.`,
    origin: "slack",
    actor: by,
  }).catch(() => {});

  await say(
    [
      `:hourglass_flowing_sand: Running the AI visibility audit on *${website}*. Four to six minutes.`,
      "The score, the report link and the scorecard PDF come back in this thread. The prompt by prompt working lands in #ai-visibility-audits.",
    ].join("\n")
  );

  // ‼️ waitUntil, NOT await AND NOT A BARE FLOATING PROMISE.
  //
  // Not awaited, because runAuditPipeline does not resolve until the ENTIRE run is over (it awaits
  // the /api/audit/process kick-off, which runs every batch and then finishReport), and Slack
  // re-delivers any event it has not heard back from within three seconds.
  //
  // Not floating either: the callers here return their HTTP response the moment this function
  // does, and Vercel freezes the lambda at that point. A bare `void` would have the run killed
  // somewhere in the middle of batch 0, leaving an audit_reports row stuck at `running` until the
  // watchdog cron picked it up the next morning. Same call startAudit() makes in the CRM route.
  waitUntil(
    runAuditPipeline({
      website,
      // "Homestead, FL". The pipeline takes the city as free text and classify.ts reads the state
      // off it. Undefined rather than "" so an unset city is absent, not a city named "".
      city: [contact.biz_city, contact.biz_state].filter(Boolean).join(", ") || undefined,
      // The whole reason to run this from a lead rather than from /audit: it is what links the
      // report to this contact, which is what makes writeAuditToLead() fire and what lets
      // postLeadNotification find this thread again when the run finishes.
      contactId: contact.id,
      requesterName: leadName(contact),
      requesterEmail: contact.email ?? undefined,
      leadSource: "hot_leads",
      // There is a thread here, but onNeedsCity would ask a question nobody is waiting on five
      // minutes after the command. Same call the Meta Lead Ads route and the CRM button make.
      allowLowConfidenceCity: true,
      onError: async (message) => {
        console.error("[leads/audit] failed:", message);
        await slack.postThreadReply(channel, threadTs, `:warning: The audit failed: ${message}`).catch(() => {});
        await addNote({
          contactId: contact.id,
          title: "AI visibility audit failed",
          content: message,
          origin: "slack",
          actor: by,
        }).catch(() => {});
      },
    }).catch(async (e) => {
      const message = (e as Error)?.message ?? String(e);
      console.error("[leads/audit] threw:", message);
      await slack.postThreadReply(channel, threadTs, `:warning: The audit threw: ${message}`).catch(() => {});
    })
  );

  return "started";
}

/**
 * What a bare `draft` has to become before it is forwarded.
 *
 * ‼️ FORWARDING THE WORD "draft" ON ITS OWN IS A BUG, NOT A COMMAND. At outreach_stage
 * `awaiting_intake` the audit thread reads free text as THE INTAKE ANSWERS, so a bare `draft`
 * would be stored as the answer to "who is this going to and what should it mention" and email 1
 * would be written from the string "draft".
 *
 * Mirrors commandText() in src/app/api/crm/leads/[id]/workflow/route.ts, which solves the same
 * problem for the CRM button: reuse the answers already on the report, and failing that seed the
 * one thing that is always knowable, which is who the recipient is.
 */
export async function buildDraftCommand(contact: LeadRow): Promise<string> {
  const report = await findUsableAudit(contact.id);
  const existing = report?.intake_answers?.trim();
  if (existing) return `draft ${existing}`;

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  const email = contact.email?.trim();
  const seeded = [name ? `The recipient is ${name}.` : null, email ? `Their email is ${email}.` : null]
    .filter(Boolean)
    .join(" ");

  return seeded ? `draft ${seeded}` : "draft";
}

// ─────────────────────────────────────────────────────────────────────
// Everything else: forward it to the lead's audit thread, mirror the result back
// ─────────────────────────────────────────────────────────────────────

export type ProxyOutcome = "no_audit" | "mirrored" | "linked";

interface DraftOption {
  label?: string;
  subject?: string;
  body?: string;
}

function renderOptions(options: DraftOption[]): string {
  return options
    .map((o, i) => `*${i + 1}. ${o.label ?? "Option"}*\nSubject: ${o.subject ?? ""}\n\n${o.body ?? ""}`)
    .join("\n\n· · ·\n\n");
}

/**
 * Hand `text` to the lead's finished audit thread verbatim, then post back whatever it produced.
 *
 * VERBATIM IS THE CONTRACT. handleAuditThreadReply is a state machine keyed on
 * audit_reports.outreach_stage: the same sentence means "these are the intake answers" at
 * awaiting_intake, "rewrite the draft like this" at drafted, and "this is what the prospect said"
 * at revealed. Interpreting it here would be a second, worse copy of that machine, and the
 * paste-their-reply path is the one that depends on it most.
 *
 * Same shape as runThreadCommand() in the CRM workflow route, including the read-before /
 * read-after comparison: loom, avatars and brief produce no email at all, so an outlook_drafts url
 * that has NOT moved belongs to some earlier run and must not be presented as this one's.
 */
export async function proxyToAuditThread(args: {
  contact: LeadRow;
  channel: string;
  threadTs: string;
  text: string;
  label: string;
  by: string;
}): Promise<ProxyOutcome> {
  const { contact, channel, threadTs, text, label, by } = args;
  const say = (s: string, blocks?: SlackBlock[]) => slack.postThreadReply(channel, threadTs, s, blocks);

  const report = await findUsableAudit(contact.id);
  if (!report?.slack_channel_id || !report.slack_thread_ts) {
    const pending = await latestAudit(contact.id);
    await say(
      pending && pending.status !== "done"
        ? `The audit for *${leadName(contact)}* is in state \`${pending.status ?? "unknown"}\`, and everything below it reads a finished report. Give it a few minutes.`
        : `No finished audit for *${leadName(contact)}* yet, and every one of these reads the report. Type \`run audit\` first.`
    );
    return "no_audit";
  }

  const draftsBefore = JSON.stringify(report.pending_drafts ?? null);
  const urlBefore = report.outlook_drafts?.[0]?.url ?? null;

  // Said out loud in the audit thread so a card appearing there on its own is explained. Safe to
  // post: the events route drops anything carrying a bot_id before it reaches the router, so this
  // cannot come back around as a command.
  await slack
    .postThreadReply(
      report.slack_channel_id,
      report.slack_thread_ts,
      `:arrow_forward: *${label}*, run from the lead thread in #hot-leads by ${by}`
    )
    .catch(() => {});

  await handleAuditThreadReply({
    channel: report.slack_channel_id,
    threadTs: report.slack_thread_ts,
    text,
  });

  const { data } = await supabaseAdmin.from("audit_reports").select(AUDIT_COLS).eq("id", report.id).maybeSingle();
  const after = (data as AuditRow | null) ?? report;
  const threadUrl = slackThreadLink(report.slack_channel_id, report.slack_thread_ts);

  const draftsAfter = JSON.stringify(after.pending_drafts ?? null);
  const options = Array.isArray(after.pending_drafts) ? (after.pending_drafts as DraftOption[]) : [];

  if (draftsAfter !== draftsBefore && options.length > 0) {
    await say(
      [
        `:memo: *${label}* produced ${options.length} option${options.length === 1 ? "" : "s"}.`,
        "Reply *1*, *2* or *3* here and I will put it in your Outlook drafts. Nothing sends by itself.",
        `Full working: <${threadUrl}|the audit thread>`,
        "",
        renderOptions(options),
      ].join("\n")
    );
    return "mirrored";
  }

  const urlAfter = after.outlook_drafts?.[0]?.url ?? null;
  if (urlAfter && urlAfter !== urlBefore) {
    await say(
      `:white_check_mark: *${label}* is in your Outlook drafts: <${urlAfter}|open it>. Read it, then send it yourself.`
    );
    return "mirrored";
  }

  await say(`:arrow_upper_right: *${label}* ran. The answer is in <${threadUrl}|the audit thread>.`);
  return "linked";
}

// ─────────────────────────────────────────────────────────────────────
// The hand-off: the booking link, which is where onboarding actually starts
// ─────────────────────────────────────────────────────────────────────

/**
 * ‼️ THIS LANE DOES NOT PROVISION ANYTHING, DELIBERATELY. No client row, no ops channel, no
 * delivery board. Onboarding begins when they open /onboarding2 and book from the two plan
 * options: /api/onboarding2/booked is what calls openClientBoard, and the r=<slug> this URL
 * carries is what attaches THIS report to that client as its pre-call audit. A client created from
 * Slack would arrive with no booking, no signature and no report attached to it.
 */
export async function postBookingLink(args: {
  contact: LeadRow;
  channel: string;
  threadTs: string;
}): Promise<boolean> {
  const { contact, channel, threadTs } = args;
  const report = await findUsableAudit(contact.id);

  if (!report?.slug) {
    await slack.postThreadReply(
      channel,
      threadTs,
      "The booking link carries the report slug, which is what attaches this audit to them as their pre-call photograph. Type `run audit` first, then ask me again."
    );
    return false;
  }

  const url = bookingUrlForReport(report);
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `:link: Booking link for *${leadName(contact)}*:`,
      url,
      "",
      "This is the /onboarding2 funnel, not a bare Calendly page. They pick one of the two plans and book, and that booking is what opens their channel and their board. Nothing is provisioned until they do.",
    ].join("\n")
  );
  return true;
}

/** What state this lead is actually in, in one card. */
export async function postLeadStatus(args: {
  contact: LeadRow;
  channel: string;
  threadTs: string;
}): Promise<void> {
  const { contact, channel, threadTs } = args;
  const report = await latestAudit(contact.id);

  const auditLine = !report
    ? "Audit: none has ever been run. Type `run audit`."
    : report.status === "done"
      ? `Audit: done, scored *${report.score ?? "?"}/100*. Report: ${appUrl()}/r/${report.slug}`
      : `Audit: in state \`${report.status ?? "unknown"}\`, no usable numbers yet.`;

  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*${leadName(contact)}*`,
      `Email: ${contact.email ?? "none on file"}`,
      `Website: ${contact.website ?? "none on file"}`,
      `Source: ${contact.source ?? "unknown"}`,
      `Stage: ${contact.application_stage ?? "Untouched"}`,
      `Outcome: ${contact.disposition ?? "not marked yet"}`,
      auditLine,
      `CRM: <${appUrl()}/dashboard/leads/${contact.id}|open the lead>`,
    ].join("\n")
  );
}
