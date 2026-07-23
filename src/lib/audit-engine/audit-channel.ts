// Channel bootstrap for the Audit Engine. This app has no "find channel by name"
// Slack API call available in slack-bot.ts, so — matching how every other fixed
// channel in this codebase works (SLACK_CEO_CHANNEL, SLACK_HOT_LEADS_CHANNEL: an
// env var, not a DB row) — the channel is created once and its ID must be pasted
// into AUDIT_CHANNEL_ID in Vercel afterwards. This function just makes that first
// run self-service instead of a manual pre-step.

import { slack } from "@/lib/slack-bot";

const CHANNEL_NAME = "ai-visibility-audits";

export async function getOrCreateAuditChannel(): Promise<{ id: string; isNew: boolean }> {
  const configured = process.env.AUDIT_CHANNEL_ID;
  if (configured) return { id: configured, isNew: false };

  const created = await slack.createChannel(CHANNEL_NAME);
  if (!created.ok || !created.id) {
    throw new Error(
      `AUDIT_CHANNEL_ID is not set and channel creation failed (${created.error ?? "unknown error"}). ` +
        `Create #${CHANNEL_NAME} manually and set AUDIT_CHANNEL_ID in Vercel.`
    );
  }

  console.warn(
    `[audit-engine] Created #${CHANNEL_NAME} (id=${created.id}). ` +
      `Paste this into AUDIT_CHANNEL_ID in Vercel so future runs don't recreate it.`
  );

  return { id: created.id, isNew: true };
}
