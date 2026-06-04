import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt, handleMarketingEmailCancel } from "@/lib/ai-intel/execute-action";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { buildSuggestionBlocks } from "@/lib/imessage-suggestion";

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
  console.log("[slack/actions] hit", { type: payload.type, action: action?.action_id });
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
    case "sms_create_channel":
      return createSmsChannelFromSlack({ slackTs, channel, userId, contactId: action.value });
    case "imsg_regenerate":
      return regenerateSuggestion({ slackTs, channel });
    case "imsg_remix":
      return openRemixModal({ slackTs, channel, triggerId: payload.trigger_id ?? "" });
    case "sequence_cancel":
      return sequenceCancel({ channel, userId, slackTs, actionValue: action.value });
    case "sequence_cat_mca":
    case "sequence_cat_sba":
    case "sequence_cat_loc":
    case "sequence_cat_cre":
      return sequenceUpdateCategory({ channel, userId, slackTs, actionValue: action.value });
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
  const { action, error } = await resolvePendingAction({
    slackTs: args.slackTs,
    status: "cancelled",
    approvedBy: args.userId,
  });

  if (error) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not cancel: ${error}`);
    return NextResponse.json({ ok: true });
  }

  // If this was a sequence email draft, reset the enrollment so it retries in 3 days
  if (action?.action_type === "send_marketing_email" && action.payload.enrollment_id) {
    await handleMarketingEmailCancel(action.payload);
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
  if (payload.view?.callback_id === "imsg_remix_submit") {
    return handleRemixSubmit(payload);
  }
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

// ── iMessage reply suggestions (🔄 Regenerate / 🎛 Remix) ───────────────────
// The live suggestion lives in sms_pending_drafts keyed by slack_ts. Regenerate
// re-runs the draft engine on the latest inbound message; Remix does the same
// with a free-text steer from a modal. Both update the card in place. There is
// no send — Matthew copies the reply into Messages on his Mac.

interface PendingSuggestion {
  conversation_id: string;
  slack_channel_id: string;
  regenerate_count: number | null;
}

async function loadSuggestion(slackTs: string): Promise<PendingSuggestion | null> {
  const { data } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, slack_channel_id, regenerate_count")
    .eq("slack_ts", slackTs)
    .maybeSingle();
  return (data as PendingSuggestion | null) ?? null;
}

async function getLastInbound(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sms_messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.body as string | undefined) ?? null;
}

async function applyNewDraft(channel: string, slackTs: string, draft: string, prevCount: number): Promise<void> {
  const count = prevCount + 1;
  await slack.updateMessage(channel, slackTs, `💬 Suggested reply: ${draft}`, buildSuggestionBlocks(draft, count));
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ draft_body: draft, regenerate_count: count })
    .eq("slack_ts", slackTs);
}

async function regenerateSuggestion(args: { slackTs: string; channel: string }): Promise<NextResponse> {
  const s = await loadSuggestion(args.slackTs);
  if (!s) return NextResponse.json({ ok: true });
  const lastInbound = await getLastInbound(s.conversation_id);
  if (!lastInbound) return NextResponse.json({ ok: true });
  const draft = await draftSmsReply(s.conversation_id, lastInbound);
  if (!draft) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Couldn't regenerate a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(args.channel, args.slackTs, draft, (s.regenerate_count ?? 0));
  return NextResponse.json({ ok: true });
}

async function openRemixModal(args: { slackTs: string; channel: string; triggerId: string }): Promise<NextResponse> {
  if (!args.triggerId) return NextResponse.json({ ok: true });
  const token = process.env.SLACK_BOT_TOKEN || "";
  const view = {
    type: "modal",
    callback_id: "imsg_remix_submit",
    private_metadata: JSON.stringify({ slackTs: args.slackTs, channel: args.channel }),
    title: { type: "plain_text", text: "Remix reply" },
    submit: { type: "plain_text", text: "Regenerate" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "instr_block",
        label: { type: "plain_text", text: "How should I adjust it?" },
        element: {
          type: "plain_text_input",
          action_id: "instr_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "e.g. shorter · more urgent · answer their pricing question" },
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
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not open remix: ${json.error}`);
  }
  return NextResponse.json({ ok: true });
}

async function handleRemixSubmit(payload: SlackInteractivePayload): Promise<NextResponse> {
  const meta = JSON.parse(payload.view?.private_metadata ?? "{}") as { slackTs?: string; channel?: string };
  if (!meta.slackTs || !meta.channel) return NextResponse.json({ ok: true });
  const instruction = payload.view?.state.values.instr_block?.instr_input?.value ?? "";

  const s = await loadSuggestion(meta.slackTs);
  if (!s) return NextResponse.json({ ok: true });
  const lastInbound = await getLastInbound(s.conversation_id);
  if (!lastInbound) return NextResponse.json({ ok: true });

  const draft = await draftSmsReply(s.conversation_id, lastInbound, instruction || undefined);
  if (!draft) {
    await slack.postThreadReply(meta.channel, meta.slackTs, "⚠️ Couldn't remix a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(meta.channel, meta.slackTs, draft, (s.regenerate_count ?? 0));
  return NextResponse.json({ response_action: "clear" });
}

async function createSmsChannelFromSlack(args: {
  slackTs: string;
  channel: string;
  userId: string;
  contactId: string;
}): Promise<NextResponse> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, phone, mobile_phone, business_name, zoho_lead_id")
    .eq("id", args.contactId)
    .maybeSingle();

  if (!contact) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ Contact not found.");
    return NextResponse.json({ ok: true });
  }

  const digits = (contact.phone || contact.mobile_phone || "").replace(/\D/g, "");
  if (!digits) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ No phone number on this contact.");
    return NextResponse.json({ ok: true });
  }
  const normalizedPhone = `+1${digits.slice(-10)}`;

  const { data: convo } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      { phone: normalizedPhone, contact_id: contact.id },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id, slack_channel_name")
    .maybeSingle();

  if (!convo) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ Could not create SMS conversation record.");
    return NextResponse.json({ ok: true });
  }

  const displayName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Lead";

  const result = await ensureSmsChannel({
    conversationId: convo.id,
    phone: normalizedPhone,
    displayName,
    contactId: contact.id,
    zohoLeadId: contact.zoho_lead_id ?? null,
    businessName: contact.business_name ?? null,
  });

  const msg = result.created
    ? `✅ SMS channel created: <#${result.channelId}>`
    : `ℹ️ SMS channel already exists: <#${result.channelId}>`;

  await slack.postEphemeral(args.channel, args.userId, msg);
  return NextResponse.json({ ok: true });
}

async function sequenceCancel(args: {
  channel: string; userId: string; slackTs: string; actionValue: string;
}): Promise<NextResponse> {
  let enrollmentId: string | undefined;
  try {
    enrollmentId = (JSON.parse(args.actionValue) as { enrollment_id?: string }).enrollment_id;
  } catch { /* ignore */ }

  if (!enrollmentId) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Could not parse enrollment ID.");
    return NextResponse.json({ ok: true });
  }

  const { data: enrollment } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ status: "stopped", stopped_at: new Date().toISOString(), stop_reason: "cancelled_by_slack" })
    .eq("id", enrollmentId)
    .select("contact_name, contact_id")
    .single();

  if (!enrollment) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Enrollment not found or already stopped.");
    return NextResponse.json({ ok: true });
  }

  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `🚫 Workflow cancelled for *${enrollment.contact_name ?? "Contact"}* by <@${args.userId}>. No more emails will be sent.`
  );
  return NextResponse.json({ ok: true });
}

const CATEGORY_LABELS: Record<string, string> = {
  mca: "💳 MCA", sba: "🏛 SBA", loc: "💰 Line of Credit", cre: "🏢 Commercial RE",
};

async function sequenceUpdateCategory(args: {
  channel: string; userId: string; slackTs: string; actionValue: string;
}): Promise<NextResponse> {
  let enrollmentId: string | undefined;
  let category: string | undefined;
  try {
    const parsed = JSON.parse(args.actionValue) as { enrollment_id?: string; category?: string };
    enrollmentId = parsed.enrollment_id;
    category = parsed.category;
  } catch { /* ignore */ }

  if (!enrollmentId || !category) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Could not parse action data.");
    return NextResponse.json({ ok: true });
  }

  const { data: enrollment } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ category })
    .eq("id", enrollmentId)
    .eq("status", "active")
    .select("contact_name")
    .single();

  if (!enrollment) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Enrollment not found or not active.");
    return NextResponse.json({ ok: true });
  }

  const label = CATEGORY_LABELS[category] ?? category.toUpperCase();
  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `✅ Category updated to ${label} for *${enrollment.contact_name ?? "Contact"}* by <@${args.userId}>.`
  );
  return NextResponse.json({ ok: true });
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
