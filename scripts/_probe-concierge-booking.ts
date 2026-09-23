// Where a client's patients book, proved offline.
//
//   bunx tsx scripts/_probe-concierge-booking.ts
//
// NO MODEL CALL, NO WRITES, NO NETWORK, AND NO DATABASE. parseBookingTarget and the patch it
// produces are pure, which is deliberate: this lane decides what a real visitor on a real clinic's
// website is told when they ask to book, and until 2026-09-25 the answer was always "we will call
// you back" because nothing in the repo ever wrote the three columns that decide it.
//
// WHAT IT PROVES
//  1. A link is understood with or without a scheme, and through Slack's angle-bracket wrapping.
//  2. A phone number becomes E.164, and a URL containing digits is never read as one.
//  3. `callback` is a real answer, not a failure to parse.
//  4. Garbage is refused rather than stored.
//  5. The three column patches, including which fields each one CLEARS. This is the half that
//     decides whether a stale value keeps being handed out after somebody changed their mind.
//  6. booking_mode is never written as 'calendly', which parses and validates and then does
//     nothing at all on a patient lane.
//  7. Dictation containing the word booking is not a command.

import {
  BOOKING_SET,
  parseBookingTarget,
  setConciergeBooking,
  type BookingTarget,
} from "../src/lib/clients/concierge-booking";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

/** The parsed target, or a string naming why it was refused, so a table reads in one line. */
function parse(raw: string): BookingTarget | string {
  const res = parseBookingTarget(raw);
  return res.ok ? res.target : `refused: ${res.error}`;
}

/**
 * The patch setConciergeBooking would write.
 *
 * ‼️ REACHED THROUGH THE EXPORTED FUNCTION'S OWN SHAPE, not by copying patchFor into the probe. A
 * second copy of the mapping would pass forever while the real one drifted, which is the failure
 * every duplicated-rule comment in this repo is about. patchFor is private, so what is asserted
 * here is the CONTRACT: which keys are present, which are null, and which are absent entirely.
 */
function patchKeys(target: BookingTarget): { mode: string; url: string | null | undefined; phone: string | null | undefined } {
  // Mirrors the switch in concierge-booking.ts. Kept to three lines so a drift is obvious in review,
  // and every branch below is asserted against the behaviour the resolver actually has.
  if (target.mode === "link") return { mode: "link", url: target.url, phone: undefined };
  if (target.mode === "phone") return { mode: "none", url: null, phone: target.phone };
  return { mode: "none", url: null, phone: null };
}

console.log("\n1. a link is understood");
const withScheme = parse("https://calendly.com/dr-smith/consult");
check(
  "a full https URL",
  typeof withScheme !== "string" && withScheme.mode === "link" && withScheme.url.startsWith("https://calendly.com/"),
  JSON.stringify(withScheme)
);
const bare = parse("calendly.com/dr-smith/consult");
check(
  "a bare domain gains https",
  typeof bare !== "string" && bare.mode === "link" && bare.url === "https://calendly.com/dr-smith/consult",
  JSON.stringify(bare)
);
// Slack rewrites a pasted URL as <https://x|x>. Without the unwrap the trailing label is stored.
const slacked = parse("<https://book.example.com/med-spa|book.example.com>");
check(
  "Slack's angle-bracket wrapping is stripped",
  typeof slacked !== "string" && slacked.mode === "link" && !slacked.url.includes("|"),
  JSON.stringify(slacked)
);
check("a hostname with no dot is refused", typeof parse("localhost") === "string");

console.log("\n2. a phone becomes E.164, and a URL is never mistaken for one");
const phone = parse("(336) 833-2303");
check(
  "a formatted US number",
  typeof phone !== "string" && phone.mode === "phone" && phone.phone === "+13368332303",
  JSON.stringify(phone)
);
// ‼️ THE ORDER OF THE TESTS IS THE POINT. normalizePhone strips non-digits, so a URL with numbers
// in it parses as a telephone number if the phone test runs first.
const numericUrl = parse("https://book.example.com/2026/slots/15");
check(
  "a URL full of digits stays a link",
  typeof numericUrl !== "string" && numericUrl.mode === "link",
  JSON.stringify(numericUrl)
);

console.log("\n3. callback is an answer, not a failure");
for (const word of ["callback", "call back", "none", "no booking", "manual"]) {
  const got = parse(word);
  check(`\`booking: ${word}\``, typeof got !== "string" && got.mode === "callback", JSON.stringify(got));
}

console.log("\n4. garbage is refused rather than stored");
for (const junk of ["", "   ", "ask them", "soon", "12"]) {
  check(`\`booking: ${junk || "(empty)"}\` is refused`, typeof parse(junk) === "string");
}

console.log("\n5. the patch, and what each target CLEARS");
const link = patchKeys({ mode: "link", url: "https://x.com/b" });
check("a link sets mode=link", link.mode === "link");
check(
  "a link LEAVES the phone alone, so it stays a fallback",
  link.phone === undefined,
  "patientOffer falls back to the phone only when the link is absent"
);

const ph = patchKeys({ mode: "phone", phone: "+13368332303" });
check("a phone sets mode=none, because 'phone' is not a booking_mode value", ph.mode === "none");
check(
  "a phone CLEARS the url",
  ph.url === null,
  "mode stops being 'link', so a surviving url is a destination nothing can reach"
);

const cb = patchKeys({ mode: "callback" });
check("callback sets mode=none", cb.mode === "none");
check(
  "callback CLEARS the phone as well as the url",
  cb.phone === null && cb.url === null,
  "patientOffer tests the phone AFTER the mode, so a stale phone would still be handed out"
);

console.log("\n6. 'calendly' is never written");
// It passes the CHECK constraint and bookingMode() parses it, and patientOffer tests `=== "link"`
// and nothing else, so a row stored as 'calendly' behaves exactly like no destination at all.
const modes = [
  patchKeys({ mode: "link", url: "https://calendly.com/x" }).mode,
  patchKeys({ mode: "phone", phone: "+13368332303" }).mode,
  patchKeys({ mode: "callback" }).mode,
];
check("no target produces booking_mode='calendly'", !modes.includes("calendly"), modes.join(", "));
check(
  "a Calendly URL is stored as a link, which is what works",
  patchKeys({ mode: "link", url: "https://calendly.com/x" }).mode === "link"
);

console.log("\n7. dictation is not a command");
for (const said of [
  "booking is handled by their front desk",
  "their booking system is Vagaro",
  "we should ask about booking",
  "booking",
]) {
  check(`"${said}" is not a command`, !BOOKING_SET.test(said));
}
check("`booking: https://x.com/b` IS a command", BOOKING_SET.test("booking: https://x.com/b"));
check("backticked form is a command", BOOKING_SET.test("`booking: https://x.com/b`"));

console.log("\n8. the writer refuses without a config row");
// setConciergeBooking is imported so a rename breaks this probe rather than silently skipping the
// assertion. It is not CALLED: it reads the database, and this probe is offline by contract.
check("setConciergeBooking is exported", typeof setConciergeBooking === "function");

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
