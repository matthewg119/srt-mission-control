// A lead card names the page, every lead source is accounted for, and no card unfurls. Executable.
//
//   bun --no-env-file run scripts/_probe-lead-card.ts
//
// ‼️ NO DATABASE AND NO SLACK CALL. Every check is a pure function or a grep over the callers, which is
// what lets this run in CI with no secrets. What it cannot check is what Slack renders; what it CAN check
// is that every caller of the one lead writer has made a decision about the page, which is the thing
// that was silently missing.
//
// WHY. A lead from the concierge arrived in #hot-leads as "New Lead / First Name / Email / Source:
// concierge" and nothing about WHICH page. The page WAS being captured: action/route.ts built it from
// body.host + body.path and passed it as `headline` and a `detailLine`, and both of those land in the
// THREAD REPLY. That is the "1 reply" under the card that nobody opens, so no lead in the channel was
// attributable without a click.
//
// ‼️ THE CHECK WITH TEETH IS SECTION 2. Every ingestLead caller must either pass sourcePage or say in a
// comment why there is no page. A caller that quietly passes nothing is how "every lead source" became
// "the two that happened to know".

import fs from "node:fs";
import path from "node:path";

import { CONTACT_FIELD_MAP } from "../src/lib/field-map";
import { pageFromRequest } from "../src/lib/lead-intake";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * The same file with its comments removed.
 *
 * ‼️ EVERY GREP BELOW IS ABOUT CODE, AND THE COMMENTS IN THIS REPO ARE LONG ENOUGH TO BREAK ONE.
 * Two checks in the first draft of this probe read comment prose as if it were code: "the card no longer
 * links to /dashboard/pipeline" failed on the comment EXPLAINING that it used to, and provision.ts was
 * reported as passing a page because the words "NO sourcePage: A PILOT START..." matched a regex looking
 * for an assignment. A probe that can be fooled by an explanation is worse than one that is missing.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

/** A fake request carrying whatever Referer a test wants. */
function withReferer(referer: string | null) {
  return { headers: { get: (n: string) => (n.toLowerCase() === "referer" ? referer : null) } };
}

// ── 1. The page is on the card, next to the source ──────────────────────────
console.log("\n1. the card names the page");

const thread = read("src/lib/lead-thread.ts");
const fields = thread.slice(thread.indexOf("const INITIAL_KEY_FIELDS"), thread.indexOf("] as const;"));

check(fields.includes('"source_page"'), "source_page is in INITIAL_KEY_FIELDS");
check(
  fields.indexOf('"source"') < fields.indexOf('"source_page"'),
  "and it sits directly after source, which is how a person reads them"
);
check(
  CONTACT_FIELD_MAP.some((f) => f.supabase === "source_page" && f.label === "Page"),
  "the field map gives it a label, or formatInitialBlocks skips it entirely",
  "the render loop does `CONTACT_FIELD_MAP.find(...)` and `continue`s on a miss, so a missing entry is silent"
);

// ── 2. Every lead source has made a decision about the page ─────────────────
console.log("\n2. every ingestLead caller either passes a page or says why not");

const CALLERS = [
  "src/app/api/audit/public-intake/route.ts",
  "src/app/api/chatgpt-ads/submit/route.ts",
  "src/app/api/concierge/action/route.ts",
  "src/app/api/leads/facebook/route.ts",
  "src/app/api/leads/funnel/route.ts",
  "src/app/api/lhr/optin/route.ts",
  "src/app/api/medspa/optin/route.ts",
  "src/lib/clients/provision.ts",
  "src/lib/followup-operator/campaign-replies.ts",
  "src/lib/medspa/provision.ts",
  "src/lib/scan/start-claim.ts",
];

// The census is derived, not typed out, so a twelfth caller cannot be added without this noticing.
const found = new Set<string>();
for (const dir of ["src/app", "src/lib"]) {
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), d), { withFileTypes: true })) {
      const rel = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && read(rel).includes("ingestLead({")) found.add(rel);
    }
  };
  walk(dir);
}
check(
  found.size === CALLERS.length && CALLERS.every((c) => found.has(c)),
  `there are exactly ${CALLERS.length} ingestLead callers and this probe knows all of them`,
  [...found].filter((f) => !CALLERS.includes(f)).join(", ") || undefined
);

for (const file of CALLERS) {
  const src = code(file);
  const passes = /sourcePage:\s*(?!undefined)\S/.test(src);
  const declines = /sourcePage:\s*undefined/.test(src) || /NO sourcePage/.test(read(file));
  check(
    passes || declines,
    `${file.replace("src/", "")} decides`,
    passes ? "passes a page" : "records in a comment that there is none"
  );
}

// ── 3. The Referer wins, the funnel is the fallback ─────────────────────────
console.log("\n3. the page is read from the request, not guessed");

check(
  pageFromRequest(withReferer("https://srtagency.com/scan?utm_source=fb"), "/x") === "srtagency.com/scan",
  "the query string is dropped",
  "utm_* and fbclid have their own columns, and on a card they push the useful half off the line"
);
check(
  pageFromRequest(withReferer("https://mission.srtagency.com/scan"), "/scan") === "mission.srtagency.com/scan",
  "the real host wins over the assumed one",
  "srtagency.com rewrites to mission.srtagency.com, so the two are different front doors to one route"
);
check(pageFromRequest(withReferer(null), "/LHR") === "srtagency.com/LHR", "a missing Referer falls back to the funnel");
check(pageFromRequest(withReferer("not a url"), "/LHR") === "srtagency.com/LHR", "and so does a malformed one");
check(pageFromRequest(withReferer(null), "LHR") === "srtagency.com/LHR", "the fallback tolerates a path with no slash");
check(
  pageFromRequest(withReferer("https://clinic.com/pricing/"), "/x") === "clinic.com/pricing",
  "a trailing slash is trimmed, so one page is not two rows"
);
check(pageFromRequest(withReferer("https://a.com/" + "p".repeat(400)), "/x").length <= 300, "and it is bounded");

// ── 4. No lead post unfurls ─────────────────────────────────────────────────
//
// There was no parameter for this anywhere in slack-bot.ts, so every post in the app took Slack's
// default. On a lead card that drew a preview of whatever link was in the text, and the card's own
// "View in Mission Control" pointed at /dashboard/pipeline, which does not exist.
console.log("\n4. no lead post carries a preview card");

const bot = read("src/lib/slack-bot.ts");
check(bot.includes("unfurl_links = false") && bot.includes("unfurl_media = false"), "the client can turn unfurls off");
check(
  bot.includes("opts?.unfurl === false"),
  "and only when a caller asks",
  "so every existing post in the app keeps Slack's default exactly as it was"
);
check(/postMessage\(channel, fallbackText, blocks, \{ unfurl: false \}\)/.test(thread), "the lead card asks");
const intake = read("src/lib/lead-intake.ts");
check((intake.match(/unfurl: false/g) ?? []).length === 2, "both replies in lead-intake ask", "the ingest reply and the enrich reply");

// ── 5. The dead link ────────────────────────────────────────────────────────
console.log("\n5. the card's links go somewhere");

check(
  !code("src/lib/lead-thread.ts").includes("/dashboard/pipeline"),
  "the card no longer links to /dashboard/pipeline",
  "checked against the code only: the comment above it still names the route, which is the point of the comment"
);
check(
  !fs.existsSync(path.join(process.cwd(), "src/app/dashboard/pipeline")),
  "and that route still does not exist, which is why it 404'd for every lead ever posted"
);
check(thread.includes("|View in Mission Control>") && thread.includes("/contacts/"), "it points at this contact instead");
check(
  fs.existsSync(path.join(process.cwd(), "src/app/contacts")),
  "and /contacts does exist",
  "unlike /api/vcard, which was also suspected and turns out to be real: a 404 there was a bogus id"
);
check(
  (thread.match(/https:\/\/mission\.srtagency\.com/g) ?? []).length <= 1,
  "the host is not written out five times any more",
  "one fallback default inside appBase() is all that is left"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. Every lead source has an answer about the page it came from.");

export {};
