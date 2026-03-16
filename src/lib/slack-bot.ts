import crypto from "crypto";

const SLACK_API = "https://slack.com/api";

// Slack-related env vars used in this codebase:
// - SLACK_BOT_TOKEN        — bot token for all API calls (required)
// - SLACK_CEO_CHANNEL      — channel ID for CEO alerts
// - SLACK_UW_CHANNEL       — channel ID for underwriting alerts
// - SLACK_SUB_CHANNEL      — channel ID for sub alerts
// - SLACK_HOT_LEADS_CHANNEL — channel ID used in route.ts and passed as arg

function getToken(): string {
        return process.env.SLACK_BOT_TOKEN || "";
}

export interface SlackBlock {
        type: string;
        text?: { type: string; text: string; emoji?: boolean };
        elements?: Array<{ type: string; text: string; emoji?: boolean }>;
        fields?: Array<{ type: string; text: string }>;
        accessory?: Record<string, unknown>;
}

async function slackFetch(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const token = getToken();
        if (!token) {
                  console.error("[Slack] SLACK_BOT_TOKEN is not set — cannot send message");
                  return { ok: false, error: "no_token" };
        }

  const res = await fetch(`${SLACK_API}/${method}`, {
            method: "POST",
            headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
  });

  const json = await res.json() as Record<string, unknown>;

  // Slack always returns HTTP 200; real errors are in json.ok === false
  if (!json.ok) {
            console.error("[Slack] API error:", JSON.stringify(json));
  }

  return json;
}

export const slack = {
        /** Send a message to a channel or DM */
        async postMessage(channel: string, text: string, blocks?: SlackBlock[]): Promise<Record<string, unknown>> {
                  if (!channel) {
                              console.error("[Slack] postMessage called with empty channel");
                              return { ok: false, error: "empty_channel" };
                  }
                  const body: Record<string, unknown> = { channel, text };
                  if (blocks) body.blocks = blocks;
                  return slackFetch("chat.postMessage", body);
        },

        /** Reply in a thread */
        async postThreadReply(channel: string, threadTs: string, text: string, blocks?: SlackBlock[]): Promise<Record<string, unknown>> {
                  const body: Record<string, unknown> = { channel, text, thread_ts: threadTs };
                  if (blocks) body.blocks = blocks;
                  return slackFetch("chat.postMessage", body);
        },

        /** Update an existing message */
        async updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlock[]): Promise<Record<string, unknown>> {
                  const body: Record<string, unknown> = { channel, ts, text };
                  if (blocks) body.blocks = blocks;
                  return slackFetch("chat.update", body);
        },

        /** Upload a PDF file to a channel (optionally in a thread) */
        async uploadFilePDF(channel: string, fileName: string, buffer: Buffer, threadTs?: string): Promise<Record<string, unknown>> {
                  const token = getToken();
                  if (!token) return { ok: false, error: "no_token" };

                  // Step 1: Get pre-signed upload URL + file_id
                  const urlRes = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ filename: fileName, length: buffer.length }),
                  });
                  const urlData = await urlRes.json() as { ok: boolean; upload_url?: string; file_id?: string };
                  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
                            console.error("[Slack] getUploadURLExternal failed:", JSON.stringify(urlData));
                            return { ok: false, error: "get_upload_url_failed" };
                  }

                  // Step 2: Upload raw bytes to the pre-signed URL
                  await fetch(urlData.upload_url, {
                            method: "POST",
                            headers: { "Content-Type": "application/octet-stream" },
                            body: new Uint8Array(buffer),
                  });

                  // Step 3: Complete upload and share to channel
                  const completeBody: Record<string, unknown> = {
                            files: [{ id: urlData.file_id, title: fileName }],
                            channel_id: channel,
                  };
                  if (threadTs) completeBody.thread_ts = threadTs;
                  return slackFetch("files.completeUploadExternal", completeBody);
        },

        /** Check if Slack is configured */
        isConfigured(): boolean {
                  const token = getToken();
                  return !!token && token.trim().length > 0;
        },

        /** Get channel IDs from env */
        channels: {
                  get ceo() { return process.env.SLACK_CEO_CHANNEL || ""; },
                  get uw() { return process.env.SLACK_UW_CHANNEL || ""; },
                  get sub() { return process.env.SLACK_SUB_CHANNEL || ""; },
        },

        /** Verify Slack request signature */
        verifySignature(signingSecret: string, timestamp: string, body: string, signature: string): boolean {
                  const basestring = `v0:${timestamp}:${body}`;
                  const hmac = crypto.createHmac("sha256", signingSecret).update(basestring).digest("hex");
                  const computed = `v0=${hmac}`;
                  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
        },

        // --- Block Kit formatters ---

        /** Format a pulse report for Slack */
        formatPulseReport(pulse: {
                  summary: string;
                  metrics?: Record<string, number>;
                  tasks?: Array<{ title: string; priority: string }>;
        }): SlackBlock[] {
                  const blocks: SlackBlock[] = [
                        {
                                      type: "header",
                                      text: { type: "plain_text", text: "🧠 BrainHeart Pulse", emoji: true },
                        },
                        {
                                      type: "section",
                                      text: { type: "mrkdwn", text: pulse.summary },
                        },
                            ];

          if (pulse.metrics && Object.keys(pulse.metrics).length > 0) {
                      blocks.push({
                                    type: "section",
                                    fields: Object.entries(pulse.metrics).map(([key, val]) => ({
                                                    type: "mrkdwn",
                                                    text: `*${key}:* ${val}`,
                                    })),
                      });
          }

          if (pulse.tasks && pulse.tasks.length > 0) {
                      const taskList = pulse.tasks
                        .map((t) => {
                                        const icon = t.priority === "urgent" ? "🔴" : t.priority === "high" ? "🟠" : "⚪";
                                        return `${icon} ${t.title}`;
                        })
                        .join("\n");

                    blocks.push({
                                  type: "section",
                                  text: { type: "mrkdwn", text: `*New Tasks:*\n${taskList}` },
                    });
          }

          return blocks;
        },

        /** Format a deal alert */
        formatDealAlert(deal: {
                  businessName: string;
                  stage: string;
                  amount?: number;
                  action: string;
        }): SlackBlock[] {
                  return [
                        {
                                      type: "section",
                                      text: {
                                                      type: "mrkdwn",
                                                      text: `*${deal.action}*\n📋 *${deal.businessName}*\nStage: ${deal.stage}${deal.amount ? ` | Amount: $${deal.amount.toLocaleString()}` : ""}`,
                                      },
                        },
                            ];
        },
};
