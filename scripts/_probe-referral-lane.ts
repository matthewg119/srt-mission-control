// The AI Referral Engine walk: scripted, in order, and no invented appointment. Executable.
//
//   bun --no-env-file run scripts/_probe-referral-lane.ts
//
// ‼️ NO MODEL CALL, NO DATABASE, NO NETWORK. Every check is either a pure read of the step array or a
// grep over the two files that walk it. That is what lets this run in CI with no secrets.
//
// ‼️ IMPORTING THE SCRIPT IS ITSELF THE COPY CHECK. Every string in referral-script.ts goes through
// guard(), which THROWS at module evaluation on an em dash, an en dash or a "--". So if this file runs
// at all, the walk's copy is clean. That is also why the import is at the top and not lazy.
//
// WHAT IT PROVES
//  1. The walk is Matthew's sequence, in his order, with nothing added or dropped.
//  2. No step's words are generated, and the frame reaches no model on this path.
//  3. The two appointment times are placeholders filled from resolveBooking, never baked copy.
//  4. Every mode resolveBooking can return is handled, including the two that mean "no times".
//  5. The contact capture goes through the one existing lead writer, not a second one.

import fs from "node:fs";
import path from "node:path";

import {
  REFERRAL_DOOR_LABEL,
  REFERRAL_IDS,
  REFERRAL_NO_TIMES,
  REFERRAL_SCRIPT,
  REFERRAL_TIMES_COPY,
  fillTimes,
} from "../src/lib/concierge/referral-script";

const FRAME = "src/app/w/[slug]/route.ts";
const ACTION = "src/app/api/concierge/action/route.ts";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

const frame = read(FRAME);
const action = read(ACTION);

// ── 1. Matthew's sequence, in his order ─────────────────────────────────────
//
// The order is the product here. He wrote it as an exact walk: the two qualifying questions come
// before the form, and the form comes before the install call, because somebody who has already
// answered two questions finishes a form they would have abandoned cold.
console.log("\n1. the walk is the sequence he wrote");

check(
  REFERRAL_IDS.join(",") === "open,q_reviews,q_website,contact,q_daypart,q_slot,close",
  "seven steps, in order",
  REFERRAL_IDS.join(" -> ")
);
check(
  REFERRAL_SCRIPT.map((s) => s.kind).join(",") === "say,ask,ask,form,chips,slots,end",
  "and each is the kind that step has to be",
  REFERRAL_SCRIPT.map((s) => s.kind).join(" -> ")
);
check(
  REFERRAL_SCRIPT.filter((s) => s.kind === "ask").map((s) => (s.kind === "ask" ? s.key : "")).join(",") ===
    "reviews,website",
  "the review count is asked before the website"
);
check(REFERRAL_DOOR_LABEL === "Download Free AI Referral Engine", "the door says what he asked it to say");

// ── 2. Nothing here is generated ────────────────────────────────────────────
console.log("\n2. no model is in this path");

const walk = frame.slice(frame.indexOf("function walkRef("), frame.indexOf("function refFill("));
check(walk.length > 500, "the walker was found to read", `${walk.length} chars`);
check(!walk.includes("/turn"), "the walker never posts to /api/concierge/turn");
check(
  !/callClaude|runConversationWithTools|anthropic/i.test(frame.slice(frame.indexOf("function walkRef("))),
  "and nothing below it reaches a model either"
);
// A step whose text came from the server per turn would be a model in disguise.
check(
  REFERRAL_SCRIPT.every((s) => s.kind === "slots" || Object.values(s).every((v) => typeof v !== "function")),
  "no step carries a function to produce its words"
);

// ── 3. The two times are real or they are not offered ───────────────────────
//
// ‼️ THE ONE CHECK THIS FILE EXISTS FOR. A scripted walk is where inventing "Tuesday at 10" is
// easiest and worst: the model is not in this path, so nothing downstream would catch a made-up time.
console.log("\n3. the appointment times are never written here");

const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i;
const CLOCK = /\b\d{1,2}\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

for (const [name, copy] of Object.entries(REFERRAL_TIMES_COPY)) {
  check(!DAYS.test(copy), `the ${name} line names no day`, copy);
  check(!CLOCK.test(copy), `the ${name} line names no time`, copy);
}
check(REFERRAL_TIMES_COPY.two.includes("{a}") && REFERRAL_TIMES_COPY.two.includes("{b}"), "the two-time line has both slots");
check(REFERRAL_TIMES_COPY.one.includes("{a}"), "the one-time line has its slot");
check(
  fillTimes(REFERRAL_TIMES_COPY.two, "today at 9am", "today at 11am") ===
    "We can do today at 9am, or would today at 11am suit you better?",
  "and filling it produces the sentence he wrote"
);
check(
  REFERRAL_SCRIPT.every((s) => s.kind !== "slots" || s.prompt === ""),
  "the slots step carries no prompt of its own",
  "its text is built from what the calendar returned, so a stored prompt would be a second source"
);

// ── 4. Every mode resolveBooking can return is handled ──────────────────────
//
// booking.ts returns FIVE modes and its own header says four. no_slots is deliberately distinct from
// a broken integration: a rotated token must not read as "there are no appointments", which is a
// claim about the business rather than about us.
console.log("\n4. all five booking modes land somewhere");

// ‼️ THE SLICE ENDS AT THE NEXT ACTION, NOT AT THE NEXT FUNCTION. Running it to partOfDay swept in the
// magnet, booking and audit branches, and the `booking` action answers `link` and `phone` too, so three
// of the checks below passed on somebody else's code.
const timesStart = action.indexOf('if (action === "referral_times")');
const timesEnd = action.indexOf('if (action === "', timesStart + 10);
const times = action.slice(timesStart, timesEnd);
check(times.length > 400, "the referral_times action was found to read", `${times.length} chars`);
check(times.includes("resolveBooking("), "it calls resolveBooking rather than reading a calendar itself");
for (const mode of ["slots", "link", "phone"]) {
  check(times.includes(`"${mode}"`), `the ${mode} mode is answered`);
}
check(times.includes('mode: "callback"'), "no_slots and callback both fall through to callback");
check(
  REFERRAL_NO_TIMES.callback.length > 0 && REFERRAL_NO_TIMES.link.length > 0 && REFERRAL_NO_TIMES.phone.length > 0,
  "and the frame has a sentence for each of them"
);
check(
  !DAYS.test(REFERRAL_NO_TIMES.callback) && !CLOCK.test(REFERRAL_NO_TIMES.callback),
  "the no-times line promises no day or time either"
);
check(times.includes('window: "extended"'), "the window is widened, unlike the booking action's two days");
check(times.includes("partOfDay("), "and the slots are bucketed into the half of the day they asked for");

// ── 5. One lead writer ──────────────────────────────────────────────────────
//
// The walk collects a surname and a phone the two-field door never did, and the obvious shape was a
// second action. That is how a lane grows two paths into #hot-leads that disagree about the
// owner/patient rule.
console.log("\n5. the contact capture reuses the one lead writer");

check(!action.includes('=== "referral_contact"'), "there is no second contact action");
check(
  (action.match(/const \{ ingestLead \} = await import/g) ?? []).length === 1,
  "ingestLead is imported in exactly one place in this route"
);
check(walk.includes("action:'contact'"), "the walk's form posts to the existing contact action");
check(walk.includes("lastName:ln.value") && walk.includes("phone:ph.value"), "carrying the surname and the phone");
check(
  action.includes("const { normalizePhone } = await import") && action.includes('field: "phone"'),
  "and the phone is normalised and refused server side, never trusted from the frame"
);
check(
  action.includes("speedToLead: false"),
  "speed to lead stays off on this path",
  "Matthew's call: nothing auto-dials somebody who filled in a form on a clinic's website"
);

// ── 6. The door replaced the one that was already broken ────────────────────
console.log("\n6. the door");

const config = read("src/lib/concierge/config.ts");
check(config.includes('kind: "referral", label: REFERRAL_DOOR_LABEL'), "the owner's second door is the walk");
check(config.includes('"audit" | "magnet" | "referral" | "type" | "booking"'), "and referral is a real kind");
check(frame.includes("else if(kind==='referral')walkRef(0)"), "and choosing it starts the walk at step one");
check(
  frame.includes("if(!contact&&kind!=='referral')"),
  "the walk is the one door that does not go through askContact first",
  "its own form is step four and collects more than askContact does"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The walk is scripted, and the times are the calendar's.");

export {};
