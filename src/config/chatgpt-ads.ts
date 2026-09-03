// Every string and every option on /chatgpt-ads, in one file.
//
// WHY A CONFIG FILE AND NOT JSX. The funnel branches on answers in three places (the
// revenue router, the website-host reveal, and the three paths), and the Slack card
// re-renders the same answers server side. A label that lives in the component and is
// compared against a copy of itself in the route is a rule that silently stops firing.
// src/config/onboarding-free.ts learned this the hard way and says so at the top.
//
// THE FIX HERE GOES ONE STEP FURTHER THAN THAT FILE. onboarding-free exports its answer
// LABELS as constants and branches on them, so editing a label is still a code change in
// two places. This file gives every option a stable `value` id that never changes and a
// `label` that is free to be reworded. Nothing downstream, in the client, the route, the
// Slack card or the database check constraint, ever sees a label.
//
// PRICE COMES FROM pitch.ts. It is the only price figure that exists anywhere and it
// drives the Loom script, the call script and both emails at the same time. A number
// typed here would be a fourth copy, which is exactly how src/app/v2/page.tsx quoted
// $299 for months. pitch.ts imports one TYPE and nothing else, so it is safe in the
// browser bundle.
//
// EVERY VISIBLE STRING GOES THROUGH guard(). It throws at module evaluation, so an em
// dash pasted out of the spec fails `next build` rather than shipping.

import { guard } from "@/lib/copy-guard";
import { FREE_UNTIL_LINE, PRICE_RETAINER } from "@/config/pitch";

// ---------------------------------------------------------------------------
// Types
//
// Deliberately NOT reusing QuestionDef from onboarding-free.ts. That type carries
// `options: string[]` and branches on the label, which is the thing this file exists to
// avoid, and widening it would touch every screen of a live funnel to serve one new page.
// The same reasoning onboarding-free itself gives for not widening client-intake's
// FieldDef.
// ---------------------------------------------------------------------------

export interface OptionDef {
  /** Stable id. Stored, branched on, and written to the database. Never reworded. */
  value: string;
  /** What the visitor reads. Free to change without touching anything else. */
  label: string;
  /**
   * Reveal a dropdown when this option is picked, and do not advance until it is answered.
   *
   * Only Q6 uses it: "Hosted on Wix / Squarespace / ..." is one answer with a second half,
   * not five separate options, because the access answer and the platform answer are read
   * by different people for different reasons.
   */
  reveal?: { key: string; label: string; options: string[] };
}

export interface QuestionDef {
  key: string;
  title: string;
  help?: string;
  kind: "choice" | "multichoice";
  options: OptionDef[];
  /** multichoice only. At least one has to be picked. */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Q1, the revenue router
//
// The ids are the same five as srt-agwb/funnel.js REVENUE, character for character, and
// the cut is in the same place. The same person can land on / and on this page in the
// same week, and two funnels that bucket revenue differently produce two contradictory
// records for one clinic. If that list ever moves, this one moves with it.
// ---------------------------------------------------------------------------

export const REVENUE: OptionDef[] = [
  { value: "0-10k", label: guard("rev 0-10k", "Less than $10k / month") },
  { value: "10-20k", label: guard("rev 10-20k", "$10k to $20k / month") },
  { value: "20-50k", label: guard("rev 20-50k", "$20k to $50k / month") },
  { value: "50-100k", label: guard("rev 50-100k", "$50k to $100k / month") },
  { value: "100k+", label: guard("rev 100k+", "More than $100k / month") },
];

/** Only the bottom bucket takes the wedge. Same cut as funnel.js DQ. */
export const UNDER_10K = "0-10k";

export type Branch = "under_10k" | "over_10k";

export function branchFor(revenue: string): Branch {
  return revenue === UNDER_10K ? "under_10k" : "over_10k";
}

export const REVENUE_QUESTION: QuestionDef = {
  key: "revenue",
  title: guard("q1 title", "Roughly what is the clinic doing a month?"),
  help: guard(
    "q1 help",
    "This decides what we can actually do for you. There is no wrong answer, and nobody sees it but us."
  ),
  kind: "choice",
  options: REVENUE,
};

// ---------------------------------------------------------------------------
// Branch B, $10k and up. Five screens, then the paths.
//
// TENURE AND AGENCY HISTORY WERE DELETED HERE on 2026-08-31, on the founder's call, and
// the deletion is the point of the rebuild: the funnel has to be short enough to run at
// volume. They are not temporarily removed. Do not reintroduce them, and do not create
// the tenure or agency_history columns that used to hold them.
//
// Q5 and Q6 are OPS questions, not qualifying ones. Nothing is disqualified by the
// answer. They exist so the Slack card can say, before anyone picks up the phone,
// whether this is an install that can start on Monday or a conversation with somebody
// else's agency first.
// ---------------------------------------------------------------------------

export const BRANCH_B_QUESTIONS: QuestionDef[] = [
  {
    key: "channels",
    title: guard("q2 title", "Where do your patients come from today?"),
    help: guard("q2 help", "Pick everything that brings you real bookings."),
    kind: "multichoice",
    required: true,
    options: [
      { value: "instagram", label: guard("ch ig", "Instagram") },
      { value: "facebook", label: guard("ch fb", "Facebook") },
      { value: "tiktok", label: guard("ch tt", "TikTok") },
      { value: "google", label: guard("ch google", "Google search") },
      { value: "referrals", label: guard("ch ref", "Referrals and word of mouth") },
      { value: "paid_ads", label: guard("ch ads", "Paid ads") },
      { value: "walk_ins", label: guard("ch walk", "Walk ins") },
      { value: "other", label: guard("ch other", "Something else") },
    ],
  },
  {
    key: "patient_volume",
    title: guard("q3 title", "How many new patients do you see in a month?"),
    kind: "choice",
    options: [
      { value: "0-10", label: guard("vol a", "Fewer than 10") },
      { value: "10-25", label: guard("vol b", "10 to 25") },
      { value: "25-50", label: guard("vol c", "25 to 50") },
      { value: "50+", label: guard("vol d", "More than 50") },
    ],
  },
  {
    key: "one_service",
    title: guard("q4 title", "If you could fill one service, which one?"),
    help: guard("q4 help", "The one with the best margin, or the one sitting empty."),
    kind: "choice",
    options: [
      { value: "injectables", label: guard("svc inj", "Injectables, Botox and filler") },
      { value: "laser", label: guard("svc laser", "Laser and skin resurfacing") },
      { value: "body", label: guard("svc body", "Body contouring") },
      { value: "weight_loss", label: guard("svc glp", "Weight loss and GLP-1") },
      { value: "hormones", label: guard("svc hrt", "Hormones and wellness") },
      { value: "other", label: guard("svc other", "Something else") },
    ],
  },
  {
    key: "gbp_access",
    title: guard(
      "q5 title",
      "Quick ops question, do you have access to your Google Business Profile?"
    ),
    kind: "choice",
    options: [
      { value: "full_access", label: guard("gbp full", "Yes, full access") },
      {
        value: "stale_access",
        label: guard("gbp stale", "Access but I have not touched it in a while"),
      },
      {
        value: "agency_or_employee",
        label: guard("gbp agency", "An agency or employee manages it"),
      },
      { value: "unsure", label: guard("gbp unsure", "Not sure how to check") },
    ],
  },
  {
    key: "website_access",
    title: guard("q6 title", "And your website, who has the keys?"),
    kind: "choice",
    options: [
      { value: "owner_full", label: guard("web owner", "I built it, I have full access") },
      {
        value: "host_full",
        label: guard("web host", "It is on a website builder and I have full access"),
        reveal: {
          key: "website_host",
          label: guard("web host label", "Which one?"),
          options: ["Wix", "Squarespace", "WordPress", "Shopify", "Other"],
        },
      },
      {
        value: "agency_managed",
        label: guard("web agency", "An agency built and manages it"),
      },
      { value: "unsure", label: guard("web unsure", "Not sure") },
    ],
  },
];

/** Every question in branch order, for the progress bar and for server-side re-checking. */
export const ALL_QUESTIONS: QuestionDef[] = [REVENUE_QUESTION, ...BRANCH_B_QUESTIONS];

export function questionsFor(branch: Branch | null): QuestionDef[] {
  if (branch === "under_10k") return [REVENUE_QUESTION];
  return ALL_QUESTIONS;
}

/** Is `value` a real option id for `key`? The route re-checks every answer with this. */
export function isValidAnswer(key: string, value: string): boolean {
  const q = ALL_QUESTIONS.find((x) => x.key === key);
  if (!q) return false;
  return q.options.some((o) => o.value === value);
}

export function labelFor(key: string, value: string): string {
  const q = ALL_QUESTIONS.find((x) => x.key === key);
  return q?.options.find((o) => o.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export const HERO = {
  /** Used when ?score= is present. {score} is replaced, nothing else is. */
  headingWithScore: guard("hero h score", "Your ChatGPT Visibility Score: {score}/100"),
  headingGeneric: guard("hero h generic", "Your AI Visibility Audit"),
  sub: guard(
    "hero sub",
    "You do not pay us a dollar until ChatGPT sends you 5 new qualified appointments."
  ),
  scrollCue: guard("hero scroll", "Scroll to get started"),
  /** Shown under the video only when we know who they are and who was named instead. */
  gapLine: guard(
    "hero gap",
    "You showed up in {user} of 5 answers. {competitor} showed up in {comp}."
  ),
  noVideo: guard(
    "hero no video",
    "Your walkthrough video is being cut. Start below and we will send it over."
  ),
} as const;

export const LOOM_EMBED_URL = process.env.NEXT_PUBLIC_LOOM_EMBED_URL || null;

// ---------------------------------------------------------------------------
// Stage 1
// ---------------------------------------------------------------------------

export const INTAKE = {
  heading: guard("intake h", "Let us see what we can do about that."),
  body: guard("intake body", "Three things and you are through. It takes about a minute."),
  website: guard("intake website", "Your clinic website"),
  email: guard("intake email", "Email"),
  phone: guard("intake phone", "Mobile"),
  cta: guard("intake cta", "Continue"),
  fine: guard(
    "intake fine",
    "We call about your report. By continuing you accept the terms. No card, nothing to sign."
  ),
} as const;

// ---------------------------------------------------------------------------
// Branch A, under $10k. The review wedge.
//
// THIS IS NOT A REJECTION SCREEN AND MUST NOT READ AS ONE. srt-agwb's downsell says "at
// your size the paid build is not the right fit yet", which is true and which the founder
// approved there. Here they have just watched a video about their own score, so the same
// sentence lands as a bait and switch. The offer is a smaller real thing instead.
// ---------------------------------------------------------------------------

export const WEDGE = {
  heading: guard("wedge h", "Start with the free piece."),
  body: guard(
    "wedge body",
    "Straight with you: at your size the full build is more than you need right now. What moves the needle first is your reviews, because between 84 and 89% of what AI repeats about a clinic comes from third-party sources, not from your own site. We will set up review management for you at no cost, and when you are ready for the rest it is here."
  ),
  cta: guard("wedge cta", "Book the free setup call"),
  fine: guard("wedge fine", "About 15 minutes. No card, nothing to sign."),
} as const;

// ---------------------------------------------------------------------------
// Q7, the three paths. Ordered by speed, because the video just said "want it faster".
// ---------------------------------------------------------------------------

export const PATHS = {
  heading: guard("paths h", "How do you want to start?"),
  help: guard("paths help", "All three get you to the same place. Pick whichever suits you."),
  callNow: {
    label: guard("path call", "Call Me Now"),
    sub: guard("path call sub", "Jimmy calls you within 5 minutes"),
  },
  book: {
    label: guard("path book", "Book onboarding call (Today or Tomorrow)"),
    sub: guard("path book sub", "15-min walkthrough on Zoom"),
  },
  self: {
    label: guard("path self", "I have got 5 min now, start me myself"),
  },
} as const;

export type SignupPath = "call_me_now" | "booked_call" | "self_intake" | "incomplete";

// ---------------------------------------------------------------------------
// Call Me Now
//
// NOTHING HERE MAY SAY WE TEXTED THEM. There is no SMS transport in this app: the only
// outbound texting is iMessage through src/lib/imessage-transport.ts, which reaches
// iPhones and silently reaches nothing else, and Twilio would need A2P 10DLC brand and
// campaign registration first. The v1 spec's two SMS sends were cut for exactly that
// reason. A confirmation screen that claims a text was sent is a promise the product
// cannot keep, and the person is sitting there watching for it.
// ---------------------------------------------------------------------------

export const CALL_SECONDS = 60;

export const CALLING = {
  heading: guard("call h", "Jimmy is calling you now"),
  /** {number} is replaced with the configured caller id. */
  sub: guard("call sub", "Answer the call from {number}. If you miss it, we will follow up."),
  subNoNumber: guard(
    "call sub plain",
    "Pick up when it rings. If you miss it, we will follow up."
  ),
  /** {seconds} is replaced with the live countdown, already formatted as 0:59. */
  countdown: guard("call countdown", "Expecting a call within {seconds}"),
  cancel: guard("call cancel", "Cancel, I will book instead"),
} as const;

export const FALLBACK = {
  heading: guard("fb h", "Missed the call? Grab a time instead."),
  body: guard("fb body", "These are the next openings. Either one works."),
  more: guard("fb more", "See more times"),
} as const;

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export const BOOKING = {
  heading: guard("book h", "Pick a time."),
  speedLine: guard("book speed", "Fastest available, we start this week either way."),
  today: guard("book today", "Today"),
  tomorrow: guard("book tomorrow", "Tomorrow"),
  morning: guard("book am", "Morning"),
  afternoon: guard("book pm", "Afternoon"),
  more: guard("book more", "See more times"),
  none: guard(
    "book none",
    "Nothing left in that window. Try the other one, or open the full calendar."
  ),
  openCalendar: guard("book open", "Open the full calendar"),
  bookedHeading: guard("booked h", "You are booked."),
  bookedBody: guard(
    "booked body",
    "Check your email for the invite. If anything changes, the reschedule link is in it."
  ),
} as const;

// ---------------------------------------------------------------------------
// Self intake
// ---------------------------------------------------------------------------

export const SELF = {
  heading: guard("self h", "Five minutes and you are set up."),
  body: guard(
    "self body",
    "This link is yours. It picks up where we left off and it does not expire for 30 days, so you can stop and come back."
  ),
  cta: guard("self cta", "Open my setup"),
  fine: guard("self fine", "We will email you the same link so you do not lose it."),
} as const;

// ---------------------------------------------------------------------------
// The three FAQs under the path buttons
//
// Closed by default, one open at a time. They sit BELOW all three buttons so the primary
// CTA is never pushed under the fold on a phone.
// ---------------------------------------------------------------------------

export interface Faq {
  q: string;
  a: string;
}

export const PATH_FAQS: Faq[] = [
  {
    q: guard("faq1 q", "Wait, what does this actually cost?"),
    a: guard(
      "faq1 a",
      `Nothing until ChatGPT sends you 5 qualified appointments. After that, ${PRICE_RETAINER} covers the full system: reviews, page updates, monthly visibility report, and NAP maintenance. No contract, cancel anytime.`
    ),
  },
  {
    q: guard("faq2 q", "How does the 5-appointment guarantee work?"),
    a: guard(
      "faq2 a",
      "We count booked appointments where the patient explicitly says they found you through ChatGPT or an AI recommendation. We track it in your monthly report. Until we hit 5, you pay zero: no setup fee, no monthly, nothing."
    ),
  },
  {
    q: guard("faq3 q", "What do you need from me to start?"),
    a: guard(
      "faq3 a",
      "Google Business Profile access, one 15-min kickoff call, and permission to write on your site. That is it. We handle the rest: writing, review outreach, NAP fixes, monthly reporting."
    ),
  },
];

// ---------------------------------------------------------------------------
// The 30 FAQ accordion, below the fold
//
// EVERY ANSWER HERE IS LIFTED FROM COPY THAT IS ALREADY LIVE, not written fresh:
// srtagency.com/method's FAQPage JSON-LD, /pricing, llms.txt, and pitch.ts. That is not
// laziness. This page and the marketing site are two surfaces on one brand, an engine
// reads both, and a page that answers "is this really free" differently from /method is
// an inconsistency signal about the exact thing we sell. Changing an answer here means
// changing it there in the same commit.
//
// The four claims that are allowed to appear, and nothing beyond them: 84 to 89% of AI
// citations are third party, one clinic per market, 60 to 90 days for organic AI
// visibility to compound, and the 5 qualified AI-sourced inquiries that start billing.
// No medical claims. No revenue or patient guarantees.
// ---------------------------------------------------------------------------

export const ALL_FAQS: Faq[] = [
  {
    q: guard("f01 q", "Is this really free?"),
    a: guard(
      "f01 a",
      "Yes. We build one section of your own site that AI can actually read and cite, you keep it, and there is no card and nothing to sign. The monthly retainer only starts once we have brought you 5 qualified AI-sourced patient inquiries inside the first 30 days."
    ),
  },
  {
    q: guard("f02 q", "What is the catch?"),
    a: guard(
      "f02 a",
      "No catch, but there is a commercial motive and we would rather say it out loud than pretend there is not one. If the first section works you will probably want the rest of the site done, and that is the paid part. If it does not work, you keep the section and we are done."
    ),
  },
  {
    q: guard("f03 q", "How much does this cost after the free period?"),
    a: guard(
      "f03 a",
      `The check is free and so is the work at first. After we have delivered 5 qualified AI-sourced patient inquiries it is ${PRICE_RETAINER}, month to month, and you can leave anytime and keep everything. Typical AEO retainers run well into the thousands per month.`
    ),
  },
  {
    q: guard("f04 q", "What exactly counts as a qualified AI-sourced inquiry?"),
    a: guard(
      "f04 a",
      "Somebody who contacts your clinic and says they found you through ChatGPT or an AI recommendation. It is settled between us and you, out of what the patient tells your front desk, and it goes into your monthly report as it happens so there is no argument on day 31."
    ),
  },
  {
    q: guard("f05 q", "What is the difference between AEO and SEO?"),
    a: guard(
      "f05 a",
      "SEO gets you ranked in a list of blue links. AEO, or Answer Engine Optimization, gets your clinic named inside the AI's answer. Google shows twenty options across a hundred pages. AI names three and never mentions the rest."
    ),
  },
  {
    q: guard("f06 q", "We already have an SEO person. Is this the same thing?"),
    a: guard(
      "f06 a",
      "No, and keep them. Search rankings and AI answers are two different surfaces now, and ranking well does not mean you get cited. This is about what the answer says when nobody clicks a link at all."
    ),
  },
  {
    q: guard("f07 q", "How do I get my med spa recommended by ChatGPT?"),
    a: guard(
      "f07 a",
      "You get recommended when the sources AI trusts, reviews, directories, third-party pages, and a clean, structured website, consistently say the same clear things about your clinic. Between 84 and 89% of what AI cites comes from third-party sources, so it is not just your own website."
    ),
  },
  {
    q: guard("f08 q", "Why can I not just check my own phone?"),
    a: guard(
      "f08 a",
      "AI answers are personalized to your history and location, so of course your clinic comes up when you have searched it a hundred times. We measure on a clean, neutral account with no history, dated so it cannot be gamed, which is the market's answer rather than yours."
    ),
  },
  {
    q: guard("f09 q", "How do I know the score is real?"),
    a: guard(
      "f09 a",
      "You can check it yourself. Everything in your report is something you can go and type into ChatGPT right now, and every question we asked and every answer we got is printed in it, word for word. If the answer does not change, you can see that as clearly as we can."
    ),
  },
  {
    q: guard("f10 q", "When will I see results?"),
    a: guard(
      "f10 a",
      "The work is immediate and the engines are slower. Organic AI visibility normally takes 60 to 90 days to compound, and we would rather set that expectation now than have you surprised in week two. What happens quickly is that you can see exactly what the engines currently say about you."
    ),
  },
  {
    q: guard("f11 q", "Can you guarantee more patients?"),
    a: guard(
      "f11 a",
      "Not directly, and no honest agency can. What we guarantee is verifiable visibility in AI answers, specifically that your name shows up for at least 5 target queries by day 30. Whether that becomes patients depends on your clinic. What we do instead of promising it is not charge you until it has happened."
    ),
  },
  {
    q: guard("f12 q", "Do you work with more than one clinic in my city?"),
    a: guard(
      "f12 a",
      "No. We work with one clinic per market, because the whole point is to be the name the answer gives out and we cannot do that for two competitors at once. If we are already working with somebody near you we will say so on the call instead of taking your money."
    ),
  },
  {
    q: guard("f13 q", "Most of our patients come from referrals. Why does this matter?"),
    a: guard(
      "f13 a",
      "Referrals are the best kind and they are also quietly moving. The recommendation that used to happen in a conversation now often happens inside ChatGPT first. When it does, the question is whether your name comes up."
    ),
  },
  {
    q: guard("f14 q", "Are AEO agencies legit or is this snake oil?"),
    a: guard(
      "f14 a",
      "Both exist. The test is whether you can verify the result yourself. We only guarantee verifiable AI appearances on a neutral account you can re-check. Anyone guaranteeing patients, revenue, or top rankings in days should be walked away from."
    ),
  },
  {
    q: guard("f15 q", "Do you touch patient data?"),
    a: guard(
      "f15 a",
      "Never. SRT works upstream of PHI, on marketing and visibility only. We do not access, store or process patient data of any kind, and nothing we publish is medical advice."
    ),
  },
  {
    q: guard("f16 q", "Is SRT Agency a lender or a business funding broker?"),
    a: guard(
      "f16 a",
      "No. SRT Agency LLC, trading as Search Retrieval Tactics, is a marketing and AI-visibility agency for med spas and provides no financial services of any kind. We do not offer or arrange term loans, business lines of credit, equipment financing, SBA loans, or merchant cash advances."
    ),
  },
  {
    q: guard("f17 q", "What do you actually do each month?"),
    a: guard(
      "f17 a",
      "We re-write your pages so the engines can extract them, turn your happy patients into the third-party evidence AI reads, fix any NAP mismatches across the directories, and send you a dated visibility report. That is the whole retainer."
    ),
  },
  {
    q: guard("f18 q", "What is NAP and why does it keep coming up?"),
    a: guard(
      "f18 a",
      "Name, address, phone. When those three disagree across your site, Google, and the directories, the engines have nothing solid to repeat about you and they move on to a clinic they can describe confidently. Being unclear costs you the same as being absent."
    ),
  },
  {
    q: guard("f19 q", "What do you need from me to start?"),
    a: guard(
      "f19 a",
      "Google Business Profile access, one 15-min kickoff call, and permission to write on your site. That is it. We handle the rest: writing, review outreach, NAP fixes, monthly reporting."
    ),
  },
  {
    q: guard("f20 q", "My agency manages my website. Is that a problem?"),
    a: guard(
      "f20 a",
      "No, it is common and we work either way. It changes the first week, not the outcome: we either get publishing access or we hand your agency the exact pages to put up. Tell us on the call which one is easier and we will take it from there."
    ),
  },
  {
    q: guard("f21 q", "I do not have access to my Google Business Profile. Now what?"),
    a: guard(
      "f21 a",
      "We recover it. It is a standard Google process, we have done it plenty of times, and it is usually the single highest-value thing we do in the first week. Say so on the call and we will start it that day."
    ),
  },
  {
    q: guard("f22 q", "Do I need a new website?"),
    a: guard(
      "f22 a",
      "Almost never. Most sites are written for people and the machine cannot read them, which is a structure problem rather than a design problem. We work on whatever you are on, Wix, Squarespace, WordPress or Shopify."
    ),
  },
  {
    q: guard("f23 q", "What if I do not really have a website?"),
    a: guard(
      "f23 a",
      "Plenty of the clinics AI names do not have much of a site. What matters more is what the rest of the internet says about you, so we start there and build the site side after."
    ),
  },
  {
    q: guard("f24 q", "Will you write things about my clinic that are not true?"),
    a: guard(
      "f24 a",
      "No. Everything we publish is checked with you before it goes up, and nothing we write is medical advice or a clinical claim. Invented detail is the fastest way to lose the trust of both a patient and an engine."
    ),
  },
  {
    q: guard("f25 q", "How is this different from buying reviews?"),
    a: guard(
      "f25 a",
      "We never buy, write or incentivise a review. We ask your existing happy patients at the right moment and make it easy for them. The reason that matters is that the engines read reviews as third-party evidence, and evidence you paid for is worth nothing the moment it is spotted."
    ),
  },
  {
    q: guard("f26 q", "Is there a contract?"),
    a: guard(
      "f26 a",
      "No. It is month to month, you can leave anytime, and you keep everything: the pages, the profiles and the data."
    ),
  },
  {
    q: guard("f27 q", "What happens if I cancel?"),
    a: guard(
      "f27 a",
      "You keep every page we wrote and every profile we fixed. The part that stops is the ongoing work, and freshness is the pillar that decays on its own, which is why this is a retainer and not a project."
    ),
  },
  {
    q: guard("f28 q", "Do you run ads?"),
    a: guard(
      "f28 a",
      "ChatGPT Ads are available as an accelerator for clinics who need results faster than organic compounds. It is quoted case by case on the call and it is separate from the retainer."
    ),
  },
  {
    q: guard("f29 q", "Who am I actually talking to?"),
    a: guard(
      "f29 a",
      "A small team. You will not be handed to an account manager you have never met, and the person on your first call is the person doing the work."
    ),
  },
  {
    q: guard("f30 q", "What happens on the 15-minute call?"),
    a: guard(
      "f30 a",
      "We go through your report, show you which questions your clinic is missing from and who is being named instead, and agree the three things to fix first. If it is not a fit we will say so on the call."
    ),
  },
];

/** The offer line, borrowed rather than re-typed. Sentence-cased for use as a heading. */
export const OFFER_LINE = `${FREE_UNTIL_LINE.charAt(0).toUpperCase()}${FREE_UNTIL_LINE.slice(1)}.`;
