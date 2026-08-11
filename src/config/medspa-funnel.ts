// All copy and tunables for /webflow-Aivisibility, in one editable file.
//
// CLIENT-SAFE. This module is imported by client components, so it must never
// import anything server-side (no supabaseAdmin, no node: builtins, no Stripe SDK).
// tsc will not catch a violation, because a bundler boundary is not a type error.
//
// Every reader-facing string goes through guard(), which throws at module load on an
// em dash. See src/lib/copy-guard.ts for why that is a throw and not a warning.
//
// Copy constraints this file has to keep, all of them house rules with history:
//   - No funding, lending, capital or MCA language anywhere on srtagency.com.
//   - No outcome claims. We sell verifiable AI visibility, never customers or revenue.
//   - No statistic without a source, and only the four cleared ones.
//   - Never promise a ranking. "get ranked #1 by chatgpt" was rejected once already.

import { guard } from "@/lib/copy-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Where the funnel lives
// ─────────────────────────────────────────────────────────────────────────────

// The PUBLIC base, capital A. Every cross-page link is built from this rather than
// from a Next <Link>, because the app is served under srtagency.com through a
// rewrite: client-side routing would resolve against whatever casing Next emitted
// and a redirect in the middle of an RSC prefetch blanks the page.
export const FUNNEL_BASE =
  process.env.NEXT_PUBLIC_FUNNEL_BASE || "https://srtagency.com/webflow-Aivisibility";

export function funnelUrl(path = ""): string {
  return `${FUNNEL_BASE}${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prices
//
// Cent amounts live in CODE, not env. The number printed on the page and the number
// handed to Stripe must be one constant: a page that says a different figure than
// the charge cannot be walked back. Stripe PRICE IDs stay in env, because those are
// environment-specific; the amounts are not.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICES = {
  /**
   * The tripwire audit. List price is $97; $39 is the fast-action price.
   *
   * A SINGLE flat line item. There is deliberately no order bump and no add-on: the
   * popup sells one thing. Consequence worth keeping: the client has no input into
   * the charged amount at all, not even a boolean, so checkout/intent computes this
   * constant and nothing else.
   */
  audit: 3900,
  /** Core: "fixes what you say". */
  core: 34900,
  /** Complete: "changes what everyone else says". */
  complete: 49900,
} as const;

export type Tier = "core" | "complete";

/**
 * What the $39 audit takes off the first month.
 *
 * Equal to the audit price by definition, and the credit line on the page computes
 * from this rather than hardcoding "$310" so the two can never disagree.
 */
export const AUDIT_CREDIT_CENTS = PRICES.audit;

export function tierPrice(tier: Tier): number {
  return tier === "core" ? PRICES.core : PRICES.complete;
}

/** First month after the $39 audit credit. Never let this be a literal. */
export function firstMonthCents(tier: Tier, hasAuditCredit: boolean): number {
  return tierPrice(tier) - (hasAuditCredit ? AUDIT_CREDIT_CENTS : 0);
}

export function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Video gating
// ─────────────────────────────────────────────────────────────────────────────

export const VSL_A = {
  url: process.env.NEXT_PUBLIC_MEDSPA_VSL_A_URL || null,
  poster: process.env.NEXT_PUBLIC_MEDSPA_VSL_A_POSTER || null,
  /** Seconds of real playback before the opt-in form appears. */
  ctaRevealSeconds: 240,
  allowScrub: false,
  resumeMode: "smart" as const,
};

export const VSL_B = {
  url: process.env.NEXT_PUBLIC_MEDSPA_VSL_B_URL || null,
  poster: process.env.NEXT_PUBLIC_MEDSPA_VSL_B_POSTER || null,
  /** The training is longer, and the offer sits behind more of it. */
  ctaRevealSeconds: 900,
  allowScrub: false,
  resumeMode: "smart" as const,
};

export const VIDEO = {
  unmuteLabel: guard("video.unmute", "Tap to turn the sound on"),
  playLabel: guard("video.play", "Tap to play"),
  placeholderTitle: guard("video.placeholderTitle", "The training goes here"),
  placeholderBody: guard(
    "video.placeholderBody",
    "This video has not been recorded yet. The page is fully clickable in the meantime, so everything below works."
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// VSL-A landing page
// ─────────────────────────────────────────────────────────────────────────────

export const LANDING = {
  eyebrow: guard("landing.eyebrow", "Free training for med spa owners"),

  headline: guard(
    "landing.headline",
    "Your next patient is asking ChatGPT who to book with"
  ),

  subhead: guard(
    "landing.subhead",
    "Watch the short training on how AI search decides which clinics it names, why most med spas are invisible in those answers, and what actually changes it."
  ),

  // The four cleared stats. Sources are printed inline because an AEO agency that
  // cites nothing is failing on its own pitch.
  stats: [
    {
      value: guard("stat1.value", "300M+"),
      label: guard("stat1.label", "health and wellness questions go to ChatGPT every week"),
    },
    {
      value: guard("stat2.value", "47%"),
      label: guard("stat2.label", "of patients say they have used AI to research a provider"),
    },
    {
      value: guard("stat3.value", "84 to 89%"),
      label: guard("stat3.label", "of the sources AI cites are third party, not your own site"),
    },
  ],

  ctaHeadline: guard("landing.ctaHeadline", "Get the questions, and your seat"),

  ctaBody: guard(
    "landing.ctaBody",
    "Send yourself The 20 Questions Your Patients Ask ChatGPT Before They Book, and reserve a seat on the free training."
  ),

  fields: {
    name: guard("field.name", "Your name"),
    namePlaceholder: guard("field.namePlaceholder", "First and last name"),
    email: guard("field.email", "Email"),
    emailPlaceholder: guard("field.emailPlaceholder", "you@yourclinic.com"),
    phone: guard("field.phone", "Mobile"),
    phonePlaceholder: guard("field.phonePlaceholder", "(336) 555 0142"),
  },

  consent: guard(
    "landing.consent",
    "You can call or text me about my clinic's AI visibility. Message and data rates may apply."
  ),

  submit: guard("landing.submit", "Send me the 20 questions"),
  submitBusy: guard("landing.submitBusy", "Sending"),

  reassure: guard("landing.reassure", "No card. No obligation. Unsubscribe any time."),

  successHeadline: guard("landing.successHeadline", "Check your inbox."),
  successBody: guard(
    "landing.successBody",
    "The 20 questions are on their way, along with the link to your training."
  ),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The $39 offer panel
//
// This copy is the founder's, specified verbatim. The only edit is the em dashes,
// which were replaced with commas per the house rule. Do not reword the rest.
// ─────────────────────────────────────────────────────────────────────────────

export const OFFER = {
  headline: guard("offer.headline", "Here are the 20 questions."),

  body: guard(
    "offer.body",
    "Checking all 20 yourself, across ChatGPT, Gemini, Perplexity, and Google AI, for your clinic AND your competitors, is hours of work. Want us to run all 20 for you and show you exactly where you stand, in 3 minutes? $39."
  ),

  button: guard("offer.button", "Run my audit, $39"),
  buttonBusy: guard("offer.buttonBusy", "One moment"),

  /** Sits directly under the button as the label for the required website input. */
  fieldLabel: guard("offer.fieldLabel", "Drop us your clinic's website to get started"),
  fieldPlaceholder: guard("offer.fieldPlaceholder", "yourclinic.com"),

  decline: guard("offer.decline", "Or take the free PDF and DIY"),

  /** Shown while MEDSPA_CHECKOUT_ENABLED is unset. */
  placeholderNotice: guard(
    "offer.placeholderNotice",
    "Thanks. Checkout opens shortly and we have your clinic on the list. Watch your inbox."
  ),

  declinedNotice: guard(
    "offer.declinedNotice",
    "No problem. The 20 questions are already in your inbox."
  ),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// VSL-B training page
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING = {
  eyebrow: guard("training.eyebrow", "Your training"),
  headline: guard("training.headline", "How AI search picks the clinics it names"),
  subhead: guard(
    "training.subhead",
    "Watch it through. The part most owners have never seen starts about halfway in."
  ),
  lockedHeadline: guard("training.lockedHeadline", "This training is for members"),
  lockedBody: guard(
    "training.lockedBody",
    "Enter your details and we will send you the link along with the 20 questions."
  ),
} as const;

// The training page's CTA into the order page. It carries no price: pricing lives on
// /get-named, where the comparison table gives the numbers their context.
export const TRAINING_OFFER = {
  headline: guard("trainingOffer.headline", "Want us to do it for you?"),
  body: guard(
    "trainingOffer.body",
    "We build the answer coverage, the markup and the third party citations that AI search reads, and we keep it maintained every month."
  ),
  cta: guard("trainingOffer.cta", "See what that looks like"),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Meta pixel
// ─────────────────────────────────────────────────────────────────────────────

/** The one shared srtagency pixel. Standard events only, never custom parameters. */
export const PIXEL_ID = "2571789533326438";

// ─────────────────────────────────────────────────────────────────────────────
// /get-named, the order page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tier comparison, as DATA with a fixed section order.
 *
 * ‼️ THE SECTION ORDER IS LOAD-BEARING. Do not reorder it, and in particular do not
 * hoist the volume rows (4 vs 8 pages, 20 vs 40 prompts) to the top "so the
 * difference is obvious". The tiers differ in CATEGORY, not quantity: Core fixes
 * what you say, Complete changes what everyone else says. A table that opens on
 * 4-vs-8 argues the opposite and turns a positioning difference into a haggle over
 * volume. The volume rows live INSIDE their sections on purpose.
 *
 * `core: false` renders NOT_INCLUDED below. It is a middle dot, not an em dash:
 * copy-guard throws on em dashes at module load, and that rule stays absolute.
 */
export const NOT_INCLUDED = "\u00b7";

export interface TierRow {
  label: string;
  /** true = included, false = not in Core, string = the Core-specific value. */
  core: boolean | string;
  complete: boolean | string;
}

export interface TierSection {
  heading: string;
  rows: TierRow[];
}

export const TIER_TABLE: TierSection[] = [
  {
    heading: guard("tier.s1", "What everyone else says about you"),
    rows: [
      { label: guard("tier.s1r1", "Review response drafting"), core: false, complete: true },
      { label: guard("tier.s1r2", "Negative review workflow"), core: false, complete: true },
      {
        label: guard("tier.s1r3", "Off-site placement across directories and lists"),
        core: false,
        complete: true,
      },
      {
        label: guard("tier.s1r4", "Competitor displacement tracking"),
        core: false,
        complete: true,
      },
    ],
  },
  {
    heading: guard("tier.s2", "What you say"),
    rows: [
      { label: guard("tier.s2r1", "New answer pages"), core: "4 a month", complete: "8 a month" },
      { label: guard("tier.s2r2", "Refreshed existing pages"), core: true, complete: true },
      { label: guard("tier.s2r3", "Automated review requests"), core: true, complete: true },
    ],
  },
  {
    heading: guard("tier.s3", "What you can see"),
    rows: [
      { label: guard("tier.s3r1", "Tracked prompts"), core: "20", complete: "40" },
      { label: guard("tier.s3r2", "Monthly re-test"), core: true, complete: true },
      { label: guard("tier.s3r3", "Scorecard"), core: true, complete: true },
      { label: guard("tier.s3r4", "Walkthrough video"), core: true, complete: true },
      { label: guard("tier.s3r5", "Slack channel"), core: true, complete: true },
    ],
  },
];

export const GET_NAMED = {
  eyebrow: guard("gn.eyebrow", "The work itself"),
  headline: guard("gn.headline", "Get named by the engines your patients ask"),

  /** Sits directly above the table and is the whole argument for the two tiers. */
  positioning: guard(
    "gn.positioning",
    "Core fixes what you say. Complete changes what everyone else says."
  ),

  coreName: guard("gn.coreName", "Core"),
  completeName: guard("gn.completeName", "Complete"),
  perMonth: guard("gn.perMonth", "a month"),

  coreCta: guard("gn.coreCta", "Start Core"),
  completeCta: guard("gn.completeCta", "Start Complete"),
  ctaBusy: guard("gn.ctaBusy", "One moment"),

  noTerm: guard("gn.noTerm", "No minimum term. Cancel anytime."),

  guaranteeHeading: guard("gn.guaranteeHeading", "The Keep Everything Guarantee"),
  guaranteeBody: guard(
    "gn.guaranteeBody",
    "Cancel whenever you want and you keep every asset we built. Your pages stay live, your listings stay corrected, your review system stays connected, and every scorecard and walkthrough video is yours. Nothing is switched off or taken back."
  ),
  /** Stated because "guarantee" reads as "refund" to most people, and it is not one. */
  guaranteeNotRefund: guard(
    "gn.guaranteeNotRefund",
    "This is not a refund policy. It means the work stays yours, not that months are returned."
  ),

  /** Must appear before payment even though it is not in the video. */
  implementationNote: guard(
    "gn.implementationNote",
    "Optional one-time implementation available at onboarding for clinics that want broader online-presence cleanup. Not required."
  ),

  zipLabel: guard("gn.zipLabel", "Which ZIP does your clinic serve?"),
  zipPlaceholder: guard("gn.zipPlaceholder", "27401"),
  cityLabel: guard("gn.cityLabel", "City and state"),
  cityPlaceholder: guard("gn.cityPlaceholder", "Greensboro, NC"),

  /** Rendered only for audit buyers. The figure is COMPUTED, never a literal. */
  creditPrefix: guard("gn.creditPrefix", "$39 audit credit applied, your first month is"),

  savedCardNote: guard(
    "gn.savedCardNote",
    "We use the card you paid the audit with. Nothing is charged until you tap the button."
  ),
} as const;

export const CONFIRMED = {
  headline: guard("confirmed.headline", "You are in."),
  body: guard(
    "confirmed.body",
    "Book your onboarding call below. It is a kickoff, not a sales call, so bring your questions and anything you want looked at first."
  ),
  noCalendar: guard(
    "confirmed.noCalendar",
    "We will email you to schedule your onboarding call shortly."
  ),
} as const;

/** Calendly inline embed. Unset renders CONFIRMED.noCalendar, never a broken iframe. */
export const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL || null;

