/**
 * Wipe step 10's thread and run it again on the new automatic researcher.
 *
 * ‼️ WHY THIS EXISTS AT ALL. Step 10 used to post `deep-research-brief.txt`, three Spanish
 * messages a person pasted into ChatGPT. It runs the research itself now. Matthew has a live
 * client sitting on the old card and asked, in as many words, not to redo onboarding from step 1
 * to see the new one. So: delete what the bot said in that thread, put the step back to pending,
 * repost the card, run it.
 *
 * WHAT IT KEEPS: the ANCHOR. The top-level message is the step's position on the board and its
 * reaction history; deleting it would move the step to the bottom of the channel and lose the
 * ticks above it. Only the thread contents go.
 *
 * WHAT IT CAN AND CANNOT DELETE: `chat.delete` on a bot token only removes the bot's own
 * messages. Anything Matthew typed in that thread comes back `cant_delete_message` and is left
 * alone, which is the behaviour you want — his words are not this script's to remove.
 *
 * ‼️ NULLING slack_message_ts IS THE LOAD-BEARING LINE. Nothing else in the codebase has ever
 * cleared it. postStep() branches on it (step-engine.ts, the update-vs-post fork): with it set,
 * the "repost" silently becomes a chat.update against a message that no longer exists.
 *
 *   bun scripts/_rerun-step-10.ts <clientId> [--dry]
 */
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";

const STEP_KEY = "avatar_harvest" as const;

const CLIENT_ID = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!CLIENT_ID) {
  console.error("usage: bun scripts/_rerun-step-10.ts <clientId> [--dry]");
  process.exit(1);
}

async function main() {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) throw new Error("SLACK_CLIENT_ONBOARDING_CHANNEL is not set");

  const botUserId = process.env.SLACK_BOT_USER_ID;

  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts, slack_message_ts, status")
    .eq("client_id", CLIENT_ID)
    .eq("step_key", STEP_KEY)
    .maybeSingle();

  if (!row) throw new Error(`no ${STEP_KEY} row for client ${CLIENT_ID}`);

  const anchorTs = row.slack_anchor_ts as string | null;
  console.log(`step ${STEP_KEY}: status=${row.status} anchor=${anchorTs ?? "none"}`);

  // ── 1. Delete the bot's own replies in the thread ──────────────────────────
  if (anchorTs) {
    const replies = await slack.conversationsReplies(channel, anchorTs, 100);
    // Element 0 is the parent. Skip it: that is the anchor, which is being kept.
    const mine = replies.slice(1).filter((m) => {
      const isBot = m.bot_id != null || (botUserId != null && m.user === botUserId);
      return isBot;
    });

    console.log(`thread has ${replies.length - 1} replies, ${mine.length} from the bot`);

    for (const m of mine) {
      const ts = m.ts as string;
      const preview = String(m.text ?? "").replace(/\s+/g, " ").slice(0, 70);
      if (DRY) {
        console.log(`  would delete ${ts}  ${preview}`);
        continue;
      }
      const res = await slack.deleteMessage(channel, ts);
      const okFlag = (res as { ok?: boolean }).ok === true;
      console.log(`  ${okFlag ? "deleted" : `FAILED (${(res as { error?: string }).error})`} ${ts}  ${preview}`);
      // Slack rate-limits chat.delete hard (tier 3). Space them out.
      await new Promise((r) => setTimeout(r, 400));
    }
  } else {
    console.log("no anchor yet, so there is no thread to clear");
  }

  if (DRY) {
    console.log("\n--dry: stopping before any database write or re-run");
    return;
  }

  // ── 2. Forget the old card ────────────────────────────────────────────────
  const { error: clearErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .update({ slack_message_ts: null })
    .eq("client_id", CLIENT_ID)
    .eq("step_key", STEP_KEY);
  if (clearErr) throw new Error(`could not clear slack_message_ts: ${clearErr.message}`);
  console.log("cleared slack_message_ts");

  // ── 3. Reopen ─────────────────────────────────────────────────────────────
  // `reopened` clears status, completed_at/by, skipped_reason, the verified_* fields and
  // error_detail. That is what makes the row claimable by runReadyAutoSteps again; postStep
  // returns early on a row still marked complete or skipped.
  const { setDeliveryStep } = await import("../src/lib/clients/delivery-checklist");
  await setDeliveryStep({
    clientId: CLIENT_ID,
    stepKey: STEP_KEY,
    transition: "reopened",
    actor: "scripts/_rerun-step-10.ts",
  });
  console.log("step reopened");

  // ── 4. Run, THEN repost ───────────────────────────────────────────────────
  //
  // ‼️ THIS ORDER IS LOAD-BEARING AND THE OBVIOUS ONE IS WRONG. postStep parks the row at
  // `awaiting_me`, and runReadyAutoSteps only claims `pending`/`blocked`/`ready`. Posting the
  // card first would therefore make this step's runner permanently unclaimable, which is exactly
  // the starvation bug ac0b733 fixed and which _debug-post-all-steps.ts carries a warning about.
  //
  // Running first is also what makes the card useful: it renders a link to output_ref, which does
  // not exist until the researcher has filed the PDF.
  const { refreshStepAnchor } = await import("../src/lib/clients/step-board");
  const { postStep, runReadyAutoSteps } = await import("../src/lib/clients/step-engine");

  await refreshStepAnchor(CLIENT_ID, STEP_KEY);

  console.log("running the harvest and the researcher (a minute or two)...");
  const started = Date.now();
  await runReadyAutoSteps(CLIENT_ID);
  console.log(`runner done in ${Math.round((Date.now() - started) / 1000)}s`);

  await postStep(CLIENT_ID, STEP_KEY);
  console.log("card reposted");

  const { data: after } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status, output_ref, error_detail")
    .eq("client_id", CLIENT_ID)
    .eq("step_key", STEP_KEY)
    .maybeSingle();

  console.log(
    `\nfinal: status=${after?.status} output_ref=${after?.output_ref ?? "none"}` +
      (after?.error_detail ? `\nerror: ${after.error_detail}` : "")
  );
}

main().catch((e) => {
  console.error("threw:", e);
  process.exit(1);
});
