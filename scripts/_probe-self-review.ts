// The weekly self-review, proved.
//
//   bun run --env-file=.env.local scripts/_probe-self-review.ts
//
// ‼️ `bun run`, NOT `bunx tsx`: section 4 uses a top-level await and tsx dies on one with a
// TransformError before a single check runs.
//
// WHAT IT PROVES
//  1. One a week is enforced by the DATABASE, not by this code, and the row is written before the post.
//  2. Every proposal carries a category from the closed list and at least two why-bullets.
//  3. Every generated prompt ends by requiring a preview.
//  4. It never posts on a day that is not Thursday, and never twice in one ISO week.
//  5. It adds no cron entry: vercel.json is unchanged.

import { readFileSync } from "fs";
import { CATEGORIES, NORTH_STAR, PREVIEW_REQUIREMENT, isoWeek, renderProposal } from "../src/lib/ops/self-review";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. the cap is in the database");

const sql = readFileSync("docs/2026-09-26-code-suggestions.sql", "utf8");
check("a unique index on iso_week exists", /create unique index[\s\S]*?\(iso_week\)/i.test(sql));
check("category is NOT NULL with a check", /category\s+text not null check/i.test(sql));
check("no default category", !/category\s+text not null default/i.test(sql), "a default would become the most common answer");
check("the decision is recorded", /status\s+text not null default 'open'/.test(sql));

const code = readFileSync("src/lib/ops/self-review.ts", "utf8");
// ‼️ THE INSERT MUST COME BEFORE THE POST. Reversed, a failed insert would still have spoken, and a
// second run that week would say the same thing again.
const insertAt = code.indexOf('.from("code_suggestions").insert');
const postAt = code.indexOf("postInfraAlert(renderProposal");
check("the row is written BEFORE the post", insertAt > 0 && postAt > insertAt, `${insertAt} vs ${postAt}`);
check("a failed insert stops the post", /not filed, so not posted/.test(code));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. the shape Matthew asked for");

check("six categories, no more", CATEGORIES.length === 6, CATEGORIES.join(", "));
check("security is one of them", CATEGORIES.includes("security"));
check("one-ui is one of them, so the goal is a category", CATEGORIES.includes("one-ui"));
check("the north star names the one page", /one page/i.test(NORTH_STAR));
check("and names data collection as the priority", /DATA COLLECTION/i.test(NORTH_STAR));
check("and calls everything else noise", /noise/i.test(NORTH_STAR));

const rendered = renderProposal(
  {
    category: "data-collection",
    title: "Step 10 should ask for the terms one at a time",
    observation: "Step 10 took 17 free-text messages against 1 command last week.",
    bullets: ["Fix the card, because people are explaining themselves to it", "Why: the grammar takes one command per message"],
    files: ["src/lib/clients/offers.ts"],
    claudePrompt: `Do the thing.${PREVIEW_REQUIREMENT}`,
  },
  "2026-W39"
);
check("the category is on the card", /`data-collection`/.test(rendered), rendered.slice(0, 80));
check("the bullets are on the card", rendered.includes("  • Fix the card"));
check("the files it read are named", /src\/lib\/clients\/offers\.ts/.test(rendered));
check("the prompt is fenced so it copies whole", rendered.includes("```"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. every prompt ends by asking for a preview");

// Matthew, 2026-09-23: "what I want is the prompt that the code guardian gives me, says to give us a
// preview at the end so we can edit whatever we create and or integrate right away."
check("the requirement asks for a preview", /give me a preview/i.test(PREVIEW_REQUIREMENT));
check("it says not to call it done first", /not report it as done/i.test(PREVIEW_REQUIREMENT));
check("it covers a page, a workflow's words and a command", /URL/.test(PREVIEW_REQUIREMENT) && /exact text/.test(PREVIEW_REQUIREMENT) && /one command/.test(PREVIEW_REQUIREMENT));
// ‼️ APPENDED IN CODE, NOT ASKED OF THE MODEL. A rule the model can forget is not a rule.
check("it is appended rather than requested", code.includes("${data.claudePrompt.trim()}${PREVIEW_REQUIREMENT}"));
check("no em dash in it", !/[—–]|--/.test(PREVIEW_REQUIREMENT));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. it stays quiet when it should");

check("isoWeek is stable", isoWeek(new Date("2026-09-23T00:00:00Z")) === isoWeek(new Date("2026-09-23T23:00:00Z")));
check("a new week is a new key", isoWeek(new Date("2026-09-23T00:00:00Z")) !== isoWeek(new Date("2026-10-01T00:00:00Z")));
check("a silent week is a legitimate outcome", /worthPosting: false/.test(code) || /worthPosting.*false/.test(code));
check("it refuses when nothing moves the goal", /nothing observed moves the goal/.test(code));

const { runWeeklySelfReview } = await import("../src/lib/ops/self-review");
const monday = await runWeeklySelfReview({ now: new Date("2026-09-21T12:00:00Z") });
check("it does not run on a Monday", monday.posted === false && monday.skipped === "not Thursday", JSON.stringify(monday));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. no eighteenth cron");

// vercel.json already carries 17 against a Hobby plan documenting 2, which is why every weekly job
// rides followup-digest as a passenger.
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string }> };
check("still 17 cron entries", vercel.crons.length === 17, String(vercel.crons.length));
check("no self-review cron was added", !vercel.crons.some((c) => /self-review|review/.test(c.path)));

const digest = readFileSync("src/app/api/cron/followup-digest/route.ts", "utf8");
check("it rides followup-digest instead", digest.includes("runWeeklySelfReview"));
check("in its own catch, so it cannot 500 the digest", /runWeeklySelfReview\(\)\.catch/.test(digest));

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
