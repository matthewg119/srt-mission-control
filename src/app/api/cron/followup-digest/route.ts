export const dynamic = "force-dynamic";
// The Follow-Up Operator's daily run (Vercel Cron, 13:00 UTC = 09:00 ET).
//
// Sweeps Outlook Sent Items for pitches Matthew actually sent, advances the
// permission ladder for each, then posts the board to #followups_channel.
// Nothing here sends anything to a prospect: drafts are created in Outlook only
// after he picks one in the thread.
//
// ?dry=1 runs the sweep and the arithmetic and posts nothing, for checking a
// first run against a real mailbox.
//
// See src/lib/followup-operator/ and docs/2026-07-31-followup-operator.sql.

import { NextRequest, NextResponse } from "next/server";
import { runFollowupDigest } from "@/lib/followup-operator/digest";
import { runClientReportReminders } from "@/lib/clients/report-reminders";
import { runContentDigest } from "@/lib/clients/content-digest";
import { runWeeklyReports } from "@/lib/clients/weekly-report";
import { runWeeklyHeadlines } from "@/lib/clients/weekly-headlines";
import { runTimeLogNudges } from "@/lib/clients/time-log-nudge";
import { runFunnelReport } from "@/lib/experiments/funnel-report";
import { runPolicyScan } from "@/lib/clients/policy-scan";
import { runWeeklyCorpusScan } from "@/lib/clients/dataset-suggestions";
import { stepDigest } from "@/lib/clients/step-engine";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const result = await runFollowupDigest({ dry });

    // A PASSENGER on this job, deliberately. Client day 30 / 60 / 90 reminders need a
    // daily tick and nothing else; vercel.json already carries 17 cron entries against a
    // Hobby plan that documents 2, so adding an 18th to run one query is the wrong move.
    // This is already the "what is due today" run.
    //
    // (That count said 14 until 2026-09-14. It is 17 now, which makes the point harder
    // rather than softer, and a stale number in a warning is how a warning stops working.)
    //
    // Caught separately: a reminder failing must never turn the follow-up digest, which
    // is the job this route exists for, into a 500.
    // Runner v3 §3: errors and anything waiting on a person for more than 48h. Best-effort
    // and never allowed to take the rest of the digest down with it.
    if (!dry) {
      await stepDigest()
        .then(async (text) => {
          const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
          if (text && channel) await slack.postMessage(channel, `:clipboard: *Delivery steps*
${text}`);
        })
        .catch((e) => console.error("[cron/followup-digest] step digest failed:", (e as Error).message));
    }

    const reports = await runClientReportReminders({ dry }).catch((e) => {
      console.error("[followup-digest] client report reminders failed:", (e as Error).message);
      return { checked: 0, reminded: [] };
    });

    // Another passenger, same reasoning and the same isolation. It only does anything on
    // two weekdays; every other day it returns immediately without touching the database.
    const content = await runContentDigest({ dry }).catch((e) => {
      console.error("[followup-digest] content digest failed:", (e as Error).message);
      return { posted: [], skipped: [] };
    });

    // Two more passengers, same reasoning and the same isolation as the two above.
    //
    // The weekly report only does anything on one weekday and returns immediately on the
    // other six. Delivery step 32 is "weekly report firing", and firing is a rhythm rather
    // than a document, so there is no runner for it -- the first successful post is what
    // ticks the step. See weekly-report.ts.
    const weekly = dry
      ? { posted: 0, skipped: 0 }
      : await runWeeklyReports().catch((e) => {
          console.error("[followup-digest] weekly reports failed:", (e as Error).message);
          return { posted: 0, skipped: 0 };
        });

    // Step 31 is ticked by the time-log route itself. This is only the nudge for a client
    // past day 0 who has no entries at all, which is the state that quietly loses the whole
    // time record for a pilot.
    const timeLog = dry
      ? { nudged: 0 }
      : await runTimeLogNudges().catch((e) => {
          console.error("[followup-digest] time log nudges failed:", (e as Error).message);
          return { nudged: 0 };
        });

    // The med spa funnel's Friday report to #alerts-infra.
    // Sixth passenger on this job, for the reason written at the top of the
    // file: vercel.json's cron list is already long against the plan's
    // documented limit, and adding an entry to run four counts once a week is
    // exactly the move that warning exists to prevent. Returns immediately on
    // the other six days. Unlike the others it honours dry, because its whole
    // output is one Slack message and a dry run is how you check it.
    const funnelReport = await runFunnelReport({ dry }).catch((e) => {
      console.error("[followup-digest] funnel report failed:", (e as Error).message);
      return { posted: 0, reason: "threw" };
    });

    // Seventh passenger, same reasoning and the same isolation. Twenty AEO headlines per client
    // per week. Thursday only, and it returns immediately on the other six days without touching
    // the database. Idempotent on the ISO week against client_headlines itself, so a second run
    // on the same Thursday writes nothing.
    const headlines = dry
      ? { posted: 0, skipped: 0 }
      : await runWeeklyHeadlines().catch((e) => {
          console.error("[followup-digest] weekly headlines failed:", (e as Error).message);
          return { posted: 0, skipped: 0 };
        });

    // Eighth passenger, same reasoning and the same isolation. Reads Google's five published
    // guidance pages and posts a card into the drafting channel ONLY when one of them moved.
    // Thursday only, the same day as the two above, and it returns immediately on the other six
    // days without a single HTTP request.
    //
    // No week stamp: the content hash is a stronger idempotency key than the ISO week here. A
    // second run on the same Thursday re-reads the same bytes, matches what is live, stores
    // nothing and posts nothing. See the header of policy-scan.ts.
    const policyScan = dry
      ? { checked: 0, changed: [], failed: [], posted: false, skipped: null }
      : await runPolicyScan().catch((e) => {
          console.error("[followup-digest] policy scan failed:", (e as Error).message);
          return { checked: 0, changed: [], failed: [], posted: false, skipped: null };
        });

    // Ninth passenger. Reads page_dataset, the corpus that had no readers at all until
    // 2026-09-22, and proposes dataset fields that pages of one shape keep leaving unanswered.
    // Thursday, the same day as the three above, and silent when it has nothing new to propose.
    //
    // It proposes. It never declares: dataset-spec.ts stays the only authority on which fields
    // exist, and accepting a proposal means writing its FieldSpec by hand.
    const corpusScan = dry
      ? { verticals: 0, filed: 0, already: 0, posted: false, skipped: null }
      : await runWeeklyCorpusScan().catch((e) => {
          console.error("[followup-digest] corpus scan failed:", (e as Error).message);
          return { verticals: 0, filed: 0, already: 0, posted: false, skipped: null };
        });

    return NextResponse.json({
      ok: true,
      dry,
      ...result,
      clientReports: { checked: reports.checked, reminded: reports.reminded.length },
      contentDigest: { posted: content.posted.length, skipped: content.skipped },
      weeklyReports: weekly,
      weeklyHeadlines: headlines,
      timeLogNudges: timeLog,
      funnelReport,
      policyScan,
      corpusScan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[followup-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
