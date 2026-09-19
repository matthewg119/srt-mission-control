// The SRT Onboarding AI Ranking Agreement. THE LIVE TEMPLATE, AND THE ONLY COPY OF IT.
//
// ‼️ NOTHING RENDERS A SIGNED DOCUMENT FROM THIS FILE. The variant resolved here is read exactly
// once per signing, by POST /api/onboarding2/start, which freezes it into
// onboarding2_signings.agreement_snapshot. Every screen after that, the PDF, and the grounded
// chatbot all read the SNAPSHOT. That is what lets this file be edited without changing what a
// signature taken last month says. src/lib/onboarding2/agreement-pdf.ts must never import it,
// and scripts/_probe-onboarding2-pdf.ts fails if it does.
//
// ‼️ ASCII ONLY, AND NOT MERELY AS HOUSE STYLE. src/lib/pdf/kit.ts draws with jsPDF's built-in
// standard-14 helvetica and embeds no TTF, so glyph coverage outside the Latin-1 range is not
// something to find out about from a signed contract. The bullet glyph is structural and lives
// in `bullets`. _probe-onboarding2-pdf.ts round-trips the render through unpdf and asserts the
// extracted text equals the canonical text, so this is proven rather than hoped.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ v6 IS THE OFFER SPLIT. ONE DOCUMENT BECAME THREE (2026-09-16, Matthew's call).
//
// There are three offers now and they are not three prices on one deal, they are three different
// arrangements. `year_3300` is paid in full up front and carries a money guarantee. `month_349`
// is month to month with no guarantee and no refund. `review_free` is a real deliverable that
// costs nothing and is not signed at all.
//
// ‼️ THE CURRENT VERSION IS v7, AND IT IS A RENAME, NOT A SECOND SPLIT. The free offer is the AI
// Referral Engine as of 2026-09-19. The split described below is still the structure; only the
// free document's wording moved. See the changelog over VERSION for why all three stamps moved.
//
// ‼️ THE STRUCTURE CHANGED, AND THE REASON IS THAT `page` USED TO LIVE ON THE SECTION.
// In v5 each clause carried its own `n` and `page`, and an IIFE threw if the page numbers skipped
// or ran backwards. That cannot survive variants: a clause shared by two documents needs two page
// numbers and two positions. So `n` and `page` come OFF the clause and the layout decides them.
//
//   SECTIONS   every clause that exists in any variant, once, keyed.
//   VARIANTS   per offer: a title, a preamble, a promise, and PAGES as arrays of section keys.
//   resolveVariant()  flattens that into the { sections, pages } shape buildSnapshot already ate.
//
// The build-time guard did not get weaker, it got stronger. A page gap or a mis-order is now
// UNREPRESENTABLE rather than thrown on, because you cannot express a gap in a nested array.
// What resolveVariant does throw on is a key that is not in SECTIONS and a key used twice in one
// variant, neither of which v5 could catch at all.
//
// ‼️ SECTION KEYS ARE STILL FOREVER, AND THAT IS WHY THERE ARE NEW ONES RATHER THAN REUSED ONES.
// onboarding2_initials.section_key and every frozen initials_snapshot reference these strings. The
// rule is "never RENAMED", not "no new keys". So where a clause says something different under a
// different offer it gets a DIFFERENT KEY: fee_yearly and fee_monthly, not one `fee` carrying two
// texts. A stored row must stay self-describing forever, and `after_five` meaning "$499 after the
// 5th appointment" on one row and "$3,300 billed annually" on another would end that.
//
// RETIRED WITH v5, still readable on every row that used them, never to be reused:
//   what_we_do, client_booking, after_five, guarantee, exclusivity, termination, governing_law
// CARRIED FORWARD UNCHANGED (same key, same text, both paid variants):
//   client_reviews, confidentiality, whole_deal
// CARRIED FORWARD, TEXT EDITED:
//   communication (the SMS Live Agent lost its $199 figure to the Concierge)
//
// ‼️ THE OFFER IS INSIDE THE HASH, AND THAT TOOK A DELIBERATE CHOICE.
// canonicalDocument() hashes title, preamble, promise, sections, closing and footer. It does NOT
// hash `version`, and adding `offer` to it would change the joining rule, which canonical.ts
// forbids ("bump it and keep the old branch rather than editing the rule in place"). So the
// variant is bound in through TEXT THAT IS ALREADY HASHED: the preamble says which plan this is
// and the footer says which template version. verifySnapshot() then catches a tampered offer for
// free, no rule changed, and every v5 snapshot still verifies byte for byte.
//
// ‼️ FOUR THINGS DECIDED HERE THAT ARE NOT OBVIOUS FROM THE TEXT:
//
//  1. THE FREE VARIANT IS ONE PAGE AND IT IS NEVER SHOWN TO ANYBODY. Matthew's call was "no
//     contract, straight to onboarding", and that is what the funnel does: `review_free` renders
//     no agreement screen and takes no signature. But onboarding2_signings.agreement_snapshot is
//     NOT NULL and a free lead still needs a row, because the session token, the chat, the lead
//     and the attribution all hang off it. The alternative was a zero-section snapshot, and that
//     is dangerous: missingSections(rows, []) returns [], so an empty document would walk through
//     the coverage check at /sign with no initials at all. One honest page of service terms fills
//     the column, keeps every downstream reader working, and is the truthful answer to "what did
//     this row freeze". /sign also now refuses a sectionless snapshot outright.
//
//  2. THE MONTH-ONE VALUE TOTAL IS GONE AND THE RECURRING ONE IS COMPOSED. v5 hardcoded "$4,000
//     in month one, $3,299 every month after". Both numbers are now wrong: the Concierge was
//     priced into OFFER_INCLUDES on 2026-09-16 so the recurring stack is $3,498, and
//     VALUE_MONTH_ONE in pitch.ts is still null precisely because the month-one figure has never
//     reconciled to its line items. The recurring total is read from VALUE_RECURRING instead of
//     retyped, so it cannot drift again.
//
//  3. THE NEW client_implementation CLAUSE IS NARROW ON PURPOSE. Matthew asked that clients "do
//     what we tell them", naming the how-did-you-hear-about-us question and future written
//     suggestions. An open obligation to follow any future instruction is both hard to enforce and
//     reads badly to somebody about to sign. So it is shaped like client_reviews and
//     client_booking, which is the pattern this document already uses for client obligations: one
//     NAMED, SPECIFIC requirement that carries real weight, plus reasonable cooperation on written
//     recommendations, with the same consequence the other two carry. No penalty, no fee, we can
//     pause the ongoing work. Same teeth, and defensible.
//
//  4. THE LIABILITY CAP IS THREE MONTHS OF SERVICE, VALUED FROM THE CLIENT'S SIDE. v5 capped at
//     "the total amount you've paid us in the previous 3 months, which starts at $0 until we hit
//     the 5-appointment mark". The trailing clause is dead for both offers, and on a year paid up
//     front the formula reads as $3,300 in months 1 to 3 and $0 from month 4 onward, which is a
//     cliff a claimant would notice. Matthew's call, 2026-09-16: the cap is the value of three
//     months, so $825 on the yearly plan, being $275 x 3. Monthly genuinely is what they paid in
//     the last three months, so it keeps that formula without the dead clause.
//
// ‼️ THE 87 PERCENT FRESHNESS FIGURE IS STILL IN client_reviews AND config/pitch.ts STILL
// SUPPRESSES IT. FRESHNESS_STAT is null there, with a header explaining that nothing in this repo
// sources the number. Matthew approved the figure for this document on 2026-09-03 and it is his to
// approve. The two disagree, and that is recorded rather than quietly reconciled.
// ─────────────────────────────────────────────────────────────────────────────
import { guard } from "@/lib/copy-guard";
import {
  GUARANTEE_COUNT,
  GUARANTEE_WINDOW,
  GUARANTEE_WINDOW_DAY,
  OFFER_INCLUDES,
  PRICE_CONCIERGE,
  PRICE_MONTH_AMOUNT,
  PRICE_YEAR_AMOUNT,
  PRICE_YEAR_EQUIV,
  REFUND_AMOUNT,
  VALUE_RECURRING,
  type OfferKey,
} from "@/config/pitch";

/**
 * ‼️ BUMP THIS WHENEVER ANY STRING BELOW CHANGES, INCLUDING PUNCTUATION.
 *
 * It is stamped onto every signing and it is how a reader tells two snapshots apart without
 * diffing 12 kB of text. Storing the full text means old rows keep rendering correctly whether
 * or not anybody remembers to bump it, which is the point, but a version that lies is still
 * worse than one that does not exist.
 *
 * ‼️ IT IS PER VARIANT NOW. Two signings taken the same afternoon under different offers would
 * both have read "v6" and nobody looking at the Slack card, the PDF footer or the internal email
 * could have told them apart, since all three print this string and nothing else about the terms.
 *
 * ‼️ AND IT IS NOT THE THING YOU FILTER ON. It becomes v7-yearly the next time a clause moves, so
 * a query wanting "how many yearly deals closed" would be parsing a version string. That is what
 * the offer_key COLUMN is for. Bumping a version must never require rewriting a query.
 *
 * v4: fourteen sections cut to nine.
 * v5: two client-obligation clauses added at 2 and 3, everything after shifted up by two.
 * v6: one document became three, keyed by offer. `page` moved off the clause onto the layout.
 * v7: the free offer was renamed the AI Referral Engine. Only free_terms changed text, and the
 *     yearly and monthly documents are word for word what they were under v6. Their stamp moved
 *     anyway, because VERSION is shared and a per-variant bump would need three constants to
 *     stay in step by hand, which is the drift this file exists to refuse.
 */
const VERSION = "v7";

export const TEMPLATE_VERSIONS: Record<OfferKey, string> = {
  review_free: `${VERSION}-free`,
  year_3300: `${VERSION}-yearly`,
  month_349: `${VERSION}-monthly`,
};

/**
 * One clause, with no position in it.
 *
 * ‼️ NO `n` AND NO `page`. Both are decided by the variant layout, which is the whole reason this
 * type exists separately from AgreementSection. A clause that knew its own page number could not
 * be shared by two documents that paginate differently.
 */
interface SectionBody {
  key: string;
  heading: string;
  /** Paragraphs above the bullets. */
  body: string[];
  bullets?: string[];
  /** Paragraphs below the bullets. */
  after?: string[];
}

/**
 * A clause AFTER the layout has placed it. This is the shape buildSnapshot and canonicalSection
 * already consume, unchanged from v5, which is why nothing downstream of the snapshot moved.
 */
export interface AgreementSection {
  /** The clause number, the order, and what the coverage check counts. */
  n: number;
  /**
   * Which rendered PAGE this clause sits on.
   *
   * ‼️ DECLARED BY THE LAYOUT, NEVER MEASURED IN THE BROWSER, AND THAT IS WHAT KEEPS THE COVERAGE
   * CHECK HONEST. One initial covers one page, so it covers a RANGE of clauses, and the only thing
   * making that mean something is that the range is fixed here, frozen into the snapshot at POST
   * /start, and hashed as a unit. If a phone were allowed to decide where the page breaks fell, a
   * narrow screen and a wide one would attest to different things under the same name.
   */
  page: number;
  /** Stable id. Rows reference this, so it may never be renamed once anything has signed. */
  key: string;
  heading: string;
  body: string[];
  bullets?: string[];
  after?: string[];
}

const VALUES = Object.fromEntries(OFFER_INCLUDES.map((o) => [o.work, o.value])) as Record<
  string,
  string
>;

/**
 * One of the figures, read off OFFER_INCLUDES by its exact `work` string.
 *
 * It throws rather than returning a blank so that renaming a line item in pitch.ts fails the
 * build here, instead of silently dropping a dollar figure out of a contract.
 */
function value(work: string): string {
  const v = VALUES[work];
  if (!v) {
    throw new Error(
      `[onboarding2-agreement] OFFER_INCLUDES has no entry "${work}". Section 1 cannot be built.`
    );
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CLAUSES. Every one that exists in any variant, once.
// ─────────────────────────────────────────────────────────────────────────────

/** The four deliverable bullets both paid plans share, before the Concierge line. */
const CORE_WORK_BULLETS = [
  `${guard("s1 l1", "Rewrite the key pages of your website so ChatGPT can quote them")} (${value(
    "We re-write your current pages"
  )})`,
  `${guard("s1 l2", "Turn your happy patients into fresh review evidence AI can cite")} (${value(
    "We turn your happy customers into the evidence"
  )})`,
  `${guard(
    "s1 l3",
    "Fix every NAP (Name / Address / Phone) mismatch across every directory we can find you on"
  )} (${value("We fix any NAP mismatches online")})`,
  `${guard(
    "s1 l5",
    "Send you a monthly AI Visibility Report showing your score, your competitors' scores, and what we did that month"
  )} (${value("Your monthly AI Visibility Report")})`,
];

// ‼️ THE CONCIERGE DISCLOSURE. THIS SENTENCE IS THE ONLY PLACE IN THE ENTIRE AGREEMENT THAT SAYS
// WHAT THE WIDGET DOES WITH A PHOTOGRAPH OF SOMEBODY'S FACE. Old section 5 carried it, section 5
// was deleted in v4, and it moved into this bullet then. It must appear in EVERY variant that
// installs the widget. Do not shorten either bullet below without putting the disclosure
// somewhere else first.
const CONCIERGE_DISCLOSURE = guard(
  "s1 disc",
  "It is not a medical device, it does not diagnose or treat, and any facial photo a visitor submits is used only for that analysis and deleted within 24 hours."
);

const CONCIERGE_WHAT = guard(
  "s1 what",
  "Install our AI Skin Concierge tool on your website, an AI-powered skin analysis widget that captures high-intent visitors, delivers personalized skin assessments, and books qualified consultations directly into your calendar."
);

const SECTIONS: Record<string, SectionBody> = {
  // ── What we do, per plan ──────────────────────────────────────────────────
  what_we_do_yearly: {
    key: "what_we_do_yearly",
    heading: guard("s1y h", "What we're doing for you"),
    body: [
      guard(
        "s1y b1",
        "You're joining SRT's AI Visibility Program for clinics. We're going to make your business the one ChatGPT recommends when patients in your area ask for your preferred service. Specifically, we will:"
      ),
    ],
    bullets: [
      ...CORE_WORK_BULLETS,
      `${CONCIERGE_WHAT} ${guard(
        "s1y l4b",
        "On this plan it is included at no extra charge for the full year."
      )} ${CONCIERGE_DISCLOSURE}`,
    ],
    after: [
      `${guard(
        "s1y a1",
        "Total delivered VALUE (not what you pay): "
      )}${VALUE_RECURRING}${guard("s1y a2", " every month.")}`,
    ],
  },

  what_we_do_monthly: {
    key: "what_we_do_monthly",
    heading: guard("s1m h", "What we're doing for you"),
    body: [
      guard(
        "s1m b1",
        "You're joining SRT's AI Visibility Program for clinics. We're going to make your business the one ChatGPT recommends when patients in your area ask for your preferred service. Specifically, we will:"
      ),
    ],
    bullets: [
      ...CORE_WORK_BULLETS,
      // ‼️ THE WIDGET IS OPTIONAL HERE AND THE DISCLOSURE IS NOT. Monthly does not get the
      // Concierge free, so this bullet describes something they may choose to add. The photo
      // sentence stays regardless, because if they do add it we have disclosed it, and if they
      // never do it has cost the document one sentence.
      `${CONCIERGE_WHAT} ${guard(
        "s1m l4b",
        `On this plan the Concierge is optional and billed separately at ${PRICE_CONCIERGE}. Nothing is installed and nothing is charged for it unless you ask us to.`
      )} ${CONCIERGE_DISCLOSURE}`,
    ],
    after: [
      `${guard(
        "s1m a1",
        "Total delivered VALUE (not what you pay), with the Concierge included: "
      )}${VALUE_RECURRING}${guard("s1m a2", " every month.")}`,
    ],
  },

  // ── What we need from you ─────────────────────────────────────────────────
  // ‼️ CARRIED FORWARD FROM v5 WITH THE SAME KEY AND THE SAME TEXT, IN BOTH PAID VARIANTS.
  // It is a pure obligation with no money and no milestone in it, so nothing about which plan
  // was bought changes a word. "the ongoing work described above" is deliberately not a numeric
  // cross-reference: see the v5 note about forward references rotting first.
  client_reviews: {
    key: "client_reviews",
    heading: guard("s2r h", "What we need from you: 5 new patient reviews a month"),
    body: [
      guard(
        "s2r b1",
        "The engine we are building for you runs on fresh evidence. AI systems lean hardest on what was published recently, and roughly 87 percent of what ChatGPT cites is less than 30 days old. A review from last week does more work for you than a review from last year. That is why this is the one thing we cannot do without you: your patients have to be asked, and only your team can ask them."
      ),
      guard(
        "s2r b2",
        "You agree to generate at least 5 new patient reviews per month, on Google or on any platform we agree on together. To make that as close to automatic as we can, here is what we do on our side:"
      ),
    ],
    bullets: [
      guard(
        "s2r l1",
        "Set up the review request automation, so every patient who finishes a visit is asked without your front desk having to remember"
      ),
      guard(
        "s2r l2",
        "Write the request scripts, the follow up wording, and the sentence your team says out loud at checkout"
      ),
      guard(
        "s2r l3",
        "Give your front desk a one tap request link they can send from the counter or from their own phone"
      ),
      guard(
        "s2r l4",
        "Monitor your review profiles weekly and tell you where you stand against the 5 before the month runs out"
      ),
    ],
    after: [
      guard(
        "s2r a1",
        "When you hit the number it is not just a box ticked, it triggers work on our side. We re-scan your AI visibility against the new evidence, push the new reviews out to the profiles and directories that feed AI answers, refresh the structured data on your site so the reviews are machine readable, and the movement shows up in that month's AI Visibility Report."
      ),
      guard(
        "s2r a2",
        "If a month comes up short, nothing happens straight away. You get a 30 day catch up window to make up the difference and we will help you do it. If you fall short two months in a row, we can pause the ongoing work described above until you are back at 5 a month. There is no financial penalty, no fee and no clawback of anything we have already built. The work simply stops until the fuel comes back, and it starts again the month you are back at the number."
      ),
    ],
  },

  client_booking_yearly: {
    key: "client_booking_yearly",
    heading: guard("s3by h", "What we need from you: new patient bookings run through the Concierge"),
    body: [
      guard(
        "s3by b1",
        "As part of what we are doing for you, we install the AI Skin Concierge on your website. We need it to be the primary way a new patient books from your website and from the new pages we write for you. This is the one requirement in this agreement that is not about the work itself. It is about being able to count the work."
      ),
      // ‼️ REWRITTEN FROM v5. The old sentence said "You do not pay us until 5 qualified
      // appointments land", which described the pay-on-performance arrangement that this plan
      // replaces. The counting argument survives intact and is now attached to the refund, which
      // is what actually turns on the count.
      guard(
        "s3by b2",
        "Here is why it matters. The guarantee below is measured in qualified appointments, and an appointment only counts where the patient tells you they found you through AI. If somebody reads a ChatGPT answer, comes to your site and books through a form that never asks the question, nobody ever finds out where they came from. That appointment happened because of this work, and it will not count toward your guarantee."
      ),
      guard(
        "s3by b3",
        "The Concierge asks, and it records the answer in the conversation log with a timestamp. That log is what we both look at in the monthly report. In practice:"
      ),
    ],
    bullets: [...bookingBullets()],
    after: [...bookingAfter("s3by")],
  },

  client_booking_monthly: {
    key: "client_booking_monthly",
    heading: guard("s3bm h", "What we need from you: telling us where new patients came from"),
    body: [
      guard(
        "s3bm b1",
        "This is the one requirement in this agreement that is not about the work itself. It is about being able to see whether the work is landing."
      ),
      // ‼️ NO GUARANTEE ON THIS PLAN, SO THIS CLAUSE CANNOT ARGUE FROM ONE. v5 argued from "you
      // do not pay us until 5 qualified appointments land" and the monthly plan has no such
      // trigger. What survives is the honest reason: a report that cannot see where patients came
      // from cannot tell either of us whether this is working.
      guard(
        "s3bm b2",
        "If somebody reads a ChatGPT answer, comes to your site and books through a form that never asks how they found you, nobody ever finds out where they came from. Your monthly AI Visibility Report is then a list of things we did rather than a picture of what they produced, and neither of us can tell a good month from a bad one."
      ),
      guard(
        "s3bm b3",
        "So we need the question asked, and the answer kept. In practice:"
      ),
    ],
    bullets: [
      guard(
        "s3bm l1",
        "Your intake form, or whatever a new patient fills in, asks how they heard about you"
      ),
      guard(
        "s3bm l2",
        "The answer is recorded rather than read and forgotten, so it can be counted later"
      ),
      guard(
        "s3bm l3",
        "If you add the AI Skin Concierge, it asks the question itself and logs every answer with a timestamp"
      ),
      guard(
        "s3bm l4",
        "You see what it collected and so do we, so neither of us is reconstructing the month from memory"
      ),
    ],
    after: [
      guard(
        "s3bm a1",
        "Nothing is taken away from you. Your existing booking system keeps running exactly as it does today. Returning patients book the way they always have, the phone still rings and gets answered the same way, and your front desk carries on booking from the desk."
      ),
      guard(
        "s3bm a2",
        "If new patients arrive with no record of where they came from, we lose the ability to report on what this is producing. If that goes on two months in a row, we can pause the ongoing work described above until it is being captured again. No penalty and no fee. We simply cannot report on what we cannot see."
      ),
    ],
  },

  // ── NEW IN v6. The implementation clause. ─────────────────────────────────
  // ‼️ NARROW ON PURPOSE. See point 3 of the file header before widening this. The brief was
  // "they need to do what we tell them", and an open obligation to follow any future instruction
  // is the kind of clause that gets struck out in review and sours a signing. One named,
  // specific requirement plus reasonable cooperation is the same pattern client_reviews and
  // client_booking already use, and it carries the same consequence.
  client_implementation: {
    key: "client_implementation",
    heading: guard("s4i h", "What we need from you: putting the recommendations in"),
    body: [
      guard(
        "s4i b1",
        "Most of what we do happens on our side and needs nothing from you. A few things can only be done by whoever controls your website, your booking system and your front desk, and those are the ones that decide whether any of this can be measured."
      ),
      guard(
        "s4i b2",
        "One of them is not optional, because everything else is counted from it:"
      ),
    ],
    bullets: [
      guard(
        "s4i l1",
        "Every form a new patient submits asks how they heard about you, and the answer is stored with the enquiry"
      ),
      guard(
        "s4i l2",
        "That question stays on the form for as long as this agreement runs, and is not removed in a redesign without telling us first"
      ),
      guard(
        "s4i l3",
        "Where we give you wording for it, you use that wording, because the options we offer are what make the answers countable"
      ),
    ],
    after: [
      guard(
        "s4i a1",
        "Beyond that one requirement, we will send you written recommendations from time to time, by email or in a scheduled conversation. Past examples include reactivation campaigns to your existing patient list, installing the AI Skin Concierge, changes to how your booking flow is worded, and which services to put in front of which audience. You agree to give each of them a fair reading and to tell us yes or no within a reasonable time."
      ),
      // ‼️ THE LIMIT IS THE POINT OF THIS PARAGRAPH. Without it the clause above reads as an
      // open instruction to obey, which is not what anybody intends and is not enforceable in
      // any useful way. This says what is actually true: we advise, they decide, and the only
      // consequence of declining is that we cannot be held to results that depended on it.
      guard(
        "s4i a2",
        "You are never obliged to accept a recommendation. They are ours to make and yours to decide on, and declining one costs you no fee and no penalty. What it does mean is that where a result depended on a recommendation you chose not to implement, that result is not something we can be held to. If the attribution question above is removed or never added, the same rule as reviews and bookings applies: we can pause the ongoing work described above until it is back, with no penalty and no clawback of anything already built."
      ),
    ],
  },

  // ── The money ─────────────────────────────────────────────────────────────
  fee_yearly: {
    key: "fee_yearly",
    heading: guard("s5y h", "What you pay"),
    body: [
      guard(
        "s5y b1",
        `Your fee for this agreement is ${PRICE_YEAR_AMOUNT}, covering twelve months from the date you sign. It is due on signing, and the work starts once it is paid. That works out at ${PRICE_YEAR_EQUIV}, and there is nothing else to pay for the rest of the year.`
      ),
      guard("s5y b2", "It covers all of it:"),
    ],
    bullets: [
      guard("s5y l1", "Ongoing page updates, reviews and NAP maintenance"),
      guard("s5y l2", "AI Skin Concierge hosting and improvements, at no extra charge"),
      guard("s5y l3", "Your monthly AI Visibility Report"),
      guard("s5y l4", "No setup fee, no per-page fee and no hidden costs"),
    ],
    after: [
      guard(
        "s5y a1",
        "This is a twelve month arrangement and it is paid once, up front. There is no monthly invoice to watch and no card kept on file."
      ),
    ],
  },

  fee_monthly: {
    key: "fee_monthly",
    heading: guard("s5m h", "What you pay"),
    body: [
      guard(
        "s5m b1",
        `Your fee is ${PRICE_MONTH_AMOUNT} per month, starting on the date you sign. It covers ongoing page updates, reviews, NAP maintenance and your monthly AI Visibility Report.`
      ),
    ],
    bullets: [
      guard("s5m l1", "Billed monthly on the same day each month"),
      guard("s5m l2", "No annual contract, you can cancel with 30 days written notice at any time"),
      guard("s5m l3", "No setup fee and no cancellation fee"),
      guard(
        "s5m l4",
        `The AI Skin Concierge is not included. If you want it, it is ${PRICE_CONCIERGE} on top, and you can add or drop it at any time`
      ),
    ],
    after: [
      // ‼️ SAID HERE, AT THE PRICE, AND NOT LEFT FOR SOMEBODY TO NOTICE LATER. The monthly plan
      // genuinely has no guarantee and no refund, and a buyer who finds that out after signing
      // has been handled badly. There is no guarantee clause in this variant to say it in.
      guard(
        "s5m a1",
        "This plan carries no performance guarantee and no refunds. Months already served are not returned, whatever the reason for leaving. What you keep is everything we built: the pages, the profiles, the review workflow and your data. If you would rather we carried some of that risk, the annual plan does, and you can ask us to move you onto it at any time."
      ),
    ],
  },

  // ── The guarantee. YEARLY ONLY. ───────────────────────────────────────────
  // ‼️ THIS CLAUSE EXISTS IN EXACTLY ONE VARIANT AND MUST NEVER BE ADDED TO THE MONTHLY LAYOUT.
  // Selling a remedy the plan does not carry is the same mistake as promising a return with no
  // mechanism behind it. _probe-onboarding2-price.ts asserts the monthly render contains neither
  // "guarantee" nor "refund".
  guarantee_yearly: {
    key: "guarantee_yearly",
    heading: guard("s6y h", "The guarantee"),
    body: [
      guard(
        "s6y b1",
        `We will bring you ${String(GUARANTEE_COUNT)} qualified appointments inside your first ${GUARANTEE_WINDOW}. If we do not, you get your first 3 months back and we keep working for the rest of the year at no charge.`
      ),
      guard("s6y b2", 'A "qualified appointment" means:'),
    ],
    bullets: [
      // ‼️ VERBATIM FROM v5's `guarantee` SECTION. The test did not change on 2026-09-16, only
      // the count, the window and the remedy did. Do not reword these three: the whole reason
      // the definition is quotable is that it has not moved.
      guard("s3 l1", "A person books an appointment with your business, AND"),
      guard(
        "s3 l2",
        "They tell you (via your intake form, in person, on the phone, or via the AI Skin Concierge conversation logs) that they found you through ChatGPT, an AI recommendation, an AI search, or a similar phrase, AND"
      ),
      guard("s3 l3", "They actually show up"),
    ],
    after: [
      guard(
        "s6y a1",
        "We track qualified appointments together in your monthly AI Visibility Report. You confirm each one. If we disagree on whether a booking qualifies, we default to your judgment, you know your patients."
      ),
      guard(
        "s6y a2",
        `If the count is below ${String(GUARANTEE_COUNT)} on day ${GUARANTEE_WINDOW_DAY}, you tell us and we refund ${REFUND_AMOUNT}, which is the first three months of your fee. You do not have to ask twice and there is nothing to fill in. We then carry on working for the remaining nine months at no further charge, exactly as described above, because the point of this is that you end the year visible rather than that you end it refunded.`
      ),
      guard(
        "s6y a3",
        "Two things pause the clock, and they are the two things only you can do: the 5 reviews a month described above, and new patient bookings running through the Concierge so an appointment can be counted at all. If either stops, the days it is stopped for do not count toward the 90."
      ),
    ],
  },

  // ── Exclusivity, per plan ─────────────────────────────────────────────────
  exclusivity_yearly: {
    key: "exclusivity_yearly",
    heading: guard("s7y h", "Exclusivity in your area"),
    body: [
      guard(
        "s7y b1",
        "Once you're an active client, we won't take on another clinic offering the same primary service within a 10-mile radius of your primary location for as long as you're an active client. On the annual plan this locks in the day you sign and holds for the full twelve months."
      ),
      guard(
        "s7y b2",
        "If the agreement ends, the exclusivity ends and we're free to work with your competitors."
      ),
    ],
  },

  exclusivity_monthly: {
    key: "exclusivity_monthly",
    heading: guard("s7m h", "Exclusivity in your area"),
    body: [
      // ‼️ v5 SAID "Founding members lock this in on signing, not after the 5th appointment."
      // There is no 5th appointment on this plan to contrast against, so the sentence is gone
      // rather than reworded around a milestone that does not exist.
      guard(
        "s7m b1",
        "Once you're an active client, we won't take on another clinic offering the same primary service within a 10-mile radius of your primary location for as long as you're an active client."
      ),
      guard(
        "s7m b2",
        "Because this plan is month to month, the exclusivity is month to month with it. If you cancel, it ends and we're free to work with your competitors."
      ),
    ],
  },

  // ── Carried forward from v5, unchanged, same keys ─────────────────────────
  confidentiality: {
    key: "confidentiality",
    heading: guard("s9 h", "Confidentiality"),
    body: [
      guard(
        "s9 b1",
        "Anything you share with us that isn't already public, your revenue, patient data, internal processes, stays confidential. Same goes the other way: our systems, prompts, scripts, AI Skin Concierge internals, and methods stay confidential."
      ),
    ],
  },

  communication: {
    key: "communication",
    heading: guard("s10 h", "Communication"),
    body: [
      // ‼️ THE SMS LIVE AGENT LOST ITS "(Value: $199/month.)" ON 2026-09-16 AND THAT WAS THE
      // POINT OF THE EDIT. The Concierge is now priced at $199/month in OFFER_INCLUDES, and two
      // different products carrying one figure in one signed document is a question the signer
      // has to stop and ask. Matthew's call: the Concierge takes the number. Do not put this one
      // back. The SMS Live Agent is still offered, it simply is not priced in this document.
      guard(
        "s10 b1",
        "Primary channel for the working relationship is email or WhatsApp, whatever you prefer. We commit to responding to any message from you within one business day. Response speed to leads is on you and your front desk, though we'll help you set up an SMS Live Agent if you want."
      ),
    ],
  },

  // ── Termination, per plan ─────────────────────────────────────────────────
  termination_yearly: {
    key: "termination_yearly",
    heading: guard("s11y h", "Term and termination"),
    body: [
      // ‼️ NO MID-YEAR EXIT, AND THIS IS THE FOUNDER'S DECISION OF 2026-09-16, NOT A DRAFTING
      // CHOICE. The guarantee's remedy is "we keep working for the rest of the year at no
      // charge", which presumes a year that cannot be walked out of. A 30 day exit with money
      // back would make the annual fee a deposit and leave that remedy with nothing to bind to.
      guard(
        "s11y b1",
        "This agreement runs for twelve months from the date you sign. The fee covers that term and is not refundable on cancellation. The one exception is the guarantee above, which is the only circumstance in which money comes back to you, and it comes back without you having to end the agreement to claim it."
      ),
      guard(
        "s11y b2",
        "At the end of the twelve months it does not renew on its own. We will ask you, in writing, before the term ends, and nothing is charged unless you say yes."
      ),
      guard(
        "s11y b3",
        "You can stop the work at any time by telling us in writing, and we will stop. That does not return the fee for the months remaining. On termination the AI Skin Concierge widget is deactivated from your site within 5 business days, and you keep everything else: the pages, the profiles, the review workflow, and all lead and booking data captured during the engagement."
      ),
      guard(
        "s11y b4",
        "If you stop responding to us for 30 straight days after we've requested something we need to keep working, we can pause the engagement without penalty until you come back to us. A pause does not extend the twelve months and does not shorten it."
      ),
    ],
  },

  termination_monthly: {
    key: "termination_monthly",
    heading: guard("s11m h", "Termination"),
    body: [
      guard(
        "s11m b1",
        "Either side can end this agreement at any time, in writing, with 30 days notice. You owe the 30 days and nothing beyond it. There is no cancellation fee and no clawback of anything we have built."
      ),
      guard(
        "s11m b2",
        "Months already served are not refunded. On termination, the AI Skin Concierge widget, if you added it, is deactivated from your site within 5 business days, but you keep all lead and booking data captured during the engagement, along with the pages, the profiles and the review workflow."
      ),
      guard(
        "s11m b3",
        "If you stop responding to us for 30 straight days after we've requested something we need to keep working, we can pause the engagement without penalty until you come back to us."
      ),
    ],
  },

  // ── Governing law and liability, per plan ─────────────────────────────────
  governing_law_yearly: {
    key: "governing_law_yearly",
    heading: guard("s12y h", "Governing law and liability"),
    body: [
      guard(
        "s12y b1",
        "This agreement is governed by the laws of the State of North Carolina. Any dispute goes to mediation first, in Guilford County, before any lawsuit."
      ),
      // ‼️ THE CAP IS THREE MONTHS OF SERVICE, NOT "WHAT YOU PAID IN THE LAST THREE MONTHS".
      // See point 4 of the file header. On a year paid up front the old formula reads as the
      // full fee in months 1 to 3 and zero from month 4, which is a cliff with no justification
      // behind it. Three months of value is the same number all year and it is the same number
      // the guarantee refunds, which is not a coincidence: both are what three months is worth.
      guard(
        "s12y b2",
        `We're not responsible for lost revenue, lost patients, downtime caused by third parties (Google, ChatGPT, Perfect Corp / skin analysis providers, hosting providers), or any indirect damages. Our maximum liability under this agreement is capped at ${REFUND_AMOUNT}, being the value of three months of service at ${PRICE_YEAR_EQUIV}.`
      ),
    ],
  },

  governing_law_monthly: {
    key: "governing_law_monthly",
    heading: guard("s12m h", "Governing law and liability"),
    body: [
      guard(
        "s12m b1",
        "This agreement is governed by the laws of the State of North Carolina. Any dispute goes to mediation first, in Guilford County, before any lawsuit."
      ),
      guard(
        "s12m b2",
        "We're not responsible for lost revenue, lost patients, downtime caused by third parties (Google, ChatGPT, Perfect Corp / skin analysis providers, hosting providers), or any indirect damages. Our maximum liability under this agreement is capped at the total amount you've paid us in the previous 3 months."
      ),
    ],
  },

  whole_deal: {
    key: "whole_deal",
    heading: guard("s14 h", "The whole deal"),
    body: [
      guard(
        "s14 b1",
        "This document is the entire agreement between us. Nothing said in a Loom video, sales call, email, or text supersedes what's written here. Changes have to be in writing, signed by both sides."
      ),
    ],
  },

  // ── The free plan. ONE PAGE, AND NOBODY IS EVER SHOWN IT. ─────────────────
  // ‼️ SEE POINT 1 OF THE FILE HEADER. `review_free` renders no agreement screen and takes no
  // signature: Matthew's call was "no contract, straight to onboarding". This clause exists
  // because agreement_snapshot is NOT NULL and a free lead still needs a signings row to hang a
  // session token, a chat and a lead on. It is the truthful answer to "what terms did this row
  // freeze", and it is a better answer than an empty document, which would walk straight through
  // the coverage check at /sign.
  free_terms: {
    key: "free_terms",
    heading: guard("sf h", "The AI Referral Engine, free of charge"),
    body: [
      guard(
        "sf b1",
        "SRT Agency LLC is setting up a patient review workflow for your clinic at no charge. There is no fee, no card, and no minimum term. You keep everything we build whether or not you ever buy anything from us."
      ),
      guard("sf b2", "What we set up:"),
    ],
    bullets: [
      guard(
        "sf l1",
        "The review request automation, so patients are asked after a visit without your front desk having to remember"
      ),
      guard("sf l2", "The request scripts and the wording your team uses at checkout"),
      guard("sf l3", "A one tap request link your front desk can send from the counter"),
    ],
    after: [
      guard(
        "sf a1",
        "There is no guarantee attached to this and no promise about what it will produce. Either side can stop at any time, for any reason, with no notice and no cost. Anything you share with us that is not already public stays confidential, and the same goes the other way."
      ),
      guard(
        "sf a2",
        "This is governed by the laws of the State of North Carolina. It is not a contract for paid services, and nothing in it obliges either of us to enter one."
      ),
    ],
  },
};

// ‼️ THE YEARLY BOOKING CLAUSE'S SHARED PARTS, IN ONE PLACE.
// Declared after SECTIONS and called from inside it, which works because these are hoisted
// function DECLARATIONS and not const arrows. If either is ever rewritten as a const, it has to
// move above SECTIONS or the object literal will throw at module evaluation.
//
// `prefix` exists so the guard() labels stay unique per variant, which only matters when a
// build fails and the error has to say which document was being built.
function bookingBullets(): string[] {
  return [
    guard(
      "s3b l1",
      "The Concierge is the booking path on your home page, on your treatment pages, and on every new page we write"
    ),
    guard("s3b l2", "A visitor talks to it, gets their skin assessment, and books there and then"),
    guard("s3b l3", "Every booking it takes carries the answer to how they found you, in writing"),
    guard(
      "s3b l4",
      "You see that log and so do we, so neither of us is reconstructing the month from memory"
    ),
  ];
}

function bookingAfter(prefix: string): string[] {
  return [
    guard(
      `${prefix} a1`,
      "Nothing is taken away from you. Your existing booking system keeps running exactly as it does today. Returning patients book the way they always have, the phone still rings and gets answered the same way, and your front desk carries on booking from the desk. This clause is about new patients arriving from an AI answer, and about nothing else."
    ),
    // ‼️ A HANDOFF VERB, NOT AN API WRITE. Nothing in this repo writes an appointment into
    // Vagaro, Boulevard, Mindbody or Zenoti, so "hands the booking straight into your calendar"
    // would be a contractual promise ahead of the build. If those integrations ship, this
    // sentence is where the stronger verb goes, and not before.
    guard(
      `${prefix} a2`,
      "The Concierge works with the booking system you already run. Vagaro, Boulevard, Mindbody and Zenoti are all supported: the Concierge carries the visitor into whichever one you use and the booking is completed there. Nothing changes for your front desk. The appointment shows up in the same calendar they already work from, and nobody has to learn a second system or check a second inbox."
    ),
    guard(
      `${prefix} a3`,
      "If new patient bookings on your website are routed around the Concierge, we lose the record of where those patients came from and we cannot count them toward the guarantee. If that happens two months in a row, the same thing applies as with reviews: we can pause the ongoing work described above until bookings are running through it again. No penalty and no fee. We simply cannot count what we cannot see."
    ),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE VARIANTS. One per offer. `pages` is the document.
// ─────────────────────────────────────────────────────────────────────────────

interface OfferVariant {
  offer: OfferKey;
  templateVersion: string;
  title: string;
  preamble: string[];
  /** Set apart on screen and in the PDF. Empty string where the plan makes no promise. */
  promise: string;
  /** Pages in order. Each page is the section KEYS on it, in order. */
  pages: string[][];
  closing: string[];
  footer: string[];
}

const FOOTER_TAIL = [
  guard("foot 1", "SRT Agency LLC, srtagency.com, Greensboro, NC"),
  guard("foot 3", "This document should be reviewed by a licensed attorney before use in production."),
];

const VARIANTS: Record<OfferKey, OfferVariant> = {
  year_3300: {
    offer: "year_3300",
    templateVersion: TEMPLATE_VERSIONS.year_3300,
    title: guard("t y", "SRT Agency - Onboarding AI Ranking Agreement, Annual Plan"),
    preamble: [
      // ‼️ THIS LINE IS WHAT PUTS THE OFFER INSIDE documentSha256. canonicalDocument() hashes the
      // preamble and does not hash `version` or `offer`, so naming the plan here is what makes a
      // tampered offer_key column fail verifySnapshot(). Do not shorten it to "Version 6".
      guard("pre y version", "Version 6, Annual Plan"),
      guard("pre between", 'Between: SRT Agency LLC ("SRT," "we," "us")'),
      guard("pre and", 'And: [Client Business Legal Name] ("Client," "you")'),
      guard("pre effective", "Effective: [Date of e-signature]"),
    ],
    promise: guard(
      "promise y",
      `${GUARANTEE_COUNT} qualified appointments in your first ${GUARANTEE_WINDOW}, or your first 3 months back and we keep working for the rest of the year.`
    ),
    pages: [
      ["what_we_do_yearly"],
      ["client_reviews", "client_booking_yearly"],
      ["client_implementation", "fee_yearly", "guarantee_yearly"],
      ["exclusivity_yearly", "confidentiality", "communication"],
      ["termination_yearly", "governing_law_yearly", "whole_deal"],
    ],
    closing: [
      guard(
        "close y b1",
        `By signing below, you confirm you have the authority to bind [Client Business Legal Name] to this agreement, that you understand the fee of ${PRICE_YEAR_AMOUNT} is due on signing and covers twelve months, and that you understand the guarantee and its remedy of ${REFUND_AMOUNT}.`
      ),
      guard("close b2", "SRT Agency LLC, Matthew Garcia, CEO"),
    ],
    footer: [FOOTER_TAIL[0], guard("foot y 2", "v7-yearly, twelve sections."), FOOTER_TAIL[1]],
  },

  month_349: {
    offer: "month_349",
    templateVersion: TEMPLATE_VERSIONS.month_349,
    title: guard("t m", "SRT Agency - Onboarding AI Ranking Agreement, Monthly Plan"),
    preamble: [
      guard("pre m version", "Version 6, Month to Month Plan"),
      guard("pre between", 'Between: SRT Agency LLC ("SRT," "we," "us")'),
      guard("pre and", 'And: [Client Business Legal Name] ("Client," "you")'),
      guard("pre effective", "Effective: [Date of e-signature]"),
    ],
    // ‼️ THE MONTHLY PLAN MAKES NO PROMISE AND THIS STRING SAYS SO RATHER THAN BEING BLANK.
    // An empty promise would hash fine and render as a gap the reader has to interpret. Stating
    // the absence is the same discipline FRESHNESS_STAT and QUALIFIED_INQUIRY_DEF use in
    // pitch.ts: a null that says what it is beats a null that looks like a bug.
    promise: guard(
      "promise m",
      "Month to month. Cancel with 30 days notice. No performance guarantee and no refunds."
    ),
    pages: [
      ["what_we_do_monthly"],
      ["client_reviews", "client_booking_monthly"],
      ["client_implementation", "fee_monthly"],
      ["exclusivity_monthly", "confidentiality", "communication"],
      ["termination_monthly", "governing_law_monthly", "whole_deal"],
    ],
    closing: [
      guard(
        "close m b1",
        `By signing below, you confirm you have the authority to bind [Client Business Legal Name] to this agreement, that the fee is ${PRICE_MONTH_AMOUNT} per month, and that you understand this plan carries no performance guarantee and no refunds.`
      ),
      guard("close b2", "SRT Agency LLC, Matthew Garcia, CEO"),
    ],
    footer: [FOOTER_TAIL[0], guard("foot m 2", "v7-monthly, eleven sections."), FOOTER_TAIL[1]],
  },

  review_free: {
    offer: "review_free",
    templateVersion: TEMPLATE_VERSIONS.review_free,
    title: guard("t f", "SRT Agency - AI Referral Engine Service Terms"),
    preamble: [
      guard("pre f version", "Version 7, AI Referral Engine, no charge"),
      guard("pre between", 'Between: SRT Agency LLC ("SRT," "we," "us")'),
      guard("pre and", 'And: [Client Business Legal Name] ("Client," "you")'),
      guard("pre effective", "Effective: [Date of e-signature]"),
    ],
    promise: guard("promise f", "No fee, no card, no minimum term. You keep it either way."),
    pages: [["free_terms"]],
    closing: [
      guard(
        "close f b1",
        "Nothing here is signed and nothing here is charged. These are the terms the AI Referral Engine is provided under."
      ),
      guard("close b2", "SRT Agency LLC, Matthew Garcia, CEO"),
    ],
    footer: [FOOTER_TAIL[0], guard("foot f 2", "v7-free, one section."), FOOTER_TAIL[1]],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION. Layout in, the shape buildSnapshot already eats out.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedAgreement {
  offer: OfferKey;
  templateVersion: string;
  title: string;
  preamble: string[];
  promise: string;
  sections: AgreementSection[];
  pages: Array<{ p: number; sections: AgreementSection[] }>;
  closing: string[];
  footer: string[];
  sectionCount: number;
  pageCount: number;
}

/**
 * Flatten one variant's layout into numbered clauses and pages.
 *
 * ‼️ IT THROWS RATHER THAN RENDERING A BROKEN DOCUMENT, AND IT IS CALLED AT MODULE SCOPE BELOW SO
 * A MISTAKE FAILS `next build` RATHER THAN A SIGNING. Two failures are possible and neither was
 * catchable in v5:
 *
 *   - a key that is not in SECTIONS, which in v5 was simply impossible to write because the
 *     clause and its position were the same object, and which is now the obvious typo;
 *   - the same key twice in one document, which would produce two clauses with one key and make
 *     every onboarding2_initials row referencing it ambiguous forever.
 *
 * The v5 page-gap and mis-order check is gone because a gap cannot be expressed in a nested
 * array. That is a stronger guarantee than throwing on one, not a weaker one.
 */
function resolveVariant(v: OfferVariant): ResolvedAgreement {
  const sections: AgreementSection[] = [];
  const pages: Array<{ p: number; sections: AgreementSection[] }> = [];
  const seen = new Set<string>();

  v.pages.forEach((keys, pageIdx) => {
    const p = pageIdx + 1;
    const onThisPage: AgreementSection[] = [];
    for (const key of keys) {
      const body = SECTIONS[key];
      if (!body) {
        throw new Error(
          `[onboarding2-agreement] variant "${v.offer}" names section "${key}", which is not in SECTIONS.`
        );
      }
      if (seen.has(key)) {
        throw new Error(
          `[onboarding2-agreement] variant "${v.offer}" uses section "${key}" twice. One key is one clause, because onboarding2_initials rows reference it.`
        );
      }
      seen.add(key);
      const resolved: AgreementSection = {
        n: sections.length + 1,
        page: p,
        key: body.key,
        heading: body.heading,
        body: body.body,
        ...(body.bullets ? { bullets: body.bullets } : {}),
        ...(body.after ? { after: body.after } : {}),
      };
      sections.push(resolved);
      onThisPage.push(resolved);
    }
    pages.push({ p, sections: onThisPage });
  });

  if (!sections.length) {
    throw new Error(`[onboarding2-agreement] variant "${v.offer}" resolved to zero sections.`);
  }

  return {
    offer: v.offer,
    templateVersion: v.templateVersion,
    title: v.title,
    preamble: v.preamble,
    promise: v.promise,
    sections,
    pages,
    closing: v.closing,
    footer: v.footer,
    sectionCount: sections.length,
    pageCount: pages.length,
  };
}

/**
 * Every variant, resolved at module scope so a broken layout fails the build.
 *
 * ‼️ THREE RESOLUTIONS MEANS THREE CHANCES TO FAIL `next build`, which is the same protection v5
 * had from its AGREEMENT_PAGES IIFE, applied per document instead of once.
 */
export const RESOLVED: Record<OfferKey, ResolvedAgreement> = {
  review_free: resolveVariant(VARIANTS.review_free),
  year_3300: resolveVariant(VARIANTS.year_3300),
  month_349: resolveVariant(VARIANTS.month_349),
};

/** The one way to get a document. buildSnapshot() is the only caller that should need it. */
export function agreementFor(offer: OfferKey): ResolvedAgreement {
  const r = RESOLVED[offer];
  if (!r) throw new Error(`[onboarding2-agreement] no variant for offer "${offer}"`);
  return r;
}
