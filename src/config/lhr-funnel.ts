// All copy and tunables for /LHR, the med spa and laser hair removal VSL funnel.
//
// CLIENT-SAFE. This module is imported by a client component, so it must never
// import anything server-side (no supabaseAdmin, no node: builtins). tsc will not
// catch a violation, because a bundler boundary is not a type error.
//
// Every reader-facing string goes through guard(), which throws at module load on an
// em dash. See src/lib/copy-guard.ts for why that is a throw and not a warning.
//
// ‼️ THIS PAGE'S HEADLINE IS AN OUTCOME CLAIM AND THAT IS DELIBERATE.
//
// "Get 20-40 New Patients Every Month" plus "or you don't pay" is a volume promise
// and a guarantee. Everywhere else in this codebase both are banned IN CODE:
// HARD_LINES bans guarantee and risk-reversal language, lintSpoken() rejects promises
// of customers or revenue, DELIVERY_BANNED_PROMISES catches them in email, and
// LOOM_CLIENT_COUNT_CLAIM is null precisely so a customer count is never asserted.
//
// Those guards govern the drafters that write to prospects; none of them run over this
// file, so nothing here is being circumvented. It is a specified exception for one paid
// traffic page, matched to the ad set pointing at it, and it was raised and overruled on
// 2026-08-20. Do not copy this copy into an email, a call script or the marketing site,
// and do not "fix" it by quietly softening it either. If it changes, it changes here.

import { guard } from "@/lib/copy-guard";
import { PIXEL_ID } from "@/config/medspa-funnel";

// One shared srtagency pixel across every funnel. Re-exported rather than restated so
// there is a single literal for it in the repo.
export { PIXEL_ID };

// ─────────────────────────────────────────────────────────────────────────────
// Where the funnel lives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The PUBLIC base, capital LHR.
 *
 * Hardcoded because the app is served under srtagency.com through a rewrite in the
 * srt-agwb repo and nothing at runtime tells it that. The route folder is lowercase
 * (`src/app/lhr`) to avoid the /webflow-Aivisibility casing trap; only this constant
 * carries the casing the ads link to.
 */
export const LHR_BASE = process.env.NEXT_PUBLIC_LHR_BASE || "https://srtagency.com/LHR";

// ─────────────────────────────────────────────────────────────────────────────
// The hero
// ─────────────────────────────────────────────────────────────────────────────

export const HERO = {
  /** The one line Matthew specified by name. */
  eyebrow: guard("lhr.eyebrow", "For Med Spas & Laser Hair Removal Clinics"),

  /** Rendered as three parts so the middle clause can carry the accent colour. */
  headlineLead: guard("lhr.headlineLead", "Get"),
  headlineAccent: guard("lhr.headlineAccent", "20-40 New Patients Every Month"),
  headlineRest: guard(
    "lhr.headlineRest",
    "Without Slashing Your Prices, Running Ads That Attract The Wrong People, Or Crossing Your Fingers Every Month"
  ),

  subheadLead: guard(
    "lhr.subheadLead",
    "That's 1-2 New Patients Every Day. Watch the free 5 minute video that breaks down the exact Patient Acquisition System we install that performs or"
  ),
  /** Emphasised at the end of the subhead, the way the reference page does it. */
  subheadEmphasis: guard("lhr.subheadEmphasis", "you don't pay"),

  cta: guard("lhr.cta", "WATCH THE FREE TRAINING"),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The opt-in card
// ─────────────────────────────────────────────────────────────────────────────

export const OPTIN = {
  headline: guard("lhr.optin.headline", "Where should we send it?"),
  body: guard(
    "lhr.optin.body",
    "Enter your details and the training starts on this page. No download, nothing to install."
  ),

  fields: {
    name: guard("lhr.field.name", "Your name"),
    namePlaceholder: guard("lhr.field.namePlaceholder", "First and last name"),
    email: guard("lhr.field.email", "Email"),
    emailPlaceholder: guard("lhr.field.emailPlaceholder", "you@yourclinic.com"),
    phone: guard("lhr.field.phone", "Mobile"),
    phonePlaceholder: guard("lhr.field.phonePlaceholder", "(336) 555 0142"),
  },

  consent: guard(
    "lhr.optin.consent",
    "You can call or text me about my clinic. Message and data rates may apply."
  ),

  submit: guard("lhr.optin.submit", "START THE TRAINING"),
  submitBusy: guard("lhr.optin.submitBusy", "One moment"),

  reassure: guard("lhr.optin.reassure", "No card. No obligation. Unsubscribe any time."),

  /** Shown when the server is unreachable, never when a field is wrong. */
  networkError: guard(
    "lhr.optin.networkError",
    "We could not reach the server. Check your connection and try again."
  ),
  genericError: guard("lhr.optin.genericError", "Something went wrong. Try again in a moment."),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The video
// ─────────────────────────────────────────────────────────────────────────────

export const VSL = {
  url: process.env.NEXT_PUBLIC_LHR_VSL_URL || null,
  poster: process.env.NEXT_PUBLIC_LHR_VSL_POSTER || null,
  /**
   * Seconds of REAL playback before the next step appears. GatedVSL drives this off
   * currentTime, never a wall-clock timer, so a paused or backgrounded tab does not
   * reveal it early. The page promises a 5 minute video, so the reveal sits just
   * inside that.
   */
  ctaRevealSeconds: 270,
  allowScrub: false,
  resumeMode: "smart" as const,
};

export const VIDEO = {
  unmuteLabel: guard("lhr.video.unmute", "Tap to turn the sound on"),
  playLabel: guard("lhr.video.play", "Tap to play"),
  placeholderTitle: guard("lhr.video.placeholderTitle", "The training goes here"),
  placeholderBody: guard(
    "lhr.video.placeholderBody",
    "This video has not been recorded yet. Everything else on the page works, so the funnel can be tested end to end in the meantime."
  ),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// What happens after the video
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ `href` IS TRI-STATE ON PURPOSE. Same doctrine as PAYMENT_LINK and site_signals.
 *
 * The post-video destination has not been decided (a booking link? a phone number?).
 * Null renders the reveal as TEXT ONLY rather than a button pointing nowhere, because
 * a promised link that does not exist is discovered by the prospect right after the
 * video, when nothing can be done about it. Setting NEXT_PUBLIC_LHR_NEXT_STEP_URL
 * turns the button on; no other change is needed.
 */
export const NEXT_STEP = {
  href: process.env.NEXT_PUBLIC_LHR_NEXT_STEP_URL || null,

  headline: guard("lhr.next.headline", "That is the system."),

  /** Rendered when href is set. */
  body: guard(
    "lhr.next.body",
    "Book a time and we will walk through what this looks like for your clinic, your city and your treatment mix."
  ),
  label: guard("lhr.next.label", "BOOK MY WALKTHROUGH"),

  /** Rendered when href is null. Says what will actually happen, and nothing more. */
  bodyNoLink: guard(
    "lhr.next.bodyNoLink",
    "We have your details. Someone from our team will reach out shortly to walk through what this looks like for your clinic."
  ),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Footer
//
// The compliance lines that sit on every clinic-facing SRT page. "Upstream of PHI"
// and "nothing here is medical advice" are A2P 10DLC text, not politeness, and the
// legal links are absolute because this page is served on srtagency.com through a
// rewrite while the legal pages live in the other repo.
// ─────────────────────────────────────────────────────────────────────────────

export const FOOTER = {
  entity: guard("lhr.footer.entity", "SRT Agency LLC, Search Retrieval Tactics"),
  compliance: guard(
    "lhr.footer.compliance",
    "Upstream of PHI. Nothing here is medical advice."
  ),
  /*
   * ‼️ THERE IS NO RESULTS DISCLAIMER ON THIS PAGE, AND ITS ABSENCE IS A DECISION.
   *
   * A draft carried "nothing on this page is a guarantee of a specific number of
   * patients" in the footer. That sat directly under a headline promising "or you don't
   * pay", so it denied the offer above it in small type. Matthew's call on 2026-08-20 was
   * to keep the promise and drop the line rather than soften either one.
   *
   * If a disclaimer is ever added back, it has to be one that AGREES with the headline
   * (what the performance term actually is), never one that contradicts it. A footer that
   * takes the offer back is worse than no footer.
   */
  privacyUrl: "https://srtagency.com/privacy",
  privacyLabel: guard("lhr.footer.privacy", "Privacy Policy"),
  termsUrl: "https://srtagency.com/terms",
  termsLabel: guard("lhr.footer.terms", "Terms of Service"),
  smsUrl: "https://srtagency.com/sms-terms",
  smsLabel: guard("lhr.footer.sms", "SMS Terms"),
} as const;
