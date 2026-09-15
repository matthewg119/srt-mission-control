/**
 * Add a person to client private ops channels, and nothing else.
 *
 * Every client provisioned before feat/booking-door got a PRIVATE channel with only the bot in it,
 * because startPilot called createOpsChannel without an invite. A private channel cannot be found
 * from the channel browser, so the board inside it was unreadable. This reads ops_channel_id and
 * invites. It posts nothing, moves nothing, and never touches ops_channel_id (write-once).
 *
 *   bunx tsx --env-file=.env.local scripts/_invite-ops-channel.ts <slug>             # read only
 *   bunx tsx --env-file=.env.local scripts/_invite-ops-channel.ts <slug> --yes
 *   bunx tsx --env-file=.env.local scripts/_invite-ops-channel.ts --all [--yes]     # every client channel
 *   add --user=U… to invite somebody other than Matthew
 */
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";
import { onboardingOwnerId } from "../src/lib/clients/provision";

export {};

const ALL = process.argv.includes("--all");
const SLUG = ALL ? null : process.argv[2];
const CONFIRMED = process.argv.includes("--yes");
const USER = process.argv.find((a) => a.startsWith("--user="))?.slice("--user=".length) ?? onboardingOwnerId();

async function main() {
  if (!ALL && (!SLUG || SLUG.startsWith("--"))) {
    console.error("usage: _invite-ops-channel.ts <slug> | --all  [--yes] [--user=U…]");
    process.exit(1);
  }

  let query = supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, ops_channel_id, ops_channel_name")
    .not("ops_channel_id", "is", null)
    .order("created_at", { ascending: false });
  if (SLUG) query = query.eq("slug", SLUG);

  const { data: clients, error } = await query;
  if (error) throw new Error(error.message);
  if (!clients?.length) {
    console.log(SLUG ? `No client with slug ${SLUG} has a private channel.` : "No client has a private channel.");
    return;
  }

  let failures = 0;
  for (const c of clients) {
    const label = `${c.slug} -> #${c.ops_channel_name} (${c.ops_channel_id})`;
    if (!CONFIRMED) {
      console.log(`dry run: would invite ${USER} into ${label}`);
      continue;
    }
    const res = (await slack.inviteToChannel(c.ops_channel_id as string, USER)) as { ok?: boolean; error?: string };
    if (res.ok) console.log(`invited   ${label}`);
    else if (res.error === "already_in_channel") console.log(`already   ${label}`);
    else {
      failures++;
      console.error(`FAILED    ${label}: ${res.error ?? "unknown"}`);
    }
  }
  if (!CONFIRMED) console.log(`\n${clients.length} channel(s). Pass --yes to invite.`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
