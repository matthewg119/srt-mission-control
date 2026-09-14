// Twenty AEO headlines a week, per client. Matthew: "Ideally I want each client to generate 20
// direct response headlines per week so we can select as many as we want and create posts around
// those headlines."
//
// ‼️ A PASSENGER ON /api/cron/followup-digest, NOT A CRON OF ITS OWN, and that refusal is the same
// one the file it rides on states at the top and the same one weekly-report.ts and funnel-report.ts
// both restate. vercel.json already carries SEVENTEEN cron entries against a Hobby plan that
// documents two. Adding an eighteenth to write twenty questions once a week is exactly the move
// that warning exists to prevent.
//
// ‼️ THE ISO WEEK IS THE IDEMPOTENCY KEY AND client_headlines IS ITS OWN LEDGER. The digest is a
// DAILY cron, so this fires seven times a week and must write once. No new table: the rows it
// writes carry the stamp, so "have I run this week" is a question the output itself answers.
// docs/2026-09-12-client-headlines.sql says so in the comment above iso_week.

import { supabaseAdmin } from "@/lib/db";
import { clientsInRhythm } from "./content-digest";
import { weekStamp } from "./weekly-report";
import {
  generateClientHeadlines,
  storeHeadlines,
  headlinesForWeek,
  WEEKLY_HEADLINES,
} from "./client-headlines";
import { slack } from "@/lib/slack-bot";

/**
 * Thursday, UTC. The same weekday runWeeklyReports uses.
 *
 * ‼️ DELIBERATELY THE SAME DAY AND NOT A DIFFERENT ONE. Both are "here is this week's work" and a
 * person reading one is in the frame of mind for the other. Splitting them across two days means
 * two separate interruptions for the same job.
 */
const HEADLINE_WEEKDAY = 4;

export interface WeeklyHeadlineRun {
  posted: number;
  skipped: number;
}

/**
 * Where the headlines land.
 *
 * ‼️ THE CLIENT'S OWN OPS CHANNEL, RESOLVED PER CLIENT, NEVER A SHARED ONE. Same property the
 * research door depends on: every client has their own channel, so a card cannot reach the wrong
 * client. At 14 onboardings a day a shared channel would mix fourteen sets of twenty headlines
 * into one scroll with nothing but a name to tell them apart.
 */
async function opsChannelFor(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("ops_channel_id")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    console.error(`[weekly-headlines] channel read failed: ${error.message}`);
    return null;
  }
  return (data?.ops_channel_id as string | null) ?? null;
}

function card(name: string, stamp: string, headlines: readonly string[], duplicates: number): string {
  const lines = [
    `:memo: *${name}, ${stamp}.* ${headlines.length} new headline${headlines.length === 1 ? "" : "s"}.`,
    "",
    ...headlines.map((h, i) => `${i + 1}. ${h}`),
  ];

  if (duplicates) {
    // ‼️ SAID OUT LOUD RATHER THAN HIDDEN. A run that returns twenty and files twelve is a run
    // whose bank is filling up, which is worth knowing before it reaches zero: it means the next
    // ones will need a new angle rather than another pass.
    lines.push(
      "",
      `${duplicates} more were phrasings of lines you have already seen, so they were not filed again.`
    );
  }

  lines.push("", "Approve the ones worth a page, and `batch` in the drafting channel turns them into one.");
  return lines.join("\n");
}

/**
 * Write this week's headlines for every client in rhythm.
 *
 * `now` and `force` exist for the probe, exactly as runWeeklyReports carries them.
 *
 * Never throws. Every caller is a cron passenger where a thrown error is a silent nothing, and
 * the route already isolates this one, but a passenger that relies on its host's catch to stay
 * quiet is one refactor away from taking the digest down.
 */
export async function runWeeklyHeadlines(opts?: {
  now?: Date;
  force?: boolean;
}): Promise<WeeklyHeadlineRun> {
  const now = opts?.now ?? new Date();
  if (!opts?.force && now.getUTCDay() !== HEADLINE_WEEKDAY) return { posted: 0, skipped: 0 };

  const clients = await clientsInRhythm();
  const stamp = weekStamp(now);
  let posted = 0;
  let skipped = 0;

  for (const c of clients) {
    try {
      // The ledger check, against the output's own rows. Anything already stamped this week means
      // the run happened, whether or not the Slack post that followed it worked.
      const already = await headlinesForWeek(c.clientId, stamp);
      if (already.length) {
        skipped += 1;
        continue;
      }

      const generated = await generateClientHeadlines({ clientId: c.clientId });
      if (!generated.ok) {
        // ‼️ NOT AN ERROR WORTH WAKING ANYBODY FOR, AND NOT SILENT EITHER. The commonest cause is
        // a client with no locked offer or no avatar yet, which headlineContext refuses by
        // design. That is a client who is not ready, not a broken job.
        console.error(`[weekly-headlines] ${c.name}: ${generated.error}`);
        skipped += 1;
        continue;
      }

      // ‼️ STORED BEFORE POSTING, the ordering runWeeklyReports uses and for the same reason: a
      // Slack failure must not produce a second set of twenty next time the digest runs.
      const stored = await storeHeadlines({
        clientId: c.clientId,
        headlines: generated.headlines,
        origin: "weekly",
        isoWeek: stamp,
      });

      if (!stored.ok) {
        console.error(`[weekly-headlines] ${c.name}: ${stored.error}`);
        skipped += 1;
        continue;
      }

      if (!stored.stored.length) {
        // Everything came back as a phrasing already on file. The bank is full enough that this
        // week's run had nothing new, which is a real state and not a failure.
        skipped += 1;
        continue;
      }

      const channel = await opsChannelFor(c.clientId);
      if (channel) {
        await slack
          .postMessage(channel, card(c.name, stamp, stored.stored.map((h) => h.headline), stored.duplicates))
          .catch((e) => console.error(`[weekly-headlines] post failed for ${c.name}:`, (e as Error).message));
      }

      posted += 1;
    } catch (e) {
      console.error(`[weekly-headlines] ${c.name} threw:`, (e as Error).message);
      skipped += 1;
    }
  }

  return { posted, skipped };
}
