// The client-facing copy. THIS IS THE FILE MATTHEW EDITS.
//
// Everything a client reads is here. The mechanism that posts it, decides the channel and
// builds the wa.me link is in src/lib/clients/client-drafts.ts and does not need touching
// to change a word of what is said.
//
// ─── HOW TO WRITE ONE ────────────────────────────────────────────────────────────────
//
// Replace the TODO body with the real message. Rules, in order of how badly they bite:
//
//  1. PLAIN TEXT. This is going into WhatsApp. No markdown, no *asterisks*, no bullet
//     characters. WhatsApp renders * as bold and a hyphen at line start as a literal
//     hyphen, so a nicely formatted draft arrives looking broken.
//  2. NO EM DASHES. guard() throws at module load, so a dash pasted out of a doc fails
//     `bun run build` rather than shipping. That is deliberate, do not work around it.
//     Commas, periods and single hyphens do the job.
//  3. NO OUTCOME CLAIMS, no unsourced statistics, and no timeline promise that has not
//     been agreed on a call. Same rule as every other piece of SRT copy.
//  4. SHORT. These are texts to a business owner between appointments, not emails.
//
// Tokens in {braces} are filled in from the client record. Each draft lists the ones it
// has. A token with no value renders as nothing rather than as the literal braces, so a
// missing city degrades to a slightly clipped sentence rather than "{city}".
//
// ─── THE TWO LINES YOU DO NOT WRITE ──────────────────────────────────────────────────
//
// CHANNEL_LINE and NO_CUSTOMER_INFO_LINE below are appended to the intro automatically.
// Do not repeat them in your own copy. They are constants rather than guidance for the
// same reason PERMISSION_CLOSE and NOT_SELLING_LINE are: a line that must survive every
// rewrite has to be code, and the second one is a compliance line rather than a
// stylistic one.

import { guard } from "@/lib/copy-guard";

/**
 * The sentinel an unwritten draft still carries.
 *
 * A draft whose body still starts with this REFUSES TO POST. It puts a note in the thread
 * saying the copy is not written instead. An unwritten message must be impossible to send
 * by accident and impossible to miss, and a placeholder that quietly posts itself is both
 * of the opposite things.
 */
export const TODO_MARKER = "TODO:";

export interface DraftCopy {
  /** The Slack label above the body. Internal, never sent. */
  label: string;
  /** The message itself. {tokens} are substituted. */
  body: string;
  /** Which {tokens} this draft can use. Documentation, and checked in dev. */
  tokens: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The two structural lines
// ─────────────────────────────────────────────────────────────────────────────

/** Appended to the intro. Sets which channel carries what, once, in writing. */
export const CHANNEL_LINE = guard(
  "intro channel line",
  "Anything quick, message me here. Anything contractual, invoices, agreements, changes to what we are doing, goes by email so we both have a record of it."
);

/**
 * Appended to the intro. NOT politeness.
 *
 * For a clinic this is the difference between a marketing chat and patient information
 * sitting in a consumer messaging app on two phones. It is stated once, plainly, at the
 * start, because the first time a front desk forwards a patient question is too late.
 */
export const NO_CUSTOMER_INFO_LINE = guard(
  "intro no customer info line",
  "One thing to keep us both clean: please keep this thread to marketing. No customer or patient details here, no names, no records, nothing about anyone's treatment. If something like that needs to reach me it goes through the proper channel, not WhatsApp."
);

// ─────────────────────────────────────────────────────────────────────────────
// The six drafts
// ─────────────────────────────────────────────────────────────────────────────

export const DRAFT_COPY: Record<string, DraftCopy> = {
  // 1 ── The intro. Fires the moment intake completes.
  //
  // The one that has to be right: it sets the channel for the whole relationship, and it
  // is the first message they get from a person rather than from a form. CHANNEL_LINE and
  // NO_CUSTOMER_INFO_LINE are appended after whatever you write here.
  intro: {
    label: "Intro, first message after intake",
    tokens: ["businessName", "firstName", "city"],
    body: guard(
      "draft intro",
      "TODO: write the intro. It goes to {firstName} at {businessName} the moment they finish intake. Say who you are, that this is the number to reach you on, and what happens next. The channel line and the no customer information line are added automatically underneath, so do not write them here."
    ),
  },

  // 2 ── ASK: Google Business Profile manager access. Step access_granted.
  ask_gbp_access: {
    label: "Ask: Google Business Profile manager access",
    tokens: ["businessName", "firstName"],
    body: guard(
      "draft ask gbp access",
      "TODO: write the Google Business Profile access ask. They add us as a manager, we never ask for a password, and they stay the owner. Say what you need and how long it takes."
    ),
  },

  // 3 ── ASK: the DNS records. Step dns_records.
  //
  // THREE RECORDS. TWO CNAMES AND ONE TXT. Say it that way, because "CNAME and TXT" reads
  // as two and that is exactly where the count drifted last time. The tokens give you the
  // real hostnames for this client, so you do not have to describe them generically.
  //
  // All three go in on the call even though the reviews host is not built yet: an
  // unattached CNAME simply does not resolve, nobody visits it before the cards are
  // printed, and getting a client back into their registrar weeks later is worse than a
  // record sitting idle for a fortnight.
  ask_dns: {
    label: "Ask: the three DNS records",
    tokens: ["businessName", "firstName", "hubHost", "reviewHost", "domain"],
    body: guard(
      "draft ask dns",
      "TODO: write the DNS ask. Three DNS records: two CNAMEs and one TXT. The CNAMEs are {hubHost} and {reviewHost}, the TXT is on {domain} for Search Console. We do it together on the call with them driving in their own registrar, and we never ask for their login."
    ),
  },

  // 4 ── NOTIFY: the baseline scan is done. Step baseline_scan.
  //
  // headline is the one finding worth leading with. It is passed in rather than generated,
  // so this draft never invents a result.
  notify_baseline: {
    label: "Notify: baseline scan done",
    tokens: ["businessName", "firstName", "headline"],
    body: guard(
      "draft notify baseline",
      "TODO: write the baseline scan notification. The scan has run and there is something to show them. {headline} carries the finding you want to lead with. Do not promise what it will turn into, just tell them it is done and what you saw."
    ),
  },

  // 5 ── NOTIFY: the first page is live. Step first_page.
  notify_first_page: {
    label: "Notify: first page live",
    tokens: ["businessName", "firstName", "pageUrl"],
    body: guard(
      "draft notify first page",
      "TODO: write the first page live notification. {pageUrl} is the page. Tell them it is up and what it is for. No traffic promises, no timeline for results."
    ),
  },

  // 6 ── REPORT: the monthly one. Manual, prompted by the day 30 / 60 / 90 reminder.
  report_monthly: {
    label: "Report: the monthly one",
    tokens: ["businessName", "firstName", "dayLabel", "headline"],
    body: guard(
      "draft report monthly",
      "TODO: write the monthly report message. {dayLabel} says which one it is, day 30, 60 or 90. A flat month gets a message too and it says the month was flat. Named, not named, named alongside, named instead. Never ranked."
    ),
  },
};

/** True while a draft is still the placeholder rather than real copy. */
export function isUnwritten(body: string): boolean {
  return body.trimStart().startsWith(TODO_MARKER);
}
