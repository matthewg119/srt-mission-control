import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { CATEGORY_LABELS, isSequenceCategory } from "@/config/sequence-categories";
import { applyLeadDisposition } from "@/lib/lead-disposition";
import { DISPOSITION_BY_ACTION_ID } from "@/lib/lead-thread";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt, handleMarketingEmailCancel } from "@/lib/ai-intel/execute-action";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { draftSmsReply, type SuggestedFollowup } from "@/lib/sms-ai-engine";
import { buildSuggestionBlocks, autoSendEnabled, autoSendMinutes } from "@/lib/imessage-suggestion";
import { deliverPendingDraft } from "@/lib/imessage-send";
import { scheduleFollowup } from "@/lib/imessage-followups";
import { enqueueBridgeCommand, getBridgeStatus, formatBridgeStatusLine, type BridgeCommandType } from "@/lib/imessage-control";
import { markDraftSent } from "@/lib/clients/client-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The [Done] / [Skip] buttons go through setDeliveryStep, which runs the generator cascade.
// waitUntil keeps Slack's 3-second ack honest, but the deferred work is still bounded by this
// number -- so without it the artifacts get killed after the response, silently.
export const maxDuration = 300;

const SLACK_API = "https://slack.com/api";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  // Mandatory, not best-effort: these buttons mutate contact records and fire
  // conversion events to Meta, so an unsigned request must never reach a handler.
  if (!signingSecret) {
    console.error("[slack/actions] SLACK_SIGNING_SECRET not set — rejecting");
    return NextResponse.json({ error: "not_configured" }, { status: 403 });
  }
  if (!timestamp || !signature) {
    return NextResponse.json({ error: "unsigned_request" }, { status: 403 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return NextResponse.json({ error: "stale_request" }, { status: 403 });
  }
  // verifySignature uses timingSafeEqual, which throws when the two buffers
  // differ in length — i.e. on a malformed header rather than a wrong one.
  let signatureOk = false;
  try {
    signatureOk = slack.verifySignature(signingSecret, timestamp, rawBody, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return NextResponse.json({ error: "bad_signature" }, { status: 403 });
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
    case "apply_check":
      // "Check" on a standalone /apply card resolves + executes the pending
      // apply_followup action, exactly like Approve on a normal AI card.
      return approveAction({ slackTs, channel, userId });
    case "ai_cancel":
      return cancelAction({ slackTs, channel, userId });
    case "ai_edit":
      return openEditModal({ slackTs, channel, userId, triggerId: payload.trigger_id ?? "" });
    case "sms_create_channel":
      return createSmsChannelFromSlack({ slackTs, channel, userId, contactId: action.value });
    case "lead_dnq":
    case "lead_booked_call":
    case "lead_converted":
      return leadDispositionAction({ actionId: action.action_id, channel, userId, contactId: action.value });
    case "imsg_send":
      return sendSuggestion({ slackTs, channel, userId });
    case "imsg_regenerate":
      return regenerateSuggestion({ slackTs, channel });
    case "imsg_remix":
      return openRemixModal({ slackTs, channel, triggerId: payload.trigger_id ?? "" });
    case "imsg_hold":
      return holdSuggestion({ slackTs, channel, userId });
    case "imsg_cancel":
      return cancelManualSend({ slackTs, channel, userId });
    case "imsg_followup":
      return scheduleSuggestedFollowup({ slackTs, channel, userId });
    case "sequence_cancel":
      return sequenceCancel({ channel, userId, slackTs, actionValue: action.value });
    case "sequence_cat_aeo":
    case "sequence_cat_audit":
    case "sequence_cat_reengage":
    case "sequence_cat_client":
      return sequenceUpdateCategory({ channel, userId, slackTs, actionValue: action.value });
    case "bridge_restart":
    case "bridge_doctor":
    case "bridge_resync":
      return bridgeCommandAction({ actionId: action.action_id, channel, slackTs, userId });
    case "bridge_status":
      return bridgeStatusAction({ channel, slackTs });
    case "cc_wrap_approve":
    case "cc_wrap_discard":
    case "cc_wrap_attach":
      return callWrapAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userId,
        sessionId: action.value ?? "",
      });
    case "audit_send_now":
    case "audit_hold":
      return auditPitchAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userId,
        reportId: action.value ?? "",
      });
    case "fo_track":
    case "fo_ignore":
      return followupTrackAction({
        actionId: action.action_id,
        channel,
        slackTs,
        prospectId: action.value ?? "",
      });
    // The "Open in WhatsApp" button is a plain url button. Slack still posts an
    // interaction for it, and acknowledging without doing anything is correct: the tap
    // has already opened WhatsApp. Falling through to default would work, but naming it
    // stops the next person wondering whether a handler went missing.
    case "client_msg_open":
      return NextResponse.json({ ok: true });
    case "step_done":
    case "step_skip":
    case "step_problem":
      return deliveryStepAction({
        actionId: action.action_id,
        channel,
        messageTs: payload.container?.message_ts ?? "",
        userId,
        userName: payload.user?.username ?? null,
        value: action.value ?? "",
      });

    case "client_msg_sent":
      return clientMessageSentAction({
        channel,
        userId,
        value: action.value ?? "",
      });
    default:
      return NextResponse.json({ ok: true });
  }
}

/**
 * "Mark sent" on a client draft.
 *
 * The stamp is the only record that a message actually reached a client. Nothing here
 * sends anything: the free WhatsApp Business app has no API, so a human tapped the wa.me
 * link, sent it in WhatsApp, and is now telling Mission Control that they did.
 *
 * Replies ephemerally rather than editing the card. The draft body has to stay readable
 * afterwards, because the most common next question is "what exactly did I send them".
 */
async function clientMessageSentAction(args: {
  channel: string;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  const [clientId, draftKey] = args.value.split(":");
  if (!clientId || !draftKey) return NextResponse.json({ ok: true });

  waitUntil(
    markDraftSent(clientId, draftKey, args.userId)
      .then((res) =>
        slack.postEphemeral(
          args.channel,
          args.userId,
          res.alreadySent
            ? "That one was already marked sent."
            : res.ok
              ? "Marked sent."
              : "⚠️ Could not mark that sent. The draft row may have been cleared."
        )
      )
      .catch((e) => console.error("[slack/actions] client_msg_sent failed:", (e as Error).message))
  );

  return NextResponse.json({ ok: true });
}

/**
 * DNQ / Booked Call / Converted on a #hot-leads message.
 *
 * Slack kills the interaction at 3 seconds and every other handler here is
 * awaited before the 200, so the Supabase write plus the Meta CRM round-trip
 * goes in waitUntil. The message redraw happens inside applyLeadDisposition,
 * which is what the user actually sees confirm the click.
 */
async function leadDispositionAction(args: {
  actionId: string;
  channel: string;
  userId: string;
  contactId: string;
}): Promise<NextResponse> {
  const disposition = DISPOSITION_BY_ACTION_ID[args.actionId];
  if (!disposition || !args.contactId) return NextResponse.json({ ok: true });

  waitUntil(
    applyLeadDisposition({
      contactId: args.contactId,
      disposition,
      slackUserId: args.userId,
    })
      .then(async (result) => {
        if (!result.ok) {
          await slack.postEphemeral(
            args.channel,
            args.userId,
            `⚠️ Could not record that outcome: ${result.reason ?? "unknown"}`
          );
          return;
        }
        // Only surface the Meta half when it failed on a lead that should have
        // reported. Success is already visible in the redrawn message.
        if (!result.metaSent && result.reason !== "no_fb_lead_id") {
          await slack.postEphemeral(
            args.channel,
            args.userId,
            `Outcome saved, but Meta did not accept the conversion event: ${result.reason ?? "unknown"}`
          );
        }
      })
      .catch((err) =>
        console.error("[slack/actions] lead disposition failed:", err instanceof Error ? err.message : err)
      )
  );

  return NextResponse.json({ ok: true });
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

  // Dual-surface reconcile: an email approved here may also be sitting in
  // textwin.ai as a 'suggested' email_outbox bubble (shared draft_key). Cancel
  // the twin so it can't be re-sent from the desktop / extension.
  const draftKey = (action.payload as { draft_key?: string }).draft_key;
  if (result.ok && draftKey) {
    await supabaseAdmin
      .from("email_outbox")
      .update({ status: "cancelled" })
      .eq("draft_key", draftKey)
      .in("status", ["suggested", "pending"])
      .then(undefined, (e) => console.warn("[slack/actions] twin email_outbox cancel failed:", e?.message));
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
        optional: payload.action_type !== "send_email",
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

async function applyNewDraft(
  channel: string,
  slackTs: string,
  draft: string,
  prevCount: number,
  followup?: SuggestedFollowup | null
): Promise<void> {
  const count = prevCount + 1;
  const fu = followup ?? null;
  await slack.updateMessage(channel, slackTs, `💬 Suggested reply: ${draft}`, buildSuggestionBlocks(draft, count, fu));
  // A new draft gets a fresh auto-send window (created_at reset too, so the
  // "lead replied again" guard compares against this regeneration). The follow-up
  // suggestion is refreshed to match the new draft (cleared when none).
  const armed = autoSendEnabled();
  const autoSendAt = armed
    ? new Date(Date.now() + autoSendMinutes() * 60 * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({
      draft_body: draft,
      regenerate_count: count,
      created_at: new Date().toISOString(),
      auto_send_at: autoSendAt,
      auto_send_status: armed ? "pending" : "cancelled",
      suggested_followup_days: fu?.days ?? null,
      suggested_followup_reason: fu?.reason ?? null,
    })
    .eq("slack_ts", slackTs);
}

// ✋ Hold — cancel the auto-send timer for this draft and update the card.
// The suggestion stays available; it just won't fire on its own.
async function holdSuggestion(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("draft_body")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ auto_send_status: "cancelled" })
    .eq("slack_ts", args.slackTs);

  const body = (draftRow?.draft_body as string | undefined) ?? "";
  await slack.updateMessage(
    args.channel,
    args.slackTs,
    `✋ Auto-send held by <@${args.userId}>.${body ? `\n\`\`\`${body}\`\`\`` : ""}`
  );
  return NextResponse.json({ ok: true });
}

// ✋ Cancel — Matthew dismissed the "Send this?" confirm for a reply he typed into the
// channel. Drop the live draft and retire the card so nothing goes out.
async function cancelManualSend(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("draft_body")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  await supabaseAdmin.from("sms_pending_drafts").delete().eq("slack_ts", args.slackTs);

  const body = (draftRow?.draft_body as string | undefined) ?? "";
  await slack.updateMessage(
    args.channel,
    args.slackTs,
    `✋ Not sent — held by <@${args.userId}>.${body ? `\n\`\`\`${body}\`\`\`` : ""}`
  );
  return NextResponse.json({ ok: true });
}

// 📅 Follow-up — one-click schedule the proposed follow-up NOW (without sending the
// reply). Loads the pending draft for its conversation + suggested_followup_*,
// resolves the contact, schedules via the shared follow-up system, then clears the
// suggested_followup_* fields so the send path does NOT also auto-create it.
async function scheduleSuggestedFollowup(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, suggested_followup_days, suggested_followup_reason")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  const days = (draftRow?.suggested_followup_days as number | null) ?? null;
  const reason = (draftRow?.suggested_followup_reason as string | null) ?? null;
  if (!draftRow?.conversation_id || !days || !reason) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No suggested follow-up to schedule.");
    return NextResponse.json({ ok: true });
  }

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("contact_id")
    .eq("id", draftRow.conversation_id as string)
    .maybeSingle();

  if (!conv?.contact_id) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No contact on this conversation — cannot schedule a follow-up.");
    return NextResponse.json({ ok: true });
  }

  const res = await scheduleFollowup({
    contactId: conv.contact_id as string,
    reason,
    dueDate: `in ${days} days`,
    createCrmTask: true,
  });

  if (!res.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not schedule follow-up: ${res.error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  // Clear the suggestion so the send path won't double-schedule it.
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ suggested_followup_days: null, suggested_followup_reason: null })
    .eq("slack_ts", args.slackTs);

  const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const when = due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  await slack.postThreadReply(args.channel, args.slackTs, `📅 Follow-up scheduled for ${when} by <@${args.userId}>: ${reason}`);
  return NextResponse.json({ ok: true });
}

async function regenerateSuggestion(args: { slackTs: string; channel: string }): Promise<NextResponse> {
  const s = await loadSuggestion(args.slackTs);
  if (!s) return NextResponse.json({ ok: true });
  const lastInbound = await getLastInbound(s.conversation_id);
  if (!lastInbound) return NextResponse.json({ ok: true });
  const { draft, suggestedFollowup } = await draftSmsReply(s.conversation_id, lastInbound);
  if (!draft) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Couldn't regenerate a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(args.channel, args.slackTs, draft, (s.regenerate_count ?? 0), suggestedFollowup);
  return NextResponse.json({ ok: true });
}

// ✅ Send — deliver the current suggested reply via the active transport.
// Gated by this explicit human click. With IMESSAGE_TRANSPORT='mac' (default) the
// reply is queued into sms_outbox and the Mac bridge delivers it (the bridge's
// is_from_me read loop then mirrors it into Slack + logs sms_messages, so we don't
// log here). With 'loopmessage' it sends immediately and dispatchOutbound logs the
// outbound. Either way the card is retired and the live suggestion cancelled.
async function sendSuggestion(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  await deliverPendingDraft(args);
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

  const { draft, suggestedFollowup } = await draftSmsReply(s.conversation_id, lastInbound, instruction || undefined);
  if (!draft) {
    await slack.postThreadReply(meta.channel, meta.slackTs, "⚠️ Couldn't remix a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(meta.channel, meta.slackTs, draft, (s.regenerate_count ?? 0), suggestedFollowup);
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

/**
 * Send or hold the pitch drafted for a public free-audit lead.
 *
 * Send fires the Outlook draft as-is, so any edit made in Outlook first goes out
 * with it. Hold parks the row, which also cancels the auto-send timer if that
 * switch is ever turned on.
 */
/**
 * The post-call wrap card: 👍 writes the CRM note and creates the Outlook draft.
 *
 * ‼️ Slack gives an interaction 3 seconds. The CRM plus Graph plus a Slack post is 2 to 5, so the
 * row is CLAIMED synchronously (which is what makes a retry safe) and the actual work runs in
 * waitUntil. Same shape as leadDispositionAction.
 */
async function callWrapAction(args: {
  actionId: string; channel: string; slackTs: string; userId: string; sessionId: string;
}): Promise<NextResponse> {
  if (!args.sessionId) return NextResponse.json({ ok: true });

  if (args.actionId === "cc_wrap_discard") {
    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap_state: "discarded" })
      .eq("id", args.sessionId)
      .neq("wrap_state", "done");
    await slack.postThreadReply(args.channel, args.slackTs, `🚫 Discarded by <@${args.userId}>. Nothing was written to the CRM.`);
    return NextResponse.json({ ok: true });
  }

  if (args.actionId === "cc_wrap_attach") {
    // Deliberately a plain instruction rather than a modal: attaching is rare, and the record id
    // is already in the CRM tab next to him. A modal here would be more code than value.
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      "🔍 Paste the contact URL for this call in this thread and I'll attach it, then the buttons come back."
    );
    return NextResponse.json({ ok: true });
  }

  const { claimWrap, applyWrap } = await import("@/lib/call-coach/wrap-card");
  const claimed = await claimWrap(args.sessionId);

  if (!claimed) {
    await slack.postThreadReply(args.channel, args.slackTs, "Already handled, nothing was written twice.");
    return NextResponse.json({ ok: true });
  }

  waitUntil(
    applyWrap(claimed, `slack:${args.userId}`).catch(async (e) => {
      console.error("[slack/actions] wrap apply failed:", (e as Error).message);
      await supabaseAdmin
        .from("call_coach_sessions")
        .update({ wrap_state: "failed", wrap_error: (e as Error).message })
        .eq("id", args.sessionId);
      await slack
        .postThreadReply(args.channel, args.slackTs, `⚠️ Wrap failed: ${(e as Error).message}. The buttons are still live.`)
        .catch(() => {});
    })
  );

  return NextResponse.json({ ok: true });
}

async function auditPitchAction(args: {
  actionId: string; channel: string; slackTs: string; userId: string; reportId: string;
}): Promise<NextResponse> {
  if (!args.reportId) return NextResponse.json({ ok: true });

  const { sendAuditPitch } = await import("@/lib/audit-engine/lead-pitch");

  if (args.actionId === "audit_hold") {
    await supabaseAdmin
      .from("audit_reports")
      .update({ auto_send_state: "held", auto_send_at: null })
      .eq("id", args.reportId)
      .neq("auto_send_state", "sent");
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      `✋ Held by <@${args.userId}>. The draft is still in your Outlook, nothing will send itself.`
    );
    return NextResponse.json({ ok: true });
  }

  const res = await sendAuditPitch(args.reportId, `slack:${args.userId}`);
  const message =
    res.outcome === "sent"
      ? `🚀 Sent by <@${args.userId}>. Enrolled in the follow-up ladder, next touch tomorrow.`
      : res.outcome === "already_sent"
        ? "✅ Already sent, nothing to do."
        : res.outcome === "held"
          ? "✋ This one is on hold. Un-hold it in Outlook and send from there."
          : res.outcome === "no_draft"
            ? "⚠️ No Outlook draft on this report, so there is nothing to send."
            : `⚠️ Send failed: ${res.detail ?? "unknown error"}`;

  await slack.postThreadReply(args.channel, args.slackTs, message);
  return NextResponse.json({ ok: true });
}

/**
 * Follow-Up Operator: vouch for (or dismiss) an address the Outlook sweep found
 * with no audit behind it. Tracking is what makes a row schedulable — until
 * this fires, an unconfirmed prospect is never drafted for and never due.
 */
async function followupTrackAction(args: {
  actionId: string; channel: string; slackTs: string; prospectId: string;
}): Promise<NextResponse> {
  if (!args.prospectId) return NextResponse.json({ ok: true });

  const { updateProspect, getProspectById } = await import("@/lib/followup-operator/prospects");
  const { nextTouchAt, snapTo9amET } = await import("@/lib/followup-operator/cadence");

  const p = await getProspectById(args.prospectId);
  if (!p) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ That prospect is no longer in the pipeline.");
    return NextResponse.json({ ok: true });
  }

  if (args.actionId === "fo_ignore") {
    await updateProspect(p.id, { paused: true });
    await slack.postThreadReply(args.channel, args.slackTs, `✖ Ignored. *${p.email}* stays out of the board.`);
    return NextResponse.json({ ok: true });
  }

  // Start the ladder from the pitch that was actually sent, not from now.
  const anchor = p.first_sent_at ? new Date(p.first_sent_at) : new Date();
  const due = nextTouchAt(p.step, anchor) ?? snapTo9amET(new Date(Date.now() + 24 * 60 * 60 * 1000));
  await updateProspect(p.id, { confirmed: true, next_touch_at: due.toISOString() });

  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `✅ Tracking *${p.email}*. Next touch ${due.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })}.`
  );
  return NextResponse.json({ ok: true });
}

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

  const label = isSequenceCategory(category) ? CATEGORY_LABELS[category] : category.toUpperCase();
  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `✅ Category updated to ${label} for *${enrollment.contact_name ?? "Contact"}* by <@${args.userId}>.`
  );
  return NextResponse.json({ ok: true });
}

// ── iMessage bridge control buttons (🔄 Restart / 🩺 Doctor / ♻️ Resync / 📡 Status) ──
// Restart/Doctor/Resync queue a command the Mac bridge drains on its next ~10s
// outbox poll. Status reads the heartbeat server-side (works even if the Mac is down).
async function bridgeCommandAction(args: { actionId: string; channel: string; slackTs: string; userId: string }): Promise<NextResponse> {
  const type = args.actionId.replace("bridge_", "") as BridgeCommandType;
  const res = await enqueueBridgeCommand(type, args.userId);
  const msg = res.ok
    ? `🛰️ <@${args.userId}> queued *${type}* — bridge will pick it up within ~10s.`
    : `⚠️ Could not queue *${type}*: ${res.error}`;
  await slack.postThreadReply(args.channel, args.slackTs, msg);
  return NextResponse.json({ ok: true });
}

async function bridgeStatusAction(args: { channel: string; slackTs: string }): Promise<NextResponse> {
  const s = await getBridgeStatus();
  await slack.postThreadReply(args.channel, args.slackTs, formatBridgeStatusLine(s));
  return NextResponse.json({ ok: true });
}

function isMatthew(slackUserId: string): boolean {
  const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";
  return matthewId !== "" && slackUserId === matthewId;
}

function inferTriggerType(actionType: string): string {
  // "reply_funder" / "submit_deal" went with the funding business; anything
  // still arriving with those types is a stale card and lands in the default.
  return "lead_state";
}

function summarizeResult(actionType: string, details?: Record<string, unknown>): string {
  if (!details) return "";
  if (actionType === "send_email") {
    return `Sent to ${details.to ?? "unknown"}.`;
  }
  if (actionType === "update_zoho") {
    return `Zoho updated (stage → ${details.stage ?? "n/a"}).`;
  }
  if (actionType === "apply_followup") {
    const did = Array.isArray(details.did) ? (details.did as string[]) : [];
    return did.length ? `Done:\n${did.map((d) => `• ${d}`).join("\n")}` : "Nothing to do.";
  }
  return "";
}


/**
 * [Done] [Skip — not applicable] [I hit a problem] on one delivery step.
 *
 * Runner v3 §2 and §3. Three rules that this function exists to keep:
 *
 *  1. NEVER AUTO-ADVANCE PAST A HUMAN. Only the button completes a manual step. Files
 *     landing in the thread file evidence; they do not tick anything.
 *  2. [Done] ON AN UPLOAD STEP VALIDATES THE COUNT, NAMES WHAT IS MISSING, AND STAYS OPEN.
 *     It does not quietly accept four screenshots where eighteen were asked for, because
 *     the gap only surfaces later, when the findings doc is being assembled and the
 *     evidence is not there.
 *  3. A SKIP CARRIES A REASON. §17: a skipped platform "renders as 'not checked' in every
 *     artifact, never as 'no issues found.'" A reason-less skip is how the second thing
 *     happens.
 */
async function deliveryStepAction(args: {
  actionId: string;
  channel: string;
  messageTs: string;
  userId: string;
  userName: string | null;
  value: string;
}): Promise<NextResponse> {
  const [clientId, stepKey] = args.value.split(":");
  if (!clientId || !stepKey) return NextResponse.json({ ok: true });

  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { setDeliveryStep, stepByKey } = await import("@/lib/clients/delivery-checklist");
      // No postReadySteps here any more: setDeliveryStep runs the whole cascade for both
      // outcomes now, and calling it again from this side would double-post the next card.
      const { stepPrecondition } = await import("@/lib/clients/step-engine");
      const step = stepByKey(stepKey);
      if (!step) return;

      // ── Done ────────────────────────────────────────────────────────────
      if (args.actionId === "step_done") {
        // Stays open, on purpose. This is the one place the engine argues back, and the list
        // of what it argues about lives in step-engine rather than here so the board and any
        // future caller get the same refusals. See stepPrecondition().
        const gate = await stepPrecondition(clientId, stepKey);
        if (!gate.ok) {
          await tellActor(args, clientId, gate.message ?? "Not yet.");
          return;
        }

        const done = await setDeliveryStep({ clientId, stepKey, transition: "complete", actor });

        // ‼️ THE CARD IS NOT REWRITTEN WHEN THE WRITE FAILED, and it used to be.
        // setDeliveryStep has always returned { ok:false, error } on a failed row write or a
        // failed Day-0 stamp, and this line discarded it and ticked the card green regardless.
        // That is the inverse of "Done does nothing" and it is the worse of the two: a step
        // that SAYS it is complete, over a row that never changed.
        if (!done.ok) {
          await stepFailureNotice(args, clientId, step.label, done.error ?? "the row could not be written");
          return;
        }

        await resolveStepCard(args.channel, clientId, stepKey, `:white_check_mark: *${step.label}* — done by ${actor}.`);
        return;
      }

      // ── Skip ────────────────────────────────────────────────────────────
      //
      // ‼️ THIS GOES THROUGH setDeliveryStep, and it used to write the row itself.
      // Doing it directly meant a skip got `postReadySteps` and nothing else — no
      // `refreshStages`, no checklist re-render, and no `runReadyAutoSteps`. Since both
      // schedulers count a skipped row as done, the step released its blockers on paper
      // while the generators behind them were never asked to run. Skipping the manual
      // presence sweep left the presence PDF, and everything downstream of it, parked.
      if (args.actionId === "step_skip") {
        const skip = await setDeliveryStep({
          clientId,
          stepKey,
          transition: "skipped",
          skippedReason: `Marked not applicable by ${actor}`,
          actor,
        });

        if (!skip.ok) {
          await stepFailureNotice(args, clientId, step.label, skip.error ?? "the row could not be written");
          return;
        }

        await resolveStepCard(
          args.channel,
          clientId,
          stepKey,
          `:heavy_minus_sign: *${step.label}* — skipped by ${actor}. ` +
            `It renders as "not checked" everywhere, never as "no issues found". ` +
            `Reply here with why, so the artifact can say it.`
        );
        return;
      }

      // ── I hit a problem ─────────────────────────────────────────────────
      const { data: flagged, error: flagError } = await supabaseAdmin
        .from("client_delivery_steps")
        .update({
          status: "error",
          error_detail: `Flagged by ${actor} from Slack`,
          updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId)
        .eq("step_key", stepKey)
        .select("id");

      // Same zero-rows-is-not-an-error trap as setDeliveryStep. Flagging a problem against a
      // step that has no row is the one moment where being told so matters most.
      if (flagError || !flagged?.length) {
        await stepFailureNotice(
          args,
          clientId,
          step.label,
          flagError?.message ?? "there is no row for this step on this client"
        );
        return;
      }

      await resolveStepCard(
        args.channel,
        clientId,
        stepKey,
        `:warning: *${step.label}* — ${actor} hit a problem. Say what happened in this thread. ` +
          `It is now in the #alerts-infra digest and it will not advance on its own.`
      );
    })().catch(async (e) => {
      // ‼️ THIS IIFE HAD NO CATCH, unlike every neighbouring handler in this file.
      // Anything that threw inside it — a missing table, a Supabase timeout, a dynamic import
      // failing on a cold module graph — killed the rest of the function silently, INCLUDING
      // resolveStepCard. The card kept its three buttons, Slack said nothing, and the only
      // trace was a Vercel log nobody was watching. That is the shape of "I hit Done and
      // nothing happens".
      const reason = (e as Error).message;
      console.error(`[slack/actions] ${args.actionId} on ${stepKey} failed:`, reason);
      const { stepByKey: byKey } = await import("@/lib/clients/delivery-checklist");
      await stepFailureNotice(args, clientId, byKey(stepKey)?.label ?? stepKey, reason).catch(() => {});
    })
  );

  return NextResponse.json({ ok: true });
}

/**
 * Did that Slack call actually work?
 *
 * ‼️ slackFetch NEVER THROWS. Slack answers HTTP 200 for everything and puts real failures in
 * `ok: false`, so every `.catch(() => {})` around a Slack call in this handler was catching
 * nothing whatsoever: a `message_not_found`, a `cant_update_message`, a bot that is not in the
 * channel, or a missing scope all resolved as success and the caller carried on as though the
 * message had landed. Check the body, never the promise.
 */
function slackOk(res: Record<string, unknown> | null | undefined): boolean {
  return Boolean(res && res.ok === true);
}

/**
 * Say something to the person who pressed the button, wherever it can be said.
 *
 * Ephemeral first, because a refusal is about their click and does not belong in the log
 * everybody reads. The ops thread is the fallback rather than the default for the opposite
 * reason: saying it too loudly beats saying nothing, and saying nothing is what happened.
 */
async function tellActor(
  args: { channel: string; messageTs: string; userId: string },
  clientId: string,
  text: string
): Promise<void> {
  const res = await slack
    .postEphemeral(args.channel, args.userId, text, args.messageTs)
    .catch(() => null);
  if (slackOk(res)) return;

  const { notifyThread } = await import("@/lib/clients/delivery-checklist");
  await notifyThread(clientId, text).catch(() =>
    console.error("[slack/actions] could not reach the actor or the ops thread:", text)
  );
}

/** A button that did not do what it said. Names the step, the reason, and what is still true. */
async function stepFailureNotice(
  args: { channel: string; messageTs: string; userId: string },
  clientId: string,
  stepLabel: string,
  reason: string
): Promise<void> {
  await tellActor(
    args,
    clientId,
    `:warning: *${stepLabel}* did not go through: ${reason}\n` +
      `The step is unchanged and the buttons are still live, so nothing is half-done. ` +
      `Try it again, and if it repeats say so in this thread.`
  );
}

/**
 * Replace the step's card with its outcome, in place.
 *
 * The buttons have to go: a resolved step still offering [Done] is an invitation to
 * double-click it, and the thread underneath stays as the log of what happened.
 */
async function resolveStepCard(
  channel: string,
  clientId: string,
  stepKey: string,
  text: string
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_message_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (data?.slack_message_ts as string | null) ?? null;

  // ‼️ BOTH FAILURE PATHS NOW FALL BACK TO A THREAD REPLY, and that is the point of this
  // function. A null ts used to `return` outright, and a failed chat.update was swallowed by a
  // `.catch(() => {})` that never fired — see slackOk above. Between them a step could be
  // genuinely complete while its card kept all three buttons and nothing anywhere said so.
  if (ts) {
    const res = await slack
      .updateMessage(channel, ts, text, [{ type: "section", text: { type: "mrkdwn", text } }])
      .catch(() => null);
    if (slackOk(res)) return;
  }

  const { notifyThread } = await import("@/lib/clients/delivery-checklist");
  await notifyThread(clientId, text).catch((e) =>
    console.error("[slack/actions] could not resolve the card or reach the ops thread:", (e as Error).message)
  );
}
