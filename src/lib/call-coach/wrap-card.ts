// The post-call card, and what 👍 actually does.
//
// On approve, in this order: claim the row, write ONE CRM note, create an Outlook DRAFT, print the
// draft back into the thread. Nothing sends. `microsoft.sendDraft` is deliberately not imported by
// this file.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { addNote } from "@/lib/crm";
import { crmRecordUrl } from "./record-url";
import { auditSignatureHtml } from "@/lib/audit-engine/lead-pitch";
import { resolveReplyAnchor } from "@/lib/audit-engine/reply-anchor";
import type { AuditReportRow } from "@/lib/audit-engine/types";
import { outcomeLabel, type CallWrap } from "./wrap";

export interface WrapSessionRow {
  id: string;
  contact_id: string | null;
  /** Legacy provenance, for sessions opened from an old Zoho link. Never the identity. */
  zoho_record_id: string | null;
  audit_report_id: string | null;
  business_name: string | null;
  person_name: string | null;
  prospect_email: string | null;
  prospect_phone: string | null;
  call_type: string | null;
  wrap: CallWrap | null;
  wrap_state: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  wrap_card_ts: string | null;
  crm_note_at: string | null;
  /** Pre-cutover name for crm_note_at. Read, never written. */
  zoho_note_at: string | null;
  duration_seconds: number | null;
}

function whoLabel(s: WrapSessionRow): string {
  return (
    [s.business_name ?? "unidentified", s.person_name, s.prospect_phone]
      .filter(Boolean)
      .join(" · ") + (s.contact_id ? ` · ${crmRecordUrl(s.contact_id)}` : "")
  );
}

/** Non-null exactly when the note write is possible, which is the same condition. */
function crmLink(s: WrapSessionRow): string | null {
  return s.contact_id ? crmRecordUrl(s.contact_id) : null;
}

/** The note was written on an earlier attempt. Sessions predating the cutover latch on the
 *  old column name, so both are consulted or an old card would write its note twice. */
function noteAlreadyWritten(s: WrapSessionRow): boolean {
  return Boolean(s.crm_note_at ?? s.zoho_note_at);
}

/**
 * Post the card into the lead's audit thread when there is one.
 *
 * With no audit it goes top-level into the same channel with a CALL LOG prefix, and that new ts is
 * stored on the SESSION row. It must never be written to `audit_reports.slack_thread_ts`, which
 * carries a partial unique index that belongs to reports.
 */
export async function postWrapCard(session: WrapSessionRow, wrap: CallWrap): Promise<{ channel: string; ts: string } | null> {
  const channel = session.slack_channel || process.env.AUDIT_CHANNEL_ID || "";
  if (!channel) {
    console.error("[wrap-card] no channel to post into");
    return null;
  }

  const identified = Boolean(session.contact_id);
  const link = crmLink(session);

  const header = identified
    ? `:telephone_receiver: *Call wrap* · ${whoLabel(session)}`
    : `:telephone_receiver: *CALL LOG* · WHO: unidentified`;

  const lines = [
    header,
    `_${outcomeLabel(wrap.outcome)}${session.duration_seconds ? ` · ${Math.round(session.duration_seconds / 60)} min` : ""}${session.call_type ? ` · dialed as ${session.call_type.toUpperCase()}` : ""}_`,
    "",
    "*CRM note*",
    "```",
    wrap.noteText,
    "```",
    wrap.nextStep ? `*Next step:* ${wrap.nextStep}${wrap.nextStepAt ? ` (${wrap.nextStepAt})` : ""}` : "*Next step:* nothing was agreed on this call.",
    "",
    "*Follow-up email, draft only*",
    `*Subject:* ${wrap.emailSubject}`,
    "```",
    wrap.emailBody,
    "```",
    wrap.flags.length ? `:warning: ${wrap.flags.join("\n:warning: ")}` : "",
    link ? `<${link}|Open in the CRM>` : "",
    identified
      ? "_:+1: writes the note to the CRM and creates the Outlook draft. Nothing sends._"
      : "_I could not work out which record this call belongs to, so there is nothing to write to. Attach it to a lead and the buttons come back._",
  ].filter(Boolean);

  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n").slice(0, 2900) } },
    {
      type: "actions",
      elements: identified
        ? [
            { type: "button", text: { type: "plain_text", text: "👍 Note + draft" }, style: "primary", action_id: "cc_wrap_approve", value: session.id },
            { type: "button", text: { type: "plain_text", text: "✏️ Edit" }, action_id: "cc_wrap_edit", value: session.id },
            { type: "button", text: { type: "plain_text", text: "🚫 Discard" }, action_id: "cc_wrap_discard", value: session.id },
          ]
        : [
            { type: "button", text: { type: "plain_text", text: "🔍 Attach to a lead" }, action_id: "cc_wrap_attach", value: session.id },
            { type: "button", text: { type: "plain_text", text: "🚫 Discard" }, action_id: "cc_wrap_discard", value: session.id },
          ],
    },
  ];

  const posted = session.slack_thread_ts
    ? await slack.postThreadReply(channel, session.slack_thread_ts, "Call wrap", blocks as never)
    : await slack.postMessage(channel, "Call wrap", blocks as never);

  const ts = (posted as { ts?: string })?.ts ?? null;
  if (ts) {
    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap_card_ts: ts, slack_channel: channel })
      .eq("id", session.id);
    return { channel, ts };
  }
  return null;
}

/**
 * Claim the row before touching anything external.
 *
 * A conditional update is what makes the button, a retry and a duplicate CALL_ENDED safe to race:
 * exactly one of them flips pending to writing and the others get zero rows back. Straight
 * `auto_send_state` precedent from the audit pitch lane.
 */
export async function claimWrap(sessionId: string): Promise<WrapSessionRow | null> {
  const { data } = await supabaseAdmin
    .from("call_coach_sessions")
    .update({ wrap_state: "writing" })
    .eq("id", sessionId)
    .in("wrap_state", ["pending", "failed"])
    .select("*")
    .maybeSingle();
  return (data as WrapSessionRow | null) ?? null;
}

/**
 * Everything 👍 does. Runs in waitUntil after the interaction has already been acknowledged,
 * because Zoho plus Graph plus a Slack post is comfortably past Slack's 3 second budget.
 */
export async function applyWrap(session: WrapSessionRow, approvedBy: string): Promise<void> {
  const wrap = session.wrap;
  const channel = session.slack_channel || process.env.AUDIT_CHANNEL_ID || "";
  const threadTs = session.wrap_card_ts || session.slack_thread_ts || "";
  const say = async (text: string) => {
    if (channel && threadTs) await slack.postThreadReply(channel, threadTs, text).catch(() => {});
  };

  if (!wrap || !session.contact_id) {
    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap_state: "failed", wrap_error: "no wrap or no record" })
      .eq("id", session.id);
    await say("⚠️ There is no write-up or no contact on this session, so nothing was written.");
    return;
  }

  const done: string[] = [];
  let failed: string | null = null;

  // ── 1. The CRM note. NOTE ONLY. ─────────────────────────────────────────
  //
  // ‼️ No field write, no stage change, ever. That is Matthew's explicit call
  // and it is the edit a future contributor will add "for convenience": a garbled transcript that
  // writes a paragraph into a note is recoverable, one that flips a lead to Not Interested is not.
  //
  // Skipped when a previous attempt already wrote it, so a Graph failure and a retry cannot
  // produce two notes for one call.
  if (!noteAlreadyWritten(session)) {
    try {
      const title = `Call ${new Date().toISOString().slice(0, 10)} — ${outcomeLabel(wrap.outcome)}`;
      const body = [
        wrap.noteText,
        wrap.nextStep ? `\nNext step: ${wrap.nextStep}${wrap.nextStepAt ? ` (${wrap.nextStepAt})` : ""}` : "",
        `\n(Written from the SRT Call Coach recording, approved by ${approvedBy}.)`,
      ]
        .filter(Boolean)
        .join("\n");

      const res = await addNote({
        contactId: session.contact_id ?? undefined,
        businessName: session.business_name ?? undefined,
        title,
        content: body,
        origin: "ai",
        actor: `call_coach:${approvedBy}`,
      });
      if (!res.ok) throw new Error("note was not written");

      await supabaseAdmin
        .from("call_coach_sessions")
        .update({ crm_note_at: new Date().toISOString() })
        .eq("id", session.id);
      done.push(`Note on ${session.business_name ?? session.contact_id}`);
    } catch (e) {
      failed = `Note failed: ${(e as Error).message}`;
    }
  } else {
    done.push("The note was already written on an earlier attempt, so it was not written twice");
  }

  // ── 2. The Outlook DRAFT. Never a send. ─────────────────────────────────
  let webLink: string | null = null;
  if (!failed && session.prospect_email) {
    try {
      const mailbox = process.env.OUTREACH_MAILBOX || undefined;
      const html = await bodyHtml(wrap.emailBody);
      const anchor = await resolveAnchor(session.audit_report_id);

      const draft = anchor
        ? await microsoft.createReplyDraft({
            messageId: anchor,
            mailbox,
            html,
          })
        : await microsoft.createDraft({
            mailbox,
            to: session.prospect_email,
            subject: wrap.emailSubject,
            body: html,
          });

      webLink = draft.webLink;
      await supabaseAdmin
        .from("call_coach_sessions")
        .update({ draft_message_id: draft.id, draft_web_link: draft.webLink })
        .eq("id", session.id);
      done.push(anchor ? "Outlook reply draft on the existing thread" : "Outlook draft (new email, no thread found)");
    } catch (e) {
      failed = `Outlook draft failed: ${(e as Error).message}`;
    }
  } else if (!session.prospect_email) {
    done.push("No email address on this record, so no draft was made");
  }

  // ── 3. Say what happened, and show the draft. ───────────────────────────
  if (failed) {
    await supabaseAdmin.from("call_coach_sessions").update({ wrap_state: "failed", wrap_error: failed }).eq("id", session.id);
    await say(`⚠️ ${failed}\n\nWhat did land: ${done.join("; ") || "nothing"}. The buttons are still live, try again.`);
    return;
  }

  await supabaseAdmin.from("call_coach_sessions").update({ wrap_state: "done", wrap_error: null }).eq("id", session.id);

  await say(
    [
      `:white_check_mark: ${done.join(" · ")}`,
      webLink ? `<${webLink}|Open the draft in Outlook>` : "",
      session.prospect_email ? "" : null,
      webLink ? "\n*The draft, as written. It has NOT been sent.*" : "",
      webLink ? `*Subject:* ${wrap.emailSubject}` : "",
      webLink ? "```" : "",
      webLink ? wrap.emailBody : "",
      webLink ? "```" : "",
    ]
      .filter((l) => l !== "" && l !== null)
      .join("\n")
  );
}

/** Reply onto the real thread when we can find it. No anchor is not fatal, it just sends fresh. */
async function resolveAnchor(auditReportId: string | null): Promise<string | null> {
  if (!auditReportId) return null;
  const { data } = await supabaseAdmin.from("audit_reports").select("*").eq("id", auditReportId).maybeSingle();
  if (!data) return null;
  const anchor = await resolveReplyAnchor(data as AuditReportRow).catch(() => null);
  return anchor?.messageId ?? null;
}

async function bodyHtml(text: string): Promise<string> {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px 0">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const sig = await auditSignatureHtml().catch(() => "");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${paras}${sig}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
