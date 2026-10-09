// AEO headline engine: the H1 of a published answer page.
//
// A page H1 has a job no ad headline has: it has to be the thing somebody actually TYPES, because
// the page only gets cited when an engine matches her query to our wording. So the shape is a
// short search ("is my med spa invisible in ChatGPT") and the weight lives in the specificity of
// the question and in the promise of the answer's SHAPE. Not in a confession, and not in a
// promise about her business.
//
// ‼️ THIS IS ONE OF FOUR HEADLINE FILES AND THE FOUR MUST NOT BE MERGED. Each has exactly one
// length contract, and in a single prompt the shortest one wins every run:
//   - `headline-swipe.ts`      8 words or fewer, the on-screen title at the top of a reel.
//   - `dr-headline-engine.ts`  12 to 45 words, the advertorial / VSL / long-form ad headline.
//   - `seo-title-engine.ts`    50 to 60 CHARACTERS, the title tag of a page.
//   - this file                a 4 to 12 word question a person would type, the H1 of a page.
//
// ‼️ THE H1 AND THE TITLE TAG ARE TWO ARTIFACTS ON ONE PAGE AND THEY ARE WRITTEN BY TWO CALLS.
// They answer to different readers: the title tag is printed by Google in a list of ten, the H1
// is matched by an answer engine against what somebody typed. See seo-title-engine.ts's own
// banner for why a character budget and a word budget cannot share a prompt.
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
// ‼️ THE MISSING CONSTRAINT WAS REALISM, NOT EMOTION, AND THIS ENGINE USED TO PRODUCE THE BUG.
// Matthew, 2026-10-07, reading the headline card for SRT's own eleven planned pages: "'Why have
// I spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?' nobody
// would actually google this, or search it like that, this sounds too ai".
//
// He was right, and the line was this file working exactly as specified. Three of its own rules
// produced it, and all three are now changed:
//   - RULE 1 ended "or a bare confessional statement when that is how she actually talks". That
//     was the door every first-person confession walked through. It is CLOSED.
//   - RULE 3 demanded "the vulnerability of the phrasing", an "identity or shame trigger" and
//     "the amount spent". It now asks for the specificity of the question instead.
//   - There was NO length rule at all, unlike the DR engine's 12 to 45 words, so a confession
//     plus a keyword plus a figure sprawled to 21 words. Real typed queries are 4 to 12.
//
// ‼️ THE PAIN IS MOVED, NOT DELETED, and that is the resolution of the whole three-format split.
// Matthew's page rules 9 and 10: the meta description is the ONLY place for a direct-response
// hook (140 to 155 chars, pain plus promise plus a soft CTA), and no emotional ad copy belongs in
// a title or an H1 because "that language belongs in ads and emails". The ad hook still carries
// every bit of it: see dr-headline-engine.ts and page-dr-headlines.ts, which is a SECOND artifact
// per page and not a replacement for this one.
//
// ‼️ THE QUOTES STAY THE EMOTIONAL SOURCE AND A QUOTE IS NEVER A HEADLINE. `headlineContext`
// feeds up to 24 voice-of-customer quotes into every run and that is correct: they are the
// evidence of what she actually worries about. What changed is that the engine now states the
// TRANSLATION step, because rebuilding a Reddit confession's shape is how the confession got
// into the H1. A quote is evidence; the headline is what she would type to find the answer to it.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/hyphens).

export const AEO_HEADLINE_ENGINE = `
WHAT YOU ARE WRITING. The H1 of one page on a business's own website. It has to be the thing a
real buyer would actually TYPE into ChatGPT, Perplexity or Google. When she types her problem
into an engine, this page is the one the engine should cite, and that only happens when the
headline is in HER words and is short enough to be a query rather than a paragraph.

‼️ THE TEST IS NOT "DOES THIS FEEL STRONG", IT IS "WOULD A PERSON TYPE THIS". Read every line
back and ask whether somebody sat down and typed those exact words into a box. Nobody types a
confession. Nobody types 21 words. Nobody types their own shame into a search engine: they type
the shortest question that gets them the answer, and that is what you are writing.

THE FIVE LAWS (every headline runs on at least two):

1) ENGINEER THE OPEN LOOP. The question itself is the loop. "Why does ChatGPT keep recommending
   my competitor and not me" has an answer she does not have, and she can feel that.
2) NAME THE SUBJECT SHE IS WORRIED ABOUT. She must read it and feel "this is about ME", and the
   way you earn that is by naming her exact situation, not by performing her feelings about it.
   Not "are you struggling", and not "I'm at a loss and don't know what I'm doing wrong" either.
   The first is vague and the second is a diary entry. "Why does ChatGPT recommend my competitor
   instead of me" is the same wound, asked the way she would ask it.
3) SPECIFICITY CREATES TRUST. Vague slides off the brain. Use the named role, the named place,
   the named platform, the real timeframe. A specific is believability in disguise. USE ONLY THE
   FIGURES YOU WERE GIVEN: see the numbers block above, which is a closed list.
4) SIMPLICITY IS PERSUASION. Short words, one clause, no stacked qualifiers. If she has to read
   it twice it is dead, and an engine matching phrasings will not match a sentence nobody says.
   This law and the length rule below are the same law counted two ways.
5) PROMISE THE SHAPE OF THE ANSWER. This is what replaces the emotional flourish, and it is the
   strongest tool this format has. A format suffix after the question tells her what she is about
   to get: "A 30-Day Plan", "5 Differences That Affect Your Bookings", "What to Do Instead". It
   is a promise about the PAGE, which the page can keep, rather than about her business, which
   nothing can.

WHAT STILL DOES NOT APPLY HERE, and it is the whole difference from an ad headline: the AD
VOICE. No third-person narrator, no "Warning:", no headline that reads as written BY a marketer
ABOUT her. She is the one speaking or the one asking. The shape is the constraint, not the
subject matter.

THE HARD RULES.

RULE 1 - QUERY SHAPE. Every headline is a question she would type, or a flat comparison she
would type. Those are the only two shapes:
  "Why is my ...", "How do I ...", "How much does ...", "What's the reason ...", "Is it normal
  that ...", "Why do ...", "How come ...", "Should I ...", "How does X decide ...",
  or a bare comparison with a colon ("AI Search vs Google Search: 5 Differences That Affect
  Your Bookings").

A question may carry a FORMAT SUFFIX after the question mark, and this is the one legal tail:
  "How Do I Get My Med Spa Recommended by ChatGPT? A 30-Day Plan"
The suffix names the shape of the answer. It is not a second sentence, not a promise about her
business, and not a place to put the pain back.

‼️ A BARE CONFESSIONAL STATEMENT IS NOT A HEADLINE HERE, AND THAT IS A CHANGE. This rule used to
end "or a bare confessional statement when that is how she actually talks", and that door is
what produced "I spent thousands on ads and still can't figure out..." lines. She may talk that
way to a friend. She does not TYPE that way into an answer engine, and the engine has nothing to
match it against. First person is not banned as vocabulary ("my", "I") when the line is still a
question somebody would type: "Why isn't my med spa showing up in ChatGPT?" is correct. What is
banned is the statement that confesses instead of asking.

RULE 2 - NO UNBACKED CLAIM. A result, a number, a percentage and a timeframe are all allowed
when a source you were given actually says so. None of them is allowed when nothing does.
  - Legal, if it is in the numbers block: "Why am I not cited when 45% of patients ask AI first?"
  - Never legal, because you were not given it: any figure you reached for to sound specific.
  - Never legal at all: a guarantee ("or your money back", "risk free"). Nothing on file can
    back a promise about what will happen to HER business, and the page it opens cannot either.
Invented specificity is the failure this rule exists to stop, not specificity.

RULE 3 - WHERE THE CHARGE COMES FROM. The weight must come from:
  - the exact situation named in her own plain words, not an agency's words for it
  - the specificity of the question: the named platform, the named competitor, the named place
  - open-loop curiosity generated by the question itself
  - the format suffix, which promises what the answer looks like (law 5)
  - what she would type at 11pm when she finally decides to look it up

‼️ AND NOT FROM SHAME. This rule used to demand "an identity or shame trigger inside the
question", "the vulnerability of the phrasing" and "the amount spent", and that is what made
every line read as a Reddit post. Those things are TRUE about her and they still have a home:
the meta description and the ad hook. They are not what she types. A headline earns its charge
here by being the real question, asked sharply, with the answer's shape promised.

RULE 3b - LENGTH, WHICH THIS ENGINE DID NOT HAVE UNTIL 2026-10-08. Count the words.
  - The QUERY CORE is 4 to 12 words. The core is everything up to the question mark, the colon,
    or a ", and" if the line has one. 4 to 12 is what people actually type.
  - 13 to 15 words in the core is allowed and will be flagged as long. Above 15 is REFUSED.
  - The whole line, suffix included, never exceeds 18 words.
  - For scale: "Why have I spent thousands on ads and still can't figure out how to get my med
    spa on ChatGPT?" is 21 words and is exactly the line this rule exists to refuse.

RULE 3c - A QUOTE IS NEVER A HEADLINE. You are given customer quotes above, and they are the
best material in this brief, but they are EVIDENCE and not drafts. A quote tells you what she is
worried about. The headline is what she would TYPE to find the answer to that worry. So the step
is always: read the quote, name the worry underneath it, then write the shortest question that
worry sends somebody to a search box with.
  the quote:    "I'm so embarrassed about my situation that I've created a throwaway account."
  the worry:    she does not know whether her clinic is visible and is ashamed to ask anybody.
  the headline: "How Do I Check If ChatGPT Mentions My Clinic?"
Rebuilding the quote's shape, which this engine used to ask for, produces the confession. Do not
do it. Keep the heat in the choice of SUBJECT, never in the grammar.

RULE 4 - CUSTOMER VOCABULARY. The words buyers use with each other, not the words an agency
uses about them. Their job titles, their shorthand, their abbreviations.

RULE 5 - STRUCTURAL VARIETY. Do not repeat the same question shape more than twice across the
set. Count your openings before you answer.

DO THIS / NOT THIS (the highest-signal part of this brief; read both columns). The DO column is
Matthew's own, written 2026-10-07, and it is the quality bar rather than an illustration:
  DO:    "How Do I Get My Med Spa Recommended by ChatGPT? A 30-Day Plan"
  DON'T: "Why have I spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?"

  DO:    "How Much Does AEO Cost for a Med Spa, and What Should You Get for It?"
  DON'T: "Is my med spa invisible in ChatGPT and am I wasting every dollar I have left?"

  DO:    "AI Search vs Google Search: 5 Differences That Affect Your Bookings"
  DON'T: "Warning: The Silent Algorithm Draining Your Med Spa Budget."

  DO:    "How Does ChatGPT Decide Which Local Business to Recommend?"
  DON'T: "She Sank $150,000 Into Her Med Spa, Then Watched ChatGPT Send Her Patients Two Blocks Away."

  DO:    "Why Facebook Ads Stop Working for Med Spas, and What to Do Instead"
  DON'T: "I opened a med spa solo and I feel like I'm doing everything wrong."

  DO:    "Why Isn't SEO Working for My Med Spa Anymore?"
  DON'T: "For the Solo NP Who Poured In Every Dollar and Still Can't Fill Her Chair."

Note what changes across those pairs, because it is NOT the subject matter. Every DON'T is about
a real thing she really feels. What dies is the SHAPE: the confession that states instead of
asking (DON'Ts 1, 2 and 5), the ad voice narrating her in the third person (DON'Ts 3, 4 and 6),
and the length. Four of the six DON'Ts are over 15 words. Every DO is a question somebody would
type, and three of them promise the answer's shape after the question mark.

The subject matter survives the rewrite every time. "I opened a med spa solo and I feel like I'm
doing everything wrong" becomes "What Am I Doing Wrong If I Run My Med Spa Solo?": same wound,
same words, asked instead of confessed, and now something a person would type.

‼️ ONE SHAPE IS NOT WRONG, IT IS JUST NOT YOURS. "How to Get Your Med Spa on ChatGPT (2026
Guide)" is an excellent line and a bad H1: it is instructional, written at her rather than asked
by her, and an engine has no query to match it to. It is the TITLE TAG of this same page, written
by its own engine with its own 60 character budget. So do not reach for "How to ..." here, and do
not think of it as banned copy. The same page carries both, and each one goes where it works.

STRICT RULES:
- Exactly the number of headlines asked for. No more, no fewer.
- Each headline stands alone. No numbering, no labels, no angle names in the text.
- A customer quote is evidence, never a draft. See rule 3c: name the worry under the quote, then
  write the question that worry sends somebody to a search box with.
- No generic hooks ("Here's the truth about X", "Nobody talks about this").
- Count the words in every line before you answer. See rule 3b.

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
