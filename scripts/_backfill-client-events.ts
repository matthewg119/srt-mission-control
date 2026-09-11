/**
 * Read one client's Slack history into client_events, once.
 *
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_backfill-client-events.ts <slug> --dry
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_backfill-client-events.ts <slug> --yes
 *
 * ‼️ RUN IT BEFORE ANY RESET. _reset-client-board deletes the bot's cards by stored ts, and the
 * anchors it deletes are the only way to find those threads again. A history read afterwards finds
 * a channel with the replies still in it and no thread parents to walk from.
 *
 * ‼️ SAFE TO RUN TWICE. Every event is keyed on (slack_channel, slack_ts) and the unique
 * constraint makes a second pass a no-op, so a partial run is finished by running it again.
 *
 * ‼️ WHAT IT CANNOT RECOVER. Slack keeps what was said; it does not keep which button was pressed,
 * and a message the bot has already deleted is gone. This is the history that still exists, not a
 * reconstruction of everything that ever happened.
 *
 * SLACK_CLIENT_ONBOARDING_CHANNEL lives only in Vercel, so pass it inline. Without
 * --env-file=.env.local this returns nothing at all, silently.
 */
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";
import { logClientEvent, type EventKind } from "../src/lib/clients/client-events";

const SLUG = process.argv[2];
const DRY = process.argv.includes("--dry");
const CONFIRMED = process.argv.includes("--yes");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SLUG || (!DRY && !CONFIRMED)) {
  console.error("usage: _backfill-client-events.ts <slug> --dry | --yes");
  process.exit(1);
}

// A uuid here is the same mistake _reset-client-board refuses: SRT has been re-onboarded twice and
// every id written down in this repo for it is dead. The slug is the durable claim.
if (UUID.test(SLUG)) {
  console.error(`"${SLUG}" is a uuid. This takes a SLUG.`);
  process.exit(1);
}

/** What one stored Slack message was. */
function kindOf(message: Record<string, unknown>, botUserId: string | null): EventKind {
  const files = message.files as unknown[] | undefined;
  if (Array.isArray(files) && files.length > 0) return "file";
  if (message.bot_id || message.subtype === "bot_message") return "bot_post";
  if (botUserId && message.user === botUserId) return "bot_post";
  return "message";
}

async function main() {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, ops_channel_id, ops_thread_ts")
    .eq("slug", SLUG)
    .maybeSingle();

  if (!client) throw new Error(`no clients row with slug "${SLUG}"`);

  const clientId = client.id as string;
  const name = (client.dba_name as string) || (client.legal_name as string) || SLUG;

  // Their own channel if they have one, the shared channel otherwise. Same order channelFor uses.
  const channel = (client.ops_channel_id as string | null) || process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    throw new Error(
      "no channel: this client has no ops_channel_id and SLACK_CLIENT_ONBOARDING_CHANNEL is not set. " +
        "It lives only in Vercel; pass it inline. Production is C0BLK797PNU."
    );
  }

  console.log(`${name}  (${SLUG})`);
  console.log(`  client  ${clientId}`);
  console.log(`  channel ${channel}${client.ops_channel_id ? " (their own)" : " (shared)"}\n`);

  // Idempotent, and the difference between conversations.replies working and not on a channel the
  // bot did not create. It cannot join a PRIVATE channel and does not need to: it is a member of
  // anything it created itself.
  const joined = await slack.joinChannel(channel);
  if (!joined.ok) console.log(`joinChannel: ${joined.error ?? "refused"} (continuing)\n`);

  const botUserId = process.env.SLACK_BOT_USER_ID || (await slack.getBotUserId().catch(() => null));

  const { data: steps } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, slack_anchor_ts")
    .eq("client_id", clientId)
    .not("slack_anchor_ts", "is", null);

  const threads: Array<{ stepKey: string | null; ts: string }> = [
    ...(client.ops_thread_ts ? [{ stepKey: null, ts: client.ops_thread_ts as string }] : []),
    ...((steps ?? []).map((s) => ({
      stepKey: s.step_key as string,
      ts: s.slack_anchor_ts as string,
    }))),
  ];

  if (threads.length === 0) {
    console.log("No anchors and no ops thread: there is nothing to read.");
    return;
  }

  let read = 0;
  let wrote = 0;

  for (const thread of threads) {
    const messages = await slack.conversationsRepliesAll(channel, thread.ts);
    read += messages.length;

    const label = thread.stepKey ?? "(the pinned header)";
    console.log(`  ${String(messages.length).padStart(4)} message(s)  ${label}`);

    if (DRY) continue;

    for (const message of messages) {
      const text = String(message.text ?? "").trim();
      const files = (message.files as Array<{ name?: string }> | undefined) ?? [];
      if (!text && files.length === 0) continue;

      await logClientEvent({
        clientId,
        stepKey: thread.stepKey,
        source: "slack",
        kind: kindOf(message, botUserId),
        author: (message.user as string) ?? (message.bot_id ? "Mission Control" : null),
        text: text || files.map((f) => f.name ?? "a file").join(", "),
        slackChannel: channel,
        slackTs: message.ts as string,
        slackThreadTs: thread.ts,
        payload: { backfilled: true, ...(files.length ? { files: files.length } : {}) },
      });
      wrote += 1;
    }

    // Slack tier 3. The same spacer the reset script settled on for chat.delete.
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n${threads.length} thread(s), ${read} message(s) read.`);

  if (DRY) {
    console.log("--dry: nothing written. Re-run with --yes to store them.");
    return;
  }

  const { count } = await supabaseAdmin
    .from("client_events")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  console.log(`${wrote} offered, ${count ?? 0} events now on file for this client.`);
  console.log("(Offered minus stored is the duplicates the unique constraint skipped.)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
