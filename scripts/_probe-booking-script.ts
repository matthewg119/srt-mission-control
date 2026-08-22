// Probe: the booking-call lane's PURE logic — what the call is allowed to CLAIM.
//
//   bunx tsx --env-file=.env.local scripts/_probe-booking-script.ts
//
// ‼️ THE THREE PRIOR-CONTACT STATES ARE THE WHOLE POINT OF THIS FILE. Matthew's reference call
// says "my team emailed over a report with the whole 9 yards". That sentence is true on exactly
// ONE of the three, it is the strongest line in the call, and it reads well enough that a model
// will reach for it every time it is not stopped. A prospect told a report was sent who cannot
// find one stops believing everything else on the call, and it is the error they catch in the
// first ten seconds.
//
// So the decision is made in code and the prompt is checked for having received it. That is the
// same rule run-prompts.ts enforces with status:"no_data" and pickAngle enforces in the no-website
// lane: offer to look, never claim to have looked.
//
// The model-facing half (buildBookingScript) needs live keys and is verified by pressing the
// button. Everything below is free.

import {
  BOOKING_EXAMPLE,
  INTAKE_BLOCKS,
  bookingFactsFrom,
  formatBookingScript,
  type BookingScript,
  type PriorContact,
} from "../src/lib/audit-engine/booking-script";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
}

function facts(prior: PriorContact, over: Partial<Parameters<typeof bookingFactsFrom>[0]> = {}) {
  return bookingFactsFrom({
    prospect: "Chisko",
    company: "Kingdom of Padel",
    trade: "padel court rental and lessons",
    city: "San Diego, CA",
    prior,
    ...over,
  });
}

// ── 1. The city is trimmed to a city ─────────────────────────────────────────
// Same reason hookPositioningLine trims it: the positioning line is spoken, and "in San Diego, CA"
// is not how anyone says where a business is.
check("state is dropped from the city", facts("hook_sent").city, "San Diego");
check("a bare city passes through", facts("hook_sent", { city: "Bakersfield" }).city, "Bakersfield");
check("no city stays null rather than becoming a guess", facts("hook_sent", { city: null }).city, null);

// ── 2. Identity is never blank ───────────────────────────────────────────────
// The live Grey Seal failure: a script that introduced the rep as a company that does not exist
// and sent the prospect hunting for mail from a domain SRT does not own. lintSpoken can only catch
// that when these two are populated, and this lane has no CallFacts to carry them.
const f = facts("hook_sent");
check("agency name is populated", Boolean(f.agencyName), true);
check("from domain is populated", Boolean(f.fromDomain), true);
check("no audit means no report url", f.reportUrl, null);

// ── 3. ‼️ The three states, and what each one licenses ───────────────────────
// formatBookingScript prints the state above the script precisely so this is visible without
// reading the code, the same way formatHookCard prints the questions above the draft.
const script: BookingScript = {
  gatekeeper: "Yeah tell her it is better if they just send it",
  open: ["Hey brother this is Matthew how are you", "I had some time between meetings to give you a call"],
  pivot: "Random question, do you know if ChatGPT is sending clients to you guys?",
  why: ["We were running questions for another client in the area", "We cannot really help every business owner", "Yours looks like the type this works for"],
  positioning: "We help you become the business AI recommends when someone asks for padel courts in San Diego",
  discovery: ["How are people usually finding you guys right now?", "Are you happy with the bookings coming in?"],
  bookIt: ["I have a meeting in about ten minutes", "I can go over it tomorrow morning or afternoon", "It takes fifteen minutes, is that fair enough?"],
  hosting: ["Quick question, do you know where your site is hosted? Like GoDaddy or Namecheap?", "I will look into it today and we will call you tomorrow to get you started."],
  getEmail: "What is your best email so I can send over the invite",
  priceDeflect: "We will go over everything tomorrow, we have a few different options.",
  closeOut: ["Perfect, that is everything I need.", "I will dig into all this today and we go over the full plan tomorrow."],
  pushback: [],
  voicemail: ["Hey it is Matthew", "Ran some questions on your area", "I will try you tomorrow morning"],
  textMessage: ["Hey, Matthew here", "Quick question about ChatGPT and your bookings", "Worth fifteen minutes?"],
  dontSay: ["Just following up", "Circling back", "Is this a good time"],
};

const sent = formatBookingScript(facts("report_sent"), script, []);
const hook = formatBookingScript(facts("hook_sent"), script, []);
const none = formatBookingScript(facts("nothing_sent"), script, []);

check("report_sent is labelled on the card", sent.includes("an audit was run and an email went out"), true);
check("hook_sent says no report exists", hook.includes("no report exists"), true);
check("nothing_sent says nothing has been sent", none.includes("nothing has been sent to them yet"), true);
check("an unscored lead is told no figures may be spoken", hook.includes("no figures may be spoken"), true);

const scored = formatBookingScript(facts("report_sent", { numbers: ["AI visibility score: 34 out of 100"] }), script, []);
check("a scored lead drops that warning", scored.includes("no figures may be spoken"), false);

// ── 4. The house rules reach the spoken card too ─────────────────────────────
check("no em dash survives the card", /—|–/.test(sent), false);
check("warnings ride above the script", formatBookingScript(facts("hook_sent"), script, [":warning: too long"]).includes(":warning: too long"), true);

// ── 5. The reference is the transcript, not a paraphrase ─────────────────────
// It teaches SHAPE. If it ever stops matching what Matthew actually says, the shape drifts and
// nothing else in the lane would notice.
check("reference keeps the disqualifier", BOOKING_EXAMPLE.includes("cant really help every business owner"), true);
check("reference keeps the fifteen minute ask", BOOKING_EXAMPLE.includes("is that fair enough?"), true);
check("reference keeps the email ask", BOOKING_EXAMPLE.includes("send over the invite."), true);
check("reference keeps the hosting question", BOOKING_EXAMPLE.includes("where your website is hosted"), true);
// Last, because it is the only beat that fires conditionally and it must not read as part of the
// booking run-through: the price answer comes AFTER the meeting is already agreed.
check("reference ends on the price deflection", BOOKING_EXAMPLE.trim().endsWith("a few different options"), true);
check("reference marks the pickup as a direction, not a line", BOOKING_EXAMPLE.includes("[they pick up]"), true);

// ── 6. The five questions ship verbatim from code ────────────────────────────
// ‼️ They are NOT model-written, for the reason the no-website lane's three questions are not: a
// model invents questions about services this business does not offer, and two prospects in the
// same trade then get answered on different questions, so nothing is comparable across calls.
check("all five intake blocks are present", INTAKE_BLOCKS.length, 5);
check("the intro to the five is printed in full", sent.includes("5 quick questions"), true);
check("website builder question ships verbatim", sent.includes("WordPress, Wix, Squarespace, Webflow"), true);
check("old developer access is asked", sent.includes("previous employee or old developer still have access"), true);
check("GBP login owner is asked", sent.includes("who has the login for it"), true);
check("highest margin service is asked", sent.includes("highest-margin service"), true);
check("booking software is asked", sent.includes("booking, scheduling, or customer messaging software"), true);
check("search console is asked", sent.includes("Google Analytics or Search Console"), true);

// ‼️ Question 4 ASKS about review incentives, it never advises one. Google policy and FTC 16 CFR
// Part 465: an existing incentivised programme is something we need to KNOW about, not something
// we help build. The note beside it on the card is the guard a reader actually sees.
check("review incentives are asked about", sent.includes("Do you offer anything in exchange for a review"), true);
check("and the card says ask, never advise", sent.includes("Ask, never advise"), true);

// The hosting question is what turns this into an onboarding call: it is the same fact
// resolveDnsProvider() reads off the nameservers and the DNS delivery step needs answered.
check("hosting is asked before the meeting", sent.includes("hosted"), true);

console.log(failures ? `\n${failures} FAILED.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
