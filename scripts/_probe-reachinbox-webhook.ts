// Pure checks for the ReachInbox webhook capture and the rate gate. No network, no DB, no key.
//
// Sibling of _probe-reachinbox.ts, which proves the mailbox gate. This one proves the two things
// that arrived on 2026-09-07 with the webhook:
//
//   1. the parser reads a payload shape nobody had seen when it was written, and never throws
//   2. a rate is printed ONLY when its own denominator was measured
//
// The second is the one that matters. The send events arrive on a PRO free trial that ends
// 2026-09-15, so `sent` can go null mid-week with nothing else changing, and a card that kept
// dividing would read high and look fine.
//
//   bunx tsx scripts/_probe-reachinbox-webhook.ts

import { parseReachInboxEvent, normalizeEventType } from "../src/lib/reachinbox/parse";
import {
  rate,
  formatPct,
  countOf,
  formatFunnel,
  sortFunnels,
  type CampaignFunnel,
} from "../src/lib/reachinbox/stats";

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

const j = (o: unknown) => JSON.stringify(o);
const parse = (o: unknown) => parseReachInboxEvent(o, j(o));

// ── Event names ──────────────────────────────────────────────────────────────
// THE ORDERING RAIL, and it is the reason TYPE_PATTERNS is an ordered list rather than a map.
// ReachInbox labels a reply "Reply Received", and the prose around it says things like "a reply
// was received to the email sent on Tuesday". A `sent` test running first matches that sentence
// and files every reply as a send: the denominator inflates and the numerator drains, in the same
// event, so the reply rate is wrong twice over and still looks like a plausible number.
check("type: Reply Received", normalizeEventType("Reply Received"), "replied");
check("type: prose naming both", normalizeEventType("A reply was received to the email sent Tuesday"), "replied");
check("type: Email Sent", normalizeEventType("Email Sent"), "sent");
check("type: EMAIL_BOUNCED", normalizeEventType("EMAIL_BOUNCED"), "bounced");
check("type: bounce beats reply in a bounce notice", normalizeEventType("Reply bounced"), "bounced");
check("type: Email Link Clicked", normalizeEventType("Email Link Clicked"), "clicked");
check("type: Email Opened", normalizeEventType("Email Opened"), "opened");
check("type: Campaign Completed", normalizeEventType("Campaign Completed"), "completed");
check("type: delivered counts as sent", normalizeEventType("delivered"), "sent");
check("type: empty", normalizeEventType(""), "unknown");
check("type: undefined", normalizeEventType(undefined), "unknown");
check("type: nonsense", normalizeEventType("banana"), "unknown");

// ── Shape 1: a structured event body ─────────────────────────────────────────
{
  const p = parse({
    event_id: "evt_123",
    event_type: "email_sent",
    campaign: { id: "cmp_9", name: "AEO" },
    lead: { email: "Jane@Acme.COM", first_name: "Jane" },
    timestamp: "2026-09-07T15:04:05Z",
  });
  check("structured: type", p.eventType, "sent");
  check("structured: campaign name", p.campaignName, "AEO");
  check("structured: campaign id", p.campaignId, "cmp_9");
  check("structured: email lowercased", p.leadEmail, "jane@acme.com");
  check("structured: occurredAt", p.occurredAt, "2026-09-07T15:04:05.000Z");
  check("structured: provider id is prefixed", p.providerEventId, "ri:evt_123");
}

{
  // Nested one level deeper than anyone would guess. Hunting by key name anywhere in the tree is
  // what makes an extra wrapper object harmless instead of fatal.
  const p = parse({ data: { payload: { prospect: { recipientEmail: "deep@clinic.io" } } } });
  check("nested: email still found", p.leadEmail, "deep@clinic.io");
}

// ── Shape 2: Slack Block Kit, where the facts are only prose ─────────────────
{
  const p = parse({
    text: "Reply received from jane@acme.com on campaign V1 lets get rich",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Reply received" } }],
  });
  check("slack-shaped: type from prose", p.eventType, "replied");
  check("slack-shaped: email from prose", p.leadEmail, "jane@acme.com");
  // No campaign key anywhere. Guessing one out of a sentence would invent attribution, and
  // attribution that was invented is worse than attribution that is missing.
  check("slack-shaped: campaign stays null", p.campaignName, null);
}

{
  // A trailing period must not join the address, or every prose-extracted email is wrong by one
  // character and matches no prospect and no booking.
  check("prose: trailing period excluded", parse({ text: "Email sent to bob@clinic.co." }).leadEmail, "bob@clinic.co");
  check("prose: angle brackets", parse({ event: "opened", to: "Jane Doe <jane@acme.com>" }).leadEmail, "jane@acme.com");
  check("prose: subdomain kept", parse({ text: "sent to a@mail.clinic.co.uk" }).leadEmail, "a@mail.clinic.co.uk");
}

// ── Dedupe ───────────────────────────────────────────────────────────────────
{
  // A provider retry that double-counts a `sent` corrupts the one number a spend decision is made
  // on, so identical bytes must hash identically and different bytes must not.
  const body = { event: "sent", email: "a@b.com", timestamp: "2026-09-07T00:00:00Z" };
  const other = { event: "sent", email: "a@b.com", timestamp: "2026-09-07T00:00:01Z" };
  const one = parseReachInboxEvent(body, j(body));
  const two = parseReachInboxEvent(body, j(body));
  const three = parseReachInboxEvent(other, j(other));
  check("no id: hash is stable", one.providerEventId === two.providerEventId, true);
  check("no id: hash is marked as one", one.providerEventId.startsWith("sha:"), true);
  check("no id: different bytes differ", one.providerEventId === three.providerEventId, false);
  check("no id: key is never empty", one.providerEventId.length > 8, true);
}

// ── It never throws ──────────────────────────────────────────────────────────
// A 400 during an 8-day trial loses the event permanently. Anything unreadable becomes
// `unknown` with the raw body still stored.
{
  check("garbage: non-JSON body", parseReachInboxEvent(null, "not json at all").eventType, "unknown");
  check("garbage: empty object", parse({}).eventType, "unknown");
  check("garbage: array", parse([1, 2, 3]).eventType, "unknown");
  check("garbage: no email", parse({ event: "sent" }).leadEmail, null);
  check("garbage: null email value", parse({ event: "sent", email: null }).leadEmail, null);
  check(
    "garbage: unparseable time falls back to now, not NaN",
    Number.isNaN(Date.parse(parse({ timestamp: "soon" }).occurredAt)),
    false
  );
  check("unix seconds", parse({ timestamp: "1788796800" }).occurredAt, "2026-09-07T16:00:00.000Z");
}

// ── The rate gate ────────────────────────────────────────────────────────────
// THE PROPOSITION: no rate is printed unless its own denominator was measured.

check("rate: null denominator", rate(9, null), null);
check("rate: zero denominator", rate(0, 0), null);
check("rate: negative denominator", rate(1, -5), null);
check("rate: normal", rate(9, 412), (9 / 412) * 100);
check("pct: null stays null", formatPct(null), null);
check("pct: one decimal", formatPct((9 / 412) * 100), "2.2%");
check("pct: whole number carries no .0", formatPct(50), "50%");
check("countOf: unmeasured denominator is a bare count", countOf(9, null), "9");
check("countOf: zero denominator is a bare count", countOf(0, 0), "0");
check("countOf: measured", countOf(9, 412), "9 of 412 (2.2%)");

const base: CampaignFunnel = {
  campaign: "AEO",
  sent: 412,
  replied: 9,
  bounced: 3,
  opened: 100,
  clicked: 12,
  booked: 2,
  closed: 1,
};

{
  const out = formatFunnel(base).lines.join(" | ");
  check("funnel: prints the reply rate", out.includes("2.2%"), true);
  check("funnel: names the reply denominator", out.includes("of the people we emailed"), true);
  check("funnel: booking is over replies", out.includes("2 of 9"), true);
  check("funnel: names the booking denominator", out.includes("of the people who replied"), true);
  check("funnel: close is over bookings", out.includes("1 of 2"), true);
  check("funnel: no trial warning while measured", out.includes("No send events"), false);
  check("funnel: header is the campaign", formatFunnel(base).header, "*AEO*");
}

{
  // The trial lapsed. Counts survive, the rate must not, and the card has to say which.
  const out = formatFunnel({ ...base, sent: null }).lines.join(" | ");
  check("funnel (no sends): says why", out.includes("No send events"), true);
  check("funnel (no sends): still reports the replies", out.includes("9 replied"), true);
  check("funnel (no sends): invents no sent count", out.includes("sent"), false);
  // Booking and close are over replies and bookings, which are still measured, so those two
  // percentages stay. The one that must vanish is the reply rate.
  check("funnel (no sends): no reply rate", out.includes("Reply rate"), false);
}

{
  // Nobody replied, so booking and close have nothing to divide by either.
  const out = formatFunnel({ ...base, replied: 0, booked: 0, closed: 0 }).lines.join(" | ");
  check("funnel (no replies): no 0 of 0", out.includes("0 of 0"), false);
  check("funnel (no replies): reply rate is still measured", out.includes("0 of 412"), true);
}

{
  const sorted = sortFunnels([
    { ...base, campaign: "quiet", replied: 0, sent: 900 },
    { ...base, campaign: "loud", replied: 12 },
    { ...base, campaign: "middling", replied: 5 },
  ]).map((f) => f.campaign);
  // Volume never outranks answers: a campaign nobody replied to sinks whatever it sent.
  check("sort: most replies first", sorted, ["loud", "middling", "quiet"]);
}

{
  // sortFunnels must not mutate its argument: the digest reads the array again for the
  // all-lapsed check after sorting.
  const input: CampaignFunnel[] = [
    { ...base, campaign: "b", replied: 1 },
    { ...base, campaign: "a", replied: 9 },
  ];
  sortFunnels(input);
  check("sort: input untouched", input.map((f) => f.campaign), ["b", "a"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
