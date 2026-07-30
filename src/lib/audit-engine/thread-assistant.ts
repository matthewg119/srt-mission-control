// Routes Slack thread replies inside an audit-report thread to the email
// assistant. Called from src/app/api/slack/events/route.ts, gated there by
// channel === AUDIT_CHANNEL_ID before this even runs — so it only ever does a
// DB lookup for genuine audit-channel thread replies, never on every message
// in the workspace. Returns false fast for a thread that isn't (yet) an audit
// report thread, so it never interferes with the many other thread lanes
// already wired in events.ts.
//
// ── The cold-outreach flow this drives ──────────────────────────────────────
// A finished audit posts an INTAKE CARD, not a finished pitch (see
// outreach-intake.ts for why). From there the thread is a small state machine
// keyed on audit_reports.outreach_stage:
//
//   awaiting_intake  free text = the answers        -> ONE email 1 draft, stage: drafted
//   drafted          free text = a revision         -> the draft is rewritten in place
//   drafted          "reveal"                       -> the hand-everything-over message
//   revealed         free text = the prospect spoke -> objection reply options
//
// Plus, at any stage: "nudge 2..5" for the pre-pitch ladder, "email 2..5" for
// the post-reveal belief ladder, "redesign <url>" / "loom <url>" to attach the
// assets the reveal needs, and "1" (or "send it") to turn the current draft into
// an Outlook DRAFT that Matthew opens and sends. Nothing is ever auto-sent.
//
// Free text means different things at different stages on purpose: at `drafted`,
// "tighter, cut the last line" is an edit to the draft, and treating it as a
// pasted prospect objection (the old behavior for all free text) produced a
// nonsense rebuttal email.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { buildReportView, type ReportView } from "./report-view";
import { buildAliases } from "./mention-match";
import {
  draftEmailOptions,
  draftPermissionEmail,
  draftRevealMessage,
  linkWarning,
  BELIEF_SEQUENCE,
  PERMISSION_SEQUENCE,
  type EmailOption,
} from "./email-assistant";
import { buildIntakeQuestions, postIntakeCard, draftFromIntake, revisePreviousDraft } from "./outreach-intake";
import type { AuditReportRow, AuditRunRow } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Persist the 3 options on the report row and post them to the thread as a numbered card. */
export async function postOptions(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  header: string,
  options: EmailOption[]
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ pending_drafts: options }).eq("id", report.id);
  const body = options
    .map((o, i) => `*${i + 1}. ${o.label}*\nSubject: ${o.subject}\n\n${o.body}`)
    .join("\n\n· · ·\n\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    `${header}\n\n_Reply *1*, *2*, or *3* in this thread and I'll create the Outlook draft for you to send._\n\n${body}`
  );
}

/** What the guards had to do to a draft, surfaced above it so it is never silent. */
interface DraftGuards {
  removedLinks?: string[];
  formatNote?: string | null;
}

/**
 * Post ONE finished draft. Stored as a single-element pending_drafts so the existing "1"
 * picker and Outlook path work unchanged, and so a later revision has something to edit.
 *
 * Guard output goes ABOVE the draft, not below: a stripped link can leave an awkward
 * half-sentence, and that has to be read before the copy is, not after.
 */
async function postSingleDraft(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  header: string,
  draft: EmailOption,
  footer: string,
  guards: DraftGuards = {}
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ pending_drafts: [draft] }).eq("id", report.id);
  const warnings = [linkWarning(guards.removedLinks ?? []), guards.formatNote ? `:warning: ${guards.formatNote}.` : null]
    .filter(Boolean)
    .join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    `${header}\n${warnings ? `\n${warnings}\n` : ""}\nSubject: ${draft.subject}\n\n${draft.body}\n\n_${footer}_`
  );
}

/** Turn the chosen stored option into an Outlook draft and confirm with the open-in-Outlook link. */
async function createOutlookDraftFromPick(report: AuditReportRow, channel: string, threadTs: string, pick: number): Promise<void> {
  const drafts = report.pending_drafts ?? [];
  const chosen = drafts[pick - 1];
  if (!chosen) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `I don't have option ${pick} queued in this thread. Reply "questions" to redo the intake, "nudge 2" (through nudge ${PERMISSION_SEQUENCE.length}) for the next pre-pitch touch, or paste the prospect's reply and I'll draft from that.`
    );
    return;
  }
  try {
    // prospect_email (the cold prospect, captured at intake) before requester_email (the
    // person who requested a public free audit). A cold /audit run only ever has the former,
    // and before it existed those drafts opened with an empty To.
    const to = report.prospect_email ?? report.requester_email ?? undefined;
    const htmlBody = `<div style="white-space:pre-wrap;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(chosen.body)}</div>`;
    const draft = await microsoft.createDraft({
      to,
      subject: chosen.subject,
      body: htmlBody,
    });
    const noRecipient = to ? "" : "\nNo recipient on file, so add the To address in Outlook before sending.";
    await slack.postThreadReply(
      channel,
      threadTs,
      `:envelope_with_arrow: Outlook draft created${drafts.length > 1 ? ` for option ${pick}` : ""} (${chosen.label})${to ? ` to ${to}` : ""}. <${draft.webLink}|Open in Outlook>${noRecipient}`
    );
  } catch (e) {
    await slack.postThreadReply(channel, threadTs, `:warning: Couldn't create the Outlook draft: ${(e as Error).message}`).catch(() => {});
  }
}

/** Store a redesign or Loom URL for the reveal message to pick up. */
async function attachAsset(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  field: "redesign_url" | "loom_url",
  url: string
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ [field]: url }).eq("id", report.id);
  const what = field === "redesign_url" ? "Redesign concept" : "Loom";
  await slack.postThreadReply(
    channel,
    threadTs,
    `:paperclip: ${what} saved. It stays out of the pre-pitch emails and goes into the reveal, so reply *reveal* once they say yes.`
  );
}

/** Post the intake card again (also the recovery path when a thread's state got confusing). */
async function restartIntake(report: AuditReportRow, channel: string, threadTs: string, view: ReportView): Promise<void> {
  const questions = await buildIntakeQuestions(report, view);
  await postIntakeCard(report, channel, threadTs, questions);
}

/** Slack wraps pasted URLs as <url> or <url|label>; unwrap before storing one. */
function unwrapSlackUrl(raw: string): string {
  const m = raw.match(/^<([^|>]+)(?:\|[^>]*)?>$/);
  return (m ? m[1] : raw).trim();
}

export async function handleAuditThreadReply(args: { channel: string; threadTs: string; text: string }): Promise<boolean> {
  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slack_thread_ts", args.threadTs)
    .maybeSingle();

  if (!reportData) return false; // not an audit thread — let other handlers run
  const report = reportData as AuditReportRow;

  if (report.status !== "done") {
    await slack.postThreadReply(args.channel, args.threadTs, "⏳ This audit hasn't finished running yet — I'll have the scorecard and the intake questions once it's done.");
    return true;
  }

  const text = args.text.trim();

  // "1" / "2" / "3" / "send it" → create the Outlook draft from what's queued.
  const pickMatch = text.match(/^([123])$/);
  if (pickMatch) {
    await createOutlookDraftFromPick(report, args.channel, args.threadTs, parseInt(pickMatch[1], 10));
    return true;
  }
  if (/^(send it|send that|draft it|do it|outlook)\.?$/i.test(text)) {
    await createOutlookDraftFromPick(report, args.channel, args.threadTs, 1);
    return true;
  }

  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  const view = buildReportView(report, runs, aliases);

  try {
    // --- Attach the assets the reveal needs -------------------------------------
    const assetMatch = text.match(/^(redesign|loom)\s+(\S+)$/i);
    if (assetMatch) {
      const field = assetMatch[1].toLowerCase() === "redesign" ? "redesign_url" : "loom_url";
      await attachAsset(report, args.channel, args.threadTs, field, unwrapSlackUrl(assetMatch[2]));
      return true;
    }

    // --- Redo the intake --------------------------------------------------------
    if (/^(questions|intake|restart intake|ask me)\??$/i.test(text)) {
      await restartIntake(report, args.channel, args.threadTs, view);
      return true;
    }

    // --- Stage 1: the pre-pitch ladder ------------------------------------------
    const nudgeMatch = text.match(/^nudge\s+(\d+)$/i);
    if (nudgeMatch) {
      const step = parseInt(nudgeMatch[1], 10);
      const touch = PERMISSION_SEQUENCE.find((t) => t.n === step);
      const draft = await draftPermissionEmail(report, view, step, report.intake_answers);
      if (!draft.subject) {
        // draftPermissionEmail puts its "no such step" explanation in the body.
        await slack.postThreadReply(args.channel, args.threadTs, draft.body);
        return true;
      }
      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        `:envelope: Nudge ${step}${touch ? ` · ${touch.day} · ${touch.name}` : ""} (no links, no price, one ask):`,
        { label: `Nudge ${step}`, subject: draft.subject, body: draft.body },
        "Reply *1* for the Outlook draft, or tell me what to change.",
        { removedLinks: draft.removedLinks, formatNote: draft.formatNote }
      );
      return true;
    }

    // --- Stage 2: they said yes -------------------------------------------------
    const revealMatch = text.match(/^(?:reveal|yes|they said yes|he said yes|she said yes|they're in|send everything)\b[,:]?\s*(.*)$/i);
    if (revealMatch) {
      const terms = revealMatch[1]?.trim() || null;
      const draft = await draftRevealMessage(report, view, terms);
      await supabaseAdmin.from("audit_reports").update({ outreach_stage: "revealed" }).eq("id", report.id);
      const missing = [
        report.redesign_url ? null : "no redesign link saved (`redesign <url>`)",
        report.loom_url ? null : "no Loom saved (`loom <url>`)",
      ].filter(Boolean);
      const footer = [
        "Reply *1* for the Outlook draft, or tell me what to change.",
        missing.length > 0 ? `Not included: ${missing.join(", ")}.` : "",
        terms ? "" : "Offer terms defaulted, reply `reveal $299/mo, setup waived` to change them.",
      ]
        .filter(Boolean)
        .join(" ");
      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        ":unlock: *Reveal* · everything at once, links and price allowed here:",
        { label: "Reveal", subject: draft.subject, body: draft.body },
        footer
      );
      return true;
    }

    // --- Stage 3: the post-reveal belief ladder (unchanged) ---------------------
    const emailMatch = text.match(/^email\s+(\d+)$/i);
    if (emailMatch) {
      const step = parseInt(emailMatch[1], 10);
      const belief = BELIEF_SEQUENCE.find((b) => b.n === step);
      const options = await draftEmailOptions(report, view, { kind: "sequence", step });
      const note =
        report.outreach_stage && report.outreach_stage !== "revealed"
          ? "\n_Heads up: this ladder assumes they've already seen the report. Before the reveal, use `nudge 2` instead._"
          : "";
      await postOptions(report, args.channel, args.threadTs, `✉️ Email ${step}${belief ? ` — ${belief.name}` : ""} · 3 options:${note}`, options);
      return true;
    }

    // --- Free text: meaning depends on where the thread is ----------------------
    if (report.outreach_stage === "awaiting_intake") {
      const { draft, extracted, removedLinks, formatNote } = await draftFromIntake(report, view, text);
      await supabaseAdmin
        .from("audit_reports")
        .update({
          intake_answers: text,
          outreach_stage: "drafted",
          // Only overwrite with something real, so a second pass that omits the email
          // doesn't wipe the address captured on the first.
          ...(extracted.prospect_name ? { prospect_name: extracted.prospect_name } : {}),
          ...(extracted.prospect_email ? { prospect_email: extracted.prospect_email } : {}),
          ...(extracted.redesign_url ? { redesign_url: extracted.redesign_url } : {}),
        })
        .eq("id", report.id);

      const captured = [
        extracted.prospect_name ? `to ${extracted.prospect_name}` : null,
        extracted.prospect_email,
        extracted.redesign_url ? "redesign link in play" : null,
      ].filter(Boolean);

      await postSingleDraft(
        { ...report, pending_drafts: [draft] },
        args.channel,
        args.threadTs,
        `:envelope: *Email 1* · pre-pitch, one finding, one ask, no price${captured.length > 0 ? `\n_${captured.join(" · ")}_` : ""}`,
        draft,
        "Reply *1* for the Outlook draft, or tell me what to change (\"tighter\", \"drop the score line\").",
        { removedLinks, formatNote }
      );
      return true;
    }

    if (report.outreach_stage === "drafted") {
      const previous = (report.pending_drafts ?? [])[0];
      if (previous) {
        const { draft: revised, removedLinks, formatNote } = await revisePreviousDraft(report, view, previous, text);
        await postSingleDraft(
          report,
          args.channel,
          args.threadTs,
          `:pencil2: *${revised.label}* · revised:`,
          revised,
          "Reply *1* for the Outlook draft, or keep telling me what to change.",
          { removedLinks, formatNote }
        );
        return true;
      }
    }

    // Default (and everything after the reveal): treat it as the prospect talking.
    const options = await draftEmailOptions(report, view, { kind: "objection", prospectSaid: text });
    await postOptions(report, args.channel, args.threadTs, `✉️ Reply drafts · 3 options:`, options);
  } catch (e) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Couldn't draft that: ${(e as Error).message}`).catch(() => {});
  }

  return true;
}
