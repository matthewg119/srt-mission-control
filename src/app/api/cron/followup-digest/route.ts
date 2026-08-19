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
    // daily tick and nothing else; vercel.json already carries 14 cron entries against a
    // Hobby plan that documents 2, so adding a 15th to run one query is the wrong move.
    // This is already the "what is due today" run.
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

    return NextResponse.json({
      ok: true,
      dry,
      ...result,
      clientReports: { checked: reports.checked, reminded: reports.reminded.length },
      contentDigest: { posted: content.posted.length, skipped: content.skipped },
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
