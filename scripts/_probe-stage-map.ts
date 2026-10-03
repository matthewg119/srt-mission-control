import {
  normalizeStage,
  isDeadStage,
  isTerminalStage,
  cadenceFor,
  STAGE_NAMES,
  HOT_STAGES,
} from "@/config/stage-display";

const LEGACY = [
  "Open - Not Contacted", "Not Contacted", "Working - No Contact", "New", "New Lead",
  "Attempted to Contact", "Intro Text Guide", "Pre-Qualified", "Contact in Future",
  "Statements Received", "Funnel Lead Captured", "Email Captured", "Name Captured",
  "No Business Checking", "Application Complete", "Hot Lead",
  "Underwriting", "Shopping", "Pre-Approved", "Approved", "VC / DL",
  "Contracts Out", "Contracts In", "Pending Stips", "Funding Call", "In Funding",
  "Working - Contacted", "Working - Application Out", "Working", "Contacted",
  "Closed", "Closed - Not Converted", "Converted", "Dead Declined", "Deal Lost",
  "Not interested", "Take Off List", "Hot", "Appointment Booked", "Follow Up", "Loom Sent", "Email Pitch", "Junk Lead", "junk lead", "DNQ", "Duplicate",
  "Wrong Number", "Do Not Call", "Bad Number", "Out of Business", "Opted Out",
  null, "", "Xyzzy",
];

let bad = 0;
const buckets: Record<string, string[]> = {};
for (const s of LEGACY) {
  const n = normalizeStage(s);
  if (!STAGE_NAMES.includes(n)) { console.log("NOT A STAGE:", s, "->", n); bad++; }
  (buckets[n] ??= []).push(String(s));
}
for (const [k, v] of Object.entries(buckets)) console.log(`${k}: ${v.length}\n    ${v.join(", ")}`);

console.log("\n-- the load-bearing checks --");
const checks: [string, boolean, boolean][] = [
  // ‼️ THE TWO THAT KEEP THE CALL BOARD ALIVE. The overwhelming majority of the book sits on one
  // of these; if either becomes "dead" the worklist empties and it looks like data loss.
  ["No Contact is NOT dead (call board survives)", isDeadStage("No Contact"), false],
  ["New Lead is NOT dead (call board survives)", isDeadStage("New Lead"), false],
  ["the old 'No contact' spelling still normalises", normalizeStage("No contact") === "No Contact", true],
  ["the old 'Untouched' spelling still normalises", normalizeStage("Untouched") === "New Lead", true],

  ["Closed IS dead", isDeadStage("Closed"), true],
  ["Not Interested IS dead", isDeadStage("Not Interested"), true],
  ["Not Interested is terminal", isTerminalStage("Not Interested"), true],
  ["Closed is terminal too (both are over)", isTerminalStage("Closed"), true],

  // ‼️ THE WON / LOST SPLIT, WHICH IS THE WHOLE POINT OF HAVING BOTH.
  // Before 2026-10-03 every one of these landed on Closed, so the book could not report a close
  // rate. A regression here is silent: the counts still add up, they just mean nothing.
  ["a lost deal is Not Interested, not Closed", normalizeStage("Deal Lost") === "Not Interested", true],
  ["a decline is Not Interested", normalizeStage("Declined") === "Not Interested", true],
  ["a won deal is Closed", normalizeStage("Converted") === "Closed", true],
  ["funded is Closed", normalizeStage("Funded") === "Closed", true],

  // ‼️ THE FIVE RETIRED STAGES MUST ALIAS FOR EVER. The migration rewrote today's rows, but a
  // Slack button, a saved template, a queued automation and an in-flight webhook can all still
  // write one of these tomorrow. Unaliased, they fall through to the unknown-value default.
  ["Take Off List aliases to Not Interested", normalizeStage("Take Off List") === "Not Interested", true],
  ["Email Pitch aliases to Working", normalizeStage("Email Pitch") === "Working", true],
  ["Loom Sent aliases to Follow Up", normalizeStage("Loom Sent") === "Follow Up", true],
  ["Negotiating aliases to Follow Up", normalizeStage("Negotiating / Follow-up") === "Follow Up", true],

  ["DNQ comes off the book", isTerminalStage("DNQ"), true],
  ["a wrong number comes off the book", isTerminalStage("Wrong Number"), true],
  ["a duplicate comes off the book", isTerminalStage("Duplicate"), true],

  ["Working is NOT dead", isDeadStage("Working"), false],
  ["Hot is NOT dead", isDeadStage("Hot"), false],
  ["Appointment Booked is NOT dead", isDeadStage("Appointment Booked"), false],
  ["Follow Up is NOT dead", isDeadStage("Follow Up"), false],
  ["No Contact is not terminal", isTerminalStage("No Contact"), false],
  ["New Lead is not terminal", isTerminalStage("New Lead"), false],

  ["null maps to New Lead", normalizeStage(null) === "New Lead", true],
  ["blank maps to New Lead", normalizeStage("   ") === "New Lead", true],
  ["an unknown non-blank value is No Contact, not New Lead", normalizeStage("Xyzzy") === "No Contact", true],

  ["Hot is hot", HOT_STAGES.includes("Hot"), true],
  ["Follow Up is hot", HOT_STAGES.includes("Follow Up"), true],
  ["Appointment Booked is hot", HOT_STAGES.includes("Appointment Booked"), true],
  ["New Lead is not hot", HOT_STAGES.includes("New Lead"), false],

  ["exactly eight stages", STAGE_NAMES.length === 8, true],
];
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (got ${got}, want ${want})`);
}

console.log("\n-- cadence resolves for every stage --");
for (const s of STAGE_NAMES) {
  const c = cadenceFor(s);
  console.log(`  ${s.padEnd(24)} firstTouch ${c.firstTouchHours}h  repeat ${c.repeatDays}d`);
}
console.log(bad === 0 ? "\nALL GOOD" : `\n${bad} FAILURES`);
process.exit(bad ? 1 : 0);
