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
