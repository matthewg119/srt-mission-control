import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt } from "@/lib/ai-intel/execute-action";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLACK_API = "https://slack.com/api";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (signingSecret && timestamp && signature) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return NextResponse.json({ error: "stale_request" }, { status: 403 });
    }
    if (!slack.verifySignature(signingSecret, timestamp, rawBody, signature)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 403 });
    }
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ error: "no_payload" }, { status: 400 });
  }

  const payload = JSON.parse(payloadRaw) as SlackInteractivePayload;

  if (payload.type === "block_actions") {
    return handleBlockAction(payload);
  }

  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  return NextResponse.json({ ok: true });
}

interface SlackInteractivePayload {
  type: string;
  user: { id: string; username: string };
  trigger_id?: string;
  view?: {
    callback_id: string;
    private_metadata?: string;
    state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
  };
  actions?: Array<{ action_id: string; value: string; block_id: string }>;
  channel?: { id: string };
  message?: { ts: string; text: string };
  response_url?: string;
  container?: { message_ts?: string; channel_id?: string };
}

async function handleBlockAction(payload: SlackInteractivePayload): Promise<NextResponse> {
  const action = payload.actions?.[0];
  if (!action) return NextResponse.json({ ok: true });

  const slackTs = payload.container?.message_ts ?? payload.message?.ts ?? "";
  const channel = payload.container?.channel_id ?? payload.channel?.id ?? "";
  const userId = payload.user.id;

  if (!slackTs) return NextResponse.json({ ok: true });

  switch (action.action_id) {
    case "ai_approve":
      return approveAction({ slackTs, channel, userId });
    case "ai_cancel":
      return cancelAction({ slackTs, channel, userId });
    case "ai_edit":
      return openEditModal({ slackTs, channel, userId, triggerId: payload.trigger_id ?? "" });
    default:
      return NextResponse.json({ ok: true });
  }
}

async function approveAction(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { action, error } = await resolvePendingAction({
    slackTs: args.slackTs,
    status: "approved",
    approvedBy: args.userId,
  });

  if (error || !action) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not approve: ${error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  if (action.payload.requires_matthew && !isMatthew(args.userId)) {
    await supabaseAdmin.from("pending_slack_actions").update({ status: "pending", approved_by: null, resolved_at: null }).eq("id", action.id);
    await slack.postThreadReply(args.channel, args.slackTs, `🔒 This action requires Matthew's approval (over $50k or deal submission). <@${args.userId}>, your approval was reverted.`);
    return NextResponse.json({ ok: true });
  }

  const result = await executePendingAction({
    actionId: action.id,
    actionType: action.action_type,
    payload: action.payload,
    approvedBy: args.userId,
  });

  if (action.payload.was_approved_as_is !== false) {
    await supabaseAdmin.from("fine_tune_examples").insert({
      trigger_type: inferTriggerType(action.action_type),
      input_context: { slack_ts: args.slackTs, channel: args.channel },
      ai_draft: action.payload.body ?? JSON.stringify(action.payload).slice(0, 1000),
      human_correction: null,
      rep_id: args.userId,
      was_approved_as_is: true,
    });
  }

  await supabaseAdmin
    .from("ai_decisions")
    .update({ was_approved: result.ok, approved_by: args.userId, slack_ts: args.slackTs })
    .match({ slack_ts: args.slackTs });

  await postExecutionReceipt({
    channel: args.channel,
    threadTs: args.slackTs,
    summary: result.ok
      ? `Executed by <@${args.userId}>. ${summarizeResult(action.action_type, result.details)}`
      : `Execution failed: ${result.error}`,
    success: result.ok,
  });

  return NextResponse.json({ ok: true });
}

async function cancelAction(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { error } = await resolvePendingAction({
    slackTs: args.slackTs,
    status: "cancelled",
    approvedBy: args.userId,
  });

  if (error) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not cancel: ${error}`);
    return NextResponse.json({ ok: true });
  }

  await slack.postThreadReply(args.channel, args.slackTs, `🚫 Cancelled by <@${args.userId}>. AI will not act on this.`);
  return NextResponse.json({ ok: true });
}

async function openEditModal(args: { slackTs: string; channel: string; userId: string; triggerId: string }): Promise<NextResponse> {
  if (!args.triggerId) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No trigger_id — cannot open edit modal.");
    return NextResponse.json({ ok: true });
  }

  const { data: existing } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, action_type, payload")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  if (!existing) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No pending action found for this message.");
    return NextResponse.json({ ok: true });
  }

  const payload = existing.payload as PendingActionPayload;
  const currentBody = payload.body ?? "";
  const currentSubject = payload.subject ?? "";

  const token = process.env.SLACK_BOT_TOKEN || "";
  const view = {
    type: "modal",
    callback_id: "ai_edit_submit",
    private_metadata: JSON.stringify({ slackTs: args.slackTs, channel: args.channel, pendingId: existing.id }),
    title: { type: "plain_text", text: "Edit AI draft" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "subject_block",
        label: { type: "plain_text", text: "Subject" },
        element: {
          type: "plain_text_input",
          action_id: "subject_input",
          initial_value: currentSubject,
        },
        optional: payload.action_type !== "send_email" && payload.action_type !== "reply_funder" && payload.action_type !== "submit_deal",
      },
      {
        type: "input",
        block_id: "body_block",
        label: { type: "plain_text", text: "Body" },
        element: {
          type: "plain_text_input",
          action_id: "body_input",
          initial_value: currentBody,
          multiline: true,
        },
      },
    ],
  };

  const res = await fetch(`${SLACK_API}/views.open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: args.triggerId, view }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not open edit modal: ${json.error}`);
  }
  return NextResponse.json({ ok: true });
}

async function handleViewSubmission(payload: SlackInteractivePayload): Promise<NextResponse> {
  if (payload.view?.callback_id !== "ai_edit_submit") {
    return NextResponse.json({ ok: true });
  }
  const metadata = JSON.parse(payload.view.private_metadata ?? "{}") as { slackTs?: string; channel?: string; pendingId?: string };
  if (!metadata.slackTs || !metadata.channel) return NextResponse.json({ ok: true });

  const values = payload.view.state.values;
  const editedSubject = values.subject_block?.subject_input?.value ?? "";
  const editedBody = values.body_block?.body_input?.value ?? "";
  const userId = payload.user.id;

  const { data: existing } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, action_type, payload, merchant_id, zoho_id")
    .eq("slack_ts", metadata.slackTs)
    .maybeSingle();

  if (!existing) return NextResponse.json({ ok: true });

  const originalPayload = existing.payload as PendingActionPayload;
  const editedPayload: PendingActionPayload = {
    ...originalPayload,
    subject: editedSubject || originalPayload.subject,
    body: editedBody,
    was_approved_as_is: false,
  };

  const { action, error } = await resolvePendingAction({
    slackTs: metadata.slackTs,
    status: "edited",
    approvedBy: userId,
    editedPayload,
  });

  if (error || !action) {
    await slack.postThreadReply(metadata.channel, metadata.slackTs, `⚠️ Could not save edits: ${error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  if (action.payload.requires_matthew && !isMatthew(userId)) {
    await supabaseAdmin.from("pending_slack_actions").update({ status: "pending" }).eq("id", action.id);
    await slack.postThreadReply(metadata.channel, metadata.slackTs, `🔒 Matthew must approve (over $50k).`);
    return NextResponse.json({ ok: true });
  }

  await supabaseAdmin.from("fine_tune_examples").insert({
    trigger_type: inferTriggerType(action.action_type),
    input_context: { slack_ts: metadata.slackTs, channel: metadata.channel },
    ai_draft: originalPayload.body ?? JSON.stringify(originalPayload).slice(0, 1000),
    human_correction: editedBody,
    rep_id: userId,
    was_approved_as_is: false,
  });

  const result = await executePendingAction({
    actionId: action.id,
    actionType: action.action_type,
    payload: editedPayload,
    approvedBy: userId,
  });

  await postExecutionReceipt({
    channel: metadata.channel,
    threadTs: metadata.slackTs,
    summary: result.ok
      ? `✏️ Edited + executed by <@${userId}>. ${summarizeResult(action.action_type, result.details)}`
      : `Execution failed: ${result.error}`,
    success: result.ok,
  });

  return NextResponse.json({ response_action: "clear" });
}

function isMatthew(slackUserId: string): boolean {
  const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";
  return matthewId !== "" && slackUserId === matthewId;
}

function inferTriggerType(actionType: string): string {
  if (actionType === "reply_funder" || actionType === "submit_deal") return "deal_submission";
  return "merchant_state";
}

function summarizeResult(actionType: string, details?: Record<string, unknown>): string {
  if (!details) return "";
  if (actionType === "send_email" || actionType === "reply_funder") {
    return `Sent to ${details.to ?? "unknown"}.`;
  }
  if (actionType === "submit_deal") {
    return `Sent submission to ${details.to ?? "unknown"} (${details.attachments ?? 0} attachments).`;
  }
  if (actionType === "update_zoho") {
    return `Zoho updated (stage → ${details.stage ?? "n/a"}).`;
  }
  return "";
}
