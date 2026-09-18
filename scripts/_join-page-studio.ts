// Invite the bot into #aeo-seo-page-drafting, and prove it worked.
//
//   bunx tsx --env-file=.env.local scripts/_join-page-studio.ts
//
// ‼️ THIS IS THE ONE THING BETWEEN THE PAGE STUDIO AND WORKING, AND IT IS NOT CODE.
// Slack lets a bot chat.postMessage into a PUBLIC channel it has never joined, but it does not
// DELIVER message events from one. That asymmetry is how this channel sat dead for weeks with no
// error anywhere: every reply the studio would have sent was never asked for.
//
// So without membership: the Thursday guidance card and the corpus card still POST, and
// `page <client>`, `check`, `scan for latest`, `waive:` and the Approve button never ARRIVE.
//
// Read-then-join-then-read, so the output says what actually changed rather than asserting it.

import { slack } from "../src/lib/slack-bot";
import { pageStudioChannel } from "../src/lib/clients/page-studio";

async function main(): Promise<void> {
  const channel = pageStudioChannel();
  const fromEnv = Boolean(process.env.SLACK_PAGE_STUDIO_CHANNEL);
  console.log(`Channel: ${channel} (${fromEnv ? "from SLACK_PAGE_STUDIO_CHANNEL" : "code fallback"})`);

  if (!process.env.SLACK_BOT_TOKEN) {
    console.log("SLACK_BOT_TOKEN is not set. Run with --env-file=.env.local.");
    process.exitCode = 1;
    return;
  }

  const before = await slack.getChannelInfo(channel);
  if (!before) {
    console.log("The channel could not be read at all. Check the id and the bot's scopes.");
    process.exitCode = 1;
    return;
  }
  console.log(`Before: #${before.name ?? "?"}  is_member=${before.is_member}  is_private=${before.is_private}  is_archived=${before.is_archived}`);

  if (before.is_member) {
    console.log("Already a member. Nothing to do.");
    return;
  }

  // ‼️ slackFetch RETURNS {ok:false} AND NEVER THROWS, so the body is checked, never the promise.
  const joined = await slack.joinChannel(channel);
  if (!joined.ok) {
    console.log(`conversations.join refused: ${joined.error ?? "unknown"}`);
    if (joined.error === "missing_scope") {
      console.log("The bot needs the channels:join scope, then reinstall the app.");
    }
    if (joined.error === "channel_not_found") {
      console.log("A private channel cannot be joined this way: invite the bot from inside Slack.");
    }
    process.exitCode = 1;
    return;
  }

  const after = await slack.getChannelInfo(channel);
  console.log(`After:  is_member=${after?.is_member}`);
  if (after?.is_member) {
    console.log("Joined. The page studio can now RECEIVE messages, not just post them.");
  } else {
    console.log("join returned ok but is_member is still false. Check the channel type.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
