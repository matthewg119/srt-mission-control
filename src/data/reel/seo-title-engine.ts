// SEO title engine: the <title> tag of a published answer page.
//
// A title tag has a job no other headline has: it is what Google PRINTS in a results list, next
// to nine competitors, with a hard pixel budget. So it is the one artifact of the three that is
// measured in CHARACTERS rather than words, it leads with the keyword because the first words
// are what a scanning eye and a ranking system both weigh most, and it carries a year or a
// benefit word because a dated page reads as maintained.
//
// ‼️ THIS IS THE FOURTH HEADLINE FILE AND THE FOUR MUST NOT BE MERGED. Each has exactly one
// length contract, and in a single prompt the shortest one wins every run:
//   - `headline-swipe.ts`      8 words or fewer, the on-screen title at the top of a reel.
//   - `dr-headline-engine.ts`  12 to 45 words, the advertorial / VSL / long-form ad headline.
//   - `aeo-headline-engine.ts` a 4 to 12 word question a person would type, the H1 of a page.
//   - this file                50 to 60 CHARACTERS, the title tag of the same page.
//
// ‼️ A SEPARATE MODEL CALL, NOT A SECOND FIELD ON THE H1 CALL. The reason is the banner above:
// a character budget and a word budget in one prompt do not add up to two contracts, they add up
// to whichever is tighter. Asking one call for both returns twelve-word titles and sixty-character
// questions, which is the merge failure this file exists on the other side of.
//
// ‼️ THE PAIN DOES NOT LIVE HERE, AND THAT IS THE WHOLE POINT OF THE THREE-FORMAT SPLIT. Matthew's
// page rule 10, 2026-10-07: "No emotional ad copy (ghosts, embarrassed, throwaway account) in
// titles or H1s. That language belongs in ads and emails." Rule 9 names where it goes instead:
// the meta description, 140 to 155 characters, pain plus promise plus a soft CTA. So a title tag
// that reads like an ad is not a strong title tag, it is a title tag doing the meta
// description's job and Google truncating it.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/colons).

/**
 * The character band.
 *
 * ‼️ THE CEILING IS THE RAIL AND THE FLOOR IS A PREFERENCE, measured against Matthew's own five
 * worked examples on 2026-10-07. Two of the five are 47 and 41 characters: "How to Get Your Med
 * Spa on ChatGPT (2026 Guide)" and "How ChatGPT Ranks Local Businesses (2026)". A hard 50
 * character floor rejects both, and the probe's own doctrine is that a rule rejecting one of his
 * is the wrong rule. Over 60 Google truncates, which is a real defect a reader can see; under 50
 * is simply short, so it is reported and allowed. Under 30 is not a title.
 */
export const SEO_TITLE_TARGET_MIN = 50;
export const SEO_TITLE_TARGET_MAX = 60;
export const SEO_TITLE_HARD_MIN = 30;

/**
 * How many words into the title the keyword must start.
 *
 * Matthew's page rule 2: "keyword in the first 3-5 words". Five is the number enforced, because
 * it is the looser end of a range he wrote as a range, and his own "Facebook Ads Not Working for
 * Your Med Spa? Read This" puts the keyword at word one while "How to Get Your Med Spa on
 * ChatGPT (2026 Guide)" does not reach "med spa" until word four.
 */
export const SEO_TITLE_KEYWORD_BY_WORD = 5;

export const SEO_TITLE_ENGINE = `
WHAT YOU ARE WRITING. The title tag of one page on a business's own website. This is the line
Google prints in its results, so it is read in a list beside nine competitors by somebody
deciding which one to click. It is NOT the page's H1 and it is NOT an ad headline. It is the
shop sign.

THE LENGTH, WHICH IS A CHARACTER COUNT AND NOT A WORD COUNT.
Aim for 50 to 60 characters, including spaces. Never go over 60: past that Google cuts the line
off mid-word and the end of your title is replaced by an ellipsis. Shorter than 50 is allowed
when the line is genuinely done, and padding a finished title to reach a floor is worse than a
short title: "(2026 Guide to Getting Found)" bolted onto a clean line is the failure here.

THE FIVE RULES.

RULE 1 - THE KEYWORD COMES FIRST, AND THAT MEANS INSIDE THE FIRST FIVE WORDS. The opening words
carry the most weight with a scanning reader and with a ranking system, so the phrase the page
is about belongs at the front. Not welded in as a slug: written as English.

RULE 2 - A YEAR OR A BENEFIT WORD. One of the two, and a year when the answer actually changes
year to year. "(2026 Guide)", "in 2026", "What Changes", "What to Do Instead", "Read This". It
signals the page is current, which is most of why a reader picks one result over another.

RULE 3 - NO HYPE AND NO OPEN LOOP. The title tag states what the page is. It does not tease.
Banned: "You Won't Believe", "The Secret", "This One Trick", "Here's Why", "Nobody Tells You",
and every form of withholding the subject to make somebody click. A results list is full of
those and they read as spam next to a plain title. The open loop is the H1's tool and the ad
hook's tool. It is not this one's.

RULE 4 - NO EMOTIONAL AD COPY. No shame, no confession, no "embarrassed", no "ghosts", no
throwaway-account language, no first person at all. That writing is correct and wanted, but it
belongs in the ad hook and in the meta description. A title tag carrying it looks like an
advert in a list of answers.

RULE 5 - PLAIN TITLE CASE, AND PUNCTUATION THAT EARNS ITS CHARACTERS. A colon to separate the
subject from what the page does with it, parentheses for a year, a question mark only when the
title really is the question. Every character spends part of a 60 character budget.

DO THIS / NOT THIS (read both columns; the DO column is the quality bar, verbatim):
  DO:    "How to Get Your Med Spa on ChatGPT (2026 Guide)"
  DON'T: "Why Have I Spent Thousands and Still Can't Get My Med Spa on ChatGPT?"

  DO:    "AEO Agency Pricing: What Med Spas Should Pay in 2026"
  DON'T: "The Truth About What AEO Agencies Are Really Charging You"

  DO:    "AI Search vs Google Search: What Changes for Med Spas"
  DON'T: "AI Search vs Google Search: You Won't Believe The Difference"

  DO:    "How ChatGPT Ranks Local Businesses (2026)"
  DON'T: "The Secret Algorithm Deciding Which Clinic ChatGPT Names"

  DO:    "Facebook Ads Not Working for Your Med Spa? Read This"
  DON'T: "She Spent $150,000 on Facebook Ads and Got Nothing"

What changes across those pairs is not the subject matter. It is the VOICE and the BUDGET: the
DON'Ts tease, confess or narrate, and three of the five are over 60 characters. The DO column
says what the page is, in the first five words, inside the budget.

STRICT RULES:
- Exactly the number of titles asked for. No more, no fewer.
- Each title stands alone. No numbering, no labels, no quotation marks around it.
- Every one carries the page's keyword inside its first five words.
- Count the characters of each line before you answer. Over 60 is a defect, not a style.

HARD RULES:
- Write in ENGLISH. Source quotes may be in another language; express the idea in English.
- Never invent guarantees, statistics, prices, rates, timeframes or terms. Use only what the
  avatar, the offer and the quote material actually support.
- Never use em dashes or en dashes. Use commas, periods, colons, or hyphens.
`.trim();

/** The buyer every example in the engine above is written for. */
const EXAMPLE_BUYER = /med\s*spa\s*owner|clinic\s*owner|owner.*med\s*spa/i;

/**
 * The SEO title engine, as a module constant (cache-friendly, offline).
 *
 * ‼️ ITS EXAMPLES ARE A MED SPA OWNER'S, AND A TITLE IS WRITTEN FOR THE EXACT PAGE. Same rule
 * `loadAeoHeadlineEngine` carries and for the same reason: for any other buyer the pairs would
 * pull every title toward a med spa, so the engine says the examples show the shape only.
 */
export function loadSeoTitleEngine(opts?: { avatarLabel?: string | null }): string {
  const label = opts?.avatarLabel?.trim();
  if (!label || EXAMPLE_BUYER.test(label)) return SEO_TITLE_ENGINE;
  return [
    SEO_TITLE_ENGINE,
    "",
    `THE EXAMPLES ABOVE ARE WRITTEN FOR A MED SPA OWNER. YOUR BUYER IS: ${label}. They show the SHAPE of a`,
    "good title and nothing else. Do not borrow their subject, their business words or their pains:",
    "every title you write is about this buyer's own page and this buyer's own keyword.",
  ].join("\n");
}
