// The one way to say something in #alerts-infra.
//
// ‼️ THIS FUNCTION EXISTED FOUR TIMES BEFORE THIS FILE DID, copy-pasted into provision.ts,
// day-zero.ts, page-gate.ts and experiments/funnel-report.ts, each with a header comment pointing at
// the others ("Same channel and same doctrine as provision.ts"). Four identical eight-line helpers
// with cross-references between them is a module that has not been written down yet. Adding a fifth
// was the moment to stop.
//
// ‼️ A MISSING CHANNEL IS LOGGED, NEVER THROWN. Every caller is reporting something that has already
// happened: a half-provisioned client, a waived Day 0 wall, a publish-gate override, a weekly
// report. An alert that throws would turn "we could not tell you about the problem" into a second,
// louder problem, on the path of the first one.

import { slack } from "@/lib/slack-bot";

/**
 * Post to the ops alerts channel.
 *
 * Returns whether it landed, so a caller that genuinely needs to know can say so. Every caller
 * today ignores it, which is correct for them.
 */
export async function postInfraAlert(text: string): Promise<boolean> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[alerts] SLACK_ALERTS_INFRA_CHANNEL unset. Alert dropped:", text);
    return false;
  }
  try {
    // slackFetch returns {ok:false} and never throws, so the result is checked rather than awaited
    // and assumed.
    const res = (await slack.postMessage(channel, text)) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch (e) {
    console.error("[alerts] post failed:", (e as Error).message);
    return false;
  }
}
