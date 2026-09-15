/**
 * Add a person to a client's private ops channel, and nothing else.
 *
 * Every client provisioned before feat/booking-door got a PRIVATE channel with only the bot in it,
 * because startPilot called createOpsChannel without an invite. A private channel cannot be found
 * from the channel browser, so the board inside it was unreadable. This reads ops_channel_id and
 * invites. It posts nothing, moves nothing, and never touches ops_channel_id (write-once).
 *
 *   bunx tsx --env-file=.env.local scripts/_invite-ops-channel.ts <slug>                 # read only
 *   bunx tsx --env-file=.env.local scripts/_invite-ops-channel.ts <slug> --yes [--user=U…]
 */
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";

export {};

const SLUG = process.argv[2];
const CONFIRMED = process.argv.includes("--yes");
const USER =
  process.argv.find((a) => a.startsWith("--user="))?.slice("--user=".length) ??
  process.env.MATTHEW_SLACK_USER_ID ??
  "U074ZQ1K0UE";

async function main() {
  if (!SLUG || SLUG.startsWith("--")) {
    console.error("usage: _invite-ops-channel.ts <slug> [--yes] [--user=U…]");
    process.exit(1);
  }

  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, ops_channel_id, ops_channel_name, ops_thread_ts, intake_completed_at, created_at")
    .eq("slug", SLUG)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!client) {
    const { data: near } = await supabaseAdmin
      .from("clients")
      .select("slug, legal_name, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    console.error(`No client with slug ${SLUG}. Newest clients:`, near);
    process.exit(1);
  }

  console.log(client);
  if (!client.ops_channel_id) {
    console.log("No ops_channel_id: this client's board is in the shared onboarding channel. Nothing to invite into.");
    return;
  }
  if (!CONFIRMED) {
    console.log(`Dry run. Would invite ${USER} into #${client.ops_channel_name} (${client.ops_channel_id}). Pass --yes.`);
    return;
  }

  const res = (await slack.inviteToChannel(client.ops_channel_id as string, USER)) as { ok?: boolean; error?: string };
  if (res.ok || res.error === "already_in_channel") {
    console.log(`OK: ${USER} is in #${client.ops_channel_name} (${res.ok ? "invited" : "already there"}).`);
  } else {
    console.error(`Invite failed: ${res.error ?? "unknown"}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
