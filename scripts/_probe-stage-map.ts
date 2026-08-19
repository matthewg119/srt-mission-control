import { normalizeStage, isDeadStage, isTerminalStage, isTakeOffListStage, cadenceFor, STAGE_NAMES, HOT_STAGES } from "@/config/stage-display";

const LEGACY = [
  "Open - Not Contacted", "Not Contacted", "Working - No Contact", "New", "New Lead",
  "Attempted to Contact", "Intro Text Guide", "Pre-Qualified", "Contact in Future",
  "Statements Received", "Funnel Lead Captured", "Email Captured", "Name Captured",
  "No Business Checking", "Application Complete", "Hot Lead",
  "Underwriting", "Shopping", "Pre-Approved", "Approved", "VC / DL",
  "Contracts Out", "Contracts In", "Pending Stips", "Funding Call", "In Funding",
  "Working - Contacted", "Working - Application Out", "Working", "Contacted",
  "Closed", "Closed - Not Converted", "Converted", "Dead Declined", "Deal Lost",
  "Not interested", "Take Off List", "Junk Lead", "junk lead", "DNQ", "Duplicate",
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
  ["No contact is NOT dead (call board survives)", isDeadStage("No contact"), false],
  ["Untouched is NOT dead (call board survives)", isDeadStage("Untouched"), false],
  ["Closed IS dead", isDeadStage("Closed"), true],
  ["Take Off List IS dead", isDeadStage("Take Off List"), true],
  ["Take Off List is terminal", isTerminalStage("Take Off List"), true],
  ["Take Off List is not Closed", normalizeStage("Take Off List") === "Take Off List", true],
  ["Closed is NOT take-off (the book keeps finished deals)", isTakeOffListStage("Closed"), false],
  ["DNQ comes off the list", isTakeOffListStage("DNQ"), true],
  ["a wrong number comes off the list", isTakeOffListStage("Wrong Number"), true],
  ["a duplicate comes off the list", isTakeOffListStage("Duplicate"), true],
  ["a lost deal is Closed, not take-off", normalizeStage("Deal Lost") === "Closed", true],
  ["Working is NOT dead", isDeadStage("Working"), false],
  ["Email Pitch is NOT dead", isDeadStage("Email Pitch"), false],
  ["Negotiating is NOT dead", isDeadStage("Negotiating / Follow-up"), false],
  ["No contact is not terminal", isTerminalStage("No contact"), false],
  ["Untouched is not terminal", isTerminalStage("Untouched"), false],
  ["null maps to Untouched, not No contact", normalizeStage(null) === "Untouched", true],
  ["Negotiating is hot", HOT_STAGES.includes("Negotiating / Follow-up"), true],
  ["an unknown non-blank value is No contact, not Untouched", normalizeStage("Xyzzy") === "No contact", true],
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
