// The SRT Onboarding AI Ranking Agreement. THE LIVE TEMPLATE, AND THE ONLY COPY OF IT.
//
// ‼️ NOTHING RENDERS A SIGNED DOCUMENT FROM THIS FILE. This constant is read exactly once per
// signing, by POST /api/onboarding2/start, which freezes it into
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
// ‼️ v4 IS v3 WITH FIVE CLAUSES CUT. Matthew's call, 2026-09-02: "we do not need them signing
// anything about the mechanism. The agreement should say SRT provides a service to X business,
// X business agrees to pay monthly, 30 days notice to cancel."
//
// DELETED: old 4 (what we need from you), 5 (AI Skin Concierge, how it works), 6 (what we won't
// do), 7 (what you own), 11 (if things go wrong).
//
// The nine survivors keep their KEYS and renumber 1 to 9. Keys are referenced by
// onboarding2_initials rows and by every frozen snapshot, so renaming one orphans real data;
// `n` is only the order, so moving it costs nothing.
//
// ‼️ FOUR THINGS THE CUT BROKE, ALL FIXED IN THIS FILE:
//
//  1. Old section 12 (termination) ended with "the 3-month window in Section 11 pauses with it".
//     Section 11 is gone. The sentence now stands alone. A signed contract must never point at a
//     clause that is not in it.
//  2. Old section 11 was doing TWO jobs: a remedy (the 3-month walk-away, mechanism, deleted)
//     and a LIABILITY CAP (kept). Deleting the whole section would have left the agreement with
//     no limitation of liability at all. The cap paragraph is folded into `governing_law`, whose
//     heading becomes "Governing law and liability". That is the standard boilerplate pairing
//     and it keeps the count at nine.
//  3. Old section 5 was the only place the AI Skin Concierge was disclosed, and section 1 still
//     PROMISES to install the widget. Deleting it outright would have left us taking facial
//     photographs on a client's site with no disclosure anywhere. Matthew's call was a short
//     disclosure sentence inside the section 1 bullet rather than a separate addendum: not a
//     medical device, does not diagnose or treat, photos deleted within 24 hours.
//  4. Fourteen of the thirty chatbot FAQs in config/onboarding2.ts cited a deleted clause. Ten
//     are deleted, four are rewritten against surviving text, and every survivor's `section` is
//     re-pointed. That file records which.
//
// ALSO GONE WITH THE CUT, RECORDED HERE BECAUSE NOTHING ELSE NOW SAYS IT:
//  - Old section 7 carried the CASE STUDY PERMISSION ("we keep the right to reference the work
//    in case studies... unless you tell us in writing not to"). The only remaining record of
//    that consent is clients.consent_results, collected at v1 intake step 6.
//  - Old section 4 was the only place the client contractually AGREED to hand over access (GBP,
//    site backend, DNS, the JS snippet) within 3 business days. Delivery now has no contractual
//    hook for access; the token-gated /onboarding intake is the only ask.
// ─────────────────────────────────────────────────────────────────────────────
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ v5 IS v4 WITH TWO CLAUSES ADDED. Matthew's call, 2026-09-03. They are the access hook the
// v4 cut removed, coming back as OBLIGATIONS OF THE CLIENT rather than as a mechanism disclosure.
//
// ADDED, as sections 2 and 3, immediately after "What we're doing for you":
//   2 `client_reviews`  at least 5 new patient reviews a month, what we do to make that easy,
//                       what firing on it triggers on our side, and the shortfall case.
//   3 `client_booking`  new-patient bookings from the website run through the AI Skin Concierge,
//                       because the guarantee only counts an appointment somebody self-reports.
//
// Everything from old 2 onward shifts up by two. KEYS DID NOT MOVE, only `n`, for the reason the
// v4 note gives: onboarding2_initials rows and every frozen snapshot reference keys.
//
// ‼️ FOUR THINGS DECIDED HERE THAT ARE NOT OBVIOUS FROM THE TEXT:
//
//  1. THERE IS NO "GUARANTEE CLOCK" IN THIS DOCUMENT AND THE SHORTFALL CASE DOES NOT INVENT ONE.
//     The brief said both clauses should "pause the guarantee clock". v4 deleted old section 11,
//     which was the only thing that ever bounded the guarantee in time, so the guarantee is now
//     open-ended and there is no clock to stop. A clause that paused one would be pointing at a
//     mechanism that is not in the document, which is exactly the defect the v4 note above
//     records fixing. What pauses instead is OUR ONGOING WORK, which exists, and which section 9
//     already knows how to pause for a client who has gone silent. Matthew chose this reading
//     (option A) on 2026-09-03 over reintroducing a bounded window.
//
//  2. NEITHER NEW CLAUSE CROSS-REFERENCES A SECTION BY NUMBER. They sit BEFORE the guarantee they
//     both talk about, so a numeric reference would be a forward one, and forward numeric
//     references are the thing that rots first when a section is inserted. They say "the
//     guarantee below" and "the ongoing work described above". _probe-onboarding2-chat.ts also
//     bans `Section 10` through `Section 99` anywhere in agreement body text; with eleven
//     sections that ban is now reachable, and descriptive wording steps around it entirely.
//
//  3. THE NEW CLAUSES NAME THE AI SKIN CONCIERGE AND NO SECOND PRODUCT. The brief called the
//     booking mechanism an "AI Appointment Setting Assistant". There is no such thing in this
//     repo: `grep -ri "appointment setting" src/ docs/` is empty, while concierge_configs
//     already carries booking_mode / booking_url / booking_phone and concierge_sessions.outcome
//     already terminates at 'booked'. It is one widget. Matthew's ruling, 2026-09-03: "Appointment
//     Assistant" is SRT's OWN marketing name for it on srtagency.com, and "AI Skin Concierge" is
//     the client-facing name for med spas onboarded here. THIS DOCUMENT IS SIGNED BY MED SPAS, so
//     it says AI Skin Concierge, which is also what the six other clauses referencing it say.
//
//  4. THE INTEGRATION SENTENCE PROMISES A HANDOFF, NOT AN API WRITE. Vagaro, Boulevard, Mindbody
//     and Zenoti are named because the clinic runs one of them, and booking_mode 'link' carries
//     the visitor into it. There is no code in this repo that writes an appointment into any of
//     those four, so "hands the booking straight into your calendar" would be a contractual
//     promise ahead of the build. If those integrations ship, this sentence is where the stronger
//     verb goes, and not before.
//
// ‼️ THE 87 PERCENT FRESHNESS FIGURE IS IN SECTION 2 AND config/pitch.ts STILL SUPPRESSES IT.
// FRESHNESS_STAT is null there, with a header explaining that nothing in this repo sources the
// number, and loom-script.ts prints a warning telling the presenter not to say it from memory.
// Matthew approved the figure for this document on 2026-09-03 and it is his to approve. pitch.ts
// is left alone deliberately: it is modified by another session and is not this session's file.
// The two now disagree, and that is recorded here rather than quietly reconciled.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ THE VALUE ANNOTATIONS IN SECTION 1 ARE COMPOSED FROM OFFER_INCLUDES, NOT RETYPED.
// config/pitch.ts is the only place a figure of ours may live, and its own header records what
// happened the last time a price was copied into a second file. The AI Skin Concierge bullet
// carries no annotation because OFFER_INCLUDES does not price it, and inventing a fifth figure
// to fill the gap is the exact move that file forbids.
//
// ‼️ THE MONTH-ONE TOTAL DOES NOT ADD UP TO THE LINE ITEMS, ON PURPOSE. $2,400 + $499 + $800 +
// $400 is $4,099 and the sentence says $4,000. pitch.ts already knows: VALUE_MONTH_ONE is null
// there precisely so the Loom never says the number out loud. Changing a total inside a document
// people sign is the founder's call and not a tidy-up, so it is left exactly as approved.
import { guard } from "@/lib/copy-guard";
import { OFFER_INCLUDES } from "@/config/pitch";

/**
 * ‼️ BUMP THIS WHENEVER ANY STRING BELOW CHANGES, INCLUDING PUNCTUATION.
 *
 * It is stamped onto every signing and it is how a reader tells two snapshots apart without
 * diffing 12 kB of text. Storing the full text means old rows keep rendering correctly whether
 * or not anybody remembers to bump it, which is the point, but a version that lies is still
 * worse than one that does not exist.
 *
 * v4: fourteen sections cut to nine.
 * v5: two client-obligation clauses added at 2 and 3, everything after shifted up by two.
 */
export const TEMPLATE_VERSION = "v5";

export interface AgreementSection {
  /** 1 to 11. The clause number, the order, and what the coverage check counts. */
  n: number;
  /**
   * Which rendered PAGE this clause sits on. 1 to 5.
   *
   * ‼️ DECLARED HERE, NEVER MEASURED IN THE BROWSER, AND THAT IS WHAT KEEPS THE COVERAGE CHECK
   * HONEST. One initial covers one page, so it covers a RANGE of clauses, and the only thing
   * making that mean something is that the range is fixed by this file, frozen into the snapshot
   * at POST /start, and hashed as a unit. If a phone were allowed to decide where the page breaks
   * fell, a narrow screen and a wide one would attest to different things under the same name.
   *
   * Grouped by how much text each clause actually is, not by count: section 1 is a paragraph,
   * five bullets and a total line, so it holds a page on its own.
   *
   * ‼️ SECTIONS 2 AND 3 SHARE PAGE 2 ON PURPOSE, AND IT IS NOT A PACKING DECISION. They are the
   * two things a client actually pushes back on, and they are one idea: what we need from you.
   * One initial covering both means the signer attested to their own side of the deal as a unit.
   * Splitting them would be a six-page document and a sixth initial for no gain in meaning.
   */
  page: number;
  /** Stable id. Rows reference this, so it may never be renamed once anything has signed. */
  key: string;
  heading: string;
  /** Paragraphs above the bullets. */
  body: string[];
  bullets?: string[];
  /** Paragraphs below the bullets. */
  after?: string[];
}

const VALUES = Object.fromEntries(OFFER_INCLUDES.map((o) => [o.work, o.value])) as Record<
  string,
  string
>;

/**
 * One of the four figures, read off OFFER_INCLUDES by its exact `work` string.
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

export const AGREEMENT_TITLE = guard(
  "agreement title",
  "SRT Agency - Onboarding AI Ranking Agreement"
);

export const AGREEMENT_PREAMBLE: string[] = [
  guard("pre version", "Version 5"),
  guard("pre between", 'Between: SRT Agency LLC ("SRT," "we," "us")'),
  guard("pre and", 'And: [Client Business Legal Name] ("Client," "you")'),
  guard("pre effective", "Effective: [Date of e-signature]"),
];

/** Set apart on screen, and the sentence the whole document is built around. */
export const AGREEMENT_PROMISE = guard(
  "agreement promise",
  "You don't pay us a dollar until ChatGPT sends you 5 new qualified appointments."
);

export const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    n: 1,
    page: 1,
    key: "what_we_do",
    heading: guard("s1 h", "What we're doing for you"),
    body: [
      guard(
        "s1 b1",
        "You're joining SRT's AI Visibility Program for clinics. We're going to make your business the one ChatGPT recommends when patients in your area ask for your preferred service. Specifically, we will:"
      ),
    ],
    bullets: [
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
      // ‼️ THE SECOND SENTENCE IS THE ONLY CONCIERGE DISCLOSURE IN THE WHOLE AGREEMENT.
      // Old section 5 carried it and section 5 is gone, but this bullet still promises to
      // install the widget on their site, and the widget takes photographs of people's faces.
      // Do not shorten this bullet without putting the disclosure somewhere else first.
      guard(
        "s1 l4",
        "Install our AI Skin Concierge tool on your website, an AI-powered skin analysis widget that captures high-intent visitors, delivers personalized skin assessments, and books qualified consultations directly into your calendar. It is not a medical device, it does not diagnose or treat, and any facial photo a visitor submits is used only for that analysis and deleted within 24 hours."
      ),
      `${guard(
        "s1 l5",
        "Send you a monthly AI Visibility Report showing your score, your competitors' scores, and what we did that month"
      )} (${value("Your monthly AI Visibility Report")})`,
    ],
    after: [
      guard(
        "s1 a1",
        "Total delivered VALUE (not actual retainer fee): $4,000 in month one, $3,299 every month after."
      ),
    ],
  },
  {
    // NEW IN v5. The first half of the access hook the v4 cut removed.
    //
    // ‼️ THE 87 PERCENT FIGURE IN b1 IS THE ONLY UNSOURCED STATISTIC IN THIS DOCUMENT, AND
    // config/pitch.ts DELIBERATELY REFUSES TO SAY IT. See the v5 note in the file header. It is
    // here on Matthew's express approval, 2026-09-03, and it is the one string in this file that
    // a client could go and check against a source we do not hold.
    n: 2,
    page: 2,
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
      // ‼️ "THE ONGOING WORK DESCRIBED ABOVE", NOT "THE GUARANTEE CLOCK". There is no clock in
      // this document to pause. See point 1 of the v5 note in the file header before changing
      // this sentence, and do not replace it with a numeric cross-reference.
      guard(
        "s2r a2",
        "If a month comes up short, nothing happens straight away. You get a 30 day catch up window to make up the difference and we will help you do it. If you fall short two months in a row, we can pause the ongoing work described above until you are back at 5 a month. There is no financial penalty, no fee and no clawback of anything we have already built. The work simply stops until the fuel comes back, and it starts again the month you are back at the number."
      ),
    ],
  },
  {
    // NEW IN v5. The second half of the access hook, and the reason the guarantee is countable.
    //
    // ‼️ IT SAYS AI SKIN CONCIERGE AND IT NAMES NO SECOND PRODUCT. See point 3 of the v5 note.
    n: 3,
    page: 2,
    key: "client_booking",
    heading: guard("s3b h", "What we need from you: new patient bookings run through the Concierge"),
    body: [
      guard(
        "s3b b1",
        "As part of what we are doing for you, we install the AI Skin Concierge on your website. We need it to be the primary way a new patient books from your website and from the new pages we write for you. This is the one requirement in this agreement that is not about the work itself. It is about being able to count the work."
      ),
      guard(
        "s3b b2",
        "Here is why it matters. You do not pay us until 5 qualified appointments land, and the guarantee below only counts an appointment where the patient tells you they found you through AI. If somebody reads a ChatGPT answer, comes to your site and books through a form that never asks the question, nobody ever finds out where they came from. That appointment happened because of this work, and it will not count. That costs you, not us."
      ),
      guard(
        "s3b b3",
        "The Concierge asks, and it records the answer in the conversation log with a timestamp. That log is what we both look at in the monthly report. In practice:"
      ),
    ],
    bullets: [
      guard(
        "s3b l1",
        "The Concierge is the booking path on your home page, on your treatment pages, and on every new page we write"
      ),
      guard(
        "s3b l2",
        "A visitor talks to it, gets their skin assessment, and books there and then"
      ),
      guard(
        "s3b l3",
        "Every booking it takes carries the answer to how they found you, in writing"
      ),
      guard(
        "s3b l4",
        "You see that log and so do we, so neither of us is reconstructing the month from memory"
      ),
    ],
    after: [
      guard(
        "s3b a1",
        "Nothing is taken away from you. Your existing booking system keeps running exactly as it does today. Returning patients book the way they always have, the phone still rings and gets answered the same way, and your front desk carries on booking from the desk. This clause is about new patients arriving from an AI answer, and about nothing else."
      ),
      // ‼️ A HANDOFF VERB, NOT AN API WRITE. See point 4 of the v5 note. Nothing in this repo
      // writes an appointment into Vagaro, Boulevard, Mindbody or Zenoti.
      guard(
        "s3b a2",
        "The Concierge works with the booking system you already run. Vagaro, Boulevard, Mindbody and Zenoti are all supported: the Concierge carries the visitor into whichever one you use and the booking is completed there. Nothing changes for your front desk. The appointment shows up in the same calendar they already work from, and nobody has to learn a second system or check a second inbox."
      ),
      guard(
        "s3b a3",
        "If new patient bookings on your website are routed around the Concierge, we lose the record of where those patients came from and we cannot count them toward the 5. If that happens two months in a row, the same thing applies as with reviews: we can pause the ongoing work described above until bookings are running through it again. No penalty and no fee. We simply cannot count what we cannot see."
      ),
    ],
  },
  {
    // Was 2 in v4.
    n: 4,
    page: 3,
    key: "after_five",
    heading: guard("s2 h", "Once we hit 5 qualified appointments"),
    body: [
      guard(
        "s2 b1",
        "Starting the month after the 5th qualified appointment, your monthly fee becomes $499/month. This covers ongoing page updates, reviews, NAP maintenance, AI Skin Concierge hosting and improvements, and the monthly report."
      ),
    ],
    bullets: [
      guard("s2 l1", "Billed monthly on the same day each month"),
      guard("s2 l2", "No annual contract, you can cancel with 30 days written notice at any time"),
      guard("s2 l3", "No cancellation fee, no clawback of the free work"),
    ],
  },
  {
    // Was 3 in v4.
    n: 5,
    page: 3,
    key: "guarantee",
    heading: guard("s3 h", "The guarantee, you don't pay us until we deliver"),
    body: [
      guard(
        "s3 b1",
        "You do not owe SRT a single dollar until ChatGPT sends you 5 new qualified appointments."
      ),
      guard("s3 b2", 'A "qualified appointment" means:'),
    ],
    bullets: [
      guard("s3 l1", "A person books an appointment with your business, AND"),
      guard(
        "s3 l2",
        "They tell you (via your intake form, in person, on the phone, or via the AI Skin Concierge conversation logs) that they found you through ChatGPT, an AI recommendation, an AI search, or a similar phrase, AND"
      ),
      guard("s3 l3", "They actually show up"),
    ],
    after: [
      guard(
        "s3 a1",
        "We track qualified appointments together in your monthly AI Visibility Report. You confirm each one. If we disagree on whether a booking qualifies, we default to your judgment, you know your patients."
      ),
      guard(
        "s3 a2",
        "Until the 5th qualified appointment lands, you owe nothing. No setup fee, no monthly fee, no hidden costs."
      ),
    ],
  },
  {
    // Was 8 in v3, 4 in v4.
    n: 6,
    page: 4,
    key: "exclusivity",
    heading: guard("s8 h", "Exclusivity in your area"),
    body: [
      guard(
        "s8 b1",
        "Once you're an active client, we won't take on another clinic offering the same primary service within a 10-mile radius of your primary location for as long as you're an active client. Founding members lock this in on signing, not after the 5th appointment."
      ),
      guard(
        "s8 b2",
        "If you cancel, the exclusivity ends and we're free to work with your competitors."
      ),
    ],
  },
  {
    // Was 9 in v3, 5 in v4.
    n: 7,
    page: 4,
    key: "confidentiality",
    heading: guard("s9 h", "Confidentiality"),
    body: [
      guard(
        "s9 b1",
        "Anything you share with us that isn't already public, your revenue, patient data, internal processes, stays confidential. Same goes the other way: our systems, prompts, scripts, AI Skin Concierge internals, and methods stay confidential."
      ),
    ],
  },
  {
    // Was 10 in v3, 6 in v4.
    n: 8,
    page: 4,
    key: "communication",
    heading: guard("s10 h", "Communication"),
    body: [
      guard(
        "s10 b1",
        "Primary channel for the working relationship is email or WhatsApp, whatever you prefer. We commit to responding to any message from you within one business day. Response speed to leads is on you and your front desk, though we'll help you set up an SMS Live Agent if you want. (Value: $199/month.)"
      ),
    ],
  },
  {
    // Was 12 in v3, 7 in v4.
    n: 9,
    page: 5,
    key: "termination",
    heading: guard("s12 h", "Termination"),
    body: [
      guard(
        "s12 b1",
        "Either side can end this agreement at any time, in writing, with 30 days notice. If you terminate before the 5-appointment threshold, you owe nothing. If you terminate after, you owe your final month prorated. On termination, the AI Skin Concierge widget is deactivated from your site within 5 business days, but you keep all lead and booking data captured during the engagement."
      ),
      // ‼️ THIS SENTENCE USED TO END "and the 3-month window in Section 11 pauses with it".
      // Section 11 was deleted in v4. It now stands alone. Do not reintroduce a cross-reference
      // to a clause that is not in the document.
      guard(
        "s12 b2",
        "If you stop responding to us for 30 straight days after we've requested something we need to keep working, we can pause the engagement without penalty until you come back to us."
      ),
    ],
  },
  {
    // Was 13 in v3, 8 in v4. The liability cap from old section 11 is folded in here.
    n: 10,
    page: 5,
    key: "governing_law",
    heading: guard("s13 h", "Governing law and liability"),
    body: [
      guard(
        "s13 b1",
        "This agreement is governed by the laws of the State of North Carolina. Any dispute goes to mediation first, in Guilford County, before any lawsuit."
      ),
      // ‼️ THE LIABILITY CAP, MOVED HERE FROM OLD SECTION 11 SO IT SURVIVED THE CUT.
      // Verbatim from v3 apart from its opening sentence, "That's the extent of our liability",
      // which referred to the 3-month remedy that was deleted with the rest of that section.
      guard(
        "s13 b2",
        "We're not responsible for lost revenue, lost patients, downtime caused by third parties (Google, ChatGPT, Perfect Corp / skin analysis providers, hosting providers), or any indirect damages. Our maximum liability under this agreement is capped at the total amount you've paid us in the previous 3 months, which starts at $0 until we hit the 5-appointment mark."
      ),
    ],
  },
  {
    // Was 14 in v3, 9 in v4.
    n: 11,
    page: 5,
    key: "whole_deal",
    heading: guard("s14 h", "The whole deal"),
    body: [
      guard(
        "s14 b1",
        "This document is the entire agreement between us. Nothing said in a Loom video, sales call, email, or text supersedes what's written here. Changes have to be in writing, signed by both sides."
      ),
    ],
  },
];

/** Above the signature fields. Not initialled, but hashed into the document like everything else. */
export const AGREEMENT_CLOSING: string[] = [
  guard(
    "close b1",
    "By signing below, you confirm you have the authority to bind [Client Business Legal Name] to this agreement and that you understand the guarantee: no payment until ChatGPT sends you 5 new qualified appointments."
  ),
  guard("close b2", "SRT Agency LLC, Matthew Garcia, CEO"),
];

export const AGREEMENT_FOOTER: string[] = [
  guard("foot 1", "SRT Agency LLC, srtagency.com, Greensboro, NC"),
  guard("foot 2", "v5, eleven sections."),
  guard(
    "foot 3",
    "This document should be reviewed by a licensed attorney before use in production."
  ),
];

/** 11. The coverage check at signature counts against this and nothing else. */
export const AGREEMENT_SECTION_COUNT = AGREEMENT_SECTIONS.length;

/**
 * The pages, derived from `page` above and never declared twice.
 *
 * ‼️ IT THROWS ON A GAP OR A MIS-ORDER RATHER THAN RENDERING ONE. A page grouping that skipped a
 * number, or put section 5 on page 2 and section 4 on page 3, would produce a document whose page
 * hashes cover the right text in the wrong order, and nothing downstream would notice: the
 * coverage check would still pass, because every section number would still be covered. Failing
 * `next build` is the only place that is cheap to catch.
 */
export const AGREEMENT_PAGES: Array<{ p: number; sections: AgreementSection[] }> = (() => {
  const out: Array<{ p: number; sections: AgreementSection[] }> = [];
  for (const s of AGREEMENT_SECTIONS) {
    const last = out[out.length - 1];
    if (last && last.p === s.page) {
      last.sections.push(s);
      continue;
    }
    if (last && s.page !== last.p + 1) {
      throw new Error(
        `[onboarding2-agreement] section ${s.n} is on page ${s.page}, after page ${last.p}. ` +
          `Pages must run 1..N in section order with no gaps.`
      );
    }
    if (!last && s.page !== 1) {
      throw new Error(`[onboarding2-agreement] the first section must be on page 1, not ${s.page}.`);
    }
    out.push({ p: s.page, sections: [s] });
  }
  return out;
})();

/** 5. How many times a signer types their initials. */
export const AGREEMENT_PAGE_COUNT = AGREEMENT_PAGES.length;
