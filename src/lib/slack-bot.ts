import crypto from "crypto";

const SLACK_API = "https://slack.com/api";

// Slack-related env vars used in this codebase:
// - SLACK_BOT_TOKEN        — bot token for all API calls (required)
// - SLACK_CEO_CHANNEL      — channel ID for CEO alerts
// - SLACK_UW_CHANNEL       — channel ID for underwriting alerts
// - SLACK_BRIDGE_CHANNEL   — channel ID for iMessage-bridge control + doctor reports
// - SLACK_HOT_LEADS_CHANNEL — channel ID used in route.ts and passed as arg

function getToken(): string {
        return process.env.SLACK_BOT_TOKEN || "";
}

// Cached bot user id (from auth.test) so we can tell the bot's own reactions apart from a
// human's. Resolved once per process; falls back to SLACK_BOT_USER_ID if auth.test fails.
let cachedBotUserId: string | null = null;

// reactions.get failures are usually a missing bot scope — warn once per error string per
// process instead of on every card tap.
const warnedReactionErrors = new Set<string>();
function warnReactionGetOnce(err: string): void {
        if (warnedReactionErrors.has(err)) return;
        warnedReactionErrors.add(err);
        console.error(
                `[Slack] reactions.get failed (${err}).` +
                        (err === "missing_scope"
                                ? " Add the reactions:read bot scope and reinstall the app;"
                                : "") +
                        " seeded-emoji cards fall back to userId-only filtering."
        );
}

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

  // ‼️ SLACK RATE LIMITS AND THIS CLIENT USED TO TREAT THAT AS A PERMANENT FAILURE.
  //
  // Everything else here assumes HTTP 200 with the real answer in json.ok, which is true for
  // every response EXCEPT 429: that one comes back with a Retry-After header and a body of
  // `{ok:false, error:"ratelimited"}`, indistinguishable at the call site from name_taken or
  // channel_not_found. Every caller in this repo treats {ok:false} as done and moves on.
  //
  // That was survivable while the board lived in one channel. Per-client channels make
  // provisioning a burst: conversations.create is tier 2 (~20/min) and the target is 30
  // onboardings a day, so the twenty-first in a busy minute would have come back "ratelimited",
  // been recorded by provision.ts's warn() as an ordinary warning, and left a client with no
  // channel and nothing saying why.
  //
  // ‼️ IT STILL RETURNS {ok:false} AND STILL NEVER THROWS. That contract is relied on by every
  // caller and by three probes. Retrying is invisible to them: what changes is that a 429 gets
  // a second chance before it becomes the {ok:false} they already handle.
  //
  // Bounded on purpose. Slack's Retry-After is usually one to a few seconds; anything asking for
  // longer than MAX_RETRY_WAIT_MS is a sustained limit that waiting inside a request handler
  // cannot fix, and blocking a Vercel function on it would trade one failure for a timeout.
  for (let attempt = 0; ; attempt += 1) {
            const res = await fetch(`${SLACK_API}/${method}`, {
                        method: "POST",
                        headers: {
                                    Authorization: `Bearer ${token}`,
                                    "Content-Type": "application/json",
                        },
                        body: JSON.stringify(body),
            });

            if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
                        const waitMs = retryAfterMs(res.headers.get("retry-after"));
                        if (waitMs <= MAX_RETRY_WAIT_MS) {
                                    console.warn(`[Slack] ${method} rate limited, waiting ${waitMs}ms`);
                                    await new Promise((r) => setTimeout(r, waitMs));
                                    continue;
                        }
                        console.error(`[Slack] ${method} rate limited for ${waitMs}ms, too long to wait`);
                        return { ok: false, error: "ratelimited" };
            }

            const json = await res.json() as Record<string, unknown>;

            // Slack always returns HTTP 200; real errors are in json.ok === false
            if (!json.ok) {
                        console.error("[Slack] API error:", JSON.stringify(json));
            }

            return json;
  }
}

/** How many times a 429 gets a second chance before it becomes an ordinary {ok:false}. */
const RATE_LIMIT_RETRIES = 2;

/** conversations.list caps at 1000 per page; this bounds the walk so a bad cursor cannot loop. */
const MAX_CHANNEL_PAGES = 10;

/** Longer than this is a sustained limit, and sleeping through it inside a handler is a timeout. */
const MAX_RETRY_WAIT_MS = 8_000;

/**
 * Retry-After is in SECONDS, and reading it as milliseconds is the classic version of this bug:
 * it turns a one second wait into an immediate retry that is rate limited again.
 *
 * A missing or unparseable header means Slack did not say, so use a second rather than zero.
 */
function retryAfterMs(header: string | null): number {
        const seconds = Number.parseInt(header ?? "", 10);
        return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/**
 * Permalink to a message or thread, built rather than fetched.
 *
 * chat.getPermalink is a real API call and this needs to work from inside
 * waitUntil and from a CRM note write, neither of which should be blocked on a
 * Slack round trip that can only fail. The archive URL is stable and has never
 * needed the token.
 */
export function slackThreadLink(channel: string, ts: string): string {
  return `https://slack.com/archives/${channel}/p${ts.replace(".", "")}`;
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

        /** Total count of a specific emoji currently on a message (0 if none). The bot pre-seeds
         *  its cards, so a seeded emoji reaching count 2 means a human reacted on top of the seed.
         *  Requires the reactions:read scope. Returns NULL when the API call fails (e.g.
         *  missing_scope) — "could not check" must never read as "zero reactions", or every
         *  seeded card dies silently. */
        async getReactionCount(channel: string, ts: string, name: string): Promise<number | null> {
                  const res = await slackFetch("reactions.get", { channel, timestamp: ts });
                  if (!res?.ok) {
                            warnReactionGetOnce(String(res?.error ?? "unknown"));
                            return null;
                  }
                  const msg = res.message as { reactions?: Array<{ name?: string; count?: number }> } | null;
                  const hit = msg?.reactions?.find((r) => r.name === name);
                  return hit?.count ?? 0;
        },

        /**
         * Delete a message.
         *
         * ‼️ THE BOT CAN ONLY DELETE ITS OWN MESSAGES with a bot token, which is the whole reason
         * this is safe to expose. A human's message in a step thread comes back `cant_delete_message`
         * rather than disappearing.
         *
         * Added 2026-08-27 for the step-10 repost: replacing a step's card means removing the old
         * one first, and nothing in the app had ever deleted anything in Slack before.
         */
        async deleteMessage(channel: string, ts: string): Promise<Record<string, unknown>> {
                  return slackFetch("chat.delete", { channel, ts });
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

        /**
         *  Find a channel this bot can see, by exact name.
         *
         *  ‼️ IT EXISTS FOR THE name_taken CASE AND FOR NOTHING ELSE. conversations.create
         *  answers name_taken without telling you which channel took the name, and creating
         *  `srt-acme-2` instead would split one client's history across two channels. This
         *  resolves the one that already exists so it can be adopted.
         *
         *  Paged, because conversations.list caps at 1000 per call and a workspace running 30
         *  onboardings a day passes that inside two months. Bounded at MAX_CHANNEL_PAGES so a
         *  bad cursor cannot loop: not finding it is a clean null, which the caller treats as
         *  a failure rather than as "create another one".
         */
        async findChannel(name: string, isPrivate = false): Promise<{ id: string; name: string } | null> {
                  const wanted = name.trim().toLowerCase();
                  let cursor = "";

                  for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
                            const res = (await slackFetch("conversations.list", {
                                      types: isPrivate ? "private_channel" : "public_channel",
                                      exclude_archived: true,
                                      limit: 1000,
                                      ...(cursor ? { cursor } : {}),
                            })) as {
                                      ok: boolean;
                                      channels?: Array<{ id: string; name: string }>;
                                      response_metadata?: { next_cursor?: string };
                            };

                            if (!res.ok) return null;

                            const hit = (res.channels ?? []).find((c) => c.name?.toLowerCase() === wanted);
                            if (hit) return { id: hit.id, name: hit.name };

                            cursor = res.response_metadata?.next_cursor ?? "";
                            if (!cursor) return null;
                  }
                  return null;
        },

        /** Invite users to a channel. users = comma-separated list of user IDs. */
        async inviteToChannel(channel: string, users: string): Promise<Record<string, unknown>> {
                  if (!channel || !users) return { ok: false, error: "missing_channel_or_users" };
                  return slackFetch("conversations.invite", { channel, users });
        },

        /** Join a public channel. Idempotent — already-there is a harmless no-op.
         *  Needed before uploadFilePDF/uploadFile on a channel the bot didn't create
         *  itself (e.g. one a human created manually): chat.postMessage works on a
         *  public channel without membership, but files.completeUploadExternal's
         *  channel share silently no-ops (still returns ok:true) if the bot isn't
         *  actually a member. */
        async joinChannel(channel: string): Promise<{ ok: boolean; error?: string }> {
                  if (!channel) return { ok: false, error: "missing_channel" };
                  const res = (await slackFetch("conversations.join", { channel })) as { ok: boolean; error?: string };
                  return res;
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

        /**
         * Remove an emoji reaction this bot added.
         *
         * Added for the delivery board, where un-ticking a step has to take the checkmark back
         * off the step's message. A tick left behind after a reopen is worse than no tick: the
         * channel would show a step as confirmed while the row says it is outstanding again,
         * and the reaction is the thing being scanned.
         *
         * `no_reaction` comes back when it was never there, which is the normal outcome for a
         * step reopened twice rather than a failure. Callers treat it as success.
         */
        async removeReaction(channel: string, timestamp: string, name: string): Promise<Record<string, unknown>> {
                  if (!channel || !timestamp || !name) return { ok: false, error: "missing_args" };
                  return slackFetch("reactions.remove", { channel, timestamp, name });
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

        /**
         * Every message in a thread, oldest first, capped at `limit`.
         *
         * Slack returns the PARENT message as element 0 of conversations.replies, which is what
         * makes this usable as conversation history: the parent is the audit result card that
         * everything after it is reacting to. Returns [] on any failure, because a thread whose
         * history cannot be read should degrade to answering the current message alone.
         */
        async conversationsReplies(channel: string, threadTs: string, limit = 30): Promise<Array<Record<string, unknown>>> {
                  const token = getToken();
                  if (!token) return [];
                  const url = `${SLACK_API}/conversations.replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(threadTs)}&limit=${limit}`;
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json() as { ok: boolean; messages?: Array<Record<string, unknown>>; error?: string };
                  if (!data.ok) {
                            console.error("[slack] conversations.replies failed:", data.error);
                            return [];
                  }
                  return data.messages ?? [];
        },

        /** Fetch channel info. Returns null if not found or error.
         *
         *  ‼️ `is_member` IS WHY THIS RETURNS MORE THAN A NAME NOW. The bot can chat.postMessage
         *  into a public channel it has never joined, but Slack does not DELIVER message events
         *  from one. That asymmetry is how #aeo-seo-page-drafting sat dead for weeks with no
         *  error anywhere: every reply the page studio would have sent was never asked for.
         *  Anything that owns a channel it did not create should check this and say so. */
        async getChannelInfo(
                  channel: string
        ): Promise<{ name?: string; is_member?: boolean; is_private?: boolean; is_archived?: boolean } | null> {
                  const token = getToken();
                  if (!token) return null;
                  const url = `${SLACK_API}/conversations.info?channel=${encodeURIComponent(channel)}`;
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json() as {
                            ok: boolean;
                            channel?: { name?: string; is_member?: boolean; is_private?: boolean; is_archived?: boolean };
                  };
                  if (!data.ok) return null;
                  return data.channel ?? null;
        },

        /** Get channel IDs from env */
        channels: {
                  get ceo() { return process.env.SLACK_CEO_CHANNEL || ""; },
                  get uw() { return process.env.SLACK_UW_CHANNEL || ""; },
		  // iMessage-bridge control + doctor reports. #srt-sub was the old fallback;
		  // that channel is decommissioned, so this falls back to the CEO channel
		  // rather than a dead one. Set SLACK_BRIDGE_CHANNEL (#textwin-manager).
		  get bridge() { return process.env.SLACK_BRIDGE_CHANNEL || process.env.SLACK_CEO_CHANNEL || ""; },
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

/**
 * GitHub-flavoured markdown into Slack mrkdwn.
 *
 * ‼️ SLACK RENDERS `**bold**` AND `## Heading` LITERALLY. A model answer posted straight through
 * arrives as a wall of asterisks and hashes, which is what the general assistant was doing in
 * #onboarding-srt-aeo. Four rules and no more, because every extra one is a way to mangle text
 * that was already fine. Triple backticks are left alone: Slack renders those natively.
 *
 * It lives here rather than beside the audit engine's `toSlackBold` deliberately. That function
 * is in hook-pitch.ts, which pulls in run-prompts, site-research, classify and claude-calls, and
 * the Slack primitive must not depend on the audit engine to format a message. The bold regex is
 * copied verbatim from it so the two cannot disagree about what bold is.
 */
export function toSlackMrkdwn(s: string): string {
        return s
                  .split("\n")
                  .map((line) => {
                            // ## Heading -> *Heading*. Slack has no headings, and bold is what a heading means here.
                            const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
                            if (heading) return `*${heading[1].trim()}*`;
                            // A leading - or * bullet. Slack has no list syntax, so this is presentational.
                            return line.replace(/^(\s*)[-*]\s+/, "$1•  ");
                  })
                  .join("\n")
                  // **bold** -> *bold*. Same expression as toSlackBold in hook-pitch.ts.
                  .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "*$1*")
                  // [label](url) -> <url|label>
                  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>");
}
