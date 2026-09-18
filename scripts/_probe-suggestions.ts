// What the board suggests doing next, and what it must never claim while suggesting it.
//
//   bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
//
// ‼️ A SUGGESTION IS THE MOST ACTIONABLE THING THIS SYSTEM EMITS, so D9 binds hardest here. A gap
// that is wrong wastes a paste. A suggestion that is wrong sends somebody to rebuild a keyword set.

import { readFileSync } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/db";
import { leadContext, held, missing, isHeld, type LeadContext } from "@/lib/clients/lead-context";
import { withLeadScope } from "@/lib/clients/lead-scope";
import { suggestionsFor, suggestionLines } from "@/lib/clients/suggestions";
import { handleGapThreadReply } from "@/lib/clients/gap-thread";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const SRC = readFileSync(path.resolve(__dirname, "../src/lib/clients/suggestions.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

/** A context carrying only what suggestionsFor reads. The cast is the documentation. */
function contextWith(over: Record<string, unknown>): LeadContext {
  return {
    clientId: "probe",
    loaded: new Set(["core"]),
    readErrors: [],
    audiences: [],
    documents: {},
    gaps: held([], { source: "probe", why: "nothing evaluated" }),
    keywords: missing("asked_unanswered", "no keyword"),
    pages: missing("asked_unanswered", "no page"),
    ladder: missing("asked_unanswered", "no ladder"),
    board: { steps: [], reachable: [], cursor: missing("blocked", "nothing reachable"), blocked: [] },
    ...over,
  } as unknown as LeadContext;
}

async function main() {
  console.log("\n1. it argues, it does not read");
  // ‼️ PURE, AND IT TAKES A LeadContext. A function with no client id and no db import cannot
  // become a second read model, which is the same enforcement northStar is designed around.
  check("no database handle", !/supabaseAdmin/.test(CODE));
  check("no table is named", !/\.from\(/.test(CODE));
  check("nothing is written", !/\.(insert|update|upsert|delete)\(/.test(CODE));
  check("it takes no clientId", !/clientId/.test(CODE));
  check("no em dash", !SRC.includes("—"));

  console.log("\n2. every suggestion says what it was read from");
  const empty = suggestionsFor(contextWith({}), null);
  check("an empty client still answers", empty.length > 0);
  check("every one carries a basis", empty.every((s) => s.basis.trim().length > 0));
  check("every one carries a why", empty.every((s) => s.why.trim().length > 0));
  // ‼️ THE FAILURE THIS CATCHES: a template rendering a Held or an undefined count into prose.
  const all = empty.map((s) => `${s.title} ${s.why} ${s.basis}`).join(" ");
  check("nothing renders as undefined", !all.includes("undefined"));
  check("nothing renders as NaN", !all.includes("NaN"));
  check("nothing renders as [object Object]", !all.includes("[object Object]"));

  console.log("\n3. performance is never claimed");
  // Matthew asked for suggestions based on "the performance of the actual pages that are live".
  // weekly-report.ts tells the client in writing that nothing counts leads, so the honest answer is
  // that it is not measured. A suggestion engine that skipped the question would let the absence
  // read as "no problem found".
  check("it says so when no page is live", empty.some((s) => /no performance to argue from/i.test(s.title)));
  const live = suggestionsFor(
    contextWith({ pages: held([{ id: "1", slug: "s", title: null, status: "published" }], { source: "probe", why: "x" }) }),
    null
  );
  check("and says so when pages ARE live", live.some((s) => /NOT MEASURED/.test(s.title)));
  const liveText = live.map((s) => `${s.title} ${s.why}`).join(" ");
  for (const word of ["traffic is up", "converting", "ranking well", "performing"]) {
    check(`it never claims "${word}"`, !liveText.includes(word));
  }

  console.log("\n4. the anchor versus the keywords, which is the funnel question");
  // The one suggestion that is about strategy rather than about a missing field. It fires only when
  // the two columns actually disagree, and it must not fire when they agree.
  const disagree = suggestionsFor(
    contextWith({
      ladder: held({ rungs: [1, 2, 3, 4, 5], anchoredAt: 4 }, { source: "probe", why: "x" }),
      keywords: held({ total: 385, approved: 376, byRole: { unpicked: 385 }, byStage: { "2": 30, "3": 349, "4": 6 } }, { source: "probe", why: "x" }),
    }),
    null
  );
  check("it fires when they disagree", disagree.some((s) => /anchor is rung 4, but the searches are at rung 3/.test(s.title)));
  const agree = suggestionsFor(
    contextWith({
      ladder: held({ rungs: [1, 2, 3, 4, 5], anchoredAt: 3 }, { source: "probe", why: "x" }),
      keywords: held({ total: 385, approved: 376, byRole: { pillar: 1, support: 6 }, byStage: { "3": 349, "2": 30 } }, { source: "probe", why: "x" }),
    }),
    null
  );
  check("and stays quiet when they agree", !agree.some((s) => /but the searches are at rung/.test(s.title)));

  console.log("\n5. the card");
  const lines = suggestionLines(empty);
  check("it is a card, not a wall", lines.join("\n").length < 2900, `${lines.join("\n").length} chars`);
  check("it says nothing was run", lines.some((l) => /Nothing here has been run/.test(l)));

  console.log("\n6. against the real client, through the thread door");
  const { data: c } = await supabaseAdmin.from("clients").select("id").eq("slug", "srt-agency-llc").maybeSingle();
  if (!c) {
    check("srt-agency-llc resolves", false);
    return done();
  }
  const reply = await handleGapThreadReply({
    clientId: c.id as string,
    stepKey: "pre_call_pages",
    text: "suggest",
    by: "probe",
    channel: "NOT_A_CHANNEL",
    threadTs: "0",
  });
  check("`suggest` is answered", reply !== null);
  check("it fits a Slack section", (reply?.message.length ?? 0) < 2900, `${reply?.message.length ?? 0} chars`);
  check("it posts nothing afterwards", reply?.after === undefined);
  check("it names the pillar as the blocker", /Pick the pillar/.test(reply?.message ?? ""));
  // An ordinary sentence in a client channel must still fall through to whatever owns it.
  const fell = await handleGapThreadReply({
    clientId: c.id as string,
    stepKey: "pre_call_pages",
    text: "can you suggest a time to call them",
    by: "probe",
    channel: "NOT_A_CHANNEL",
    threadTs: "0",
  });
  check("a sentence containing 'suggest' falls through", fell === null);

  await withLeadScope(async () => {
    const ctx = await leadContext(c.id as string, { include: ["core", "documents", "gaps", "keywords", "pages"] });
    const real = suggestionsFor(ctx, "pre_call_pages");
    // ‼️ A BASIS NAMES ITS SOURCE, NOT NECESSARILY A COUNT. This asserted a digit first and failed
    // on the cursor suggestion, correctly: "client_delivery_steps, walked in order with the
    // blockedBy declarations" is a complete answer to "where did you read that" and there is no
    // number in it. Requiring a digit would have pushed somebody to invent one.
    // ‼️ WIDENED 2026-09-22 TO ADMIT THE SHARED TABLES, AND THE LIST IS THE POINT.
    // A cross-client suggestion must name the SHARED table it read (avatar_briefs, question_bank),
    // never the other client's row. Those tables deliberately carry no client_id, and the absence
    // of that column is the enforcement: a fact about a vertical, an avatar, a domain or a public
    // URL may be shared, and a measurement about one client may not.
    // ‼️ AND THE SAME REGEX LIVES IN _probe-step-rerun.ts. Widening one and not the other leaves
    // that probe failing on a basis this one accepts.
    const SOURCE = /client_[a-z_]+|page_[a-z_]+|avatar_briefs|question_bank|audience_documents|dataset_suggestions|policy_documents|STEP_NEEDS/;
    check("every real suggestion names its source", real.every((s) => SOURCE.test(s.basis)), real.find((s) => !SOURCE.test(s.basis))?.basis ?? "");
    if (isHeld(ctx.keywords)) {
      check("the keyword counts are the measured ones", real.some((s) => s.basis.includes(String(ctx.keywords.state === "present" ? ctx.keywords.value.approved : ""))));
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
