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

import { parseReachInboxEvent, normalizeEventType, cleanReplyText } from "../src/lib/reachinbox/parse";
import { shouldAnnounceReply, buildReplyNote } from "../src/lib/reachinbox/announce";
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
  // The clause naming the denominator has to vanish with the denominator, or the line reads like
  // a sentence that got cut off: "Closed: 0 of the people who booked."
  check("funnel (no replies): no dangling denominator clause", out.includes("of the people who replied"), false);
  check("funnel (no replies): booked is a bare count", out.includes("Booked: 0."), true);
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

// -- The Slack announcement: what may reach the channel, and what it says ----
//
// The gate is the whole point. #vektor-email-director's invariant is that nothing appears there
// unless a real prospect did something, and `All Events` is the recommended registration, so every
// send and open in the campaign passes through shouldAnnounceReply on its way to being ignored.

{
  const reply = parse({ event: "Reply Received", email: "jane@acme.com", campaign: "7D 3E 6M" });
  check("gate: a reply with an address announces", shouldAnnounceReply(reply), true);

  for (const ev of ["Email Sent", "Email Opened", "Email Link Clicked", "Email Bounced", "Campaign Completed"]) {
    check(`gate: ${ev} stays silent`, shouldAnnounceReply(parse({ event: ev, email: "jane@acme.com" })), false);
  }

  // A reply we cannot address has no person to open a thread for. It still counts in the funnel.
  check("gate: reply with no address stays silent", shouldAnnounceReply(parse({ event: "Reply Received" })), false);
  check("gate: unknown event stays silent", shouldAnnounceReply(parse({ event: "quarterly vibes" })), false);
}

{
  // A webhook that carries no body must not render as an empty quote, which reads as "they sent a
  // blank email" rather than "ReachInbox did not tell us what they said".
  const bare = buildReplyNote({
    email: "jane@acme.com",
    campaignName: "7D 3E 6M",
    replyText: null,
    occurredAt: "2026-09-16T14:30:00.000Z",
    mailboxLaneOff: true,
  });
  const bareText = JSON.stringify(bare.blocks);
  check("note: missing body is stated", bareText.includes("no reply text"), true);
  check("note: missing body quotes nothing at all", bareText.includes(">"), false);
  check("note: mailbox off says no body is coming", bareText.includes("REACHINBOX_REPLY_MAILBOX"), true);
  check("note: fallback text names the lead", bare.text, "Reply received - jane@acme.com");

  const withMailbox = buildReplyNote({
    email: "jane@acme.com", campaignName: "c", replyText: null,
    occurredAt: "2026-09-16T14:30:00.000Z", mailboxLaneOff: false,
  });
  check(
    "note: mailbox on promises the body",
    JSON.stringify(withMailbox.blocks).includes("within ~5 minutes"),
    true
  );

  const quoted = buildReplyNote({
    email: "jane@acme.com", campaignName: "7D 3E 6M", replyText: "Sure, what does it cost?",
    occurredAt: "2026-09-16T14:30:00.000Z", mailboxLaneOff: true,
  });
  const quotedText = JSON.stringify(quoted.blocks);
  check("note: a body is quoted", quotedText.includes(">Sure, what does it cost?"), true);
  check("note: a body suppresses the apology", quotedText.includes("no reply text"), false);

  // An unparseable timestamp must not put "Invalid Date" in the channel.
  const bad = buildReplyNote({
    email: "j@a.com", campaignName: null, replyText: "hi", occurredAt: "not a date", mailboxLaneOff: true,
  });
  check("note: bad timestamp degrades", JSON.stringify(bad.blocks).includes("unknown time"), true);
  check("note: missing campaign is stated", JSON.stringify(bad.blocks).includes("No campaign name"), true);
}

// -- Reply text extraction ---------------------------------------------------

{
  check("body: html is stripped", cleanReplyText('<div dir="ltr">Sounds good<br>Jane</div>'), "Sounds good Jane");
  check("body: entities are decoded", cleanReplyText("Tom &amp; Jerry &quot;yes&quot;"), 'Tom & Jerry "yes"');
  check("body: empty after stripping is null", cleanReplyText("<div></div>"), null);
  check("body: null stays null", cleanReplyText(null), null);
  check("body: capped at 600", cleanReplyText("x".repeat(900))?.length, 600);

  check("body: read from a reply key", parse({ event: "replied", email: "j@a.com", replyText: "yes please" }).replyText, "yes please");
  check("body: read from a nested body key", parse({ event: "replied", data: { lead: { email: "j@a.com" }, body: "call me" } }).replyText, "call me");

  // THE ONE THAT MATTERS. A Slack Block Kit body puts OUR OWN prose in `text`. Quoting that would
  // show Matthew a sentence we wrote as though the lead wrote it.
  const slackShaped = parse({
    text: "Reply received from jane@acme.com on campaign 7D 3E 6M",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Reply received from jane@acme.com" } }],
  });
  check("body: slack prose is never quoted as the reply", slackShaped.replyText, null);
  check("body: slack prose still parses as a reply", slackShaped.eventType, "replied");
  check("body: slack prose still yields the address", slackShaped.leadEmail, "jane@acme.com");
}

// -- Lead name ---------------------------------------------------------------

{
  check("name: read from leadName", parse({ event: "replied", leadName: "Jane Doe", email: "j@a.com" }).leadName, "Jane Doe");
  // Bare `name` is not a key. findByKey searches the whole tree, so on {campaign:{name}} it would
  // address the card to the campaign.
  check("name: campaign name is not the lead", parse({ event: "replied", campaign: { name: "7D 3E 6M", id: "9" }, email: "j@a.com" }).leadName, null);
  check("name: campaign still parses", parse({ event: "replied", campaign: { name: "7D 3E 6M", id: "9" }, email: "j@a.com" }).campaignName, "7D 3E 6M");
  check("name: an address is not a name", parse({ event: "replied", fromName: "j@a.com", email: "j@a.com" }).leadName, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
