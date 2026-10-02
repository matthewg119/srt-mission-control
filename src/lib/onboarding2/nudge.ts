// "They tried and stopped." One message, five minutes after somebody goes quiet mid-funnel.
//
// ‼️ IT RIDES AN EXISTING CRON AND DOES NOT ADD AN EIGHTEENTH. vercel.json already declares 17
// against a Hobby plan whose documented limit is 2, and two of them are already `*/5 * * * *`.
// A new entry is the thing most likely to make the whole set stop firing, so this is a passenger
// on outreach-sender, which runs at exactly the cadence this needs anyway.
//
// ‼️ IT POSTS INTO THE LEAD'S OWN THREAD, NOT A NEW CARD. The card already exists: it was posted
// the moment they gave a phone. A second top-level message about the same person is how #hot-leads
// becomes two rows per lead and nobody can tell which is current.
//
// ‼️ ONCE, EVER, PER PERSON. `nudged_at` is the latch and it is set whether or not Slack accepted
// the message. A nudge that retried every five minutes until it succeeded would, on a Slack
// outage, deliver the whole backlog at once an hour later, which is worse than missing one.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

/**
 * How long a visitor may be quiet before they count as stalled.
 *
 * Matthew asked for five minutes. It is a floor rather than a promise: the sweep runs every five
 * minutes, so in practice somebody is chased between five and ten minutes after their last answer.
 * Saying so here stops the next person reading this from treating a six-minute gap as a bug.
 */
const STALL_MS = 5 * 60 * 1000;

/** Never chase something from last week on the first run after a deploy. */
const TOO_OLD_MS = 24 * 60 * 60 * 1000;

const STEP_LABEL: Record<string, string> = {
  phone: "left a phone number and stopped there",
  reactivation: "answered the reactivation offer and stopped there",
  email: "gave an email and stopped before the offer",
  offer: "reached the offer screen and did not pick one",
};

export interface NudgeResult {
  checked: number;
  nudged: number;
  errors: string[];
}

export async function sweepAbandonedOnboardings(): Promise<NudgeResult> {
  const now = Date.now();
  const cutoff = new Date(now - STALL_MS).toISOString();
  const floor = new Date(now - TOO_OLD_MS).toISOString();
  const out: NudgeResult = { checked: 0, nudged: 0, errors: [] };

  const { data, error } = await supabaseAdmin
    .from("onboarding2_progress")
    .select("id, contact_id, name, phone, website, email, furthest_step, updated_at")
    .is("completed_at", null)
    .is("nudged_at", null)
    .lt("updated_at", cutoff)
    .gt("updated_at", floor)
    .limit(25);

  if (error) {
    // ‼️ A MISSING TABLE IS NOT AN OUTAGE. Until the migration runs this reads as an error every
    // five minutes, and the passenger must stay quiet rather than filling the log of a cron that
    // has its own job to do.
    if (!/does not exist|schema cache/i.test(error.message)) out.errors.push(error.message);
    return out;
  }

  const rows = data ?? [];
  out.checked = rows.length;

  for (const r of rows as Record<string, unknown>[]) {
    const id = String(r.id);
    const phone = String(r.phone ?? "");
    const step = String(r.furthest_step ?? "");

    // Latch FIRST. See the header: at-most-once beats at-least-once here.
    const { error: latchErr } = await supabaseAdmin
      .from("onboarding2_progress")
      .update({ nudged_at: new Date().toISOString() })
      .eq("id", id)
      .is("nudged_at", null);
    if (latchErr) {
      out.errors.push(`latch ${id}: ${latchErr.message}`);
      continue;
    }

    const lines = [
      `:hourglass_flowing_sand: *${String(r.name ?? "Someone")} started onboarding and stopped.*`,
      `They ${STEP_LABEL[step] ?? `got as far as ${step}`}.`,
      `Phone: ${phone}`,
      r.email ? `Email: ${String(r.email)}` : null,
      r.website ? `Website: ${String(r.website)}` : null,
      "Nothing was charged and nothing was signed. Worth a call while it is warm.",
    ].filter(Boolean) as string[];

    // Into their own thread when we have one, so the chase sits under the card it is about.
    let channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
    let threadTs: string | null = null;
    if (r.contact_id) {
      const { data: c } = await supabaseAdmin
        .from("contacts")
        .select("slack_thread_ts, slack_channel")
        .eq("id", String(r.contact_id))
        .maybeSingle();
      threadTs = (c?.slack_thread_ts as string | null) ?? null;
      channel = (c?.slack_channel as string | null) || channel;
    }
    if (!channel) {
      out.errors.push("SLACK_HOT_LEADS_CHANNEL is not set");
      continue;
    }

    try {
      if (threadTs) await slack.postThreadReply(channel, threadTs, lines.join("\n"));
      else await slack.postMessage(channel, lines.join("\n"));
      out.nudged += 1;
    } catch (e) {
      out.errors.push(`post ${id}: ${(e as Error).message}`);
    }
  }

  return out;
}
