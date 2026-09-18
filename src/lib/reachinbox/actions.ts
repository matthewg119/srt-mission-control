// The two things a campaign-reply card can do, written once.
//
// ‼️ THESE ARE THE ONLY IMPLEMENTATIONS. The Slack buttons call them, and so do the agent tools
// exposed in the prospect's thread. A button that reimplements what a tool does (or the reverse)
// is how one of the two quietly stops matching the other.

import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { microsoft } from "@/lib/microsoft";
import { wrapWithSignature } from "@/config/email-signature";
import { formatLintFindings } from "@/lib/audit-engine/draft-linter";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { handleAuditThreadReply } from "@/lib/audit-engine/thread-assistant";
import { latestInboundBody, updateProspect } from "@/lib/followup-operator/prospects";
import { displayName } from "@/lib/followup-operator/digest";
import type { OutreachProspectRow } from "@/lib/followup-operator/types";
import { draftCampaignReply } from "./draft-reply";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

async function say(p: OutreachProspectRow, text: string, blocks?: SlackBlock[]): Promise<void> {
  if (!p.slack_channel_id || !p.slack_thread_ts) return;
  await slack.postThreadReply(p.slack_channel_id, p.slack_thread_ts, text, blocks);
}

export type DraftOutcome =
  | "drafted"
  | "no_reply_text"
  | "rejected"
  | "not_configured"
  | "no_thread"
  | "error";

/**
 * Draft the answer into Matthew's Outlook Drafts, and put the approval card IN THE PROSPECT'S
 * THREAD pointing at it.
 *
 * Sends nothing. The draft waits in his mailbox where he can rewrite it, and the existing
 * ai_approve / ai_edit / ai_cancel buttons own everything after that, which is why this function
 * has no send path of its own to get wrong.
 */
export async function runDraftForProspect(p: OutreachProspectRow): Promise<DraftOutcome> {
  if (!p.slack_channel_id || !p.slack_thread_ts) return "no_thread";

  if (!process.env.ANTHROPIC_API_KEY) {
    await say(p, "AI is not configured, so I cannot draft. ANTHROPIC_API_KEY is unset.");
    return "not_configured";
  }

  const replyText = await latestInboundBody(p.id);
  if (!replyText) {
    // ‼️ REFUSE RATHER THAN GUESS. Drafting an answer to words nobody has read is the one thing
    // this lane must never do: it reads fluent and is about nothing they actually said.
    await say(
      p,
      "I do not have their words yet, so there is nothing to answer. Press *Paste their reply*, drop in what they wrote, then press *Draft a reply* again."
    );
    return "no_reply_text";
  }

  const gated = await draftCampaignReply({ prospect: p, replyText });

  if (!gated.draft) {
    // Show the work. A refusal that prints nothing is unfixable from Slack.
    await say(p, "The draft was rejected by the linter.", [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            ":no_entry: *I could not get a clean draft past the linter.*",
            formatLintFindings(gated.findings),
            gated.lastRejected
              ? `\n_Last rejected attempt:_\n>${gated.lastRejected.body.slice(0, 600)}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      } as SlackBlock,
    ]);
    return "rejected";
  }

  const { subject, body } = gated.draft;

  // ‼️ THE DRAFT IS PLACED IN MATTHEW'S OWN MAILBOX, NOT HELD IN THE DATABASE.
  //
  // He asked to review these where he reads mail. So the email is created as a real Outlook draft
  // in the connected account, the Slack card links straight to it, and approving fires THAT draft
  // byte for byte (see sendEmail in execute-action.ts). Anything he rewrites in Outlook is
  // therefore the thing that actually ships, which is not true of a body held in a jsonb column.
  //
  // The signature is baked in here on purpose: sendDraft sends the bytes as they are and appends
  // nothing, so a draft without it would go out unsigned.
  let draft: { id: string; webLink: string } | null = null;
  try {
    draft = await microsoft.createDraft({
      // No mailbox means /me, which is the connected account: matthew@srtagency.com.
      to: p.email,
      subject,
      body: wrapWithSignature(body),
    });
  } catch (err) {
    // Graph being down must not cost him the draft entirely. Fall back to the older path, where
    // the body lives on the card and approving composes and sends it.
    console.error("[reachinbox] createDraft failed, falling back to compose on approve:", err);
  }

  const summary = [
    `*${displayName(p)}* replied to the campaign. Here is the answer.`,
    `To: ${p.email}`,
    `Subject: ${subject}`,
    "",
    body,
  ].join("\n");

  const headerText = draft
    ? `:pencil: Draft ready in your inbox for *${displayName(p)}*`
    : `:pencil: Draft ready for *${displayName(p)}*`;

  const elements: Array<Record<string, unknown>> = [
    {
      type: "button",
      text: { type: "plain_text", text: ":thumbsup: Approve and send" },
      style: "primary",
      action_id: "ai_approve",
      value: "pending",
    },
    {
      type: "button",
      text: { type: "plain_text", text: ":pencil2: Edit here" },
      action_id: "ai_edit",
      value: "pending",
    },
    {
      type: "button",
      text: { type: "plain_text", text: ":no_entry: Cancel" },
      style: "danger",
      action_id: "ai_cancel",
      value: "pending",
    },
  ];
  if (draft?.webLink) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: ":envelope: Open in Outlook" },
      url: draft.webLink,
    });
  }

  const footer = draft
    ? "It is sitting in your Drafts. Edit it in Outlook if you want, then press Approve and send and exactly what is in the draft goes out. Editing here instead replaces the draft."
    : "Outlook would not take the draft, so this one is held here. Approving composes and sends it.";

  const res = await postApprovalRequest({
    summary,
    channel: p.slack_channel_id,
    // Lands IN this prospect's thread rather than at the top of the channel.
    threadTs: p.slack_thread_ts,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${headerText}\n${summary}` } },
      { type: "actions", elements },
      { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
    ],
    payload: {
      // send_email, never send_marketing_email: the latter is blocked at the door of
      // postApprovalRequest because email marketing is paused.
      action_type: "send_email",
      to: p.email,
      subject,
      body,
      is_html: false,
      contact_id: p.contact_id ?? undefined,
      outlook_draft_id: draft?.id,
      outlook_draft_url: draft?.webLink,
      // ‼️ from_mailbox IS DELIBERATELY UNSET AND MUST STAY UNSET. It is handed straight to
      // Graph, and undefined means /me, the connected account, which is matthew@srtagency.com.
      // It also has to match the mailbox the draft was created in, or sendDraft looks for it in
      // the wrong place.
      //
      // requires_matthew is unset on purpose too: isMatthew() is only as good as
      // MATTHEW_SLACK_USER_ID, and the flag would make the card unapprovable if that is wrong.
      note: { title: "Campaign reply drafted", content: `${subject}\n\n${body}` },
    },
  });

  if (!res.slackTs) {
    // The card is the only way to approve, so a card that never posted means the draft would sit
    // in Outlook with nothing pointing at it. Say where it is.
    await say(
      p,
      draft
        ? `I could not post the approval card, but the draft is in your Outlook Drafts: <${draft.webLink}|open it>.`
        : "I drafted the reply but could not post the approval card. Check the logs."
    );
    return "error";
  }
  return "drafted";
}

export type LoomOutcome =
  | "wizard_opened"
  | "no_website"
  | "no_engine"
  | "audit_failed"
  | "not_done"
  | "no_thread"
  | "error";

interface AuditRow {
  id: string;
  status: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
}

const AUDIT_COLS = "id, status, slack_channel_id, slack_thread_ts";

async function findUsableAudit(p: OutreachProspectRow): Promise<AuditRow | null> {
  if (p.audit_report_id) {
    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select(AUDIT_COLS)
      .eq("id", p.audit_report_id)
      .maybeSingle();
    const row = data as AuditRow | null;
    if (row?.status === "done" && row.slack_thread_ts) return row;
  }

  if (p.contact_id) {
    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select(AUDIT_COLS)
      .eq("contact_id", p.contact_id)
      .eq("status", "done")
      .not("slack_thread_ts", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as AuditRow | null;
    if (row) return row;
  }
  return null;
}

/**
 * Get this prospect to the Loom script.
 *
 * ‼️ THIS IS A DOORWAY, NOT AN IMPLEMENTATION. The wizard lives in thread-assistant.ts and is
 * reached exactly the way the CRM's own Loom button reaches it: post a breadcrumb into the audit
 * thread, then hand `loom` to handleAuditThreadReply. Copying any part of the wizard here would be
 * a second copy to keep in step with the first.
 *
 * The audit is the price of entry. Every Loom mechanism in this repo keys on an audit_reports row,
 * and a campaign replier arrives without one.
 */
export async function runLoomForProspect(p: OutreachProspectRow): Promise<LoomOutcome> {
  if (!p.slack_channel_id || !p.slack_thread_ts) return "no_thread";

  let audit = await findUsableAudit(p);

  if (!audit) {
    // The engine runs on OpenAI. Empty in production today, so name the missing piece rather than
    // letting the button look broken for an unrelated reason.
    if (!process.env.OPENAI_API_KEY) {
      await say(
        p,
        "The Loom needs an audit first, and the audit engine has no key. `OPENAI_API_KEY` is empty in production. Set it and press *Loom* again."
      );
      return "no_engine";
    }

    // createCampaignProspect leaves website null for a freemail sender, and there is no company
    // name on this lane either. Refuse rather than audit a guess: a run against the wrong business
    // produces a confident report about somebody else.
    if (!p.website) {
      await say(
        p,
        [
          `I cannot audit *${p.email}*. That is a personal email domain, so there is no site to crawl and no business name on this row to research.`,
          p.contact_id
            ? `Add their website on the lead <${appUrl()}/dashboard/leads/${p.contact_id}|here>, then press *Loom* again.`
            : "Add their website to the prospect, then press *Loom* again.",
        ].join("\n")
      );
      return "no_website";
    }

    await say(
      p,
      `:hourglass_flowing_sand: No audit for *${displayName(p)}* yet, so I am running one first. That takes four to six minutes. If the wizard is not open when it finishes, press *Loom* again and I will pick up the finished report.`
    );

    const run = await runAuditPipeline({
      website: p.website,
      requesterName: p.name ?? undefined,
      // ‼️ LOAD-BEARING TWICE OVER, DO NOT DROP IT. It arms findRecentReport's 30 minute
      // double-submit guard (which returns null on a falsy email, so without it two presses buy
      // two full runs), AND enrolLoomFollowup reads requester_email to enrol this prospect on the
      // D+3 / D+7 ladder. Without it the wizard completes and enrols nobody, silently.
      requesterEmail: p.email,
      contactId: p.contact_id ?? undefined,
      leadSource: "reachinbox",
      // There is no thread here to ask Matthew which city they are in. Same call the CRM button
      // and the Meta lead route make.
      allowLowConfidenceCity: true,
      onReportCreated: async (reportId) => {
        await updateProspect(p.id, { audit_report_id: reportId });
      },
      onError: async (message) => {
        await say(p, `:warning: The audit failed: ${message}`);
      },
    });

    if (!run.ok || !run.reportId) return "audit_failed";

    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select(AUDIT_COLS)
      .eq("id", run.reportId)
      .maybeSingle();
    audit = data as AuditRow | null;
  }

  if (!audit || audit.status !== "done" || !audit.slack_thread_ts || !audit.slack_channel_id) {
    await say(
      p,
      `:warning: The audit is in state \`${audit?.status ?? "unknown"}\`, and the Loom wizard needs a finished report. Look in #ai-visibility-audits, then press *Loom* again.`
    );
    return "not_done";
  }

  await updateProspect(p.id, { audit_report_id: audit.id });

  await slack.postThreadReply(
    audit.slack_channel_id,
    audit.slack_thread_ts,
    ":arrow_forward: *Loom*, run from the campaign reply card in #vektor-email-director"
  );
  await handleAuditThreadReply({
    channel: audit.slack_channel_id,
    threadTs: audit.slack_thread_ts,
    text: "loom",
  });

  await say(
    p,
    `:movie_camera: The Loom wizard is open in the audit thread: <${slackThreadLink(
      audit.slack_channel_id,
      audit.slack_thread_ts
    )}|open it>. Pick the customer, then the picture, and the script comes back there.`
  );
  return "wizard_opened";
}
