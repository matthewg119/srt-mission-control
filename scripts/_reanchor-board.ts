/**
 * Give a client's board a Slack card for every step that has no live one.
 *
 * ‼️ THIS DELETES NOTHING, REOPENS NOTHING, AND CHANGES NO STATUS. It exists for one shape of
 * problem: a client that was re-onboarded under a new id. The old id's `client_delivery_steps`
 * rows went with it on cascade, so its Slack cards are orphans whose buttons write to nothing,
 * while the live id's rows sit there with `slack_anchor_ts` null and no card at all. That is what
 * made SRT Agency's `gbp_buildout` look unskippable: the only card for it belonged to a client
 * that no longer existed.
 *
 * The bar for posting is deliberately narrow: `slack_anchor_ts IS NULL`. A step that already has
 * an anchor is left exactly as it is, because a second anchor for one step splits its thread and
 * every later reply lands on whichever half Slack happens to return first. postStepAnchor() is
 * itself guarded on `is null`, so this script and a concurrent cascade cannot both post.
 *
 * Manual steps also get their instruction card. Auto steps get the anchor only: their card is
 * posted by the runner when it finishes, and posting one here would put a card on the board for
 * work nothing has done.
 *
 * SLACK_CLIENT_ONBOARDING_CHANNEL lives only in Vercel, so pass it inline.
 *
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU bun scripts/_reanchor-board.ts <clientId> [--dry]
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=... bun scripts/_reanchor-board.ts <clientId> --only=gbp_buildout
 */
import { supabaseAdmin } from "../src/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "../src/config/delivery-steps";
import { postStepAnchor } from "../src/lib/clients/step-board";
import { postStep } from "../src/lib/clients/step-engine";

const CLIENT_ID = process.argv[2];
const DRY = process.argv.includes("--dry");
const ALL = process.argv.includes("--all");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;

if (!CLIENT_ID) {
  console.error("usage: bun scripts/_reanchor-board.ts <clientId> --only=<stepKey> | --all [--dry]");
  process.exit(1);
}

// ‼️ --only OR --all, NEVER A BARE RUN, AND THIS IS NOT A CONVENIENCE. Measured on SRT Agency:
// 19 of 35 step rows had no anchor, every one of them `pending` behind a blocker. That is the
// board working correctly, not damage: ensureReachableAnchors posts ONE anchor at a time so the
// channel shows the step to work on rather than the whole backlog. A bare run would have posted
// all 19 at once, most of them for work blocked behind `hub_preview` and `call_held`, and the
// board would then be louder and less true than before the repair.
if (!ONLY && !ALL) {
  console.error("refusing a bare run: pass --only=<stepKey> for the orphaned step, or --all");
  console.error("--all floods the channel with cards for blocked work, which a re-anchor");
  console.error("almost never needs. --dry shows what either would post.");
  process.exit(1);
}

async function main() {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) throw new Error("SLACK_CLIENT_ONBOARDING_CHANNEL is not set");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name")
    .eq("id", CLIENT_ID)
    .maybeSingle();

  // The whole point of the script is that dead ids exist, so say so plainly rather than throwing
  // a row-not-found that reads like a typo.
  if (!client) {
    throw new Error(
      `no clients row with id ${CLIENT_ID}. That id is dead: find the live one with ` +
        `select id, slug from clients order by created_at`
    );
  }

  const { data: rows } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_anchor_ts")
    .eq("client_id", CLIENT_ID);

  const byKey = new Map((rows ?? []).map((r) => [r.step_key as string, r]));
  console.log(`${client.legal_name ?? client.slug} (${client.slug})`);
  console.log(`${byKey.size} step rows against ${DELIVERY_STEPS.length} steps in config\n`);

  const missing = DELIVERY_STEPS.filter((s) => {
    if (ONLY && s.key !== ONLY) return false;
    const row = byKey.get(s.key);
    return Boolean(row) && !row?.slack_anchor_ts;
  });

  // A step in the config with no row at all is a different fault and a different fix: seeding.
  // Naming it here stops it being read as "already anchored".
  const unseeded = DELIVERY_STEPS.filter((s) => !byKey.has(s.key)).map((s) => s.key);
  if (unseeded.length) {
    console.log(`⚠ ${unseeded.length} step(s) have no row at all: ${unseeded.join(", ")}`);
    console.log("  seedDeliverySteps() upserts all of them at once. This script will not.\n");
  }

  if (!missing.length) {
    console.log("Nothing to do: every step row already carries an anchor.");
    return;
  }

  for (const step of missing) {
    const row = byKey.get(step.key);
    const n = stepNumber(step.key as StepKey);
    const kind = step.mode === "auto" ? "auto, anchor only" : "manual, anchor + card";
    if (DRY) {
      console.log(`would post  ${n}. ${step.key}  [${row?.status}]  (${kind})`);
      continue;
    }

    const anchored = await postStepAnchor(CLIENT_ID, step.key);
    if (!anchored.ok) {
      console.log(`FAILED      ${n}. ${step.key}: ${anchored.error}`);
      continue;
    }
    if (step.mode !== "auto") await postStep(CLIENT_ID, step.key);
    console.log(`posted      ${n}. ${step.key}  [${row?.status}]  ts=${anchored.ts}`);
  }

  console.log(`\n${DRY ? "dry run, nothing posted" : `${missing.length} step(s) handled`}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
