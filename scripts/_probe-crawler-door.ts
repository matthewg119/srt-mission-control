// The crawler door: the two halves, and the claim that must not be made off the wrong one.
//
// Run: bun run scripts/_probe-crawler-door.ts        (pure, offline)

import { readFileSync } from "node:fs";
import { analyzeRobotsTxt, robotsVerdict, searchBotFindings } from "../src/lib/audit-engine/robots-check";
import { doorLines } from "../src/lib/clients/crawler-door";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`
${t}`); }

// The exact reuse this stage exists to make. Not a second parser.
section("1. the robots half is the audit engine's, not a second parser");

const DOOR = readFileSync("src/lib/clients/crawler-door.ts", "utf8");
ok("it imports checkRobots", /from "@\/lib\/audit-engine\/robots-check"/.test(DOOR));
// ‼️ PRECISE, BECAUSE THE CRUDE VERSION CAUGHT THE WAF PROBE. This file legitimately sends a
// `user-agent` REQUEST HEADER to see what the server does with a crawler; that is the half that
// is not robots.txt at all. What it must not do is declare its own bot list or parse groups,
// because a second list is how a training bot quietly becomes a search bot.
const DOOR_CODE = DOOR.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok("it declares no bot list of its own", !/GPTBot|ClaudeBot|PerplexityBot|Google-Extended/.test(DOOR_CODE));
// Narrowed again: "disallows" appears in the sentence read on the CALL ("Their robots.txt
// disallows X"), which is copy rather than parsing. What would be parsing is a directive with a
// colon, or a group walker.
ok("it does not parse robots.txt groups", !/Disallow:|User-agent:|parseGroups/i.test(DOOR_CODE));

// ── 2. ‼️ THE CLAIM. A training opt-out is not a closed door.
section("2. a training opt-out is not a closed door");

const TRAINING_ONLY = `User-agent: GPTBot
Disallow: /
User-agent: Google-Extended
Disallow: /
`;
const SEARCH_BLOCKED = `User-agent: OAI-SearchBot
Disallow: /
`;
const OPEN = `User-agent: *
Allow: /
`;

const training = analyzeRobotsTxt(TRAINING_ONLY);
const searchB = analyzeRobotsTxt(SEARCH_BLOCKED);
const open = analyzeRobotsTxt(OPEN);

ok("a training block is found", training.length > 0);
ok("and its verdict is soft, not devastating", robotsVerdict(training) === "soft");
ok("‼️ and it yields NO search-bot findings", searchBotFindings(training).length === 0);
ok("a search block is devastating", robotsVerdict(searchB) === "devastating");
ok("and it yields a search-bot finding", searchBotFindings(searchB).length > 0);
ok("an open file is none", robotsVerdict(open) === "none");

// ── 3. The sentence said on the call
section("3. the sentence said on the call");

function linesFor(robots: ReturnType<typeof analyzeRobotsTxt> | null, waf: "open" | "blocked" | "unknown") {
  return doorLines({
    robots,
    waf,
    wafStatus: waf === "blocked" ? 403 : 200,
    blockedSearchBots: searchBotFindings(robots).map((f) => f.bot),
    closed: searchBotFindings(robots).length > 0 || waf === "blocked",
    checkedAt: new Date().toISOString(),
  }).join(" ");
}

const trainingLine = linesFor(training, "open");
ok("a training-only block says the word training", /training/i.test(trainingLine), trainingLine);
ok("‼️ and it does NOT claim the engines cannot read them", !/disallows GPTBot, Google-Extended\. Those are the crawlers/i.test(trainingLine));

const searchLine = linesFor(searchB, "open");
ok("a search block names the bots", /OAI-SearchBot/.test(searchLine), searchLine);
ok("and says they answer questions", /ANSWER/i.test(searchLine), searchLine);

const unread = linesFor(null, "unknown");
ok("‼️ an unread file claims nothing either way", /could not be read/i.test(unread) && /nothing may be claimed/i.test(unread), unread);

const wafLine = linesFor(open, "blocked");
ok("a WAF block is reported separately from the file", /server answered 403/.test(wafLine), wafLine);
ok("and an unmeasured WAF says so", /unmeasured/i.test(linesFor(open, "unknown")));

// ── 4. ‼️ A failure is never a finding
section("4. a failure is never a finding");

const WATCH = readFileSync("src/lib/clients/crawler-watch.ts", "utf8");
ok("probeWaf returns unknown on a throw", /catch \{\s*return \{ verdict: "unknown", status: null \};/.test(DOOR));
ok("only 401, 403 and 429 count as blocked", /res\.status === 403 \|\| res\.status === 429 \|\| res\.status === 401/.test(DOOR));
ok("‼️ a first sighting is not a change", /if \(!before\) continue;/.test(WATCH));
ok("it speaks on a close, not on a pass", /check\.closed && !before\.closed/.test(WATCH));
ok("and it says so when a door reopens", /!check\.closed && before\.closed/.test(WATCH));

// ── 5. ‼️ It rides an existing cron
section("5. it rides an existing cron");

const CRON = readFileSync("src/app/api/cron/followup-digest/route.ts", "utf8");
ok("the watch runs inside followup-digest", /runCrawlerWatch/.test(CRON));
const VERCEL = readFileSync("vercel.json", "utf8");
ok("no crawler cron was added to vercel.json", !/crawler/i.test(VERCEL));

// ── 6. The subfolder gate
section("6. the subfolder gate");

const DEST = readFileSync("src/lib/hub/destinations.ts", "utf8");
ok("subfolderAllowed exists", /export async function subfolderAllowed/.test(DEST));
ok("‼️ an unread door does not refuse", /if \(!door\) return \{ ok: true \};/.test(DEST));
ok("it frames the fix as week one rather than a blocker", /week one/.test(DEST));

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
