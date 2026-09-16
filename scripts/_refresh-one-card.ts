// Re-render ONE step's card, in place, to see a change live without churning a board.
//
// ‼️ IT EDITS, IT DOES NOT RE-POST, which is the only reason this is safe to run against a real
// client. postStep is idempotent on slack_message_ts: a step that already has a card is edited
// and keeps its position. Slack orders a channel by post time, so a delete-and-repost would move
// that step to the bottom permanently.
//
// ‼️ IT REFUSES A STEP THAT HAS NO CARD YET. Posting a card for a step that has not been reached
// is exactly the ungated surface reachableCursor exists to prevent, and this script is not the
// place to make that decision.
//
// ‼️ A CARD RENDERED FROM A LOCAL SHELL CARRIES THAT SHELL'S ENVIRONMENT INTO SLACK, AND THIS
// SCRIPT REFUSES RATHER THAN LETTING IT. Two ways it goes wrong, both observed:
//
//   NEXT_PUBLIC_APP_URL   .env.local sets it to http://localhost:3000, so every board link on
//                         the card publishes as a localhost URL nobody else can open.
//   CLIENT_LINK_SECRET    Vercel-only. Without it previewLinkLine prints "No shareable link
//                         could be minted: CLIENT_LINK_SECRET is not set on this environment",
//                         which is a true sentence about the wrong environment sitting in a
//                         card that a person reads as being about production.
//
// Both are silent: the card renders, Slack accepts it, and the damage is a line of text that
// is simply wrong until something re-renders it from production.
//
//   NEXT_PUBLIC_APP_URL=https://mission.srtagency.com \
//   CLIENT_LINK_SECRET=... \
//   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
//     bunx tsx --env-file=.env.local scripts/_refresh-one-card.ts <clientId> <stepKey>
//
// Easier: press any button on the card in Slack. That re-renders it through the production
// function with the production environment, which is what you actually want.
import { supabaseAdmin } from "@/lib/db";
import { isStepKey } from "@/config/delivery-steps";

async function main() {
  const [clientId, stepKey] = process.argv.slice(2);
  if (!clientId || !stepKey) {
    console.error("usage: _refresh-one-card.ts <clientId> <stepKey>");
    process.exit(1);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const problems: string[] = [];
  if (/localhost|127\.0\.0\.1/i.test(appUrl)) {
    problems.push(`NEXT_PUBLIC_APP_URL is ${appUrl}, so every link on the card would be a localhost URL`);
  }
  if (!process.env.CLIENT_LINK_SECRET) {
    problems.push(
      "CLIENT_LINK_SECRET is unset, so the card would say no preview link could be minted, " +
        "which is a statement about THIS shell wearing production's clothes"
    );
  }
  if (problems.length) {
    console.error("Refusing to render a card with this environment:");
    for (const p of problems) console.error(`  • ${p}`);
    console.error("");
    console.error("Pass them inline, or press a button on the card in Slack and let production");
    console.error("re-render it, which is the better answer anyway.");
    process.exit(1);
  }
  if (!isStepKey(stepKey)) {
    console.error(`${stepKey} is not a step key`);
    process.exit(1);
  }

  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status, slack_anchor_ts, slack_message_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (!row) {
    console.error("no such step on this client's board");
    process.exit(1);
  }
  if (!row.slack_message_ts) {
    console.error(
      `${stepKey} has no card yet (status ${row.status}). This script only re-renders an ` +
        "existing one; posting a new card is reachableCursor's decision, not this script's."
    );
    process.exit(1);
  }

  console.log(`${stepKey}: status ${row.status}, editing message ${row.slack_message_ts}`);

  const { postStep } = await import("@/lib/clients/step-engine");
  await postStep(clientId, stepKey);

  console.log("Edited in place. Open the step's thread in Slack.");
}

main();

export {};
