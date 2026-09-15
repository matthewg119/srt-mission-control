// AEO headline engine — the H1 of a published answer page.
//
// A page H1 has a job no ad headline has: it must match how the buyer PHRASES HER OWN PAIN,
// because the page only gets cited when an engine matches her wording to ours. So the shape is
// search language ("why is my med spa invisible in ChatGPT") and the direct-response weight
// lives INSIDE the question: the specificity of the pain, the vulnerability of the confession,
// the identity trigger. Not in a promise.
//
// ‼️ THIS IS THE THIRD HEADLINE FILE AND THE THREE MUST NOT BE MERGED. Each has exactly one
// length contract, and in a single prompt the shortest one wins every run:
//   - `headline-swipe.ts`      8 words or fewer, the on-screen title at the top of a reel.
//   - `dr-headline-engine.ts`  12 to 45 words, the advertorial / VSL / long-form ad headline.
//   - this file                a question a person would type, the H1 of a page.
//
// ‼️ THE LINE IS BACKED VERSUS UNBACKED, NOT PROMISE VERSUS NO PROMISE. Matthew, 2026-09-13:
// "you can also remove rule #2 with no timeframes tied to results (if the deep research can back
// the data we can talk about results)". So a result, a number and a timeframe are all legal in a
// headline when a source on file says so, and all illegal when nothing does. Law 4 of the ad
// engine (specificity: numbers, timeframes, named roles as proof) therefore carries over INTACT.
//
// What that leaves banned is the invented figure, which is a different failure and the one that
// actually bit: the first live run of the ad lane returned "In 2024, 45 Percent of Local Searches
// Start With an AI Prompt" and "within 90 days", neither of which anything in this repo measures.
// `approvedNumbersBlock` is the enforcement and it is already wired in: an empty approved list
// means no figure at all, and a populated one is a CLOSED list.
//
// ‼️ THE PAGE BODY IS STILL STRICTER THAN THE HEADLINE, AND THAT IS NOT AN INCONSISTENCY.
// `draft-page.ts` rule 4 bans outcome promises in the body, and the publish gate BLOCKS on
// unbacked claims. So a headline making a backed result claim reaches a body that has to source
// it. The headline can open the loop; the page still has to close it with evidence.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/hyphens).

export const AEO_HEADLINE_ENGINE = `
WHAT YOU ARE WRITING. The H1 of one page on a business's own website. It has to read like the
exact question, phrase or statement a real buyer would type into ChatGPT, Perplexity or Google,
while carrying full direct-response emotional weight. When she types her problem into an engine,
this page is the one the engine should cite, and that only happens when the headline is in HER
words rather than the industry's.

THE FIVE LAWS (the emotional delta; every headline runs on at least two):

1) ENGINEER THE OPEN LOOP. The question itself is the loop. "Why does ChatGPT keep recommending
   my competitor and not me" has an answer she does not have, and she can feel that.
2) NAME THE WOUND BEFORE YOU OFFER THE BANDAGE. Poke the nerve she tries to ignore. She must
   read it and feel "this is about ME". One sharp edge, not five. The wound goes INSIDE the
   question: not "are you struggling", but "I'm at a loss and don't understand what I'm doing
   wrong".
3) SPECIFICITY CREATES TRUST. Vague slides off the brain. Use the unusual number over the round
   one, the named role, the named place, the real timeframe, the amount actually spent. A
   specific is believability in disguise. USE ONLY THE FIGURES YOU WERE GIVEN: see the numbers
   block above, which is a closed list.
4) SIMPLICITY IS PERSUASION. Short words, one clause, no stacked qualifiers. If she has to read
   it twice it is dead, and an engine matching phrasings will not match a sentence nobody says.
5) EARN BELIEF THROUGH CREDIBILITY SIGNALS. A real event, a measurable outcome, a personal
   confession, an unexpected authority. Credibility removes friction and friction kills response.

WHAT STILL DOES NOT APPLY HERE, and it is the whole difference from an ad headline: the AD
VOICE. No third-person narrator, no "Warning:", no headline that reads as written BY a marketer
ABOUT her. She is the one speaking or the one asking. The shape is the constraint, not the
subject matter.

THE HARD RULES.

RULE 1 - QUERY SHAPE. Every headline sounds like natural search language or a direct question
she would type or say out loud:
  "Why is my ...", "How do I ...", "What's the reason ...", "Is it normal that ...", "Why do ...",
  "How come ...", "Am I the only ...", "What am I missing if ...", "Should I ...",
  or a bare confessional statement when that is how she actually talks
  ("My med spa is invisible in ChatGPT.").

RULE 2 - NO UNBACKED CLAIM. A result, a number, a percentage and a timeframe are all allowed
when a source you were given actually says so. None of them is allowed when nothing does.
  - Legal, if it is in the numbers block: "Why am I not cited when 45% of patients ask AI first?"
  - Never legal, because you were not given it: any figure you reached for to sound specific.
  - Never legal at all: a guarantee ("or your money back", "risk free"). Nothing on file can
    back a promise about what will happen to HER business, and the page it opens cannot either.
Invented specificity is the failure this rule exists to stop, not specificity.

RULE 3 - WHERE THE CHARGE COMES FROM. The emotional weight must come from:
  - raw pain wording, hers not yours
  - an identity or shame trigger inside the question
  - the vulnerability of the phrasing
  - specificity of the frustration: the amount spent, the hours, the behaviour experienced
  - open-loop curiosity generated by the question itself

RULE 4 - CUSTOMER VOCABULARY. The words buyers use with each other, not the words an agency
uses about them. Their job titles, their shorthand, their abbreviations.

RULE 5 - STRUCTURAL VARIETY. Do not repeat the same question shape more than twice across the
set. Count your openings before you answer.

DO THIS / NOT THIS (the highest-signal part of this brief; read both columns):
  DO:    "Why do my med spa Meta ad leads keep ghosting me?"
  DON'T: "Warning: The Silent Algorithm Draining Your Med Spa Budget."

  DO:    "Is my med spa invisible in ChatGPT?"
  DON'T: "How to Get ChatGPT to Name Your Clinic in Under 30 Days."

  DO:    "Why isn't my med spa growing after $150,000 invested?"
  DON'T: "She Sank $150,000 Into Her Med Spa, Then Watched ChatGPT Send Her Patients Two Blocks Away."

  DO:    "I opened a med spa solo and I feel like I'm doing everything wrong."
  DON'T: "For the Solo NP Who Poured In Every Dollar and Still Can't Fill Her Chair."

Note what changes across those pairs, because it is NOT the subject matter. The pain survives.
The dollar figure survives. A timeframe and a result survive too when a source backs them. What
dies every time is the AD VOICE: the narrator talking about her in the third person, the
"Warning:" opener, the instructional "How to Get X to do Y" written at her rather than asked by
her. Rewrite the DON'Ts as her own question and most of them become legal:
  "Why isn't ChatGPT naming my clinic yet?" is the second DON'T, fixed.

STRICT RULES:
- Exactly the number of headlines asked for. No more, no fewer.
- Each headline stands alone. No numbering, no labels, no angle names in the text.
- Never summarize a customer quote into a bland line. Rebuild its SHAPE as a question and keep
  its heat.
- No generic hooks ("Here's the truth about X", "Nobody talks about this").

HARD RULES:
- Write in ENGLISH. Source quotes may be in another language; express the idea in English.
- Never invent guarantees, statistics, prices, rates, timeframes or terms. Use only what the
  avatar, the offer and the quote material actually support.
- Never use em dashes or en dashes. Use commas, periods, colons, or hyphens.
`.trim();

/** The buyer every example in the engine above is written for. */
const EXAMPLE_BUYER = /med\s*spa\s*owner|clinic\s*owner|owner.*med\s*spa/i;

/**
 * The AEO headline engine, as a module constant (cache-friendly, offline).
 *
 * ‼️ ITS EXAMPLES ARE A MED SPA OWNER'S, AND A HEADLINE IS WRITTEN FOR THE EXACT AVATAR (F3). For any other
 * buyer, a patient or a diner, the pairs would pull every headline toward "my med spa is invisible in
 * ChatGPT". So for another buyer the engine says the examples show the shape only, and whose words to use.
 */
export function loadAeoHeadlineEngine(opts?: { avatarLabel?: string | null }): string {
  const label = opts?.avatarLabel?.trim();
  if (!label || EXAMPLE_BUYER.test(label)) return AEO_HEADLINE_ENGINE;
  return [
    AEO_HEADLINE_ENGINE,
    "",
    `THE EXAMPLES ABOVE ARE WRITTEN FOR A MED SPA OWNER. YOUR BUYER IS: ${label}. They show the SHAPE of a`,
    "good headline and nothing else. Do not borrow their subject, their business words or their pains:",
    "every headline you write is asked in this buyer's own words, about this buyer's own problem.",
  ].join("\n");
}
