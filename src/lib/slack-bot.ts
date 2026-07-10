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

// Cached bot user id (from auth.test) so we can tell the bot's own reactions apart from a
// human's. Resolved once per process; falls back to SLACK_BOT_USER_ID if auth.test fails.
let cachedBotUserId: string | null = null;

export interface SlackBlock {
        type: string;
        text?: { type: string; text: string; emoji?: boolean };
        // `elements` accepts either plain text/mrkdwn elements OR interactive
        // elements (buttons) whose `text` is itself a plain_text object.
        elements?: Array<Record<string, unknown>>;
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

        /** The bot's own Slack user id (cached). Used to ignore the bot's own reactions so a
         *  pre-seeded emoji only triggers an action when a human reacts. */
        async getBotUserId(): Promise<string> {
                  if (cachedBotUserId !== null) return cachedBotUserId;
                  const res = await slackFetch("auth.test", {});
                  const id = (res?.ok && typeof res.user_id === "string" ? res.user_id : "") as string;
                  cachedBotUserId = id || process.env.SLACK_BOT_USER_ID || "";
                  return cachedBotUserId;
        },

        /** Update an existing message */
        async updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlock[]): Promise<Record<string, unknown>> {
                  const body: Record<string, unknown> = { channel, ts, text };
                  if (blocks) body.blocks = blocks;
                  return slackFetch("chat.update", body);
        },

        /** Upload any file to a channel (optionally in a thread) */
        async uploadFile(channel: string, fileName: string, buffer: Buffer, mimetype: string, threadTs?: string): Promise<Record<string, unknown>> {
                  const token = getToken();
                  if (!token) return { ok: false, error: "no_token" };

                  // files.getUploadURLExternal only reads form-encoded params, NOT JSON.
                  const urlRes = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
                            body: new URLSearchParams({ filename: fileName, length: String(buffer.length) }).toString(),
                  });
                  const urlData = await urlRes.json() as { ok: boolean; upload_url?: string; file_id?: string };
                  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
                            console.error("[Slack] getUploadURLExternal failed:", JSON.stringify(urlData));
                            return { ok: false, error: "get_upload_url_failed" };
                  }

                  const put = await fetch(urlData.upload_url, {
                            method: "POST",
                            headers: { "Content-Type": mimetype },
                            body: new Uint8Array(buffer),
                  });
                  if (!put.ok) {
                            console.error("[Slack] file byte-upload failed:", put.status);
                            return { ok: false, error: `upload_bytes_${put.status}` };
                  }

                  const completeBody: Record<string, unknown> = {
                            files: [{ id: urlData.file_id, title: fileName }],
                            channel_id: channel,
                  };
                  if (threadTs) completeBody.thread_ts = threadTs;
                  return slackFetch("files.completeUploadExternal", completeBody);
        },

        /** Upload a PDF file to a channel (optionally in a thread) */
        async uploadFilePDF(channel: string, fileName: string, buffer: Buffer, threadTs?: string): Promise<Record<string, unknown>> {
                  const token = getToken();
                  if (!token) return { ok: false, error: "no_token" };

                  // Step 1: Get pre-signed upload URL + file_id
                  // files.getUploadURLExternal only reads form-encoded params, NOT JSON.
                  const urlRes = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
                            body: new URLSearchParams({ filename: fileName, length: String(buffer.length) }).toString(),
                  });
                  const urlData = await urlRes.json() as { ok: boolean; upload_url?: string; file_id?: string };
                  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
                            console.error("[Slack] getUploadURLExternal failed:", JSON.stringify(urlData));
                            return { ok: false, error: "get_upload_url_failed" };
                  }

                  // Step 2: Upload raw bytes to the pre-signed URL
                  const put = await fetch(urlData.upload_url, {
                            method: "POST",
                            headers: { "Content-Type": "application/octet-stream" },
                            body: new Uint8Array(buffer),
                  });
                  if (!put.ok) {
                            console.error("[Slack] file byte-upload failed:", put.status);
                            return { ok: false, error: `upload_bytes_${put.status}` };
                  }

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

        /** Fetch file metadata via files.info — returns url_private_download, mimetype, channels, thread context. */
        async filesInfo(fileId: string): Promise<Record<string, unknown>> {
                  const token = getToken();
                  if (!token) return { ok: false, error: "no_token" };
                  const res = await fetch(`${SLACK_API}/files.info?file=${encodeURIComponent(fileId)}`, {
                            headers: { Authorization: `Bearer ${token}` },
                  });
                  const json = await res.json() as Record<string, unknown>;
                  if (!json.ok) console.error("[Slack] files.info error:", JSON.stringify(json));
                  return json;
        },

        /** Download a Slack file by its url_private_download. Returns the raw Buffer. */
        async downloadFile(urlPrivateDownload: string): Promise<Buffer> {
                  const token = getToken();
                  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
                  const res = await fetch(urlPrivateDownload, {
                            headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
                  return Buffer.from(await res.arrayBuffer());
        },

        /** Post an ephemeral message visible only to one user (confirmations, errors). */
        async postEphemeral(channel: string, user: string, text: string, threadTs?: string): Promise<Record<string, unknown>> {
                  if (!channel || !user) return { ok: false, error: "missing_channel_or_user" };
                  const body: Record<string, unknown> = { channel, user, text };
                  if (threadTs) body.thread_ts = threadTs;
                  return slackFetch("chat.postEphemeral", body);
        },

        /** Create a public channel. Returns { id, name } on success. */
        async createChannel(name: string, isPrivate = false): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
                  const res = (await slackFetch("conversations.create", { name, is_private: isPrivate })) as {
                            ok: boolean; channel?: { id: string; name: string }; error?: string;
                  };
                  if (!res.ok || !res.channel) return { ok: false, error: res.error };
                  return { ok: true, id: res.channel.id, name: res.channel.name };
        },

        /** Invite users to a channel. users = comma-separated list of user IDs. */
        async inviteToChannel(channel: string, users: string): Promise<Record<string, unknown>> {
                  if (!channel || !users) return { ok: false, error: "missing_channel_or_users" };
                  return slackFetch("conversations.invite", { channel, users });
        },

        /** Pin a message to a channel. */
        async pinMessage(channel: string, timestamp: string): Promise<Record<string, unknown>> {
                  if (!channel || !timestamp) return { ok: false, error: "missing_channel_or_ts" };
                  return slackFetch("pins.add", { channel, timestamp });
        },

        /** Archive a channel. Requires channels:manage scope. */
        async archiveChannel(channel: string): Promise<{ ok: boolean; error?: string }> {
                  if (!channel) return { ok: false, error: "missing_channel" };
                  const res = (await slackFetch("conversations.archive", { channel })) as { ok: boolean; error?: string };
                  return res;
        },

        /** Add an emoji reaction to a message. */
        async addReaction(channel: string, timestamp: string, name: string): Promise<Record<string, unknown>> {
                  if (!channel || !timestamp || !name) return { ok: false, error: "missing_args" };
                  return slackFetch("reactions.add", { channel, timestamp, name });
        },

        /** Fetch a single message by channel + ts. Returns null if not found or error. */
        async getMessage(channel: string, ts: string): Promise<Record<string, unknown> | null> {
                  const token = getToken();
                  if (!token) return null;
                  const url = `${SLACK_API}/conversations.history?channel=${encodeURIComponent(channel)}&latest=${encodeURIComponent(ts)}&limit=1&inclusive=true`;
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json() as { ok: boolean; messages?: Record<string, unknown>[] };
                  if (!data.ok || !data.messages?.length) return null;
                  return data.messages[0];
        },

        /** Fetch channel info (name, etc.). Returns null if not found or error. */
        async getChannelInfo(channel: string): Promise<{ name?: string } | null> {
                  const token = getToken();
                  if (!token) return null;
                  const url = `${SLACK_API}/conversations.info?channel=${encodeURIComponent(channel)}`;
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json() as { ok: boolean; channel?: { name?: string } };
                  if (!data.ok) return null;
                  return data.channel ?? null;
        },

        /** Get channel IDs from env */
        channels: {
                  get ceo() { return process.env.SLACK_CEO_CHANNEL || ""; },
                  get uw() { return process.env.SLACK_UW_CHANNEL || ""; },
                  get sub() { return process.env.SLACK_SUB_CHANNEL || ""; },
		  // iMessage-bridge control + doctor reports. Falls back to #srt-sub so
		  // nothing breaks before SLACK_BRIDGE_CHANNEL is set in Vercel.
		  get bridge() { return process.env.SLACK_BRIDGE_CHANNEL || process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM"; },
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
