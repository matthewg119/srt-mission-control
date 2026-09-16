// Does the board still resolve a channel, and would a per-client channel still be routed?
//
// ‼️ THE FAILURE THIS EXISTS TO CATCH IS SILENT AND TOTAL. Every step anchor is stored as a
// BARE timestamp with no channel beside it. If channelFor() returns the wrong channel, or if
// clientForThread refuses a client's own channel, nothing errors: chat.update answers
// message_not_found, slackFetch returns {ok:false}, and the board simply stops responding while
// looking exactly as it did.
//
//   bunx tsx --env-file=.env.local scripts/_probe-ops-channel.ts [clientId]
//
// SLACK_CLIENT_ONBOARDING_CHANNEL lives only in Vercel, so pass it inline to exercise the
// fallback:
//   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU bunx tsx --env-file=.env.local \
//     scripts/_probe-ops-channel.ts <clientId>
import { supabaseAdmin } from "@/lib/db";
import { channelFor } from "@/lib/clients/step-board";
import { isClientChannel } from "@/lib/clients/onboarding-docs";

let failures = 0;
function check(pass: boolean, label: string, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    failures += 1;
    if (detail) console.log(`      ${detail}`);
  }
}

async function main() {
  // ── 1. The columns exist ──────────────────────────────────────────────────
  const { error: colError } = await supabaseAdmin
    .from("clients")
    .select("ops_channel_id, ops_channel_name, ops_index_ts")
    .limit(1);

  check(
    !colError,
    "clients carries ops_channel_id, ops_channel_name and ops_index_ts",
    colError ? `${colError.message} — run docs/2026-09-08-client-ops-channel.sql` : undefined
  );
  if (colError) {
    console.log("\nNothing else can be checked until that migration runs.");
    process.exit(1);
  }

  // ── 2. No two clients share a channel ─────────────────────────────────────
  //
  // The unique partial index enforces this, but a probe that only trusts the index would not
  // notice the index missing. Two clients on one channel routes one client's step threads into
  // the other's board.
  const { data: withChannels } = await supabaseAdmin
    .from("clients")
    .select("id, slug, ops_channel_id")
    .not("ops_channel_id", "is", null);

  const seen = new Map<string, string>();
  let collisions = 0;
  for (const row of withChannels ?? []) {
    const ch = row.ops_channel_id as string;
    const prior = seen.get(ch);
    if (prior) {
      collisions += 1;
      console.log(`      ${ch} claimed by both ${prior} and ${row.slug}`);
    }
    seen.set(ch, row.slug as string);
  }
  check(collisions === 0, `no channel is claimed twice (${withChannels?.length ?? 0} client channels)`);

  // ── 3. Routing accepts every channel the board writes to ─────────────────
  const shared = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (shared) {
    check(await isClientChannel(shared), "the shared onboarding channel routes");
  } else {
    console.log("SKIP  SLACK_CLIENT_ONBOARDING_CHANNEL not set, pass it inline to check the fallback");
  }

  for (const row of (withChannels ?? []).slice(0, 5)) {
    const ch = row.ops_channel_id as string;
    check(await isClientChannel(ch), `${row.slug}'s own channel routes`);
  }

  // ‼️ AND SOMETHING THAT IS NOT A CLIENT CHANNEL MUST NOT. A gate that answered true for
  // everything would route #content-full into the client lane, which is the failure the
  // events-route comment describes: a long model answer at channel top level.
  check(!(await isClientChannel("C_NOT_A_REAL_CHANNEL")), "an unrelated channel does not route");
  check(!(await isClientChannel("")), "an empty channel id does not route");

  // ── 4. One client, end to end ─────────────────────────────────────────────
  const clientId = process.argv[2];
  if (!clientId) {
    console.log("\nNo client id given. Pass one to resolve a real board's channel.");
    if (failures) process.exit(1);
    console.log("\nAll checks passed.");
    return;
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("slug, ops_channel_id, ops_channel_name, ops_index_ts, ops_thread_ts")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    console.log(`\nNo client ${clientId}.`);
    process.exit(1);
  }

  const resolved = await channelFor(clientId);
  const own = (client.ops_channel_id as string | null) ?? null;

  console.log(`\n${client.slug}:`);
  console.log(`  ops_channel_id  ${own ?? "null (uses the shared channel)"}`);
  console.log(`  ops_index_ts    ${client.ops_index_ts ?? "not posted"}`);
  console.log(`  channelFor()    ${resolved ?? "null"}`);

  check(resolved !== null, "channelFor resolves a channel for this client");
  check(
    own ? resolved === own : resolved === shared,
    own ? "it resolves to their own channel" : "it falls back to the shared channel"
  );

  // ‼️ THE ANCHORS ARE THE THING THAT CANNOT SURVIVE A CHANGED CHANNEL, so say how many are at
  // stake. This is the number that would be orphaned if ops_channel_id were ever moved.
  const { count } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .not("slack_anchor_ts", "is", null);

  console.log(`  ${count ?? 0} anchors are addressed through it, and every one stores a bare ts.`);

  if (failures) {
    console.log(`\n${failures} failing.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();

export {};
