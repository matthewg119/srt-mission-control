// What the assistant is told about the lead, and what it must never be told.
//
//   bunx tsx --env-file=.env.local scripts/_probe-lead-brief.ts
//
// ‼️ THE POINT OF THIS FILE IS THE NEGATIVE ASSERTIONS. leadBrief goes into a system prompt, so
// anything wrong in it is not a bug that throws, it is a confident sentence to a person who is
// about to act on it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/db";
import { leadContext, held, missing, isHeld, type LeadContext } from "@/lib/clients/lead-context";
import { leadBrief } from "@/lib/clients/lead-brief";
import { withLeadScope } from "@/lib/clients/lead-scope";
import { gapsFrom, gapLines } from "@/lib/clients/step-gaps";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const SRC = readFileSync(path.resolve(__dirname, "../src/lib/clients/lead-brief.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

async function main() {
  console.log("\n1. it renders, it does not read");
  // ‼️ A BRIEF THAT COULD READ WOULD BECOME A SECOND ASSEMBLY. leadContext is the one read model;
  // this file turns one into prose and must stay downstream of it.
  check("no database handle", !/supabaseAdmin/.test(CODE));
  check("no table is named", !/\.from\(/.test(CODE));
  check("nothing is written", !/\.(insert|update|upsert|delete)\(/.test(CODE));
  check("no model is called", !/callClaude|runConversationWithTools/.test(CODE));
  check("no em dash anywhere", !SRC.includes("—"));

  console.log("\n2. the rules the model is handed");
  const rules = [
    "This IS the client",
    "Do not fill it in",
    "Never state a number",
    "Suggest, never decide",
    "Only name a command",
  ];
  for (const r of rules) check(`it still says: ${r}`, SRC.includes(r));

  console.log("\n3. a missing field is said out loud");
  // A synthetic context, the same cast _probe-gaps.ts documents: leadBrief reads the fields it
  // prints and nothing else, so naming them is the honest way to build one.
  const bare = {
    clientId: "x",
    loaded: new Set(["core"]),
    readErrors: [],
    identity: {
      ref: {},
      name: "Nobody Ltd",
      domain: missing("asked_unanswered", "no website is on file"),
      website: missing("asked_unanswered", "no website is on file"),
      vertical: missing("never_asked", "no vertical has been classified"),
      businessType: missing("never_asked", "not classified"),
      city: missing("asked_unanswered", "no city is on file"),
      intakeCompletedAt: missing("asked_unanswered", "intake is not finished"),
      day0ArchivedAt: missing("blocked", "day 0 has not happened"),
    },
    audiences: [],
    primaryAudience: null,
    avatar: {},
    offers: [],
    primaryOffer: null,
    documents: {},
    beliefs: missing("asked_unanswered", "no belief is on file"),
    ladder: missing("asked_unanswered", "no ladder is on file"),
    keywords: missing("asked_unanswered", "no keyword has been written"),
    pages: missing("asked_unanswered", "no page has been drafted"),
    audits: missing("asked_unanswered", "no audit"),
    research: missing("asked_unanswered", "no pull is held"),
    history: missing("unreadable", "not loaded"),
    gaps: held([], { source: "probe", why: "no dataset could be evaluated" }),
    board: { steps: [], reachable: [], cursor: missing("blocked", "nothing is reachable"), blocked: [] },
  } as unknown as LeadContext;

  const empty = leadBrief(bare, null);
  check("an empty client still renders", empty.length > 0);
  check("a missing field says NOT ON FILE", empty.includes("NOT ON FILE"));
  check("and carries the reason", empty.includes("no website is on file"));
  // ‼️ THE FAILURE THIS CATCHES: a Held rendered through String() prints "undefined" or
  // "[object Object]" and reads, to a model, like a value.
  check("nothing renders as undefined", !empty.includes("undefined"));
  check("nothing renders as [object Object]", !empty.includes("[object Object]"));
  check("no rung count is invented", !/\d+ rung/.test(empty));

  console.log("\n4. against the real client");
  const { data: c } = await supabaseAdmin.from("clients").select("id").eq("slug", "srt-agency-llc").maybeSingle();
  if (!c) {
    check("srt-agency-llc resolves", false);
    return done();
  }
  check("srt-agency-llc resolves", true);

  await withLeadScope(async () => {
    const ctx = await leadContext(c.id as string, {
      include: ["core", "documents", "gaps", "keywords", "pages", "research"],
    });
    const brief = leadBrief(ctx, "pre_call_pages");

    check("it names the client", brief.includes("SRT Agency LLC"));
    check("it says which step the thread is", brief.includes("THIS THREAD IS STEP 21"));
    check("it fits a system prompt", brief.length < 8000, `${brief.length} chars`);
    check("it was not truncated", !brief.includes("(brief truncated)"));

    // ‼️ THE CARD AND THE ASSISTANT CANNOT DISAGREE IN ONE THREAD. The gap lines are gapLines',
    // verbatim, not a paraphrase: two different answers to one question on one screen is worse
    // than one answer nobody likes.
    const lines = gapLines(gapsFrom(ctx, "pre_call_pages"));
    check("the gaps are the board's own sentences", lines.every((l) => brief.includes(l)), `${lines.length} line(s)`);

    // The ladder bug that started all this: present document, field read as missing.
    if (isHeld(ctx.ladder)) {
      check("the ladder is reported as held", /Awareness ladder: \d+ rung/.test(brief));
    }
  });

  done();
}

function done(): void {
  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
