// The keyword step, proved offline, and optionally one real expansion that writes nothing.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
//      bunx tsx --env-file=.env.local scripts/_probe-keywords.ts --live srt-agency-llc
//
// ‼️ THE DEFAULT RUN MAKES NO MODEL CALL, NO WRITE AND NO NETWORK CALL. `--live <slug>` makes one
// real expansion for that client (one or two Sonnet calls plus re-asks, well under a dollar),
// prints what it produced per category and the nine keywords the plan would pick if every row
// were approved, and still writes nothing: it never touches client_keywords.
//
// WHAT IT PROVES
//  1. The SRT fixture: every outcome-promise line lands as a HOOK, every "why isn't my med spa on
//     ChatGPT" line as a QUERY, whatever the model labelled it. Matthew's two pasted lists are not
//     in the repo, so the fixture is the addendum's own seed column plus the lines it quotes.
//  2. The floor: 150 query rows refuse, 200 pass, and approval and relevance are separate gates.
//  3. Provenance: an expansion row never outranks an evidenced one for the same slot, never
//     carries a frequency term, and loses to evidence when both are the same phrase.
//  4. Relevance: "does lip filler hurt" is about a lip filler client and not about a Botox one.
//  5. Grammar: the five commands fire; "keywords drop everything" and "keywords matter less than
//     people think" are dictation.
//  6. Terms and the filter: `terms:` parses, two-word naming variants survive, dashes do not.

import {
  KEYWORD_CATEGORIES,
  KEYWORD_FLOOR,
  classifyUse,
  cleanPhrase,
  compareKeywords,
  isHookShaped,
  keywordFault,
  keywordVerdict,
  mergeKeywords,
  parseKeywordCommand,
  scoreKeyword,
  type KeywordCandidate,
} from "@/lib/clients/keyword-expansion";
import { isAboutOffer, offerVocabulary } from "@/lib/clients/phrase-quality";
import { parseTerms } from "@/lib/clients/offers";
import { commandOwner, looksLikePastedList } from "@/lib/clients/step-commands";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── 1. Query or hook, on SRT's own wording ───────────────────────────────────
console.log("\n1. SRT: outcome promises are hooks, whatever the model said; searches are queries");

const SRT_QUERIES = [
  ...KEYWORD_CATEGORIES.owner.flatMap((c) => c.seeds),
  "why isn't my med spa on ChatGPT",
  "why doesn't ChatGPT recommend my clinic",
  "med spa not showing up in Perplexity",
  "get my med spa recommended by ChatGPT",
  "how long until ChatGPT mentions my clinic",
  "is AEO worth it for a med spa",
];
const SRT_HOOKS = [
  "5 new filler patients in 30 days",
  "30-day ChatGPT visibility sprint",
  "your clinic isn't showing up on ChatGPT",
  "20 more Botox bookings a month, guaranteed",
  "Stop losing patients to AI search!",
  "Get recommended by ChatGPT in 60 days",
];

for (const q of SRT_QUERIES) check(`query: ${q}`, classifyUse("query", q) === "query");
for (const h of SRT_HOOKS) check(`hook even when the model said query: ${h}`, classifyUse("query", h) === "hook");
check("a line the model called a hook stays a hook", classifyUse("hook", "AEO for med spas") === "hook");
check("isHookShaped leaves a plain price question alone", !isHookShaped("how much does AEO cost per month"));

// ── 2. The floor ─────────────────────────────────────────────────────────────
console.log("\n2. The verifier's floor, approval and relevance");

check(`150 query rows refuse (floor ${KEYWORD_FLOOR})`, !keywordVerdict({ queries: 150, approvedQueries: 150, relevantApproved: 150 }).ok);
check("200 approved, relevant query rows pass", keywordVerdict({ queries: 200, approvedQueries: 200, relevantApproved: 200 }).ok);
check("200 rows nobody approved refuse", !keywordVerdict({ queries: 200, approvedQueries: 0, relevantApproved: 0 }).ok);
const eight = keywordVerdict({ queries: 210, approvedQueries: 210, relevantApproved: 8 });
check("8 relevant approved queries refuse, with the fix named", !eight.ok && !eight.ok && eight.todo.includes("keywords more"));
check(
  "both category tables ask for at least the floor",
  (["patient", "owner"] as const).every((a) => KEYWORD_CATEGORIES[a].reduce((n, c) => n + c.target, 0) >= KEYWORD_FLOOR),
  (["patient", "owner"] as const).map((a) => `${a}=${KEYWORD_CATEGORIES[a].reduce((n, c) => n + c.target, 0)}`).join(", ")
);
check(
  "exactly one naming category per table",
  (["patient", "owner"] as const).every((a) => KEYWORD_CATEGORIES[a].filter((c) => c.naming).length === 1)
);

// ── 3. Provenance ────────────────────────────────────────────────────────────
console.log("\n3. A proposal never outranks evidence and never carries a frequency term");

const row = (over: Partial<KeywordCandidate>): KeywordCandidate => ({
  phrase: "how much is lip filler",
  normalized: "how much is lip filler",
  category: "price",
  use: "query",
  origin: "expansion",
  frequency: 0,
  intent: 3,
  objection: false,
  currentlyNamed: null,
  sourceUrl: null,
  score: 0,
  ...over,
});

const expScoreA = scoreKeyword({ origin: "expansion", frequency: 0, intent: 3, objection: false, currentlyNamed: null }, 3);
const expScoreB = scoreKeyword({ origin: "expansion", frequency: 500, intent: 3, objection: true, currentlyNamed: false }, 3);
check("an expansion row's score ignores frequency, objection and the gap term", expScoreA === expScoreB, `${expScoreA} vs ${expScoreB}`);
const measured = scoreKeyword({ origin: "measured", frequency: 0, intent: 3, objection: false, currentlyNamed: false }, 3);
check("a measured row earns the +15 gap term and only that", measured === expScoreA + 15, `${measured}`);
const harvested = scoreKeyword({ origin: "harvest", frequency: 5, intent: 1, objection: false, currentlyNamed: null }, 3);
check("a harvested row earns its frequency term", harvested > scoreKeyword({ origin: "harvest", frequency: 0, intent: 1, objection: false, currentlyNamed: null }, 3));

const proposal = row({ origin: "expansion", score: 99 });
const evidence = row({ origin: "harvest", score: 5, category: "other", sourceUrl: "https://example.com/a", frequency: 3 });
const [merged] = mergeKeywords([proposal, evidence]);
check("the same phrase twice keeps the EVIDENCED row", merged.origin === "harvest");
check("and the expansion's category replaces the evidence row's fallback", merged.category === "price");
check("and keeps the evidence's source URL", merged.sourceUrl === "https://example.com/a");

const sorted = [row({ phrase: "b", origin: "expansion", score: 99 }), row({ phrase: "a", origin: "harvest", score: 1 })].sort(compareKeywords);
check("an expansion row with a far higher score still sorts after evidence", sorted[0].origin === "harvest");
const manualWins = mergeKeywords([row({ origin: "harvest", score: 50 }), row({ origin: "manual", score: 1 })])[0];
check("a phrase a person added beats the market's copy of it", manualWins.origin === "manual");
const hooksLast = [row({ phrase: "h", use: "hook", origin: "harvest", score: 99 }), row({ phrase: "q", use: "query", origin: "expansion", score: 1 })].sort(compareKeywords);
check("queries rank before hooks", hooksLast[0].use === "query");

// ── 4. Relevance ─────────────────────────────────────────────────────────────
console.log("\n4. isAboutOffer: one definition, a vocabulary not a string");

const lip = offerVocabulary({ treatment: "Lip filler", terms: ["lip injections", "lip flip"] });
const botox = offerVocabulary({ treatment: "Botox", terms: ["tox", "wrinkle relaxer"] });
const srt = offerVocabulary({
  treatment: "AEO Services for med spas",
  terms: ["AEO", "answer engine optimization", "AI visibility", "ChatGPT SEO"],
});

check('"does lip filler hurt" is about a lip filler client', isAboutOffer("does lip filler hurt", lip));
check('"does lip filler hurt" is not about a Botox client', !isAboutOffer("does lip filler hurt", botox));
check("word boundaries: tox does not match detox", !isAboutOffer("best detox drinks", botox));
check("SRT: a customer term makes a harvested phrase relevant", isAboutOffer("best AEO agency for med spas", srt));
check(
  "SRT: the whole treatment string alone would have matched almost nothing",
  !isAboutOffer("best AEO agency for med spas", offerVocabulary({ treatment: "AEO Services for med spas" }))
);
check("SRT: a lip filler question is not about SRT's offer", !isAboutOffer("does lip filler hurt", srt));
check(
  "a phrase written under one of the offer's own categories is about it",
  isAboutOffer("why isn't my med spa on ChatGPT", srt, { askedAboutOffer: true })
);
check("a harvested buying shape with no name in it is not", !isAboutOffer("how much does it cost", srt));

// ── 5. The thread grammar ────────────────────────────────────────────────────
console.log("\n5. The five commands fire; the dictation they could swallow does not");

const patient = KEYWORD_CATEGORIES.patient;
const owner = KEYWORD_CATEGORIES.owner;
check('"keywords approve"', parseKeywordCommand("keywords approve", patient)?.kind === "approve");
check('"`keywords approve`" in backticks', parseKeywordCommand("`keywords approve`", patient)?.kind === "approve");
const drop1 = parseKeywordCommand("keywords drop 12", patient);
check('"keywords drop 12"', drop1?.kind === "drop" && drop1.ranks.join() === "12");
const dropMany = parseKeywordCommand("keywords drop 12, 15, 40", patient);
check('"keywords drop 12, 15, 40"', dropMany?.kind === "drop" && dropMany.ranks.join() === "12,15,40");
const add = parseKeywordCommand("keywords add: lip filler charlotte", patient);
check('"keywords add: lip filler charlotte"', add?.kind === "add" && add.phrases.length === 1 && add.phrases[0] === "lip filler charlotte");
const pasted = parseKeywordCommand(
  "keywords add:\n1. Get more filler patients from ChatGPT\n2. 5 filler patients in 30 days\nMechanism-led (AEO / visibility angle)\n8. ChatGPT visibility for med spas",
  owner
);
check(
  "a pasted numbered list adds every numbered line and skips the heading between them",
  pasted?.kind === "add" && pasted.phrases.length === 3 && !pasted.phrases.some((p) => p.startsWith("Mechanism")),
  JSON.stringify(pasted)
);
check(
  "and each line is still classified on its own: the outcome promise is a hook",
  pasted?.kind === "add" && classifyUse("query", pasted.phrases[1]) === "hook" && classifyUse("query", pasted.phrases[2]) === "query"
);
{
  // ‼️ THE PASTED LIST, WHICH IS WHAT ACTUALLY HAPPENED TWICE. A list with no `keywords add:` in
  // front of it matches no command grammar, so it used to fall through to the general assistant,
  // which answered a keyword list with a strategic assessment and stored nothing.
  const pastedList = [
    "AEO for med spas",
    "answer engine optimization med spa",
    "why isn't my med spa on ChatGPT",
    "ChatGPT not recommending my clinic",
    "best AEO agency for med spas",
    "how much does AEO cost",
  ].join("\n");
  check("a pasted list of phrases is recognised", looksLikePastedList(pastedList)?.lines.length === 6);
  check(
    "a numbered list with a heading skips the heading",
    looksLikePastedList("Mechanism-led (AEO angle):\n1. AEO for med spas\n2. AI visibility audit\n3. get cited by ChatGPT\n4. answer engine optimization\n5. LLM optimization clinics")?.lines.length === 5
  );
  check("four lines is not a list", looksLikePastedList("one phrase\ntwo phrase\nthree phrase\nfour phrase") === null);
  check(
    "a paragraph with line breaks is not a list",
    looksLikePastedList(
      [
        "I spoke to them this morning and they were happy with the preview.",
        "They want to know whether the booking bot is included in the price.",
        "I said I would check and come back to them tomorrow afternoon.",
        "They also asked about the guarantee and how the five patients are counted.",
        "Worth reading the notes before the next call because there is a lot in there.",
      ].join("\n")
    ) === null
  );
  check(
    "a list that IS a command is left to the command handler",
    looksLikePastedList("keywords add:\n1. AEO for med spas\n2. AI visibility\n3. get cited\n4. LLM SEO\n5. answer engines") !== null &&
      commandOwner("keywords add:\n1. AEO for med spas") !== null
  );
}
{
  check("`terms:` belongs to the prep call", commandOwner("terms: AEO, ChatGPT SEO")?.step === "offer_locked");
  check("a pasted keyword list belongs to the keyword step", commandOwner("keywords add:\n1. x")?.step === "keyword_set");
  check("`plan approve` belongs to the pre-call pages", commandOwner("plan approve")?.step === "pre_call_pages");
  check("a sentence about keywords is not a command", commandOwner("keywords matter less than people think") === null);
  check("a sentence about a plan is not a command", commandOwner("plan ahead for the call") === null);
}
const morePrice = parseKeywordCommand("keywords more price", patient);
check('"keywords more price" resolves to the price category', morePrice?.kind === "more" && morePrice.category.key === "price");
const moreNaming = parseKeywordCommand("keywords more naming", owner);
check('"keywords more naming" resolves on the owner table', moreNaming?.kind === "more" && moreNaming.category.key === "direct_naming");
// ‼️ REMOVED 2026-09-12, AND THIS ASSERTS IT STAYS REMOVED. `keywords check` used to put the top
// twenty to ChatGPT from this lane. The audit measures the approved set now, so the old command is
// an ordinary sentence and must fall through to the assistant like any other.
for (const d of [
  "keywords check",
  "keywords drop everything",
  "keywords matter less than people think",
  "keywords more than ever",
  "keywords",
  "keywords approve please",
  "keywords add lip filler",
]) {
  check(`"${d}" is dictation`, parseKeywordCommand(d, patient) === null);
}

// ── 6. Terms and the filter ──────────────────────────────────────────────────
console.log("\n6. `terms:` and the expansion filter");

const t = parseTerms(" lip flip, lip filler | lip injections ");
check("three terms, any separator", t.ok && t.terms.length === 3, JSON.stringify(t));
const dup = parseTerms("lip filler, Lip Filler.");
check("the same term twice collapses to the first spelling", dup.ok && dup.terms.join() === "lip filler");
check("a dash in a term is refused", !parseTerms("lip—flip").ok);
check("an empty list is refused", !parseTerms(" , ").ok);
check("thirty-one terms is a menu, refused", !parseTerms(Array.from({ length: 31 }, (_, i) => `term ${i}`).join(", ")).ok);

check('a two-word naming variant survives ("lip filler")', keywordFault("lip filler", "query") === null);
check("a URL does not", keywordFault("lip filler https://example.com", "query") !== null);
check("a dash does not", keywordFault("lip filler — cost", "query") === "dash");
check("quotes and numbering are stripped, words are not", cleanPhrase('3. "lip filler near me"') === "lip filler near me");
check(
  "a call to action welded onto a question is debris (top of SRT's first live run)",
  keywordFault("Request a free AEO audit What is Answer Engine Optimization for aesthetic practices?", "query") === "nav_chrome"
);
check("two questions with a break between them are kept", keywordFault("How much is AEO? What does it include", "query") === null);

// ── 7. Optional: one real expansion, writes nothing ──────────────────────────
async function live(slug: string): Promise<void> {
  console.log(`\n7. LIVE: one real expansion for ${slug}. Writes nothing.`);
  const { supabaseAdmin } = await import("@/lib/db");
  const { data: client } = await supabaseAdmin.from("clients").select("id").eq("slug", slug).maybeSingle();
  if (!client?.id) {
    check(`client ${slug} resolves by slug`, false);
    return;
  }
  const clientId = String(client.id);

  const { keywordContext, evidenceCandidates, expandKeywords } = await import("@/lib/clients/client-keywords");
  const { selectOfferPlan } = await import("@/lib/clients/page-plan");
  const { categoryLabel, isRelevantKeyword, tierOf } = await import("@/lib/clients/keyword-expansion");

  const c = await keywordContext(clientId);
  if (!c.ok) {
    check("the offer is locked", false, c.missing.join("; "));
    return;
  }
  const ctx = c.ctx;
  console.log(`   offer "${ctx.treatment}", terms [${ctx.terms.join(", ")}], audience ${ctx.audience}${ctx.audienceConfirmed ? "" : " (proposed)"}, city ${ctx.city ?? "none"}`);

  const baseVocab = offerVocabulary({ treatment: ctx.treatment, terms: ctx.terms });
  const ev = await evidenceCandidates(ctx, baseVocab);
  if (ev.note) console.log(`   ${ev.note}`);
  const started = Date.now();
  const ex = await expandKeywords(ctx, ev.rows);
  console.log(`   expansion took ${Math.round((Date.now() - started) / 1000)}s`);
  for (const n of ex.notes) console.log(`   ${n}`);

  const all = mergeKeywords([...ev.rows, ...ex.rows]);
  const queries = all.filter((r) => r.use === "query");
  const hooks = all.filter((r) => r.use === "hook");
  console.log(`\n   ${queries.length} queries and ${hooks.length} hooks after the merge (${ex.rows.length} proposed, ${ev.rows.length} evidence)`);
  for (const cat of ctx.categories) {
    const q = queries.filter((r) => r.category === cat.key).length;
    const h = hooks.filter((r) => r.category === cat.key).length;
    const e = queries.filter((r) => r.category === cat.key && tierOf(r.origin) === 0).length;
    console.log(`   ${cat.label.padEnd(36)} ${String(q).padStart(3)} queries (target ${cat.target}, ${e} evidence)  ${h} hooks`);
  }
  const other = queries.filter((r) => r.category === "other").length;
  if (other) console.log(`   ${"Other, from the market".padEnd(36)} ${String(other).padStart(3)} queries`);
  check(`the expansion clears the floor of ${KEYWORD_FLOOR} queries`, queries.length >= KEYWORD_FLOOR, `${queries.length}`);

  const naming = ctx.categories.find((cat) => cat.naming)?.key;
  const vocab = offerVocabulary({
    treatment: ctx.treatment,
    terms: ctx.terms,
    variants: queries.filter((r) => r.category === naming).map((r) => r.phrase),
  });
  const plan = selectOfferPlan(
    queries.map((r) => ({
      question: r.phrase,
      score: r.score,
      category: r.category,
      categoryLabel: categoryLabel(ctx.categories, r.category),
      tier: tierOf(r.origin),
      naming: r.category === naming,
      focus: ctx.categories.find((cat) => cat.key === r.category)?.focus === true,
      relevant: isRelevantKeyword(r, vocab),
    })),
    { city: ctx.city }
  );
  console.log("\n   The nine the plan would pick if every row were approved:");
  if (plan.pillar) console.log(`    1. [Pillar] ${plan.pillar.keyword}  (${plan.pillar.item.categoryLabel})`);
  plan.supports.forEach((s, i) => console.log(`   ${String(i + 2).padStart(2)}. [Support] ${s.question}  (${s.categoryLabel})`));
  if (plan.fix) console.log(`   ${plan.fix}`);
  check("a pillar and eight supports", Boolean(plan.pillar) && plan.supports.length === 8, `${plan.supports.length} supports`);
}

const liveAt = process.argv.indexOf("--live");
const run = liveAt > -1 && process.argv[liveAt + 1] ? live(process.argv[liveAt + 1]) : Promise.resolve();
run
  .catch((e) => {
    check("the live run completed", false, (e as Error).message);
  })
  .finally(() => {
    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
