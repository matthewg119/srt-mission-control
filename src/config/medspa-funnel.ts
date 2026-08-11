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
  /** Founding, locked for life, first 5 clinics only. */
  founding: 29900,
  /** Standard, everyone after the founding seats are gone. */
  standard: 49900,
} as const;

export const FOUNDING_SEATS = 5;

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

// The $299 / $499 block. Deliberately carries NO price until checkout exists: a
// price on a page that cannot take the money is a promise with no mechanism behind
// it, which is the same reason LOOM_CLIENT_COUNT_CLAIM ships null.
export const TRAINING_OFFER_PLACEHOLDER = {
  headline: guard("trainingOffer.headline", "Want us to do it for you?"),
  body: guard(
    "trainingOffer.body",
    "We build the answer coverage, the markup and the third party citations that AI search reads, and we work with one clinic per market."
  ),
  cta: guard("trainingOffer.cta", "Tell me more"),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The one-time offer, shown once immediately after the $39 purchase
// ─────────────────────────────────────────────────────────────────────────────

export const OTO = {
  runningHeadline: guard("oto.runningHeadline", "Your audit is running"),
  runningBody: guard(
    "oto.runningBody",
    "It is asking ChatGPT all 20 questions right now. Read this while it works, the scorecard lands in your inbox either way."
  ),

  steps: [
    guard("oto.step1", "Research your clinic"),
    guard("oto.step2", "Identify your competitors"),
    guard("oto.step3", "Write the buyer questions"),
    guard("oto.step4", "Ask ChatGPT all 20"),
    guard("oto.step5", "Score the answers"),
    guard("oto.step6", "Build your report"),
  ],

  founding: {
    eyebrow: guard("oto.founding.eyebrow", "Founding rate, this page only"),
    headline: guard("oto.founding.headline", "Want us to go and fix it?"),
    body: guard(
      "oto.founding.body",
      "The audit tells you where you stand. This is the work that changes it: the answer coverage, the schema markup and the third party citations AI search actually reads, rebuilt around your clinic and maintained every month."
    ),
    bullets: [
      guard("oto.founding.b1", "We work with one clinic per market"),
      guard("oto.founding.b2", "Your rate is locked for as long as you stay"),
      guard("oto.founding.b3", "Cancel any time, no term"),
    ],
    cta: guard("oto.founding.cta", "Yes, start at $299 a month"),
    ctaBusy: guard("oto.founding.ctaBusy", "Starting"),
    noCard: guard("oto.founding.noCard", "No card to re-enter. We use the one you just paid with."),
    decline: guard("oto.founding.decline", "No thanks, just the audit"),
    seatsLabel: guard("oto.founding.seatsLabel", "founding seats left"),
  },

  standard: {
    eyebrow: guard("oto.standard.eyebrow", "Monthly, cancel any time"),
    headline: guard("oto.standard.headline", "Want us to go and fix it?"),
    body: guard(
      "oto.standard.body",
      "The audit tells you where you stand. This is the work that changes it: the answer coverage, the schema markup and the third party citations AI search actually reads, rebuilt around your clinic and maintained every month."
    ),
    cta: guard("oto.standard.cta", "Start at $499 a month"),
    ctaBusy: guard("oto.standard.ctaBusy", "Starting"),
    soldOut: guard(
      "oto.standard.soldOut",
      "The five founding seats are taken. This is the standard rate."
    ),
    expired: guard(
      "oto.standard.expired",
      "The founding rate on your link has expired. This is the standard rate."
    ),
    cityLabel: guard("oto.standard.cityLabel", "Which city and state does your clinic serve?"),
    cityPlaceholder: guard("oto.standard.cityPlaceholder", "Greensboro, NC"),
  },

  done: {
    headline: guard("oto.done.headline", "You are in."),
    body: guard(
      "oto.done.body",
      "We will be in touch today to kick off. Your audit scorecard still lands in your inbox separately."
    ),
  },

  declined: {
    headline: guard("oto.declined.headline", "No problem."),
    body: guard(
      "oto.declined.body",
      "Your audit is still running and the scorecard lands in your inbox shortly."
    ),
  },

  invalid: {
    headline: guard("oto.invalid.headline", "This link is not live"),
    body: guard(
      "oto.invalid.body",
      "It may have been used already, or it expired. If you have paid for an audit, check your inbox for the scorecard."
    ),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Meta pixel
// ─────────────────────────────────────────────────────────────────────────────

/** The one shared srtagency pixel. Standard events only, never custom parameters. */
export const PIXEL_ID = "2571789533326438";
