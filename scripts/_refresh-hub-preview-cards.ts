// Re-render the step 15 / step 16 instruction cards for clients already sitting on them.
//
// WHY IT IS NEEDED ONCE. `instructionsFor` builds a card at the moment the step is posted, so
// every client whose hub_preview card went out before the skin lane existed has a card that does
// not mention templates. The commands work regardless — the Slack handler is keyed on the STEP,
// not on what the card says — so this is discoverability, not function.
//
// ‼️ IT EDITS, IT DOES NOT POST. postStep is idempotent on slack_message_ts and calls
// slack.updateMessage when one exists, so this rewrites the card in place. It does not move the
// step to the bottom of the channel, which step-board.ts says can never be undone.
//
// ‼️ IT CANNOT CHANGE A STEP'S STATUS. postStep's status write is gated
// `.in("status", ["pending","blocked","ready","error"])`, so a row at `awaiting_me` — where a
// posted card always sits — is untouched. A row at `ready` or `error` WOULD be moved, so those
// are reported and skipped rather than refreshed.
//
// ‼️ IT VERIFIES THE EDIT BY READING THE CARD BACK, AND THE FIRST CUT DID NOT.
// It counted postStep CALLS and printed "1 card(s) edited". postStep opens with
// `if (!process.env.SLACK_CLIENT_ONBOARDING_CHANNEL) return;` and that variable is not in
// .env.local, so it returned immediately and the script cheerfully reported a success that had
// not happened. Same failure family as every "slackFetch returns {ok:false} and never throws"
// note in this repo: an unchecked Slack call is a confident lie. It now pre-flights the env and
// then reads the thread back and looks for the menu it just claimed to write.
//
// Dry run by default. Pass --write to actually edit.
//
//   bunx tsx --env-file=.env.local scripts/_refresh-hub-preview-cards.ts
//   SLACK_CLIENT_ONBOARDING_CHANNEL=C0... bunx tsx --env-file=.env.local scripts/_refresh-hub-preview-cards.ts --write

import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";
import { postStep } from "../src/lib/clients/step-engine";
import { loadSkin } from "../src/lib/clients/hub-skin";

const STEPS = ["hub_preview", "review_tool_preview"];

/** The only status a posted card sits at. See the header for why the others are skipped. */
const REFRESHABLE = "awaiting_me";

/** A string the refreshed card must contain, or the edit did not do what it claimed. */
const MENU_MARKER = "template clinic";

async function cardCarriesMenu(
  channel: string,
  anchorTs: string,
  cardTs: string
): Promise<boolean | null> {
  // conversationsReplies returns an ARRAY (and [] on any failure), not {ok, messages}.
  const messages = await slack.conversationsReplies(channel, anchorTs, 50);
  if (!messages.length) return null; // could not read; not the same as "the menu is absent"
  const card = messages.find((m) => (m.ts as string) === cardTs);
  if (!card) return null;
  return JSON.stringify(card.blocks ?? card.text ?? "").includes(MENU_MARKER);
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const degraded = process.argv.includes("--degraded");
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // ‼️ THIS SCRIPT REBUILDS A CARD FROM WHATEVER ENVIRONMENT IT RUNS IN, AND THAT IS THE WHOLE
  // HAZARD. instructionsFor reads NEXT_PUBLIC_APP_URL and CLIENT_LINK_SECRET at render time, so
  // a run from a dev shell does not "refresh" the card, it REWRITES it with dev values. Measured,
  // not theorised: the first run put http://localhost:3000 into both board links on a live card
  // and replaced a working screen-share link with "CLIENT_LINK_SECRET is not set".
  //
  // The pre-flight is therefore about the ENVIRONMENT, not just the channel.
  if (write) {
    const problems: string[] = [];
    if (!channel) {
      problems.push(
        "SLACK_CLIENT_ONBOARDING_CHANNEL is not set, so postStep returns on its first line and\n" +
          "  nothing at all would be edited."
      );
    }
    // A localhost APP_URL silently corrupts every link on the card, which is worse than not
    // running: the card still looks complete and every link on it is dead for anyone but you.
    if (!/^https:\/\//.test(appUrl) || /localhost|127\.0\.0\.1/.test(appUrl)) {
      problems.push(
        `NEXT_PUBLIC_APP_URL is ${appUrl || "unset"}. Every board link on the card is built from\n` +
          "  it, so this run would publish localhost URLs into a live Slack card."
      );
    }
    if (problems.length) {
      console.error("Refusing to write:\n\n  " + problems.join("\n\n  ") + "\n");
      console.error(
        "Set them for this run, or make the change from the client board instead: any step\n" +
          "transition runs the same cascade inside production, where the real values are."
      );
      process.exit(1);
    }

    // CLIENT_LINK_SECRET is a softer failure: it costs ONE line (the shareable screen-share
    // link degrades to "could not be minted") and corrupts nothing. It still must be a
    // deliberate choice rather than a surprise, because that line is the one somebody hands a
    // client on a call.
    if (!process.env.CLIENT_LINK_SECRET) {
      if (!degraded) {
        console.error(
          "CLIENT_LINK_SECRET is not set. The card would keep every other line but lose the\n" +
            '"safe to screen-share" preview link, which would read "could not be minted".\n\n' +
            "Re-run with --degraded if that is acceptable, or rebuild from the client board."
        );
        process.exit(1);
      }
      console.log(
        "!! --degraded: no CLIENT_LINK_SECRET, so the screen-share preview link will be\n" +
          "   replaced by the could-not-be-minted note. Everything else is written normally.\n"
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id, step_key, status, slack_message_ts, slack_anchor_ts")
    .in("step_key", STEPS);

  if (error) {
    console.error("could not read the steps:", error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  if (!rows.length) {
    console.log("No hub_preview or review_tool_preview rows exist yet. Nothing to refresh.");
    return;
  }

  const names = new Map<string, string>();
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name")
    .in("id", [...new Set(rows.map((r) => r.client_id as string))]);
  for (const c of clients ?? []) {
    names.set(c.id as string, ((c.dba_name as string | null) || (c.legal_name as string)) ?? "");
  }

  console.log(write ? "WRITING\n" : "DRY RUN (pass --write to apply)\n");

  let verified = 0;
  let unverified = 0;
  let skipped = 0;

  for (const row of rows) {
    const clientId = row.client_id as string;
    const stepKey = row.step_key as string;
    const label = `${names.get(clientId) ?? clientId} · ${stepKey}`;
    const skin = await loadSkin(clientId);

    if (!row.slack_message_ts) {
      console.log(`  skip   ${label} — no card posted yet, so it will be built fresh and correct`);
      skipped++;
      continue;
    }
    if (row.status !== REFRESHABLE) {
      console.log(
        `  skip   ${label} — status is ${row.status}; refreshing would rewrite it to awaiting_me`
      );
      skipped++;
      continue;
    }

    if (!write) {
      console.log(`  would  ${label} — currently template=${skin.template} (${skin.source})`);
      continue;
    }

    await postStep(clientId, stepKey);

    const carries = await cardCarriesMenu(
      channel as string,
      row.slack_anchor_ts as string,
      row.slack_message_ts as string
    );

    if (carries === true) {
      console.log(`  ok     ${label} — card edited and the menu is on it`);
      verified++;
    } else if (carries === false) {
      console.log(`  FAILED ${label} — postStep ran and the card still has no menu on it`);
      unverified++;
    } else {
      console.log(
        `  UNSURE ${label} — postStep ran but the thread could not be read back, so nothing is proven`
      );
      unverified++;
    }
  }

  if (!write) {
    console.log("\nNothing was changed. Re-run with --write.");
    return;
  }
  console.log(`\n${verified} verified, ${unverified} not verified, ${skipped} skipped.`);
  if (unverified) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
