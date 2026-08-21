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

// ─────────────────────────────────────────────────────────────────────────────
// The opt-in modal
//
// It is a MODAL rather than a card in the flow, matching the reference funnel: the
// hero button opens it over the page. That is a conversion decision, not a styling
// one, so the copy lives here with everything else.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The qualifier options, EXPORTED AS CONSTANTS because the client renders them and
 * the route matches on them.
 *
 * Same rule as config/onboarding-free.ts: a label reworded here and compared as a
 * string literal there is a gate that silently stops firing. Anything that is not
 * OWNS_YES is treated as not qualified.
 */
export const OWNS_YES = "Yes";
export const OWNS_NO = "No (leave this page)";

export const OPTIN = {
  headline: guard("lhr.optin.headline", "Where should we send your free training?"),

  fields: {
    owns: guard("lhr.field.owns", "Do you own a Med Spa or Laser Hair Removal Clinic"),
    ownsPlaceholder: guard("lhr.field.ownsPlaceholder", "Choose one"),
    name: guard("lhr.field.name", "Full Name"),
    namePlaceholder: guard("lhr.field.namePlaceholder", "Enter your full name"),
    email: guard("lhr.field.email", "Email"),
    emailPlaceholder: guard("lhr.field.emailPlaceholder", "your@email.com"),
    phone: guard("lhr.field.phone", "Phone"),
    phonePlaceholder: guard("lhr.field.phonePlaceholder", "(555) 000-0000"),
  },

  ownsOptions: [OWNS_YES, OWNS_NO] as const,

  /**
   * Shown when they pick the No option. The submit button is removed rather than
   * disabled, so there is nothing to press and nothing is posted.
   *
   * It stays polite and does not insult them. The reference page's option label says
   * "leave this page" and this is that instruction, worded like a person.
   */
  disqualified: guard(
    "lhr.optin.disqualified",
    "This training is built specifically for clinic owners, so it will not be much use to you. Thanks for stopping by."
  ),

  consent: guard(
    "lhr.optin.consent",
    "You can call or text me about my clinic. Message and data rates may apply."
  ),

  submit: guard("lhr.optin.submit", "Send Me The Video!"),
  submitBusy: guard("lhr.optin.submitBusy", "One moment"),

  reassure: guard("lhr.optin.reassure", "No card. No obligation. Unsubscribe any time."),

  close: guard("lhr.optin.close", "Close"),

  ownsError: guard("lhr.optin.ownsError", "Pick one so we know this is for you."),
  networkError: guard(
    "lhr.optin.networkError",
    "We could not reach the server. Check your connection and try again."
  ),
  genericError: guard("lhr.optin.genericError", "Something went wrong. Try again in a moment."),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Where a qualified opt-in goes next
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RELATIVE ON PURPOSE, and not built from LHR_BASE.
 *
 * LHR_BASE is the apex (srtagency.com), and the apex currently 307s to www, so an
 * absolute redirect would put a redirect hop between the form and the video for every
 * visitor. A same-origin relative path lands directly on whichever host they were
 * already on: mission.srtagency.com in dev and on the origin, www.srtagency.com in
 * production, both of which the /lhr/:path* rewrite covers.
 *
 * It is a full navigation via window.location, never a next/link. The house rule
 * exists because a 30x in the middle of an RSC prefetch under the rewrite blanks the
 * page.
 */
export const TRAINING_PATH = "/lhr/training";

// ─────────────────────────────────────────────────────────────────────────────
// The training page: white, video, then a calendar
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING = {
  /** The green banner across the top, the reference page's shape. */
  banner: guard(
    "lhr.training.banner",
    "We'll Install Our Complete Patient Getting System That We're Using To Add 20-40+ New Patients Each Month"
  ),

  cta: guard("lhr.training.cta", "Book My Demo Below"),

  calendarHeading: guard("lhr.training.calendarHeading", "Pick a time that works"),

  /** Rendered when no Calendly URL is configured. Never a broken iframe. */
  noCalendar: guard(
    "lhr.training.noCalendar",
    "Booking opens shortly. We have your details and will reach out to schedule."
  ),

  videoPlaceholderTitle: guard("lhr.training.videoPlaceholderTitle", "The training goes here"),
  videoPlaceholderBody: guard(
    "lhr.training.videoPlaceholderBody",
    "This video has not been recorded yet. The rest of the page works, so the funnel can be tested end to end in the meantime."
  ),
} as const;

/**
 * The VSL shown on the training page.
 *
 * NOT gated. GatedVSL exists for the med spa funnel, where the offer sits behind a
 * watch-time threshold; here the booking calendar is visible the whole time by design,
 * so a seek clamp would only annoy someone who already gave us their number. Unset
 * renders a placeholder rather than an empty black box.
 */
export const TRAINING_VSL = {
  url: process.env.NEXT_PUBLIC_LHR_VSL_URL || null,
  poster: process.env.NEXT_PUBLIC_LHR_VSL_POSTER || null,
};

/**
 * Calendly inline embed. Unset renders TRAINING.noCalendar, never a broken iframe.
 * Same tri-state treatment as CALENDLY_URL in medspa-funnel.ts.
 *
 * The default is a real link rather than null, and that is a deliberate change from
 * the tri-state everything else in this file uses. Every Calendly env var in this repo
 * has always been unset, so the tri-state's honest fallback ("Booking opens shortly")
 * was the only thing this page had ever rendered: a funnel that captures a phone number
 * and then declines to let them book. The env var still wins where a different calendar
 * is wanted, so nothing is lost by having a working default underneath it.
 */
export const CALENDLY_URL =
  process.env.NEXT_PUBLIC_LHR_CALENDLY_URL || "https://calendly.com/matthewg19/democall";

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

/** The wordmark. No logo mark on the training page, Matthew's call: text only. */
export const BRAND = guard("lhr.brand", "SRT Agency");
