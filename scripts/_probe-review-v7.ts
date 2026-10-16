// THE REVIEW JOINER'S FENCE, EXECUTABLE. v7 built it; v8 widened what it inserts and narrowed
// where those words may come from.
//
//   bun --no-env-file run scripts/_probe-review-v7.ts
//
// v7 added connective tissue between the four v6 answers: ", and " between her motivation and her
// nerves, and the question's own verb carried onto a walkout fragment. v8 added a carry for EVERY
// one of the four questions, dropped the floor from two words to one, and gave each carry
// alternate wordings for the Regenerate button. Everything this file asserts follows from one
// sentence: THE ONLY WORDS THE JOINER MAY PUT IN HER REVIEW ARE THE WORDS IN ITS OWN EXPORTED
// LITERALS. An adjective, an adverb, a treatment, a staff name, a price, a duration, a result or a
// location that she did not type is the "material details unrelated to user input" the Rytr
// complaint turned on, and disseminating a review carrying them is what FTC 16 CFR Part 465
// reaches.
//
// ‼️ THE INVARIANTS ARE A SET AND NO ONE OF THEM IS SUFFICIENT ALONE. Read them together:
//
//   NOTHING INVENTED. Every word of the output is a word of hers, or a word in
//     JOIN_MOTIVATION_NERVES / CARRIES / the lead templates. Vocabulary is built from the MODULE,
//     so adding a literal to review-assemble.ts is the only way to widen what we can say.
//   EACH ANSWER CONTIGUOUS. Every answer appears in the output as one unbroken run of her words.
//     Nothing of ours may land inside a sentence of hers.
//   NOTHING DROPPED. Her every word appears at least as many times as she typed it. A joiner that
//     quietly discarded "and the wait was long" would satisfy both of the above perfectly.
//   NOTHING FROM OUTSIDE THE QUESTION. v8's own fence, section 1b. Every content word of every
//     carry variant must appear in THAT KEY'S OWN QUESTION PROMPT. The vocabulary check above is
//     derived FROM the literals, so it cannot see a widened literal; this one can, and it is the
//     reason four carries with three wordings each is a tighter feature than one fixed verb was.
//
// ‼️ THE FIRST TWO REPLACED A SINGLE SUBSEQUENCE CHECK ON 2026-10-13, WHEN SENTENCE ORDER BECAME
// PART OF THE VARIANT. The old rule was "her own assembly's word sequence appears in the output AS
// A SUBSEQUENCE", which a reordered review fails by construction. What that rule was built to
// catch is the v7 brief's own suggestion of moving her "honestly" out of the walkout answer and
// into the nerves clause: every word is hers, so a word-list check passes it, and relocating a
// hedge changes which statement it modifies. Contiguity still fails that, and fails it harder,
// because it also refuses our words INSIDE her sentence, which a subsequence allowed.
//
// What is no longer asserted is the order of whole answers. Reordering intact statements is the
// feature (see SENTENCE_ORDERS); rewriting one is still impossible.
//
// ‼️ AND IT IS NOT FOUR HAND-CHECKED STRINGS. Section 3 runs the joiner over every subset of the
// four keys, in three answer shapes, with and without the lead line: 96 combinations, with
// nonsense tokens for her answers, so any English word the joiner inserts stands out against
// "zorble quibix" and no future literal can be added without this failing. The four named
// fixtures are the readable half; that sweep is the enforcement.
//
// SOURCE probe for the screen half, same technique and same reason as _probe-review-gating.ts:
// React Testing Library is not in this repo, and which radio is checked on first render is a fact
// about one line of source.

import fs from "node:fs";
import path from "node:path";
import {
  CARRIES,
  CARRY_COMBINATIONS,
  JOIN_MOTIVATION_NERVES,
  LEAD_SERVICE_ONLY,
  LEAD_WITH_PROVIDER,
  REVIEW_QUESTIONS_V6,
  REVIEW_SHAPES,
  SENTENCE_ORDERS,
  assembleFragment,
  assembleJoined,
  assemblePlain,
  type ReviewAnswers,
} from "../src/lib/hub/review-assemble";

import {
  MIN_WALKS_FOR_RATE,
  pct,
  referralFunnel,
  walkFunnel,
  type WalkFunnelRow,
} from "../src/lib/hub/review-funnel";

/** Every wording the module can insert, flattened once. The fence's subject. */
const ALL_CARRIES: readonly string[] = Object.values(CARRIES).flat();

const CLIENT = "src/app/hub/[host]/reviews/virtual-agent-client.tsx";
const ASSEMBLE = "src/lib/hub/review-assemble.ts";

let failures = 0;

/**
 * Source, with CRLF normalised to LF.
 *
 * Same guard and the same scar as _probe-review-gating.ts's read(): `core.autocrlf=true`
 * materialises these files with CRLF on Windows, every marker search below misses, and the probe
 * reports a breach that does not exist. Green in CI and red on the author's machine is worse than
 * a plain bug, because it teaches people the probe is unreliable.
 */
function read(file: string): string {
  const CR = String.fromCharCode(13);
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").split(CR).join("");
}

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

/** Comments say what we intend; code says what happens. Only code is evidence. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A string reduced to comparable words: lowercase, apostrophes kept, everything else dropped.
 *
 * Apostrophes stay because "didn't" and "didnt" are different words of hers and neither should be
 * able to pass as the other. Case is dropped because midSentence() lowercases a fragment's first
 * letter on purpose, which is grammar and not a new word.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 0);
}

/** Her words, plus the only strings the module can insert. Nothing else may appear in an output. */
function vocabularyOf(answers: ReviewAnswers): Set<string> {
  const vocabulary = new Set<string>();
  for (const value of Object.values(answers)) {
    for (const word of words(value ?? "")) vocabulary.add(word);
  }
  // The templates' own words, with the {tokens} removed: "got", "with", "today", "and", and every
  // word in every carry wording. Read from the module so the fence cannot drift from the code.
  //
  // ‼️ EVERY VARIANT, NOT THE ONE IN USE. Regenerate can reach any of them, so the vocabulary has
  // to admit all of them. That makes this check WEAKER per variant than v7's was, which is
  // exactly why section 1b exists: the pool this builds is derived from the literals, so a
  // widened literal widens the pool and passes. 1b reads the QUESTIONS instead.
  const ours = [LEAD_WITH_PROVIDER, LEAD_SERVICE_ONLY, JOIN_MOTIVATION_NERVES, ...ALL_CARRIES]
    .join(" ")
    .replace(/\{[a-z]+\}/g, " ");
  for (const word of words(ours)) vocabulary.add(word);
  return vocabulary;
}

/**
 * Whether `run` appears in `outer` as consecutive elements.
 *
 * ‼️ CONTIGUOUS, NOT A SUBSEQUENCE, AND THAT IS WHAT KEEPS ONE ANSWER ONE STATEMENT. A subsequence
 * check would pass "I was worried it [absolutely] would look overdone"; this does not, because our
 * word lands in the middle of her run.
 */
function hasRun(outer: string[], run: string[]): boolean {
  if (run.length === 0) return true;
  for (let at = 0; at + run.length <= outer.length; at += 1) {
    let all = true;
    for (let i = 0; i < run.length; i += 1) {
      if (outer[at + i] !== run[i]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/**
 * Words of hers that the output does not carry as many times as she typed them.
 *
 * Multiset containment rather than set containment: she may legitimately use "the" four times, and
 * an output carrying it twice has dropped two of her words.
 */
function droppedWords(hers: string[], joined: string[]): string[] {
  const have = new Map<string, number>();
  for (const word of joined) have.set(word, (have.get(word) ?? 0) + 1);
  const short: string[] = [];
  const need = new Map<string, number>();
  for (const word of hers) need.set(word, (need.get(word) ?? 0) + 1);
  for (const [word, count] of need) {
    if ((have.get(word) ?? 0) < count) short.push(word);
  }
  return short;
}

/** Whether `inner` appears in `outer` in order, gaps allowed. */
function isSubsequence(inner: string[], outer: string[]): boolean {
  let at = 0;
  for (const word of outer) {
    if (at < inner.length && inner[at] === word) at += 1;
  }
  return at === inner.length;
}

/** The first word of `inner` that the subsequence walk could not place, for the failure message. */
function firstUnplaced(inner: string[], outer: string[]): string | null {
  let at = 0;
  for (const word of outer) {
    if (at < inner.length && inner[at] === word) at += 1;
  }
  return at < inner.length ? inner[at] : null;
}

/** Sentences, for the position checks. Splits on terminal punctuation followed by a space. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * The two invariants, run over any answers object at any wording. Everything else in this file is
 * a special case.
 *
 * `variant` defaults to 0 so every v7-era call site still reads the same and still means the same
 * thing: the wording she sees before she touches Regenerate.
 */
function assertInvariants(label: string, answers: ReviewAnswers, variant = 0): string {
  const hers = assemblePlain(answers, { lead: true });
  const joined = assembleJoined(answers, variant);

  const vocabulary = vocabularyOf(answers);
  const invented = words(joined).filter((word) => !vocabulary.has(word));
  check(
    invented.length === 0,
    `${label}: nothing invented`,
    invented.length
      ? `words in the output that are in neither her text nor our literals: ${invented.join(", ")}`
      : "every word is hers or is in JOIN_MOTIVATION_NERVES / CARRIES / the lead template"
  );

  // ‼️ THIS CHECK CHANGED SHAPE ON 2026-10-13 WHEN SENTENCE ORDER BECAME PART OF THE VARIANT, AND
  // THE REPLACEMENT IS STRICTER WHERE IT MATTERS. It used to be:
  //
  //     isSubsequence(words(hers), words(joined))   // her words, in her order, gaps allowed
  //
  // which proved nothing was dropped and nothing moved, and which a reordered review fails by
  // construction. What that rule was really built to catch is named in this file's header: the v7
  // brief suggested moving her "honestly" out of the walkout answer and into the nerves clause,
  // which changes what the hedge modifies. Two rules replace it and both must hold:
  //
  //   CONTIGUOUS. Every answer appears as an unbroken run of her words. That is STRONGER than
  //     the subsequence rule within an answer: a subsequence permits our words to be interleaved
  //     through her sentence, and this does not. Moving "honestly" across answers still fails.
  //   NOTHING DROPPED. Her every word appears at least as many times as she typed it. A joiner
  //     that quietly discarded "and the wait was long" fails here, which is the half that the
  //     contiguity rule alone would miss.
  //
  // What is deliberately no longer asserted is the ORDER OF WHOLE ANSWERS, because reordering
  // intact answers is the feature. An answer is a statement she made; which statement she makes
  // first is presentation, and she reads and approves the result either way.
  for (const [key, value] of Object.entries(answers)) {
    const fragment = assembleFragment(value);
    if (!fragment) continue;
    const block = words(fragment);
    if (block.length === 0) continue;
    const contiguous = hasRun(words(joined), block);
    check(
      contiguous,
      `${label}: her "${key}" answer survives as one unbroken run`,
      contiguous
        ? `${block.length} word(s), untouched and uninterleaved`
        : `"${fragment}" was broken up or altered; joined: ${joined}`
    );
  }

  const missing = droppedWords(words(hers), words(joined));
  check(
    missing.length === 0,
    `${label}: nothing dropped`,
    missing.length === 0
      ? `all ${words(hers).length} of her words are still there`
      : `missing from the output: ${missing.join(", ")}; joined: ${joined}`
  );

  return joined;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. THE FENCE AROUND OUR OWN LITERALS.
//
// These are the only strings the joiner can insert. The day somebody writes ", and the staff were
// amazing, " or "I walked out absolutely delighted ", this section is what fails. It is the same
// check, and deliberately the same word list, that _probe-review-gating.ts holds the lead template
// behind: a second place we can author text is a second copy of that rule, and the duplication is
// the point rather than an oversight.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const BANNED = [
  "amazing", "wonderful", "great", "best", "love", "loved", "lovely", "incredible",
  "fantastic", "perfect", "excellent", "highly", "recommend", "happy", "thrilled",
  "beautiful", "natural", "painless", "professional", "friendly", "caring", "kind",
  "definitely", "absolutely", "really", "very", "such ", "stunning", "flawless",
];

/**
 * ‼️ 48, AND IT WAS 24 IN v7. THE CAP ROSE AND THE FENCE IS WHY.
 *
 * v7 capped its two literals at 24 characters as a crude proxy for "this is scaffolding, not
 * prose", at a time when nothing checked WHICH words were in them. Three of v8's carry wordings
 * are longer than that ("What I would tell a friend on the fence is" is 41), so the cap had to
 * move or the feature could not exist.
 *
 * Raising a cap to make a check pass is normally the wrong half of the fix, so here is the
 * argument for why this one is not: section 1b, which did not exist in v7, requires every content
 * word of every wording to appear in that key's own question prompt. A 41-character string built
 * only from the question's own words can assert strictly less than a 24-character string built
 * from any word in English. The real limit got tighter while this number got looser. The cap stays
 * only as a blunt backstop against somebody pasting a paragraph in.
 */
const CARRY_MAX_CHARS = 48;

for (const literal of [JOIN_MOTIVATION_NERVES, ...ALL_CARRIES]) {
  const hit = BANNED.filter((word) => literal.toLowerCase().includes(word));
  check(
    hit.length === 0,
    `our literal "${literal}" carries no judgement of its own`,
    hit.length ? `found: ${hit.join(", ")}` : "connective words around what she typed"
  );
  check(
    literal.trim().length <= CARRY_MAX_CHARS,
    `and "${literal}" is scaffolding rather than prose`,
    `${literal.trim().length} of ${CARRY_MAX_CHARS} characters of ours`
  );
}

// ‼️ PRESENCE, SO SECTION 3 CANNOT PASS VACUOUSLY. A fence around empty strings holds perfectly
// and permits everything, which is the trap _probe-review-gating.ts's check 1b was added for. The
// joiner has to actually be able to insert something.
check(
  JOIN_MOTIVATION_NERVES.trim().length > 0 && ALL_CARRIES.every((c) => c.trim().length > 0),
  "every literal is non-empty, so the vocabulary check is subtracting something real",
  `"${JOIN_MOTIVATION_NERVES}" and ${ALL_CARRIES.length} carry wordings`
);

// ‼️ AND THERE IS A WORDING FOR EVERY ONE OF THE FOUR QUESTIONS, WHICH IS WHAT v8 IS.
// A table that lost a key would silently fall back to v6 for that answer, which is the failure
// mode his complaint WAS: a dry answer sitting there untouched.
for (const question of REVIEW_QUESTIONS_V6) {
  const wordings = (CARRIES as Record<string, readonly string[] | undefined>)[question.key];
  check(
    Array.isArray(wordings) && wordings.length > 0,
    `the "${question.key}" question has at least one carry wording`,
    wordings ? `${wordings.length} wording(s)` : "MISSING: this answer would never be expanded"
  );
}

// ‼️ THE PRODUCT, NOT THE LONGEST ROW, AND THE DIFFERENCE IS THE WHOLE ANTI-PATTERN FIX. This read
// `Math.max(...)` while one index moved all four carries together, which gave 3 possible reviews.
// Each key reads its own digit now, so the space is 3 x 2 x 3 x 3.
check(
  CARRY_COMBINATIONS ===
    Object.values(CARRIES).reduce((total, wordings) => total * wordings.length, 1),
  "CARRY_COMBINATIONS is the product of every row, derived rather than typed",
  `${CARRY_COMBINATIONS} shapes from ${Object.values(CARRIES).map((w) => w.length).join(" x ")}`
);
// ‼️ AND EVERY KEY MUST BE ABLE TO VARY, or a row of length 1 would pin one sentence across every
// review and the pattern would survive in that line.
for (const [key, wordings] of Object.entries(CARRIES)) {
  check(
    wordings.length >= 2,
    `the "${key}" sentence can be worded more than one way`,
    `${wordings.length} wordings; a single one would make that line identical in every review`
  );
}
// Distinct wordings, so a "variant" cannot be a duplicate wearing a different number.
for (const [key, wordings] of Object.entries(CARRIES)) {
  check(
    new Set(wordings).size === wordings.length,
    `and the "${key}" wordings are all different from each other`,
    wordings.join(" | ")
  );
}

// ‼️ ONE CONJUNCTION, AND IT IS THE ONE THAT ASSERTS NOTHING. The brief allowed and, but, so,
// because and which is why. The last four assert contrast or causation between two answers, which
// is a claim about her experience that SHE did not make and that picking between them requires
// understanding her meaning to pick. "and" asserts addition, which the question order already
// establishes. If this ever fails, the fix is a new named rule with its own fixtures, not a
// widened literal.
for (const asserting of ["but", "so", "because", "which"]) {
  check(
    !words(JOIN_MOTIVATION_NERVES).includes(asserting),
    `the joiner does not assert "${asserting}"`,
    "only addition, which is the relationship the question order already implies"
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1b. ‼️ THE v8 FENCE: EVERY CONTENT WORD OF A CARRY COMES FROM THAT CARRY'S OWN QUESTION.
//
// This is the check that makes four carries with three wordings each a TIGHTER feature than v7's
// one fixed verb, and it is the reason the character cap above was allowed to rise.
//
// Section 1's word list can only forbid the adjectives somebody thought to list. This forbids
// every word the question does not already contain. "I absolutely loved that" cannot be added to
// the walkout carry unless "How did you feel walking out?" starts containing "absolutely loved",
// which it never will. Neither can "I walked out feeling better", or "relaxed", or "pain free":
// none of them is in the question, so none of them can be in the carry.
//
// ‼️ AND IT IS WHY THIS IS NOT A REWRITER. The words we contribute are the words of a prompt that
// is fixed, identical for every clinic, and written before any patient answered anything. A
// question cannot flatter a visit it was written months before.
//
// ‼️ THE VOCABULARY CHECK IN assertInvariants CANNOT DO THIS JOB, which is why both exist. That
// one builds its pool FROM the literals, so widening a literal widens the pool and the check
// still passes. This one reads REVIEW_QUESTIONS_V6 instead, so the literals are measured against
// something they cannot move.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Words that assert nothing on their own: pronouns, forms of "to be", articles and the
 * prepositions a carry needs to be grammatical.
 *
 * ‼️ CLOSED, AND DELIBERATELY MISSING THE FOUR CONJUNCTIONS review-assemble.ts REFUSED. "so",
 * "but", "which" and "though" are not here, so no carry can be built around them even though
 * they are short function words. "because" IS here and is the one that needed an argument; see
 * the assertion below it, which confines it to the one question that asks for a cause.
 */
const FUNCTION_WORDS = new Set([
  "i", "me", "my", "you", "your", "it",
  "is", "am", "are", "was", "were", "be", "been",
  "a", "an", "the",
  "of", "to", "for", "in", "on", "at",
  "and", "if", "that", "this", "what",
  "because",
]);

/** Common inflections, so "started" counts as the question's "start". */
function stem(word: string): string {
  // The one irregular any wording needs: "felt" is the past of the walkout question's "feel".
  // A map rather than a rule, because English past tenses are not a rule.
  const IRREGULAR: Record<string, string> = { felt: "feel" };
  if (IRREGULAR[word]) return IRREGULAR[word];
  return word.replace(/(ing|ed|es|s|d)$/, "");
}

{
  const prompts = new Map(REVIEW_QUESTIONS_V6.map((q) => [q.key as string, q.prompt]));

  for (const [key, wordings] of Object.entries(CARRIES)) {
    const prompt = prompts.get(key);
    check(
      typeof prompt === "string" && prompt.length > 0,
      `the "${key}" carry has a question to be measured against`,
      prompt ?? "NO PROMPT: this key is not in REVIEW_QUESTIONS_V6"
    );
    if (!prompt) continue;

    const allowed = new Set(words(prompt).map(stem));

    for (const wording of wordings) {
      const foreign = words(wording).filter(
        (word) => !FUNCTION_WORDS.has(word) && !allowed.has(stem(word))
      );
      check(
        foreign.length === 0,
        `"${wording}" uses only the words of "${prompt}"`,
        foreign.length
          ? `NOT IN THE QUESTION: ${foreign.join(", ")} -- a carry may not introduce a word the ` +
            "question does not contain"
          : "every content word is the question's own"
      );
    }
  }

  // ‼️ "because" IS CONFINED TO THE ONE QUESTION THAT ASKS FOR A CAUSE. "What MADE you start
  // looking for a place like this?" asks why, so "I started looking because of X" restates the
  // question's own causal frame and asserts no causation she did not. The same word on the
  // walkout or the friend answer WOULD assert one, which is the thing
  // review-assemble.ts's CONJUNCTIONS docstring refuses. Hence a per-key rule rather than a
  // blanket permission.
  for (const [key, wordings] of Object.entries(CARRIES)) {
    const causal = wordings.filter((w) => words(w).includes("because"));
    check(
      key === "motivation" || causal.length === 0,
      `the "${key}" carry asserts no causation`,
      causal.length
        ? `found "because" in: ${causal.join(" | ")}`
        : "nothing here claims one answer caused another"
    );
  }

  // And the fence is not vacuous: a wording nobody could have written must actually fail it.
  const sabotage = words("I absolutely loved the amazing staff").filter(
    (word) => !FUNCTION_WORDS.has(word) && !new Set(words("How did you feel walking out?").map(stem)).has(stem(word))
  );
  check(
    sabotage.length > 0,
    "the fence rejects a wording built from words outside the question",
    `negative control: it would have flagged ${sabotage.join(", ")}`
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE FOUR FIXTURES, IN ORDER OF HOW LIKELY EACH IS TO BREAK IT.
//
// The expected output of each is pinned in full. A rule change that improves one of these will
// show up as a diff on a string somebody has to read, which is the only way a reviewer can see
// what the joiner now does to a real answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

// ── FIXTURE 1: all four answered in full sentences. The easy case. ──────────
const F1: ReviewAnswers = {
  service: "lip filler",
  provider: "Sarah",
  motivation: "I kept putting off doing anything about my smile lines",
  nerves: "I was worried it would look overdone",
  walkout: "Like myself again, honestly",
  friend: "Just go, they talk you through everything",
};

const f1 = assertInvariants("fixture 1 (full sentences)", F1);
check(
  f1 ===
    "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines, " +
      "and I was worried it would look overdone. I walked out feeling like myself again, " +
      "honestly. Just go. They talk you through everything.",
  "fixture 1: joins the motivation to the nerves, carries the walkout verb, splits the advice",
  f1
);
// ‼️ AND IT ACTUALLY DID SOMETHING. Without this the whole suite passes on a joiner that returns
// assemblePlain unchanged, which is the vacuous pass this file would otherwise be blind to.
check(
  f1 !== assemblePlain(F1, { lead: true }),
  "fixture 1: the joined version differs from hers, so the feature is not a no-op",
  `hers: ${assemblePlain(F1, { lead: true })}`
);
check(
  f1.includes(JOIN_MOTIVATION_NERVES) && f1.includes(CARRIES.walkout[0]),
  "fixture 1: and the difference is our literals, not something else"
);
// ‼️ AND v8 DID NOT MOVE IT. Four full-sentence answers clear the merge floor and overrun the
// carry ceiling, so the only rules eligible here are the three v7 already had. A fixture that
// changed when the floors changed would mean a floor was doing something other than what it says.
check(
  f1 === assembleJoined(F1, 0),
  "fixture 1: unchanged by v8, because none of the new carries is eligible on a full sentence",
  "the floor drop reaches one-word answers; it cannot reach these"
);

// ── FIXTURE 2: one-word answers. ‼️ THIS FIXTURE INVERTED IN v8 AND THAT IS THE WHOLE RELEASE. ──
//
// v7 asserted the OPPOSITE of what is below, in these words: "fixture 2: one-word answers come out
// BYTE FOR BYTE what v6 produced", on the grounds that "'I started looking because of wrinkles and
// walked out feeling good' would be a sentence we invented around two words she typed."
//
// Matthew walked that build, typed four honest answers with "Great" as the walkout, and got back a
// paragraph with `Great.` sitting dead in the middle of it. That is the form of the complaint this
// release answers. What makes the expansion legitimate is not a change of mind about inventing
// sentences; it is section 1b, which did not exist in v7: every word we add is a word of the
// question she was reading when she typed that one word.
//
// If this assertion is ever reverted, revert section 1b with it. The expansion without the fence
// is the thing v7 was right to refuse.
console.log("");
const F2: ReviewAnswers = {
  service: "botox",
  provider: "Sarah",
  motivation: "wrinkles",
  nerves: "bruising",
  walkout: "good",
  friend: "go",
};

const f2 = assertInvariants("fixture 2 (one-word answers)", F2);
check(
  f2 ===
    "Got botox with Sarah today. I started looking because of wrinkles. I was nervous about " +
      "bruising. I walked out feeling good. If you are on the fence, go.",
  "fixture 2: every one-word answer is carried into a sentence by its own question",
  f2
);
check(
  f2 !== assemblePlain(F2, { lead: true }),
  "fixture 2: and it is NOT what v6 produced, which is the point of v8",
  `v6 gave: ${assemblePlain(F2, { lead: true })}`
);
check(
  !f2.includes(JOIN_MOTIVATION_NERVES),
  "fixture 2: the MERGE still declines, because one word each is under its floor",
  "the carries fired; the merge did not. Two separate sentences, not one run-on."
);

// ‼️ AND THE REGENERATE BUTTON CHANGES OUR WORDS AND ONLY OUR WORDS.
// Every variant must hold both invariants, and her own words must come out byte for byte identical
// across all of them: the only thing a press of that button may move is scaffolding.
{
  const hersWords = words(assemblePlain(F2, { lead: true }));
  const seen = new Set<string>();
  for (let variant = 0; variant < REVIEW_SHAPES; variant += 1) {
    const out = assertInvariants(`fixture 2 at variant ${variant}`, F2, variant);
    seen.add(out);
    const mine = words(out).filter((word) => hersWords.includes(word));
    check(
      mine.length > 0,
      `variant ${variant}: her words are still in it`,
      out
    );
  }
  check(
    seen.size === REVIEW_SHAPES,
    `the variant space produces ${REVIEW_SHAPES} genuinely different reviews`,
    `${seen.size} distinct outputs from ${REVIEW_SHAPES} shapes. A button that redraws the ` +
      "same text is a button that lies about what it does."
  );
}

// ── FIXTURE 3: gaps. Only motivation and friend; nerves skipped. ─────────────
// The merge is keyed to the motivation/nerves PAIR, never to "the first two answers present", so
// there is nothing to bridge a hole with.
console.log("");
const F3: ReviewAnswers = {
  service: "lip filler",
  provider: "Sarah",
  motivation: "I was tired of hiding my hands in photos",
  friend: "Honestly, just book it",
};

const f3 = assertInvariants("fixture 3 (nerves skipped)", F3);
check(
  f3 ===
    "Got lip filler with Sarah today. I was tired of hiding my hands in photos. " +
      "If you are on the fence, honestly, just book it.",
  "fixture 3: a skipped question leaves a full stop, not a conjunction",
  f3
);
// ‼️ THE FRIEND LINE MOVED IN v8 AND THE GAP ASSERTION DID NOT. v7 gave "Honestly, just book it."
// here; the friend carry now reaches it, because her four words clear the new floor and her comma
// is a trailing aside rather than a second clause, so the split declines and the carry takes it.
// What this fixture is FOR is the hole where nerves should be, and that is the check below: a
// carry onto one answer is not a bridge between two.
check(
  !f3.includes(JOIN_MOTIVATION_NERVES),
  "fixture 3: nothing joins across the gap",
  "a conjunction spanning a question she declined asserts a relationship to nothing"
);
check(
  sentencesOf(f3).length === sentencesOf(assemblePlain(F3, { lead: true })).length,
  "fixture 3: and no middle was invented to fill it",
  `${sentencesOf(f3).length} sentences, same as hers`
);

// ── FIXTURE 4: a complaint. This fixture proves the whole thing. ─────────────
console.log("");
const COMPLAINT = "a bit sore and the wait was long";
const F4: ReviewAnswers = {
  service: "a cleaning",
  provider: "Dana",
  motivation: "I had been meaning to get my teeth looked at for years",
  nerves: "I was nervous about the needle",
  walkout: COMPLAINT,
  friend: "worth it but book the first slot of the day",
};

const f4 = assertInvariants("fixture 4 (a complaint)", F4);

// Undiluted: the sentence is hers, capitalised and stopped, and nothing was carried onto it.
check(
  f4.includes("A bit sore and the wait was long."),
  "fixture 4: the complaint survives as its own sentence, word for word",
  f4
);
check(
  !CARRIES.walkout.some((wording) => f4.includes(wording)),
  "fixture 4: no verb was carried onto it, in any of the walkout wordings",
  'routing "the wait was long" through "I walked out feeling" recasts a fact as a mood, which is a ' +
    "sentiment shift made entirely out of her own words"
);
// ‼️ AT EVERY VARIANT, AND THIS IS THE ASSERTION THE WHOLE RELEASE IS GUARDED BY. Regenerate must
// not be a way to roll the dice until a complaint reads better. The conjunction refusal in
// canCarry() is what holds it: "a bit sore AND the wait was long" contains "and", so no wording of
// any carry can ever reach it, which makes the complaint byte-identical at every index.
// ‼️ THE COMPLAINT SURVIVES AT ALL 324 SHAPES, AND THIS LOOP CHANGED SHAPE WHEN ORDER DID. It used
// to assert the whole review was byte-identical at every variant, which is the strongest form of
// "Regenerate cannot soften it" and is impossible once the sentence order varies. What it asserts
// now is the part that was ever load-bearing, and it asserts it 324 times:
//
//   the complaint is PRESENT, word for word;
//   it is a SENTENCE OF ITS OWN, so nothing absorbed it into a neighbour as a clause;
//   and no walkout carry appears anywhere, at any wording.
//
// ‼️ THE SENTENCE COUNT IS NOT ONE OF THEM, AND MY FIRST ATTEMPT AT THIS LOOP ASSERTED IT AND
// FAILED 162 OF 324 SHAPES. Exactly half, which is the giveaway: the merge needs motivation
// immediately before nerves, three of the six orders put them that way, and the other three
// produce five sentences instead of four. That is the merge legitimately declining, not the
// complaint being touched. A count check here would have been a probe failing for a reason
// unrelated to what it is named after, which is how a real breach gets filed as flaky.
//
// Rolling the dice until a complaint reads better is still impossible. What a patient can now get
// is the same complaint in a review whose sentences run in a different order.
let softened = 0;
for (let variant = 0; variant < REVIEW_SHAPES; variant += 1) {
  const at = assembleJoined(F4, variant);
  const intact = at.includes("A bit sore and the wait was long.");
  const uncarried = !CARRIES.walkout.some((wording) => at.includes(wording));
  const standsAlone = sentencesOf(at).includes("A bit sore and the wait was long.");
  if (!intact || !uncarried || !standsAlone) {
    softened += 1;
    if (softened <= 3) console.log(`      variant ${variant} gave: ${at}`);
  }
}
check(
  softened === 0,
  `fixture 4: the complaint survives word for word at all ${REVIEW_SHAPES} shapes`,
  softened === 0
    ? "no wording and no ordering can carry a verb onto it or absorb it into a neighbour"
    : `${softened} shape(s) altered it, first three above`
);
// And it is still its own sentence rather than a clause inside somebody else's.
const joined4 = sentencesOf(f4);
check(
  joined4.includes("A bit sore and the wait was long."),
  "fixture 4: and it stands as a sentence of its own",
  `sentence ${joined4.indexOf("A bit sore and the wait was long.") + 1} of ${joined4.length}`
);
// Lukewarm stays lukewarm. Her "but" is hers; ours is never added.
check(
  f4.includes("Worth it but book the first slot of the day."),
  "fixture 4: the lukewarm recommendation is not upgraded either",
  "no split, because she put no clause after her comma, and nothing was appended"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE SWEEP. 96 answer combinations with nonsense tokens for her answers.
//
// ‼️ THIS IS THE CHECK THAT OUTLIVES THE FOUR FIXTURES ABOVE. They are hand-written strings and a
// future rule will be written to satisfy them. This runs every subset of the four keys, with and
// without the lead, over answer shapes chosen to make every rule fire at once, and the words are
// nonsense: any English word the joiner inserts is immediately visible against "zorble quibix",
// and a third literal added to the module cannot reach an output without failing here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const SHAPES: Record<string, Record<string, string>> = {
  // Long enough to clear every floor, so merge, carry and split are all eligible.
  firing: {
    motivation: "zorble quibix franten dreckle",
    nerves: "plonkish wazzit grimble snoodery",
    walkout: "flembic tarnuk",
    friend: "vorp glimble, they snorkle bazzim",
  },
  // Under every floor, so every rule declines.
  bare: {
    motivation: "zorble",
    nerves: "plonkish",
    walkout: "flembic",
    friend: "vorp",
  },
  // Her own conjunctions and her own full stops inside the answers.
  awkward: {
    motivation: "zorble quibix. franten dreckle",
    nerves: "and plonkish wazzit grimble snoodery",
    walkout: "flembic and tarnuk whonk gribbet",
    friend: "vorp glimble, honestly",
  },
};

let swept = 0;
let sweepFailures = 0;

for (const [shapeName, shape] of Object.entries(SHAPES)) {
  for (let mask = 0; mask < 16; mask += 1) {
    for (const withLead of [true, false]) {
      // ‼️ EVERY WORDING, NOT JUST THE FIRST. v8 multiplied this sweep by CARRY_COMBINATIONS, because
      // a variant nobody swept is a variant nobody checked, and Regenerate puts all of them in
      // front of a patient. 96 cases became 96 times the wording count.
      for (let variant = 0; variant < REVIEW_SHAPES; variant += 1) {
        const answers: ReviewAnswers = {};
        if (withLead) {
          answers.service = "grumbish";
          answers.provider = "Zendrel";
        }
        const keys = ["motivation", "nerves", "walkout", "friend"] as const;
        keys.forEach((key, bit) => {
          if (mask & (1 << bit)) answers[key] = shape[key];
        });

        const joined = assembleJoined(answers, variant);
        const vocabulary = vocabularyOf(answers);
        const invented = words(joined).filter((word) => !vocabulary.has(word));
        const hersWords = words(assemblePlain(answers, { lead: true }));

        swept += 1;
        // ‼️ THE SAME TWO RULES assertInvariants USES, NOT THE OLD SUBSEQUENCE. Her answers must
        // each survive as an unbroken run and nothing may be dropped; the order of whole answers
        // is the variant's to choose. A sweep still asserting order would fail 5 of the 6
        // orderings and tell nobody anything.
        const outWords = words(joined);
        const broken = (["motivation", "nerves", "walkout", "friend"] as const).filter((key) => {
          const fragment = assembleFragment(answers[key]);
          if (!fragment) return false;
          return !hasRun(outWords, words(fragment));
        });
        const lost = droppedWords(hersWords, outWords);

        if (invented.length > 0 || broken.length > 0 || lost.length > 0) {
          sweepFailures += 1;
          // ‼️ THE REASON, NOT JUST THE COUNT. A probe that reports "7 cases failed" and stops
          // sends somebody back to re-derive which seven and why, which is how a real breach gets
          // filed as flaky. First ten offenders, in full.
          if (sweepFailures <= 10) {
            console.log(`      case ${shapeName}/mask ${mask}/lead ${withLead}/variant ${variant}`);
            if (invented.length > 0) console.log(`        invented: ${invented.join(", ")}`);
            if (broken.length > 0) console.log(`        answer broken up: ${broken.join(", ")}`);
            if (lost.length > 0) console.log(`        dropped: ${lost.join(", ")}`);
            console.log(`        output: ${joined}`);
          }
        }
      }
    }
  }
}

check(
  sweepFailures === 0,
  `the sweep: ${swept} answer combinations invent nothing and drop nothing`,
  sweepFailures === 0
    ? `every rule fired against nonsense tokens at all ${REVIEW_SHAPES} shapes and inserted ` +
      "only our own literals"
    : `${sweepFailures} of ${swept} combinations breached, listed above`
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. NO RATING REACHES THE JOINER OR THE PANEL THAT OFFERS IT.
//
// Offering the better-reading version to five stars and withholding it from two is review shaping:
// the text she is nudged toward would depend on how happy she is. That is the funnel
// _probe-review-gating.ts exists to keep rebuilt-proof, and v7 adds a new place to rebuild it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const assembleSrc = stripComments(read(ASSEMBLE));
const clientSrc = stripComments(read(CLIENT));

// ‼️ v8 ADDED A SECOND PARAMETER AND THIS CHECK GOT STRICTER, NOT LOOSER.
//
// v7 pinned `assembleJoined.length === 1` and said "takes answers and nothing else", precisely so
// that a second parameter could not quietly become the rating. v8 needs a wording index, so the
// count alone can no longer carry that meaning. Three checks replace it:
//
//   1. the REQUIRED arity is still 1, which Function.length reports because a defaulted parameter
//      is not counted. Every v7-era caller and every stored-row reader is therefore untouched.
//   2. the optional parameter is NAMED in the source, and the name is `variant`. A `rating`
//      second parameter fails this by name, which a count never could.
//   3. no `rating` token anywhere in the function's body, below. That is the half that was always
//      load-bearing, and it is asserted on the body rather than the signature.
//
// ‼️ IF A THIRD PARAMETER IS EVER NEEDED, STOP. That is a decision for a plan, not a diff.
check(
  assembleJoined.length === 1,
  "assembleJoined still REQUIRES only her answers",
  `required arity ${assembleJoined.length}; the wording index is optional and defaults to 0`
);
check(
  /export function assembleJoined\(\s*answers: ReviewAnswers,\s*variant = 0\s*\)/.test(assembleSrc),
  "and its optional parameter is a wording index called `variant`, not a rating",
  "pinned by name in the source: a second parameter called anything else fails here"
);
check(
  assembleJoined({ walkout: "good" }) === assembleJoined({ walkout: "good" }, 0),
  "and omitting it gives the wording she sees on arrival",
  "a caller that does not know Regenerate exists gets variant 0"
);

const LF = String.fromCharCode(10);
const joinedStart = assembleSrc.indexOf("export function assembleJoined");
const joinedEnd = assembleSrc.indexOf(`${LF}}${LF}`, joinedStart);
const joinedBody = joinedStart >= 0 && joinedEnd > joinedStart
  ? assembleSrc.slice(joinedStart, joinedEnd)
  : "";
check(
  joinedBody.length > 200,
  "assembleJoined's body was found in the source, so the next check is reading something",
  `${joinedBody.length} characters`
);
check(
  !joinedBody.includes("rating"),
  "and there is no rating anywhere inside it",
  "every value 1 through 5 reaches the same joined text"
);

// The panel pair, sliced from its own container to the promise that follows it.
//
// ‼️ THE END MARKER CHANGED IN v8 BECAUSE THE RAIL IT USED TO POINT AT WAS DELETED. It was
// `className="rev2-rail"`. If a future commit renames .rev2-promise, this slice silently collapses
// to "" and the three checks below pass over nothing, which is why the length guard is here and
// why it is checked FIRST. A fence around an empty string permits everything.
const panelStart = clientSrc.indexOf('className="rev2-versions"');
const panelEnd = clientSrc.indexOf('className="rev2-promise"', panelStart);
const panelBlock = panelStart >= 0 && panelEnd > panelStart
  ? clientSrc.slice(panelStart, panelEnd)
  : "";
check(
  panelBlock.length > 400,
  "the side-by-side panel block was found, so the next checks are reading something",
  `${panelBlock.length} characters`
);
check(
  !panelBlock.includes("rating"),
  "both panels are rendered without consulting the rating",
  "not gated, not collapsed, not reordered, not withheld from a low rating"
);
check(
  !/\bdisabled\b|(?<!aria-)\bhidden\b/.test(panelBlock),
  "and neither panel is disabled or hidden",
  "`aria-hidden` is excluded on purpose: a decorative node may carry it, which is the opposite " +
    "of hiding a panel from her"
);
// ‼️ READ-ONLY IS NOT THE SAME AS DISABLED AND THE DISTINCTION IS THE POINT. v8 made the original
// panel read-only, which the check above deliberately does not catch: a read-only textarea is
// selectable, scrollable, screen-reader navigable and fully legible, and the original's entire job
// is to be READ beside the review. A disabled one is none of those things. Exactly one of the two
// panels carries it, so the review box cannot become read-only by a copy-paste slip.
check(
  (panelBlock.match(/readOnly/g) ?? []).length === 1,
  "exactly one of the two panels is read-only, and it is not the one she copies",
  "the original is for reading; the review is for editing"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. THE REVIEW IS WHAT SHE COPIES, AND THE ORIGINAL IS ALWAYS BESIDE IT.
//
// ‼️ THIS SECTION REVERSED IN v8 AND THE REVERSAL WAS DELIBERATE. v7 asserted the opposite, under
// the heading "HER VERSION IS THE DEFAULT, AND IT IS FIRST", in these words:
//
//     clientSrc.includes('useState<"hers" | "joined">("hers")'),
//     "the selected version on first render is HERS"
//     hersAt >= 0 && joinedAt > hersAt,
//     "her words are the first panel on the screen and in the reading order on a phone"
//
// Matthew, 2026-10-13: "I want them to see original, and retouched version so they can copy the
// retouched only."
//
// ‼️ WHAT THIS SECTION CHECKS INSTEAD IS THE MITIGATION, AND IT IS A HARDER THING TO SATISFY THAN
// THE DEFAULT WAS. v7's fear was a tool that replaces her words and hopes she does not notice. The
// answer to that fear is no longer "hers is pre-selected"; it is that the original is rendered,
// complete, unedited and adjacent on every render, so the difference is visible rather than
// described. A build that dropped the original panel to save space would pass v7's check (nothing
// would be "selected" wrongly) and fails every check below.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

check(
  clientSrc.includes("const text = editedJoined ?? joined;"),
  "the review she edits is the string the clipboard reads, by construction",
  "one variable feeds the box, the clipboard and the attestation, so what she approved is what " +
    "she posts"
);

// ‼️ THE ORIGINAL IS NOT OPTIONAL. Both panels must be in VERSIONS, and the review must be first:
// first in the source is first on the screen and first on a phone, where the second panel is
// below the fold.
const joinedAt = clientSrc.indexOf('key: "joined"');
const hersAt = clientSrc.indexOf('key: "hers"');
check(
  joinedAt >= 0 && hersAt > joinedAt,
  "the review is the first panel and the original is the second",
  "she reads the thing she is about to post, then what she typed, in that order"
);
check(
  hersAt >= 0,
  "and the original panel still exists at all",
  "‼️ THE SHIPPING CONDITION FOR THE WHOLE FEATURE. Dropping it would make this a box that " +
    "rewrites her words with nothing to compare them against, which is the form of this tool " +
    "that FTC 16 CFR Part 465 reaches."
);
check(
  clientSrc.includes("const hersText = assembled;"),
  "the original renders straight from her answers with no edit buffer over it",
  "nothing can put a word in that panel that assemblePlain did not put there"
);

// Regenerate varies our wording and must not be able to touch hers, nor to run on a schedule, nor
// to reach the network.
check(
  clientSrc.includes("setVariant((at) => (at + CARRY_STRIDE) % REVIEW_SHAPES)"),
  "Regenerate advances the wording number and does nothing else",
  "by a stride coprime with the space, so each press moves more than one sentence and all 54 " +
    "shapes are still reachable"
);

// ‼️ THE STARTING SHAPE IS RANDOM PER WALK, AND THIS IS THE ASSERTION THAT KEEPS THE PATTERN FIX
// ALIVE. 54 shapes are worth nothing if every patient starts on shape 0: the clinic's profile
// fills with reviews whose full stops and commas land in the same places, which is what a reader
// and a spam filter both call a template. A future tidy-up that "simplifies" this back to
// useState(0) would restore the exact defect he reported, silently, and every other check in this
// file would still pass.
check(
  clientSrc.includes("useState(() => Math.floor(Math.random() * REVIEW_SHAPES))"),
  "every walk starts on a random one of the shapes",
  "NOT useState(0): that is the pattern he reported, and nothing else here would catch it"
);
// A lazy initialiser, not a value computed in the render body, or the server and the client roll
// different numbers. Same scar as the invite code's.
check(
  !/Math\.random\(\)/.test(clientSrc.replace("useState(() => Math.floor(Math.random() * REVIEW_SHAPES))", "")),
  "and that is the only randomness in the client",
  "a second Math.random() in a render body is a hydration mismatch waiting to happen"
);
check(
  !/setVariant[\s\S]{0,200}(rating|fetch\(|setAnswers)/.test(clientSrc),
  "and nothing near it reads the rating, posts anything, or rewrites her answers",
  "a pure function over a table of literals, re-run"
);
// ‼️ THIS ASSERTION REVERSED ON 2026-10-16 AND THE REVERSAL WAS THE RIGHT WAY ROUND. It read:
//
//     clientSrc.includes("{editedJoined === null ? (")
//     "and it is withdrawn once she has edited the box"
//     "regenerating over her edit would silently discard what she wrote"
//
// The danger was real and the remedy was wrong: it protected her text by removing the control, so
// a patient who typed one character could no longer reach any of the other 323 arrangements.
// Matthew hit it on his own walk-through. What replaces it keeps her text recoverable instead,
// which is strictly better for her AND leaves the feature usable.
check(
  !clientSrc.includes("we have stopped suggesting others"),
  "the button is not withdrawn after she edits the box",
  "a tool with 324 arrangements and no way to reach them has 1"
);
check(
  clientSrc.includes("setUndoable(editedJoined)") &&
    clientSrc.includes("setEditedJoined(undoable)"),
  "and her wording is kept and restorable instead of overwritten",
  "Undo appears only when there is an edit of hers to put back, and puts it back in one press"
);

// Nothing persists the choice, so it is her words again on the next visit and for the next patient
// at the same counter phone.
check(
  !/localStorage|sessionStorage/.test(clientSrc),
  "the choice is not remembered, so the default cannot be worn away",
  "no localStorage or sessionStorage in this client"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. THE SHIPPED PROMISE MATCHES THE SHIPPED FEATURE.
//
// ‼️ THIS IS A SEPARATE PROBLEM FROM THE REVIEW RULE AND IS NOT CURED BY ANY OF IT. The rail said
// "We never write a replacement. Your call, and your words either way." A joined version offered
// beside hers IS a replacement on offer, so shipping the joiner while keeping that sentence would
// be a false claim about our own product. Stripped of comments, because the old wording is quoted
// in the comment that explains why it went.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

/**
 * The client's shipped text with every run of whitespace collapsed to one space.
 *
 * ‼️ WITHOUT THIS, EVERY COPY CHECK BELOW IS A COIN FLIP ON HOW PRETTIER WRAPPED THE SENTENCE. JSX
 * breaks a line of prose wherever the print width lands, so "We never add words you did not say."
 * lives in the source as "We never\n                add words you did not say." A raw `includes`
 * reported the new promise missing while it was rendering on the screen, and would just as happily
 * report the OLD promise gone after a reflow put a newline inside it, which is the direction that
 * matters: this section exists to catch the old wording coming back.
 */
const clientFlat = clientSrc.replace(/\s+/g, " ");

check(
  !clientFlat.includes("We never write a replacement"),
  "the old promise is gone from the shipped copy",
  '"We never write a replacement. Your call, and your words either way." is false once a joined ' +
    "version is on offer"
);
check(
  !clientFlat.includes("your words either way"),
  "and so is the half of it that said her words either way"
);
check(
  clientFlat.includes("We tidy the grammar and join your answers up") &&
    clientFlat.includes("We never add words you did not say"),
  "and what replaced it is the smaller claim this file can actually hold",
  "both halves describe exactly what sections 1 to 3 assert"
);

// ‼️ v8 ADDED TWO CLAUSES AND EACH OF THEM IS LOAD BEARING.
//
// "with words from our own questions" is the honest description of CARRIES. There are MORE of our
// words in her review than v7 put there, and the promise has to say where they came from rather
// than imply there are none.
//
// "only rephrases our joining words, never yours" exists because the button exists. A control
// labelled "Try another wording" invites exactly one wrong assumption, which is that it is
// rewriting what she said.
check(
  clientFlat.includes("with words from our own questions"),
  "and it says WHERE our words come from, now that there are four carries",
  "section 1b is what makes that sentence true; without the clause the promise understates us"
);
check(
  clientFlat.includes("only rephrases our joining words, never yours"),
  "and the Regenerate button is described on the screen that carries it",
  "a button she can press without being told what it varies is a button she will misread"
);

// ‼️ AND THE ATTESTATION SAYS APPROVAL RATHER THAN AUTHORSHIP. With our question's words in the
// box, "these are my own words" asked her to certify something not quite true on the one control
// whose only job is to be a truthful record. "A real customer of this business" is untouched.
check(
  clientFlat.includes("I am a real customer of this business"),
  "she still attests that she is a real customer",
  "the half that matters most, and the half that was always hers to assert"
);
check(
  clientFlat.includes("I approve these words as my own") &&
    !clientFlat.includes("these are my own words"),
  "and she attests that she APPROVES the words rather than that she authored every one",
  "accurate once a carry can put four of the question's words in the box"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. AN OLDER STORED ROW IS NOT SILENTLY EMPTIED.
//
// assembleJoined knows four keys. A v3, v4 or v5 row holds none of them, and a v6-only
// implementation would have returned the empty string for one. Nothing calls it that way today,
// which is exactly why it is worth pinning before something does.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const STORED_V3: ReviewAnswers = {
  worried: "I thought it would hurt",
  hoping: "I wanted to look less tired",
  surprised: "how quick it was",
  happened: "they explained every step",
};

const storedJoined = assembleJoined(STORED_V3);
assertInvariants("a stored v3 row", STORED_V3);
check(
  storedJoined.length > 0,
  "a v3 row handed to the joiner comes out as its own sentences, not as nothing",
  storedJoined
);
check(
  !storedJoined.includes(JOIN_MOTIVATION_NERVES) &&
    !ALL_CARRIES.some((wording) => storedJoined.includes(wording)),
  "and with no join and no carry applied to any of them",
  "the v6 rules are keyed to v6 questions, so an older set is passed through untouched. ‼️ v8 " +
    "added three more carries and this is the check that proves none of them leaked onto a stored " +
    "row somebody already approved."
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 8. THE FUNNEL ARITHMETIC. A WRONG CONVERSION NUMBER IS WORSE THAN AN ABSENT ONE.
//
// ‼️ THIS SECTION EXISTS BECAUSE THESE FIGURES GO IN FRONT OF A PAYING CLIENT. An undercount that
// looks plausible is the failure mode docs/2026-08-21-hub-analytics.sql warns about twice, and the
// fold is where it would happen: a running total written the wrong way round reads perfectly and
// is nonsense. Every assertion below is a property, not a snapshot, so reordering the walk does
// not break them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

{
  // Two walks stopped at the stars, one at the review's last question, one finished.
  const rows: WalkFunnelRow[] = [
    { last_step: "q_stars", n: 2, completed: 0, edited: 0, regenerated: 0 },
    { last_step: "q_friend", n: 1, completed: 0, edited: 0, regenerated: 0 },
    { last_step: "closing", n: 1, completed: 1, edited: 1, regenerated: 1 },
  ];
  const folded = walkFunnel(rows);

  check(
    folded.started === 4 && folded.completed === 1,
    "the funnel counts every walk that produced an answer, and completions separately",
    `${folded.started} started, ${folded.completed} completed`
  );

  // ‼️ MONOTONIC, AND THIS IS THE ONE THAT CATCHES THE RUNNING TOTAL BEING BUILT BACKWARDS. Later
  // steps can never have been reached by MORE people than earlier ones. A fold that summed
  // forwards instead of backwards would produce a rising series and look like a funnel upside
  // down, which somebody would read as the walk gaining people as it went.
  let monotonic = true;
  for (let at = 1; at < folded.steps.length; at += 1) {
    if (folded.steps[at].reached > folded.steps[at - 1].reached) monotonic = false;
  }
  check(
    monotonic,
    "and every step was reached by no more people than the step before it",
    folded.steps.map((s) => `${s.id}:${s.reached}`).join(" ")
  );

  check(
    folded.steps[0]?.reached === folded.started - folded.unknown,
    "the first step accounts for every walk with a recognised step",
    `${folded.steps[0]?.reached} of ${folded.started}, ${folded.unknown} unknown`
  );

  // ‼️ AN UNRECOGNISED STEP IS COUNTED AND NAMED, NEVER DROPPED. A row stamped with a step this
  // build no longer has is still a real patient. Discarding it would shrink the denominator and
  // inflate every rate above it, which is the direction that flatters us.
  const withStale = walkFunnel([
    ...rows,
    { last_step: "q_a_step_we_deleted", n: 5, completed: 0, edited: 0, regenerated: 0 },
  ]);
  check(
    withStale.started === 9 && withStale.unknown === 5,
    "a step this build no longer has is counted in the total and reported as unknown",
    `${withStale.started} started, ${withStale.unknown} unknown`
  );

  // ‼️ NO PERCENTAGE UNDER THE FLOOR, AND THE FLOOR IS WHAT PROTECTS A CLIENT CALL. Four walks
  // cannot produce a conversion rate. funnel-report.ts pins the same rule for the same reason.
  check(
    folded.steps.every((s) => s.rate === "-"),
    `under ${MIN_WALKS_FOR_RATE} walks no rate is printed at all`,
    "two of three is not 67%, it is two of three"
  );
  const busy = walkFunnel([
    { last_step: "closing", n: MIN_WALKS_FOR_RATE, completed: MIN_WALKS_FOR_RATE, edited: 0, regenerated: 0 },
  ]);
  check(
    busy.steps[0]?.rate === "100.0%",
    `and at ${MIN_WALKS_FOR_RATE} walks it is`,
    `first step reads ${busy.steps[0]?.rate}`
  );
  check(pct(1, 3) === "33.3%" && pct(0, 0) === "-", "pct rounds to one place and refuses to divide by zero");

  // The referral half, from its own table.
  const ref = referralFunnel([
    { channel: "copy", invites: 10, sent: 8, claimed: 2 },
    { channel: "whatsapp", invites: 3, sent: 3, claimed: 0 },
  ]);
  check(
    ref.invites === 13 && ref.sent === 11 && ref.claimed === 2,
    "the referral funnel totals invites, keyboards reached and claims",
    `${ref.invites} / ${ref.sent} / ${ref.claimed}`
  );
  check(
    ref.channels[0]?.channel === "copy",
    "ordered by how much each channel is actually used",
    "so the channel worth keeping is the first row"
  );
  // ‼️ THE CLAIM RATE DIVIDES BY SENT AND NOT BY INVITES. An invite she never sent cannot be
  // claimed, so dividing by the minted count would blame the friend for a message that never left
  // the counter.
  check(
    ref.channels.every((c) => c.claimRate === "-"),
    "and no claim rate is printed under the floor either",
    "same rule as the walk"
  );
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed. See the reason beside each.`);
  process.exit(1);
}
console.log(
  "All checks passed. Every word in the joined version is hers or is in a literal whose every " +
    "content word comes from the question she answered, " +
    "every answer of hers survives whole and undropped, the complaint survives it at every one " +
    "of the shapes, and the original is " +
    "still on the screen beside it."
);
