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
    // {city} is available and deliberately unused. An absent token leaves the sentence
    // around it behind, so "in {city}" degrades to "in today" rather than to nothing.
    // Optional tokens belong at the end of a clause or nowhere.
    body: guard(
      "draft intro",
      "Hi {firstName}, it is Matthew from SRT. Thanks for getting the form done.\n\n" +
        "This is my number, save it. Anything you need, you come straight here rather than to an inbox.\n\n" +
        "First thing on my end is the baseline. I take the questions your customers ask before they pick anybody, run them into the AI engines, and write down exactly what comes back about {businessName} today, before we change a thing. Then we get on a call and I walk you through it."
    ),
  },

  // 2 ── ASK: Google Business Profile manager access. Step access_granted.
  ask_gbp_access: {
    label: "Ask: Google Business Profile manager access",
    tokens: ["businessName", "firstName"],
    // No token carries the SRT address, so the ask points at the message it arrived in
    // rather than at an invented {ourEmail}. One less thing to keep in step by hand.
    body: guard(
      "draft ask gbp access",
      "{firstName}, one small job for you when you have two minutes.\n\n" +
        "Add me as a manager on your Google Business Profile. Use the email address my welcome message came from.\n\n" +
        "On google.com/business it is Settings, then People and access, then Add.\n\n" +
        "You stay the owner. You can take the access off me whenever you want, and I never need your password."
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
      "{firstName}, the next step is about five minutes inside whatever account your domain is registered with. GoDaddy, Squarespace, whoever you bought it from.\n\n" +
        "There are three DNS records to add: two CNAMEs and one TXT.\n\n" +
        "The two CNAMEs are {hubHost} and {reviewHost}. The TXT sits on {domain} itself and is the Google Search Console verification.\n\n" +
        "We do it together on the call. You stay logged in and you do the typing, I read the values out. I never need your login, and nothing on your existing website changes."
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
      "{firstName}, the baseline is done for {businessName}.\n\n" +
        "{headline}\n\n" +
        "That is the starting point, written down before we touch anything, so every re-test after this gets measured against the same thing rather than against a memory of it.\n\n" +
        "I will take you through the full set on the call."
    ),
  },

  // 5 ── NOTIFY: the first page is live. Step first_page.
  notify_first_page: {
    label: "Notify: first page live",
    tokens: ["businessName", "firstName", "pageUrl"],
    body: guard(
      "draft notify first page",
      "{firstName}, the first page is up:\n\n" +
        "{pageUrl}\n\n" +
        "It answers one of the questions people ask before they pick anyone, and it is written so an AI engine can quote it and say where the answer came from.\n\n" +
        "Have a read when you get a second. If anything on it about the business is wrong, tell me and I will change it today."
    ),
  },

  // 6 ── REPORT: the monthly one. Manual, prompted by the day 30 / 60 / 90 reminder.
  report_monthly: {
    label: "Report: the monthly one",
    tokens: ["businessName", "firstName", "dayLabel", "headline"],
    // A flat month gets this message too, and says the month was flat. The measure is
    // named, not named, named alongside, named instead. Never a rank: there is no
    // position column anywhere in the pipeline, so a number here would be invented.
    body: guard(
      "draft report monthly",
      "{firstName}, the {dayLabel} re-test is done for {businessName}.\n\n" +
        "Same questions, same engines, same wording as the baseline, so this is like for like and not a fresh look at it.\n\n" +
        "{headline}\n\n" +
        "Anything that has not moved, I have said so rather than dressed it up. Full sheet is on its way over and we can go through any of it."
    ),
  },

  // 7 ── ASK: the story nudge. Early in the week, twice-weekly rhythm, first of the pair.
  //
  // ‼️ THE ASK IS A VOICE NOTE AND THAT IS THE WHOLE MECHANIC. A business owner between
  // appointments will not type three paragraphs about a case, and asking them to is how
  // this goes quiet in week two. Talking for forty seconds costs them nothing and gives
  // us more usable material than a typed answer would. Say so explicitly every time.
  //
  // It goes out BEFORE the question set, deliberately. A story they volunteered is better
  // material than an answer to a question we picked, so it gets first refusal on the week.
  ask_stories: {
    label: "Ask: anything interesting this week",
    tokens: ["businessName", "firstName", "city"],
    body: guard(
      "draft ask stories",
      "{firstName}, quick one. Anything interesting come through the door this week?\n\n" +
        "A job that went better than expected, a question somebody asked that you had not heard before, something you talked a customer out of. Whatever is fresh.\n\n" +
        "Send it as a voice note, no need to write anything. If there is a story in it I will turn it into a page and send it to you before it goes up."
    ),
  },

  // 8 ── ASK: the question set. Later in the week, second of the pair.
  //
  // {questions} arrives already formatted as lines, derived from what the engines actually
  // asked about this business. It is NOT typed on the board: a question nobody is asking
  // produces a page nobody is looking for, which is the entire failure this product exists
  // to fix. When there are no questions to send, the digest skips the week rather than
  // inventing some, so this token is never empty.
  ask_content: {
    label: "Ask: this week's questions",
    tokens: ["businessName", "firstName", "questions"],
    body: guard(
      "draft ask content",
      "{firstName}, here is this week's pair. Both are things people actually ask before they pick somebody in your line of work.\n\n" +
        "{questions}\n\n" +
        "Voice note is easiest, just answer them the way you would answer a customer standing in front of you. Say more than you think is needed, I will cut it down.\n\n" +
        "I write it up in your words, you read it, and nothing goes live until you say so."
    ),
  },
};

/** True while a draft is still the placeholder rather than real copy. */
export function isUnwritten(body: string): boolean {
  return body.trimStart().startsWith(TODO_MARKER);
}
