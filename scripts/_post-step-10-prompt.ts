/**
 * Put the deep-research prompt into step 10's EXISTING thread. One message, nothing else touched.
 *
 * ‼️ THIS IS NOT _rerun-step-10.ts AND MUST NOT BECOME IT. That script wipes the bot's replies,
 * nulls slack_message_ts, reopens the row and reposts the card. Matthew asked for the opposite in
 * as many words: "dont delete our current step 10 in slack onboarding to rerun, send another
 * message with step 10 but this time make it give me the prompt". So this reads the anchor and
 * posts one reply under it. No delete, no status change, no card.
 *
 * It exists because the two files that would otherwise do this, the runner and the `prompt`
 * keyword, both live in code that is not deployed yet. This runs locally against the same
 * Supabase and the same Slack, so the message lands regardless.
 *
 * SLACK_CLIENT_ONBOARDING_CHANNEL is only in Vercel, not .env.local. Pass it inline.
 *
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU bun scripts/_post-step-10-prompt.ts <clientId> [--dry]
 */
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";
import { buildContext, buildCompactPrompt } from "../src/lib/clients/artifacts/deep-research-run";

const STEP_KEY = "avatar_harvest" as const;

const CLIENT_ID = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!CLIENT_ID) {
  console.error("usage: bun scripts/_post-step-10-prompt.ts <clientId> [--dry]");
  process.exit(1);
}

async function main() {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) throw new Error("SLACK_CLIENT_ONBOARDING_CHANNEL is not set");

  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts, status, output_ref")
    .eq("client_id", CLIENT_ID)
    .eq("step_key", STEP_KEY)
    .maybeSingle();

  if (!row) throw new Error(`no ${STEP_KEY} row for client ${CLIENT_ID}`);

  const anchorTs = row.slack_anchor_ts as string | null;
  console.log(`step ${STEP_KEY}: status=${row.status} anchor=${anchorTs ?? "none"}`);

  // ‼️ REFUSES RATHER THAN CREATING ONE. anchorTsFor() would post a fresh anchor, which on a live
  // client means a second step-10 card at the bottom of the channel and two threads for one step.
  if (!anchorTs) {
    throw new Error(
      "this step has no anchor, so there is no thread to post into. Creating one here would " +
        "leave two cards for the same step. Run the step normally instead."
    );
  }

  const built = await buildContext(CLIENT_ID);
  if (!built.ok) throw new Error(`could not build the prompt: ${built.error}`);

  const prompt = buildCompactPrompt(built.ctx);
  console.log(`prompt is ${prompt.length} characters\n`);
  console.log(prompt);
  console.log();

  const message = [
    `:brain: Deep research prompt for *${built.ctx.avatarLabel}*. This step no longer runs the ` +
      "research itself. Copy the block and run it in claude.com deep research.",
    "",
    "```",
    prompt,
    "```",
    "",
    "Bring the answer back into this thread: paste it with `research:` in front of it, or drop " +
      "the PDF straight in. Then press Done.",
  ].join("\n");

  if (message.length > 3900) {
    throw new Error(
      `the message is ${message.length} characters and Slack truncates over 4,000. ` +
        "Shorten the prompt rather than splitting it: a prompt in two pieces gets pasted in one."
    );
  }

  if (DRY) {
    console.log(`--dry: would post ${message.length} characters to ${channel} under ${anchorTs}`);
    return;
  }

  const res = (await slack.postThreadReply(channel, anchorTs, message)) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };

  if (!res?.ok) throw new Error(`the post failed: ${res?.error ?? "unknown"}`);
  console.log(`posted ${message.length} characters as ${res.ts}`);

  // Filed against the avatar so the next client in this vertical is handed the same prompt.
  const { recordAvatarPrompt } = await import("../src/lib/clients/avatars");
  await recordAvatarPrompt({
    vertical: built.ctx.vertical,
    avatarSlug: built.ctx.avatarSlug,
    avatarLabel: built.ctx.avatarLabel,
    promptText: prompt,
    clientId: CLIENT_ID,
  });
  console.log("prompt filed against the avatar");
}

main().catch((e) => {
  console.error("threw:", (e as Error).message);
  process.exit(1);
});
