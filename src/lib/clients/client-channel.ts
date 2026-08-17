// The per-client Slack channel, #srt-{slug}.
//
// Modeled on ensureSmsChannel() in src/lib/sms-channel.ts, which already solved the
// per-entity channel problem including the name_taken retry. Two differences:
//
// 1. PRIVATE, always. An SMS channel holds our own notes about a lead. A client channel
//    is where a client will eventually sit, and a public channel in a workspace that
//    also contains #hot-leads and every other client's channel is not somewhere you can
//    put a customer.
//
// 2. It can target a SECOND WORKSPACE. slack-bot.ts reads SLACK_BOT_TOKEN from a
//    module-level getToken(), so it cannot be pointed elsewhere per call. This file
//    therefore talks to the API directly for the four methods it needs, using
//    SLACK_HUB_BOT_TOKEN when it is set and falling back to the main workspace when it
//    is not. That single fallback is what lets a Client Hub workspace be created later
//    and light up with no schema change and no rewrite here.
//
// WHAT THIS CANNOT DO, at any Slack plan tier below Enterprise Grid: invite the client.
// admin.users.invite is Grid-only, and guest accounts require a paid plan at all. So
// the channel is automated and the invite is a click. The card this posts to
// #onboarding-srt-aeo carries the channel link and the client's email so that click is
// one step from where you already are. Do not add code that pretends to automate it.

import { supabaseAdmin } from "@/lib/db";

const SLACK_API = "https://slack.com/api";

/** The Client Hub workspace when configured, otherwise the main workspace. */
function channelToken(): string {
  return process.env.SLACK_HUB_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || "";
}

/** True when client channels are landing in a separate workspace from our own. */
export function usingClientHub(): boolean {
  return Boolean(process.env.SLACK_HUB_BOT_TOKEN);
}

async function hubFetch(
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const token = channelToken();
  if (!token) {
    console.error("[client-channel] no Slack token available");
    return { ok: false, error: "no_token" };
  }

  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Slack always returns HTTP 200; real errors are in json.ok === false.
  const json = (await res.json()) as Record<string, unknown>;
  if (!json.ok) console.error(`[client-channel] ${method} failed:`, JSON.stringify(json));
  return json;
}

/**
 * Post into a CLIENT channel.
 *
 * Use this rather than slack.postMessage for anything addressed to a client channel.
 * slack-bot.ts always uses SLACK_BOT_TOKEN, so the moment SLACK_HUB_BOT_TOKEN is set
 * it would be posting into the wrong workspace with a channel id that does not exist
 * there, and the failure would be a silent channel_not_found in a log.
 */
export async function postToClientChannel(channelId: string, text: string): Promise<void> {
  if (!channelId) return;
  await hubFetch("chat.postMessage", { channel: channelId, text });
}

export interface EnsureClientChannelResult {
  channelId: string | null;
  channelName: string | null;
  created: boolean;
}

/**
 * Idempotent. Returns the existing channel when the client already has one, so a
 * re-run of provisioning cannot leave a clinic with two channels.
 */
export async function ensureClientChannel(args: {
  clientId: string;
  slug: string;
  legalName: string;
}): Promise<EnsureClientChannelResult> {
  const { clientId, slug, legalName } = args;

  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("slack_channel_id, slack_channel_name")
    .eq("id", clientId)
    .maybeSingle();

  if (existing?.slack_channel_id) {
    return {
      channelId: existing.slack_channel_id as string,
      channelName: (existing.slack_channel_name as string) ?? null,
      created: false,
    };
  }

  const name = `srt-${slug}`.slice(0, 75); // Slack caps names at 80.

  let created = await hubFetch("conversations.create", { name, is_private: true });

  // name_taken is the one error worth retrying: a previous half-finished run, or two
  // clinics whose names slugify the same way.
  if (!created.ok && created.error === "name_taken") {
    const suffixed = `${name}-${Math.random().toString(36).slice(2, 5)}`.slice(0, 75);
    created = await hubFetch("conversations.create", { name: suffixed, is_private: true });
  }

  const channel = created.ok ? (created.channel as { id?: string; name?: string } | undefined) : undefined;
  if (!channel?.id) {
    return { channelId: null, channelName: null, created: false };
  }

  // NO conversations.join HERE. It only works on PUBLIC channels: called on a private
  // one it fails with method_not_supported_for_channel_type. The bot does not need it
  // anyway, because the app that CREATES a private channel is already a member of it.
  // Membership is what matters, since files.completeUploadExternal silently no-ops
  // without it while still returning ok:true.

  // Whoever runs delivery has to be IN the channel, and a private channel created by a
  // bot has exactly one member until someone is invited: the bot. Skipping this would
  // leave a trail of client channels you cannot see.
  //
  // The id differs per workspace. A main-workspace user id is not a member of the hub
  // workspace, so inviting it there fails with user_not_found, which is why hub mode
  // needs its own env var rather than reusing MATTHEW_SLACK_USER_ID.
  const ownerId = usingClientHub()
    ? process.env.SLACK_HUB_OWNER_USER_ID
    : process.env.MATTHEW_SLACK_USER_ID;

  if (ownerId) {
    await hubFetch("conversations.invite", { channel: channel.id, users: ownerId });
  } else if (usingClientHub()) {
    console.error(
      "[client-channel] SLACK_HUB_OWNER_USER_ID is not set, so nobody was invited to " +
        `#${channel.name ?? name}. The bot is its only member.`
    );
  }

  await hubFetch("chat.postMessage", {
    channel: channel.id,
    text: [
      `*${legalName}*`,
      ``,
      `This is the working channel for this clinic. Findings, scorecards and the monthly video land here.`,
    ].join("\n"),
  });

  await supabaseAdmin
    .from("clients")
    .update({
      slack_channel_id: channel.id,
      slack_channel_name: channel.name ?? name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  return { channelId: channel.id, channelName: channel.name ?? name, created: true };
}
