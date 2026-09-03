// The med-spa Loom script, v5. STORED, NOT WIRED.
//
// ‼️ NOTHING READS THIS FILE YET, AND THAT IS DELIBERATE (2026-09-01, founder's call).
// buildLoomScript() in src/lib/audit-engine/loom-script.ts is 1,000 lines of vertical-aware
// generation and it is live behind the `loom` Slack command in the audit thread. Swapping it for
// this in the same pass as building /onboarding2 would put a working generator's rewrite inside
// a funnel build, so the words are captured and version-controlled here first and the wiring is
// a separate job.
//
// ‼️ MED SPAS ONLY, EXCLUSIVELY. This script names patients, memberships and filler, and it
// closes on the /onboarding2 signing funnel. It is not a trades script and it is not a general
// local-business script, so whoever wires it up has to keep buildLoomScript's vertical branch
// rather than deleting it.
//
// ‼️ NOT guard()-CHECKED FOR FIGURES, BUT EVERY FIGURE IN IT IS ALREADY IN pitch.ts. The value
// stack is OFFER_INCLUDES, the retainer is PRICE_RETAINER, the recurring total is
// VALUE_RECURRING, and the phone is LOOM_TEXT_NUMBER. When this gets wired, read them from there
// rather than leaving the literals below in place, for the reason pitch.ts's own header gives.
//
// Slots, filled at generation time:
//   {SCORE}       the clinic's AI visibility score out of 100
//   {CITY}        the city the prompts were run for
//   {USER_SHOWED} how many of 5 prompts named them
//   {COMP_SHOWED} how many of 5 prompts named the rival
//   {COMPETITOR}  the named rival
//   {PATIENT_KIND} what a patient is worth to THIS clinic, e.g. "filler patients" or
//                 "membership buyers worth $2,000 to $4,000 each"

import { guard } from "@/lib/copy-guard";

export const LOOM_MEDSPA_VERSION = "v5";

/**
 * The script, beat by beat.
 *
 * Kept as an array rather than one blob so a future generator can drop or reorder a beat without
 * a regex over prose, and so the value stack beat can be rebuilt from OFFER_INCLUDES in place.
 */
export const LOOM_MEDSPA_BEATS: Array<{ beat: string; text: string }> = [
  {
    beat: "open",
    text: guard(
      "loom open",
      "In this video I am going to show you how you can increase your AI visibility to book more appointments from {PATIENT_KIND}."
    ),
  },
  {
    beat: "score",
    text: guard("loom score", "So you scored {SCORE} out of 100."),
  },
  {
    beat: "prompts",
    text: guard(
      "loom prompts",
      "These are the prompts that we tested, looking for a med spa in {CITY}. You showed up {USER_SHOWED} out of 5. {COMPETITOR} showed up {COMP_SHOWED} out of 5."
    ),
  },
  {
    beat: "why_it_matters",
    text: guard(
      "loom why",
      "Your AI visibility matters because it is not like anything else you are buying. Meta ads can be like cold calling people at dinner at 9pm. ChatGPT is like selling hot dogs outside the club at 3am. The person is already looking."
    ),
  },
  {
    beat: "three_f",
    text: guard(
      "loom three f",
      "It all comes down to being Findable, Familiar, and staying Fresh. Findable is being consistent everywhere. Familiar means AI recognizes you as an authority, which comes from reviews. But Fresh matters most, since 87 percent of what ChatGPT cites is less than 30 days old."
    ),
  },
  {
    beat: "offer",
    text: guard(
      "loom offer",
      "We can help you do it all for free, or you can do it yourself. If you want to work with us, click the link at the end of your visibility report. It will ask for your email and then walk you through the onboarding agreement."
    ),
  },
  {
    beat: "guarantee",
    text: guard(
      "loom guarantee",
      "And do not worry, you only pay after we get you 5 appointments booked with our system."
    ),
  },
  {
    beat: "value_stack",
    text: guard(
      "loom value stack",
      "Here is how we do it, and these are the same lines you will read in the agreement. We rewrite the pages that need rewriting so ChatGPT can quote them, $2,400 value. We turn happy patients into evidence the AI search engines can quote, $499 a month value. We fix every NAP mismatch across every directory, $800 one time. And we send you the reports monthly so you can see the work that is done, $400 a month value. Total value $4,000 in month one, $3,299 every month after."
    ),
  },
  {
    beat: "clause_two",
    text: guard(
      "loom clause two",
      "Section 2 of the agreement says it plainly. Starting the month after the 5th qualified appointment, your monthly fee becomes $499 a month. No annual contract, cancel with 30 days notice, and you keep everything we built either way."
    ),
  },
  {
    beat: "two_ways",
    text: guard(
      "loom two ways",
      "After you complete the agreement there are two ways to get started. Scroll down and complete the 5 minute intake if you want us to start working today, or book the 5 minute onboarding call and we walk through it live."
    ),
  },
  {
    beat: "after",
    text: guard(
      "loom after",
      "After that we reach out for some basic information about your Google Business Profile. Once we have it we get to work, and we send you updates weekly or monthly, whichever you prefer."
    ),
  },
  {
    beat: "close",
    text: guard(
      "loom close",
      "If this sounds like you, hit the link at the bottom of the report I sent over in the email. If it is not for you, thanks for watching. Any questions, you can reach me right here, my number is 336-833-2303."
    ),
  },
];

/** The whole script as one block, slots unfilled. */
export const LOOM_MEDSPA_SCRIPT = LOOM_MEDSPA_BEATS.map((b) => b.text).join("\n\n");
