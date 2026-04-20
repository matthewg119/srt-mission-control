import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { routeToChannel, VEKTOR_CHANNELS, type VektorCategory } from "@/config/vektor";
import type { PendingActionPayload } from "./types";

const FALLBACK_APPROVAL_CHANNEL = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";

export interface PostApprovalOpts {
  summary: string;
  payload: PendingActionPayload;
  merchantId?: string;
  zohoId?: string;
  aiDecisionId?: string;
  channel?: string;
  category?: VektorCategory;
}

export interface PostApprovalResult {
  pendingActionId: string | null;
  slackTs: string | null;
  channel: string | null;
  skipped?: "no_channel" | "slack_error";
}

export async function postApprovalRequest(opts: PostApprovalOpts): Promise<PostApprovalResult> {
  const channel =
    opts.channel ||
    (opts.category ? routeToChannel(opts.category) : "") ||
    VEKTOR_CHANNELS.main ||
    FALLBACK_APPROVAL_CHANNEL;
  if (!channel) {
    console.error("[vektor] No Slack channel configured for approvals");
    return { pendingActionId: null, slackTs: null, channel: null, skipped: "no_channel" };
  }

  const actionId = opts.payload.action_type;
  const tag = opts.payload.requires_matthew ? " (Matthew approval required)" : "";

  const headerText = `:shark: VeKtor recommends: *${actionId.replace(/_/g, " ")}*${tag}`;

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${headerText}\n${opts.summary}` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":thumbsup: Approve" },
          style: "primary",
          action_id: "ai_approve",
          value: "pending",
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":pencil2: Edit" },
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
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `React :+1: / :pencil2: / :no_entry: or click a button. AI will not act until approved.` },
      ],
    },
  ];

  const resp = (await slack.postMessage(channel, headerText, blocks as unknown as Parameters<typeof slack.postMessage>[2])) as {
    ok: boolean;
    ts?: string;
    channel?: string;
    error?: string;
  };

  if (!resp.ok || !resp.ts) {
    console.error("[ai-intel] Slack postMessage failed:", resp.error);
    return { pendingActionId: null, slackTs: null, channel, skipped: "slack_error" };
  }

  const slackTs = resp.ts;
  const slackChannel = resp.channel || channel;

  const { data, error } = await supabaseAdmin
    .from("pending_slack_actions")
    .insert({
      slack_ts: slackTs,
      slack_channel: slackChannel,
      action_type: opts.payload.action_type,
      payload: opts.payload,
      status: "pending",
      merchant_id: opts.merchantId ?? null,
      zoho_id: opts.zohoId ?? null,
      ai_decision_id: opts.aiDecisionId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ai-intel] Failed to insert pending_slack_actions:", error.message);
    return { pendingActionId: null, slackTs, channel: slackChannel, skipped: "slack_error" };
  }

  return { pendingActionId: data.id as string, slackTs, channel: slackChannel };
}

export async function resolvePendingAction(opts: {
  slackTs: string;
  status: "approved" | "edited" | "cancelled";
  approvedBy: string;
  editedPayload?: PendingActionPayload;
}): Promise<{ action: { id: string; payload: PendingActionPayload; action_type: string; merchant_id: string | null; zoho_id: string | null } | null; error?: string }> {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, action_type, payload, status, merchant_id, zoho_id")
    .eq("slack_ts", opts.slackTs)
    .single();

  if (fetchErr || !existing) {
    return { action: null, error: fetchErr?.message || "not_found" };
  }

  if (existing.status !== "pending") {
    return { action: null, error: `already_${existing.status}` };
  }

  const updatedPayload = opts.editedPayload ?? (existing.payload as PendingActionPayload);

  const { error: updateErr } = await supabaseAdmin
    .from("pending_slack_actions")
    .update({
      status: opts.status,
      approved_by: opts.approvedBy,
      resolved_at: new Date().toISOString(),
      payload: updatedPayload,
    })
    .eq("id", existing.id);

  if (updateErr) return { action: null, error: updateErr.message };

  return {
    action: {
      id: existing.id as string,
      payload: updatedPayload,
      action_type: existing.action_type as string,
      merchant_id: existing.merchant_id as string | null,
      zoho_id: existing.zoho_id as string | null,
    },
  };
}
