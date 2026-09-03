// Pure checks for the ReachInbox campaign lane. No network, no DB, no Slack, no key.
//
// The proposition it exists to prove is ONE thing: isCampaignMailbox() is the only gate between
// an ordinary email arriving in a human's inbox and this app minting a prospect plus a CRM lead
// plus a Speed-to-Lead RingOut out of it. Everything else here is secondary.
//
//   bunx tsx scripts/_probe-reachinbox.ts

import { isCampaignMailbox, campaignReplyMailbox, isHot } from "../src/lib/followup-operator/campaign-replies";
import { yesterdayETRange } from "../src/lib/followup-operator/campaign-digest";
import type { ReplyClassification } from "../src/lib/followup-operator/cadence";

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL  ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.REACHINBOX_REPLY_MAILBOX;
  if (value === undefined) delete process.env.REACHINBOX_REPLY_MAILBOX;
  else process.env.REACHINBOX_REPLY_MAILBOX = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.REACHINBOX_REPLY_MAILBOX;
    else process.env.REACHINBOX_REPLY_MAILBOX = prev;
  }
}

// ── The gate, unset ──────────────────────────────────────────────────────────
// The single most expensive failure available: unset must FAIL CLOSED. An unset var reading as
// "match everything" would mint a prospect and a CRM lead out of every message in every swept
// mailbox, including Matthew's own.
withEnv(undefined, () => {
  check("unset: real address", isCampaignMailbox("replies@srtagency.com"), false);
  check("unset: matthew", isCampaignMailbox("matthew@srtagency.com"), false);
  check("unset: empty string", isCampaignMailbox(""), false);
  check("unset: campaignReplyMailbox is empty", campaignReplyMailbox(), "");
});

withEnv("", () => {
  check("blank: real address", isCampaignMailbox("replies@srtagency.com"), false);
  check("blank: empty string", isCampaignMailbox(""), false);
});

withEnv("   ", () => {
  // A var holding only whitespace is unset by any honest reading, and must not match a mailbox
  // whose own address trims to the same nothing.
  check("whitespace-only: does not match empty", isCampaignMailbox(""), false);
  check("whitespace-only: does not match spaces", isCampaignMailbox("  "), false);
});

// ── The gate, set ────────────────────────────────────────────────────────────
withEnv("replies@srtagency.com", () => {
  check("set: exact", isCampaignMailbox("replies@srtagency.com"), true);
  check("set: uppercase input", isCampaignMailbox("Replies@SRTagency.com"), true);
  check("set: padded input", isCampaignMailbox("  replies@srtagency.com  "), true);
  check("set: the connected mailbox", isCampaignMailbox("matthew@srtagency.com"), false);
  check("set: the submissions mailbox", isCampaignMailbox("submissions@srtagency.com"), false);
  check("set: empty", isCampaignMailbox(""), false);
  // Not a prefix or suffix test. A lookalike address must not open the door.
  check("set: prefix lookalike", isCampaignMailbox("replies@srtagency.com.evil.com"), false);
  check("set: suffix lookalike", isCampaignMailbox("no-replies@srtagency.com"), false);
});

withEnv("  Replies@SRTagency.com  ", () => {
  check("env is normalized too", isCampaignMailbox("replies@srtagency.com"), true);
  check("env normalized: campaignReplyMailbox", campaignReplyMailbox(), "replies@srtagency.com");
});

// ── isHot: it decides whether a stranger's phone rings ────────────────────────
const cls = (over: Partial<ReplyClassification>): ReplyClassification => ({
  state: "OBJECTION",
  summary: "",
  askedPrice: false,
  wantsOut: false,
  ...over,
});

check("hot: interested", isHot(cls({ state: "REPLIED_INTERESTED" })), true);
check("hot: asked price", isHot(cls({ state: "ASKED_PRICE_HOT", askedPrice: true })), true);
check("hot: objection", isHot(cls({ state: "OBJECTION" })), false);
// The one that matters: never RingOut somebody who asked to be left alone.
check("hot: opt-out", isHot(cls({ state: "CLOSED", wantsOut: true })), false);
check("hot: defer", isHot(cls({ state: "SENT_NO_REPLY", deferDays: 14 })), false);

// ── The digest window ────────────────────────────────────────────────────────
// Midday ET, mid-summer. The window is yesterday's Eastern day, half open.
{
  const now = new Date("2026-08-28T16:00:00Z"); // 12:00 ET, EDT
  const { start, end } = yesterdayETRange(now);
  check("window: length is 24h", end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
  check("window: start is yesterday ET midnight", start.toISOString(), "2026-08-27T04:00:00.000Z");
  check("window: end is today ET midnight", end.toISOString(), "2026-08-28T04:00:00.000Z");
  check("window: end excludes now", end.getTime() < now.getTime(), true);
}

{
  // 00:30 ET, i.e. just after the Eastern day rolled over. The window must be the day that just
  // ended, not the one before it -- the 12-hour step back is what makes that hold.
  const now = new Date("2026-08-28T04:30:00Z");
  const { start, end } = yesterdayETRange(now);
  check("window (just past ET midnight): start", start.toISOString(), "2026-08-27T04:00:00.000Z");
  check("window (just past ET midnight): end", end.toISOString(), "2026-08-28T04:00:00.000Z");
}

{
  // Winter, EST. The offset moves and the window must still be exactly one Eastern day.
  const now = new Date("2026-01-15T17:00:00Z"); // 12:00 ET, EST
  const { start, end } = yesterdayETRange(now);
  check("window (EST): length is 24h", end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
  check("window (EST): start", start.toISOString(), "2026-01-14T05:00:00.000Z");
  check("window (EST): end", end.toISOString(), "2026-01-15T05:00:00.000Z");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
