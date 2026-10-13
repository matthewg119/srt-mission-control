// The AI Referral Engine's four questions, and the only transformation applied to an answer.
//
// SRT-Referral-Engine-BUILD-SPEC-v2.md. THERE IS NO MODEL IN THIS PATH. Not for drafting, not
// for cleanup, not for tone, not for spelling. That is the single most important line in
// the spec and the reason this file is pure string work with no imports.
//
// FTC 16 CFR Part 465 and the Rytr fact pattern: a tool that GENERATES review content its
// user did not write is the thing being regulated. A tool that REFORMATS what she typed is
// not. Every rule below follows from staying well behind that line.
//
// ‼️ v7 (2026-10-13) ADDED A JOINER AND THAT LINE ABOVE STILL HOLDS, BUT IT IS NO LONGER THE
// WHOLE STORY AND MUST NOT BE READ AS ONE. There is still no model, no network and no rewriter in
// this path. There are now two strings of ours that can land BETWEEN her answers, ", and " and
// "I walked out feeling ", on top of the lead line's "Got ... with ... today.". They are
// enumerable, they are exported, and scripts/_probe-review-v7.ts fails on any word in the output
// that is not in one of them or in her own text. See the v7 banner at the foot of this file for
// why a joiner is not the generator the rule reaches, and for the rules-against-a-model argument
// re-run rather than inherited.
//
// Pure and isomorphic on purpose, the same doctrine as src/lib/clients/normalize.ts: the
// client component previews the assembly as she types and the server stores from this same
// function, so what she reads and what is kept cannot drift.

// ‼️ v3 (2026-09-04) REPLACED QUESTION 3 AND THE REASON IS NOT A COPY PREFERENCE.
//
// It used to be "Had you had a bad experience somewhere before this one?", which invites a
// customer to describe A NAMED COMPETITOR'S care in a review posted on a public profile. That is
// the single review in this set most likely to draw a defamation complaint, and the clinic, not
// SRT, is the one holding it. "What surprised you?" asks about THIS visit, is still
// sentiment-neutral, and produces the specific detail that makes a review quotable.
//
// Old rows carry `before` and QUESTION_SET_VERSION "v2". They stay readable: assembleLabelled()
// and assemblePlain() iterate REVIEW_QUESTIONS, so a v2 row simply contributes no bullet for a
// key that is no longer asked. Nothing migrates and nothing is rewritten.
export const QUESTION_SET_VERSION = "v3";

export interface ReviewQuestion {
  /**
   * ‼️ `before` IS RETIRED, NOT DELETED. It is still in the union because
   * review_tool_submissions rows written under v2 hold it, and page-candidates.ts and
   * weekly-report.ts read those rows. Removing it from the type would make real stored data
   * unassignable.
   */
  key:
    // v3 and earlier.
    | "worried"
    | "hoping"
    | "before"
    | "surprised"
    | "happened"
    // v4 (2026-09-24). Every one of these is a sentence she typed.
    //
    // ‼️ NONE OF THEM IS A CHIP, AND THAT IS THE WHOLE DEFENCE. The v4 walk asks three
    // yes/no questions before three of these. Those gates live in review-script.ts and have NO KEY
    // AT ALL, so a "Yes" is not assignable to ReviewAnswers, cannot be iterated into a bullet,
    // cannot be stored by the submit route, and cannot reach the copy buffer. A gate is a branch.
    // What she types afterwards is the review.
    | "service"
    | "liked"
    | "improve"
    | "expectations"
    | "concerns"
    | "fears"
    // v5 (2026-10-05). The in-clinic walk. Also a sentence she typed.
    //
    // ‼️ `provider` IS A STAFF NAME IN A PUBLIC REVIEW AND THAT IS A REVERSAL. The comment on
    // REVIEW_QUESTIONS below says "NOT ASKED, EVER: who treated her", because Google forbids a
    // merchant soliciting specific review content and names staff names as an example. Matthew
    // decided on 2026-10-05 that it is asked and that it reaches the review text. Recorded as
    // his decision; the exposure sits on the clinic's Google profile, not on this tool's FTC
    // position, which is about GENERATED content and is untouched by it.
    //
    // ‼️ IT IS NOT PATIENT PII. The name is a member of the clinic's staff, so
    // review_tool_submissions still holds nothing that identifies HER, which is what that
    // table's no-column rule has always been about.
    | "provider"
    // v6 (2026-10-10). FOUR, AND THE ORDER IS THE ALGORITHM. See REVIEW_QUESTIONS_V6.
    | "motivation"
    | "nerves"
    | "walkout"
    | "friend";
  /** What she is asked. */
  prompt: string;
  /** The label shown beside her sentence ON SCREEN only. Never copied. */
  label: string;
}

/**
 * Fixed, sentiment-neutral, identical for every business.
 *
 * NOT ASKED, EVER: who treated her, whether she would recommend, anything that would SORT HER
 * DOWN ONE PATH OR ANOTHER. There is no staff name field in this route and there must never be
 * one — Google 2026 forbids a merchant requesting specific content, staff names included.
 *
 * ‼️ A STAR RATING IS NOW ASKED, AND THE RULE IT LOOKS LIKE IT BREAKS IS INTACT. Added
 * 2026-09-04. The prohibition in this comment was never about a number, it was about ROUTING:
 * a rating that decides whether she is shown the public review link is gating, which Google's
 * policy and FTC 16 CFR Part 465 both reach. The rating collected here decides nothing. Every
 * value 1 through 5 reaches these same four questions, the same assembly, the same editable
 * box and the same destination links. scripts/_probe-review-gating.ts asserts that byte for
 * byte, and it is the reason this paragraph is a description rather than a promise.
 *
 * The rating lives on the submission row and in the client's own reporting. It must never
 * become an argument to any function in this file.
 *
 * Question 1 is doing double duty. It is the customer-side mirror of the objection-shaped
 * questions in the audit's twenty, which is why the reviews this produces get quoted: they
 * contain the worry a future customer is typing into a chat box.
 */
export const REVIEW_QUESTIONS: ReviewQuestion[] = [
  {
    key: "worried",
    prompt: "What were you worried about before you came in?",
    label: "What I was worried about",
  },
  {
    key: "hoping",
    prompt: "What were you hoping would happen?",
    label: "What I was hoping for",
  },
  {
    key: "surprised",
    prompt: "What surprised you?",
    label: "What surprised me",
  },
  {
    key: "happened",
    prompt: "What actually happened at your appointment?",
    label: "What happened",
  },
];

/**
 * The v4 set (2026-09-24), walked by the Virtual Agent.
 *
 * Three of these six are only ever asked when a yes/no gate in review-script.ts was answered Yes.
 * That is a branch in the conversation and nothing more: a customer who says No to all three
 * reaches the same editable box, the same copy button and the same destination links as one who
 * says Yes to all three. The gates are not in this array and have no key of their own, which is
 * what keeps the word "Yes" out of a public review.
 *
 * "What surprised you?" and "What actually happened at your appointment?" are gone from the walk
 * and still in the union above, because rows written under v3 hold them.
 */
export const REVIEW_QUESTIONS_V4: ReviewQuestion[] = [
  {
    key: "service",
    prompt: "What service did you get done with us?",
    label: "What I came in for",
  },
  {
    key: "liked",
    prompt: "What did you like about our experience the most?",
    label: "What I liked most",
  },
  {
    key: "improve",
    prompt: "What did you not like about our experience?",
    label: "What could be better",
  },
  // The three behind a gate. Their prompts read as follow-ups because that is what they are: she
  // has already said Yes to the question the gate asked, and asking it again in full would read
  // as not having listened.
  {
    key: "expectations",
    prompt: "What were they?",
    label: "What I expected",
  },
  {
    key: "concerns",
    prompt: "Tell us about it.",
    label: "What I was concerned about",
  },
  {
    key: "fears",
    prompt: "Tell us about it.",
    label: "What I was afraid of",
  },
];

/**
 * The v5 addition (2026-10-05), asked at the counter with the front desk beside her.
 *
 * ‼️ IT ASKS FOR A NAME AGAIN, BECAUSE THE LEAD LINE MADE THAT SAFE. For half a day this read
 * "Who took care of you today, and how were they?", purely to stop a one-word answer assembling
 * into the review line `Sarah.` That is a two-part question at a desk where somebody is reading
 * it out loud, and it existed to work around the assembler rather than to ask anything better.
 *
 * assembleLead() consumes this key into "Got {service} with {provider}.", so a bare name is now
 * the RIGHT answer and the question is the one the front desk actually says. An answer that is a
 * sentence still works: "Sarah, she was great" gives "Got lip filler with Sarah, she was great."
 */
export const REVIEW_QUESTIONS_V5: ReviewQuestion[] = [
  {
    key: "provider",
    prompt: "Who took care of you today?",
    label: "Who took care of me",
  },
];

/**
 * v6, 2026-10-10. The four that replaced seven, and the STRUCTURE IS THE QUESTION ORDER.
 *
 * ‼️ WHAT WAS WRONG WITH v4/v5, IN MATTHEW'S WORDS: "this thing is very redundant". It asked what
 * she liked, what she did not like, whether she had expectations, whether she was concerned and
 * whether she was afraid: three near-identical worry gates and a complaint box, which produced
 * answers like "The people. Nothing. Sexo, Sex, Sara." A review assembled out of those is a form
 * somebody filled in, because the QUESTIONS had no shape, so the output could not have one either.
 *
 * ‼️ THESE FOUR ARE A NARRATIVE IN THE ORDER THEY ARE ASKED, AND THAT IS THE WHOLE TRICK.
 * Motivation, worry, outcome, recommendation. Answered honestly and joined in sequence they read
 * as a review a person wrote, with nothing added:
 *
 *   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines.
 *    I was worried it would look overdone. I felt like myself again. Just go, they talk you
 *    through everything."
 *
 * ‼️ v7 (2026-10-13) PARTLY SUPERSEDED THE TWO PARAGRAPHS BELOW. Read them, then read the v7
 * banner at the foot of this file, which says what changed and what did not. In short: still no
 * model and still no rewriter, but a JOINER now exists, the four sentences below can be offered
 * joined up as an OPTION beside hers, and the shipped copy quoted at the end of this docstring was
 * rewritten in the same commit because the joiner made it false. The reasoning in both paragraphs
 * is why the joiner is two conjunction-shaped literals and not a tidy-up button.
 *
 * ‼️ AND THAT IS WHY THIS FILE STILL CONTAINS NO MODEL, NO REWRITER AND NO POLISH STEP.
 * FTC 16 CFR Part 465 bans disseminating reviews that misrepresent a consumer's experience, and
 * the Rytr complaint turned on a generator producing "material details unrelated to user input".
 * The safe side of that line is adding no substance at all. The temptation to add one is a
 * symptom of badly shaped questions, so the fix went into the questions. assembleBullet still
 * does exactly three things to her sentence: collapse whitespace, capitalise a lowercase first
 * letter, add a full stop if there is none.
 *
 * ‼️ ONE MORE REASON NOT TO ADD A POLISH BUTTON HERE: the clinic-facing page says in as many
 * words that we never write the review and never write a replacement. A tidy-up feature would
 * make that sentence false, which is a deception problem of its own, separate from the review
 * rule, and it would spend the strongest thing the product says about itself.
 *
 * ‼️ v7 TOOK THAT COST RATHER THAN DENYING IT. "We never write a replacement. Your call, and your
 * words either way." is gone from the rail, because a joined version offered beside hers IS a
 * replacement on offer and keeping the sentence would have been the deception this paragraph
 * warns about. What replaced it claims less and is true: "We tidy the grammar and join your
 * answers up. We never add words you did not say." The half of the promise that was worth having
 * survived, and the probe fails if the old sentence returns.
 */
export const REVIEW_QUESTIONS_V6: ReviewQuestion[] = [
  {
    key: "motivation",
    prompt: "What made you start looking for a place like this?",
    label: "Why I started looking",
  },
  {
    // ‼️ THE FOLLOW-UP, NOT THE GATE. "Were you nervous about anything before coming in?" is a
    // yes/no in review-script.ts with no key at all, so a "Yes" is not assignable to
    // ReviewAnswers and cannot reach the clipboard. This is what she types after one.
    key: "nerves",
    prompt: "What were you nervous about?",
    label: "What I was nervous about",
  },
  {
    key: "walkout",
    prompt: "How did you feel walking out?",
    label: "How I felt walking out",
  },
  {
    key: "friend",
    prompt: "What would you tell a friend who is on the fence about coming in?",
    label: "What I would tell a friend",
  },
];

/**
 * Assembly order for ALL sets, and the reason nothing migrates.
 *
 * ‼️ THE ORDER OF THIS SPREAD IS LOAD BEARING AND IS PINNED BY A TEST. assembleLabelled and
 * assemblePlain iterate it, so it decides the order of the sentences she copies. No stored row has
 * ever held one v3 key and one v4 key, so a v3 row comes out byte for byte what it produced before
 * v4 existed. Reordering this would re-assemble stored reviews in an order the customer who wrote
 * them never saw, which is a thing she cannot be asked to check.
 *
 * ‼️ v5 IS APPENDED, NEVER INSERTED, AND THE READ ORDER WAS THE DECIDING ARGUMENT. `provider`
 * would read most naturally second, right after the service, but putting it there would mean
 * splitting the v4 spread in half around it, and the next person to add a question would have a
 * four-part expression to reason about instead of a list. Appended, every stored v3 and v4 row
 * comes out byte for byte unchanged (they hold no `provider` value, so they contribute no extra
 * bullet), and a v5 review ends by naming the person who did the work, which is a good last line
 * rather than a compromise.
 */
export const ALL_REVIEW_QUESTIONS: ReviewQuestion[] = [
  ...REVIEW_QUESTIONS,
  ...REVIEW_QUESTIONS_V4,
  ...REVIEW_QUESTIONS_V5,
  // ‼️ APPENDED, LIKE v5, AND HERE IT IS NOT A COMPROMISE BUT THE POINT. A v6 walk collects only
  // v6 keys plus the lead's two, so this spread's tail IS the narrative order: motivation, worry,
  // outcome, recommendation. Every stored v3, v4 and v5 row still comes out byte for byte what
  // its author approved, because none of them holds a v6 key.
  ...REVIEW_QUESTIONS_V6,
];


/** The stamp a v4 row carries. v3 rows keep QUESTION_SET_VERSION above and nothing rewrites them. */
export const QUESTION_SET_VERSION_V4 = "v4";

/** The stamp a v5 row carries. Nothing rewrites a v3 or a v4 row. */
export const QUESTION_SET_VERSION_V5 = "v5";

/** The stamp a v6 row carries. Nothing rewrites anything older. */
export const QUESTION_SET_VERSION_V6 = "v6";

/**
 * Which set was walked, read off the request body.
 *
 * Anything unrecognised is v3, which is what a client that sends nothing is. The value lands in a
 * not-null text column, so it is narrowed here rather than trusted.
 */
export function readQuestionSetVersion(raw: unknown): string {
  if (raw === QUESTION_SET_VERSION_V6) return QUESTION_SET_VERSION_V6;
  if (raw === QUESTION_SET_VERSION_V5) return QUESTION_SET_VERSION_V5;
  return raw === QUESTION_SET_VERSION_V4 ? QUESTION_SET_VERSION_V4 : QUESTION_SET_VERSION;
}

export type ReviewAnswers = Partial<Record<ReviewQuestion["key"], string>>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE LEAD LINE (v5, 2026-10-05), AND THE RULE IT BENDS
//
// ‼️ THIS IS SRT-AUTHORED TEXT INSIDE WHAT SHE COPIES, AND NOTHING ELSE IN THIS FILE IS.
// assemblePlain's own docstring says the labels are kept out so that "what gets posted to Google
// is one hundred percent her own words, with no SRT-authored text in it at all". Two words of
// ours now travel with it: "Got" and "with". Matthew's call, 2026-10-05, and the reasoning is
// his: the reviews worth having name the treatment, which is the whole pitch in the cold email
// ("Got Botox here, looks so natural"), and a patient at a counter answers "who took care of
// you?" with one word.
//
// ‼️ IT ALSO FIXES A REAL DEFECT RATHER THAN ONLY ADDING A FEATURE. Without it, `provider` had to
// be its own bullet, so "Sarah" assembled into the review line `Sarah.` To avoid that the
// question had to ask "and how were they?", which is a two-part question at a desk where the
// front desk is reading it out loud. The template lets the question be the one the front desk
// actually asks.
//
// ‼️ WHAT THE TEMPLATE MAY CONTAIN IS FENCED, AND THE FENCE IS THE DEFENCE. Connective words
// around facts she typed, and nothing else. No adjective, no adverb, no sentiment, no claim about
// a result, no business name, no superlative. "Got {service} with {provider}." states two things
// she stated. "Had an amazing {service} with the wonderful {provider}" would be us writing her
// review, which is the Rytr fact pattern and is what FTC 16 CFR Part 465 reaches.
// scripts/_probe-review-gating.ts holds that fence against a word list.
//
// ‼️ AND SHE SEES IT BEFORE IT GOES ANYWHERE. The lead line lands in the same editable box as the
// rest, above the same attestation and the same copy button, so the last hand on the text is
// hers. That is the mitigation that makes two function words defensible where a generated
// sentence would not be.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Both halves of the lead line. A full stop belongs to the template, not to her fragment.
 *
 * ‼️ "today" IS A FACT AND NOT A FLOURISH, which is the only reason it is allowed in here. She
 * is answering this at the counter on the day of the visit, so it is true by construction. It
 * earns its place because it is what makes the line read as somebody talking rather than as a
 * form: "Got lip filler with Sarah today" is a sentence, "Got lip filler with Sarah" is a label.
 * Nothing else may be added on that argument: every other candidate is an adjective.
 */
export const LEAD_WITH_PROVIDER = "Got {service} with {provider} today.";
export const LEAD_SERVICE_ONLY = "Got {service} today.";

/**
 * The keys the lead line consumes, so they are not also emitted as their own bullets.
 *
 * ‼️ CONSUMED, NOT DUPLICATED. Without this, a v5 review would open "Got lip filler with Sarah."
 * and then repeat "Lip filler." and "Sarah." as the next two lines.
 */
export const LEAD_KEYS: ReadonlyArray<ReviewQuestion["key"]> = ["service", "provider"];

/**
 * Her words, prepared to sit INSIDE a sentence rather than to be one.
 *
 * Differs from assembleBullet in exactly two ways, both because of where it lands: it does NOT
 * capitalise (the word is mid-sentence) and it strips a trailing full stop rather than adding one
 * (the template owns the punctuation). Everything else is the same single transformation: trim
 * and collapse whitespace. No spelling correction, no grammar, no reordering, no words added.
 *
 * ‼️ IT CANNOT RESCUE A SENTENCE-SHAPED ANSWER, AND IT MUST NOT TRY. A patient who answers "I got
 * lip filler" produces "Got I got lip filler with Sarah." That is a wart, it is visible in the
 * editable box, and she can fix it in one tap. The alternative is this function detecting and
 * rewriting her phrasing, which is the line the whole file refuses to cross for a cosmetic win.
 */
export function assembleFragment(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim().replace(/[.]+$/, "").trim();
  return collapsed || null;
}

/**
 * The opening line of a v5 review, or null when there is no service to name.
 *
 * No service means no lead line at all and her answers assemble exactly as they did before, which
 * is also why v1 and every stored v3 row are untouched by this: they have no `service` key.
 */
export function assembleLead(answers: ReviewAnswers): string | null {
  const service = assembleFragment(answers.service);
  if (!service) return null;
  const provider = assembleFragment(answers.provider);
  return provider
    ? LEAD_WITH_PROVIDER.replace("{service}", service).replace("{provider}", provider)
    : LEAD_SERVICE_ONLY.replace("{service}", service);
}

/**
 * The entire transformation, and nothing else.
 *
 * Trim. Collapse internal runs of whitespace. Capitalise the first character if it is
 * lowercase. Append a period if there is no terminal punctuation.
 *
 * NOT done, and each omission is deliberate: no spelling correction, no grammar fixing, no
 * reordering, no joining of clauses, no transitions, no adjectives, no business name
 * inserted, no service name inserted. Her words, tidied, or nothing.
 *
 * ‼️ EVERY WORD OF THAT IS STILL TRUE OF THIS FUNCTION, AND v7 DID NOT TOUCH IT. The joining
 * added in v7 lives entirely in assembleJoined, which COMPOSES this function rather than changing
 * it: it hands this one a string it has already built and relies on exactly the three
 * transformations above. Anything that joins, carries or splits belongs down there, where the
 * probe can see it. This function staying the one place her sentence is only tidied is what makes
 * "her version" and "the joined version" two different things on the screen rather than one.
 *
 * Returns null for an empty answer. An unanswered question simply produces fewer bullets;
 * none of the four is required.
 */
export function assembleBullet(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;

  const first = collapsed[0];
  // Only when it is LOWERCASE. Leaving an already-capitalised or non-alphabetic opener
  // alone means the function never changes a character she chose deliberately.
  const capitalised =
    first === first.toLowerCase() && first !== first.toUpperCase()
      ? first.toUpperCase() + collapsed.slice(1)
      : collapsed;

  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export interface LabelledBullet {
  key: ReviewQuestion["key"];
  label: string;
  text: string;
}

/**
 * FOR THE SCREEN ONLY. Labelled bullets, so she can see the structure of what she wrote.
 *
 * Kept as a separate function from assemblePlain() and not derived from it, so that a later
 * refactor cannot quietly merge the two. That separation is the whole legal answer if the
 * tool is ever challenged.
 */
export function assembleLabelled(answers: ReviewAnswers): LabelledBullet[] {
  const out: LabelledBullet[] = [];
  for (const question of ALL_REVIEW_QUESTIONS) {
    const text = assembleBullet(answers[question.key]);
    if (text) out.push({ key: question.key, label: question.label, text });
  }
  return out;
}

/**
 * FOR THE COPY BUFFER. Her sentences, joined by line breaks. NO LABELS.
 *
 * The labels are ours; the sentences are hers. Keeping ours out of the copied artifact
 * means what gets posted to Google is one hundred percent her own words, with no
 * SRT-authored text in it at all.
 */
export function assemblePlain(answers: ReviewAnswers, opts?: { lead?: boolean }): string {
  const lines: string[] = [];

  // ‼️ OPT IN, AND THE DEFAULT IS THE OLD BEHAVIOUR BYTE FOR BYTE. Only the v5 walk passes
  // `lead`. v1 calls this with no options, so the four-question chat is untouched, and so is any
  // future reader that assembles a stored row: a v3 or v4 row read back comes out exactly what
  // its author saw and approved. The flag lives at the call site rather than being inferred from
  // the presence of a key, so "which flow was this" is a decision somebody wrote down.
  const lead = opts?.lead ? assembleLead(answers) : null;
  if (lead) lines.push(lead);

  for (const question of ALL_REVIEW_QUESTIONS) {
    // The lead line already said these two. Skipped only when it actually rendered.
    if (lead && LEAD_KEYS.includes(question.key)) continue;
    const text = assembleBullet(answers[question.key]);
    if (text) lines.push(text);
  }
  // ‼️ v5 IS ONE PARAGRAPH AND v3/v4 ARE STILL ONE LINE EACH. Matthew, 2026-10-05, wrote out what
  // he wanted it to look like and it was prose: "Got lip filler with sarah today I loved how
  // natural it looks, nobody could tell. I was worried It would look overdone." A column of
  // sentences on separate lines reads as a form somebody filled in, which is exactly how it looks
  // on a Google profile beside reviews people actually typed.
  //
  // Tied to the SAME flag as the lead line rather than to a second option, because they are one
  // decision: v5 produces a paragraph, and everything before it produces the lines its author
  // already saw and approved.
  return lines.join(opts?.lead ? " " : "\n");
}

/** Nothing typed in any of the four. */
export function isEmpty(answers: ReviewAnswers): boolean {
  return ALL_REVIEW_QUESTIONS.every((q) => !assembleBullet(answers[q.key]));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// v7 (2026-10-13): CONNECTIVE TISSUE, AND THE ARGUMENT DIRECTLY ABOVE THAT IT AMENDS
//
// ‼️ READ THE v6 DOCSTRING FIRST. It says this file contains no model, no rewriter and no polish
// step, and it is right about two of those three. v7 adds a JOINER. The difference is not a
// shading of the same idea, it is the whole reason this is allowed to exist:
//
//   A REWRITER takes her sentence and emits a better one. It decides what she meant.
//   A JOINER takes two sentences she typed and names the relationship THE ORDER ALREADY IMPLIES.
//
// v6 made the questions a narrative and the output still read as four disconnected sentences,
// because nothing carried across the full stops:
//
//   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines.
//    I was worried it would look overdone. Like myself again, honestly. Just go, they talk you
//    through everything."
//
// and with the joins below it reads as one person talking, with no word added that is not in a
// literal in this file:
//
//   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines,
//    and I was worried it would look overdone. I walked out feeling like myself again, honestly.
//    Just go. They talk you through everything."
//
// ‼️ "THERE IS NO MODEL IN THIS PATH" AT THE TOP OF THIS FILE SURVIVED v7, AND IT WAS RE-ARGUED
// RATHER THAN INHERITED. Rules against a model was the open question on the v7 brief. A model
// writes better prose over the long tail of answer shapes and the rule table below handles eight.
// It lost on three things, in increasing order of how much they matter:
//
//   1. The header's isomorphic doctrine. The client previews the assembly AS SHE TYPES from this
//      same function, so what she reads and what the server stores cannot drift. A network call
//      cannot run in that path, so a model puts the drift back.
//   2. The guarantee changes kind. "No adjective she did not write" is a property of a rule table
//      and a hope about a model. A probe over four fixtures in CI is not a runtime validator over
//      every live submission, and when a validator trips, the fallback is her raw text anyway.
//   3. "Nothing varies by star rating" is provable while no rating argument exists, and becomes an
//      argument about a prompt the moment one does. scripts/_probe-review-gating.ts asserts that
//      byte for byte today. It would be asserting a weaker thing tomorrow.
//
// What a model would buy is prose quality. What it would cost is the one property this surface is
// built to be ABLE TO PROVE. If a model is ever wanted here, it belongs behind a second explicit
// choice with a runtime validator in front of it, not inside this function.
//
// ‼️ THE CONSERVATIVE DEFAULT IS THE DESIGN, NOT A FALLBACK. Every rule below has to EARN her
// sentence. When any precondition misses, the sentence is emitted by assembleBullet exactly as v6
// emitted it, so the worst case of the whole feature is today's output. All the fuzziness in the
// closed word lists is therefore biased in one direction on purpose: a list that is too long makes
// a rule DECLINE, and declining is free.
//
// ‼️ THE SHIPPED COPY CHANGED IN THE SAME COMMIT, AND THAT IS A CONDITION OF THE FEATURE, NOT
// POLISH. The rail in virtual-agent-client.tsx promised "We never write a replacement. Your call,
// and your words either way." A joined version offered beside hers makes the first half of that
// false, which is a deception problem of its own, separate from the review rule and not cured by
// any of it. It now reads "We tidy the grammar and join your answers up. We never add words you
// did not say." Shipping the joiner without that edit would be a false claim about our own
// product. scripts/_probe-review-v7.ts fails if the old sentence comes back.
//
// ‼️ WHAT MAKES CONNECTIVE WORDS THE SAFE ZONE, WHICH IS THE SAME ARGUMENT THE LEAD LINE WON ON.
// FTC 16 CFR Part 465 bans disseminating a review that misrepresents a consumer's experience, and
// the Rytr complaint turned on a generator producing "material details unrelated to user input".
// ", and" asserts no detail. It names a relationship between two answers she gave in the order she
// gave them. An adjective, a result, a duration, a price or a staff name she did not type is a
// detail, and none of them can reach the output: the only words this section can insert are in the
// two literals below, and the probe reads them out of this module to build its vocabulary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ‼️ THE ONLY TWO STRINGS v7 CAN PUT IN HER REVIEW, AND BOTH ARE EXPORTED SO A PROBE CAN FENCE
 * THEM. scripts/_probe-review-v7.ts builds its allowed vocabulary out of these plus the lead
 * templates plus her own answers, and fails on any other word in the output. That makes adding a
 * word to this file the only way to widen what we can say, which is a line in a diff somebody
 * reviews rather than a behaviour somebody discovers.
 *
 * ‼️ "and" IS THE ONLY CONJUNCTION, AND THE BRIEF ALLOWED FIVE. "but" asserts contrast, "so",
 * "because" and "which is why" assert causation: each of them is a claim about the relationship
 * between two answers that SHE did not make, and picking between them needs a reader who
 * understands her meaning, which is the rewriter this is not. "and" asserts addition, which is
 * the one relationship the question order already establishes. Narrowing five to one is the
 * single most load-bearing decision in this section.
 */
export const JOIN_MOTIVATION_NERVES = ", and ";

/**
 * The verb carried from "How did you feel walking out?" so a fragment becomes a sentence.
 *
 * This is the one transformation the brief named by example: her "like myself again" plus the
 * question's own verb is "I walked out feeling like myself again". The words are the question's,
 * not ours, and the question is fixed, sentiment-neutral and identical for every business.
 */
export const CARRY_WALKOUT = "I walked out feeling ";

/** The four keys v7 joins. Derived, so it cannot drift from the question set. */
export const V6_KEYS: ReadonlyArray<ReviewQuestion["key"]> = REVIEW_QUESTIONS_V6.map((q) => q.key);

/**
 * Words meaning "she has already started a clause here".
 *
 * A verb carried onto one of these produces a double subject ("I walked out feeling I felt fine"),
 * and a merge onto one reads as a run-on. Over-inclusion only makes a rule decline, so "the" and
 * "that" are in here even though they open plenty of fragments too.
 *
 * Apostrophes are stripped before the lookup, so "it" plus "s" and "I" plus "m" both arrive bare.
 */
const CLAUSE_OPENERS: ReadonlySet<string> = new Set([
  "i", "im", "ive", "id", "ill",
  "we", "weve", "were", "well", "our", "us",
  "it", "its", "they", "theyre", "theyve", "he", "hes", "she", "shes", "you", "youre", "youve",
  "my", "mine", "his", "her", "hers", "their", "your",
  "everything", "everyone", "everybody", "something", "someone", "nobody", "nothing", "none",
  "there", "that", "this", "these", "those", "the", "when", "after", "before", "since", "if",
]);

/**
 * Conjunctions, used for two different refusals.
 *
 * ‼️ THE SECOND REFUSAL IS WHAT KEEPS A COMPLAINT INTACT, AND IT IS THE REASON FIXTURE 4 PASSES.
 * "a bit sore and the wait was long" carries its own second clause. Carrying a verb onto it gives
 * "I walked out feeling a bit sore and the wait was long", which routes a FACT about the clinic
 * ("the wait was long") through "feeling" and recasts it as a mood. Every word of hers would still
 * be there and the sentiment would have moved, which is the prohibition that is easiest to break
 * without noticing. So an answer holding a conjunction is never carried; it is emitted as she
 * typed it, in the position v6 put it.
 */
const CONJUNCTIONS: ReadonlySet<string> = new Set([
  "and", "but", "so", "because", "which", "though", "although", "plus", "also", "then", "however",
]);

/** A word reduced to letters for a closed-list lookup, so a trailing comma cannot miss. */
function token(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/** Her answer's words, after assembleFragment has already collapsed the whitespace. */
function wordsOf(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

/**
 * True when the whole answer is ONE sentence.
 *
 * Anything with sentence-final punctuation inside it is left alone: two sentences merged with
 * ", and " is a run-on, and "Dr. Smith" would be read as two. Both refusals are the safe direction.
 */
function isSingleSentence(text: string): boolean {
  return !/[.!?…]/.test(text.replace(/[.!?…]+$/, ""));
}

/**
 * Her fragment, prepared to sit after a conjunction or a carried verb.
 *
 * Lowercasing a sentence-initial capital mid-sentence is grammar, which the brief allows. The
 * three exceptions are the ones where the capital is hers and means something: the pronoun I, an
 * acronym she typed in capitals (IPL, PRP, CO2), and the provider's name, which is the one proper
 * noun this flow knows by name because she typed it into a different question.
 *
 * Beyond those three a lowercased proper noun is possible and is a visible wart in a box she is
 * reading and editing, exactly like the one in assembleFragment's docstring. The alternative is
 * this function deciding which of her words are names, which is a guess about her meaning for a
 * cosmetic win.
 */
function midSentence(fragment: string, answers: ReviewAnswers): string {
  const first = wordsOf(fragment)[0] ?? "";
  const bare = first.replace(/[^A-Za-z']/g, "");
  if (bare === "I" || bare.startsWith("I" + "'")) return fragment;
  if (bare.length > 1 && bare === bare.toUpperCase()) return fragment;

  const provider = (answers.provider ?? "").trim().toLowerCase();
  const providerFirst = provider.split(" ")[0] ?? "";
  if (providerFirst.length > 1 && bare.toLowerCase() === providerFirst) return fragment;

  const head = fragment[0];
  return head === head.toUpperCase() && head !== head.toLowerCase()
    ? head.toLowerCase() + fragment.slice(1)
    : fragment;
}

/** Below this, a merge would be building a sentence around two words rather than joining two. */
const MERGE_MIN_WORDS = 4;

/**
 * Whether motivation and nerves may become one sentence.
 *
 * ‼️ THE PAIR IS NAMED, NOT ADJACENT, AND THAT IS WHAT STOPS IT BRIDGING A GAP. This asks about
 * motivation and nerves specifically, never "the first two answers present". With nerves skipped,
 * motivation stands alone and nothing joins across the hole, because a conjunction spanning a
 * question she declined to answer asserts a relationship between her answer and nothing.
 *
 * ‼️ AND THE WORD FLOOR IS WHY ONE-WORD ANSWERS ARE LEFT ALONE. motivation "wrinkles" and nerves
 * "bruising" joined would be "Wrinkles, and bruising", a sentence we built around two words she
 * typed. Under the floor, both come out as the bullets v6 produced.
 */
function canMergeMotivationAndNerves(motivation: string, nerves: string): boolean {
  if (!isSingleSentence(motivation) || !isSingleSentence(nerves)) return false;
  if (wordsOf(motivation).length < MERGE_MIN_WORDS) return false;

  const nerveWords = wordsOf(nerves);
  if (nerveWords.length < MERGE_MIN_WORDS) return false;
  // A nerves answer that already opens with a conjunction would double it after ", and ".
  if (CONJUNCTIONS.has(token(nerveWords[0]))) return false;
  return true;
}

/** A carried verb is for a short complement phrase. Longer than this and she wrote a sentence. */
const CARRY_MIN_WORDS = 2;
const CARRY_MAX_WORDS = 6;

/**
 * Whether "How did you feel walking out?" may lend its verb to her answer.
 *
 * One word ("good") is left alone: "I walked out feeling good" is a sentence built around one word
 * she typed. Seven or more, or anything holding a conjunction or opening its own clause, is
 * already a sentence and gets nothing added. What is left is the shape the carry was designed for:
 * "like myself again, honestly".
 */
function canCarryWalkout(walkout: string): boolean {
  const words = wordsOf(walkout);
  if (words.length < CARRY_MIN_WORDS || words.length > CARRY_MAX_WORDS) return false;
  if (!isSingleSentence(walkout)) return false;
  if (CLAUSE_OPENERS.has(token(words[0]))) return false;
  if (words.some((word) => CONJUNCTIONS.has(token(word)))) return false;
  return true;
}

const SPLIT_MIN_HEAD_WORDS = 2;
const SPLIT_MIN_TAIL_WORDS = 3;

/**
 * "Just go, they talk you through everything" becomes "Just go. They talk you through everything."
 *
 * A full stop and a capital, and nothing else: the only transformation in this file that adds no
 * word at all. It is kept to the friend answer rather than applied generally because that is where
 * the advise-then-explain shape occurs, and one named rule is easier to audit than a general
 * sentence-splitter running over every answer.
 *
 * Requires exactly one comma and a tail that opens its own clause, so a list ("the staff, the
 * rooms, everything") and a trailing aside ("just go, honestly") are both left alone.
 */
function splitFriendClause(friend: string, answers: ReviewAnswers): string | null {
  if (!isSingleSentence(friend)) return null;

  const parts = friend.replace(/[.]+$/, "").split(",");
  if (parts.length !== 2) return null;

  const head = parts[0].trim();
  const tail = parts[1].trim();
  if (wordsOf(head).length < SPLIT_MIN_HEAD_WORDS) return null;

  const tailWords = wordsOf(tail);
  if (tailWords.length < SPLIT_MIN_TAIL_WORDS) return null;
  if (!CLAUSE_OPENERS.has(token(tailWords[0]))) return null;

  const first = assembleBullet(head);
  const second = assembleBullet(tail);
  return first && second ? first + " " + second : null;
}

/**
 * HER ANSWERS, JOINED. The v7 option, offered beside the version this file has always produced.
 *
 * ‼️ IT IS AN OPTION AND assemblePlain IS STILL THE DEFAULT, IN THIS FILE AND ON THE SCREEN. The
 * component holds both, hers is selected, and the joined one is a radio she has to choose. That
 * ordering is not a UI preference: a tool that silently replaces what she wrote with our version
 * of it is the thing FTC 16 CFR Part 465 reaches, and a tool that offers it beside hers is not.
 *
 * ‼️ OFFERED AT EVERY RATING, AND THE FUNCTION CANNOT KNOW THE RATING. There is no rating
 * argument here and there must never be one. Offering a better-reading review to five stars and
 * not to two is review shaping with a nicer name, and it is the exact funnel
 * scripts/_probe-review-gating.ts exists to keep rebuilt-proof.
 *
 * ‼️ NOTHING SHE TYPED IS EVER DROPPED, INCLUDING A KEY THIS FUNCTION HAS NEVER HEARD OF. The
 * non-v6 loop runs first in ALL_REVIEW_QUESTIONS order, so a stored v3, v4 or v5 row handed to
 * this comes out as its own sentences with no join applied to any of them, rather than as the
 * empty string a v6-only implementation would have returned. Nothing calls it that way today.
 *
 * Pure, no network, no imports: ReviewAnswers in, a string out.
 */
export function assembleJoined(answers: ReviewAnswers): string {
  const sentences: string[] = [];

  const lead = assembleLead(answers);
  if (lead) sentences.push(lead);

  // Everything outside the v6 narrative, in the pinned order, untouched. See the docstring: this
  // is what keeps an older stored row readable rather than empty.
  for (const question of ALL_REVIEW_QUESTIONS) {
    if (V6_KEYS.includes(question.key)) continue;
    if (lead && LEAD_KEYS.includes(question.key)) continue;
    const text = assembleBullet(answers[question.key]);
    if (text) sentences.push(text);
  }

  // 1. motivation + nerves, merged with the one conjunction that asserts nothing.
  const motivation = assembleFragment(answers.motivation);
  const nerves = assembleFragment(answers.nerves);
  if (motivation && nerves && canMergeMotivationAndNerves(motivation, nerves)) {
    const merged = assembleBullet(
      motivation + JOIN_MOTIVATION_NERVES + midSentence(nerves, answers)
    );
    if (merged) sentences.push(merged);
  } else {
    const first = assembleBullet(answers.motivation);
    if (first) sentences.push(first);
    const second = assembleBullet(answers.nerves);
    if (second) sentences.push(second);
  }

  // 2. walkout, with the question's own verb carried onto a fragment.
  const walkout = assembleFragment(answers.walkout);
  if (walkout) {
    const carried = canCarryWalkout(walkout)
      ? assembleBullet(CARRY_WALKOUT + midSentence(walkout, answers))
      : assembleBullet(answers.walkout);
    if (carried) sentences.push(carried);
  }

  // 3. friend, split where she already put the break.
  const friend = assembleFragment(answers.friend);
  if (friend) {
    const split = splitFriendClause(friend, answers) ?? assembleBullet(answers.friend);
    if (split) sentences.push(split);
  }

  return sentences.join(" ");
}
