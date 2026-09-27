// The whole pre-booking conversation, as data.
//
// ‼️ THE IDENTITY FORM IS GONE (2026-09-04, second pass). /onboarding2 opened on six labelled
// fields, then handed over to a chat that booked a call. Matthew's call: make the chat ask for
// all of it, in the order somebody would actually answer, with the two easiest questions first.
// A form asks for six things before it has given anybody a reason to answer; a conversation that
// opens with "mornings or afternoons?" has already started booking a call by the time it asks
// for an email address.
//
// ‼️ THE ORDER IS THE PRODUCT DECISION AND IT IS NOT ALPHABETICAL OR TECHNICAL.
// The two things we can act on, then the taps, then the rest, then the calendar:
//
//   website -> phone -> daypart -> timezone -> name -> email -> day -> Calendly
//
// ‼️ THE WEBSITE AND THE PHONE MOVED TO THE FRONT ON 2026-09-27, AND THAT REVERSES WHAT THIS
// COMMENT USED TO ARGUE. It said: "The two taps cost nothing and commit somebody to booking. A
// conversation that opens with mornings or afternoons has already started booking a call by the time
// it asks for an email address." That is a real effect and it is being traded away deliberately.
//
// Matthew's call, and the trade is about what a drop-out leaves behind. Somebody who taps a daypart
// and a timezone and then abandons has left us two facts we can do nothing with: we cannot audit a
// timezone or ring a daypart. Somebody who gives a website and a phone and then abandons has left the
// two fields the entire delivery lane is built from, and a person who can follow up. The commitment
// argument still holds for the taps; it just no longer outranks having something to act on.
//
// The day is still asked LAST of the conversational steps, immediately before the calendar, so the
// three options are computed against a timezone we already hold.
//
// ‼️ THE MODEL IS NOT IN ANY OF THIS. Every step here is matched by a plain function and answered
// with fixed copy, on turns that never reach Claude, exactly as the scheduling close already was.
// That is what keeps "the assistant cannot hand out a calendar link" true, and it is also why
// seven questions cost nothing per lead.
//
// ‼️ TWO THINGS THE FORM DID THAT THIS DOES NOT, RECORDED RATHER THAN QUIETLY DROPPED:
//   1. The honeypot and the MIN_FILL_SECONDS time trap were on screen one. The chat has its own
//      bounds (per-IP start cap, per-IP hourly turn cap, per-signing turn caps, MIN_TURN_GAP_MS)
//      and they are stricter in aggregate, but a form-filling bot now meets a different wall
//      rather than the same one.
//   2. It collected `businessLegalName` and `signerTitle`. Neither is asked here. The agreement
//      those two fed is no longer signed in this funnel, and the business name is asked as the
//      first post-booking question instead, where it costs nothing.

import { ASK_PHONE, ASK_WEBSITE } from "@/config/onboarding2";
import { clean, validEmail } from "@/lib/medspa/validate";
import { normalizeLeadPhone } from "@/lib/phone";
import { normalizeTarget } from "@/lib/scan/normalize";
import { readDaypart, readTimezone } from "./scheduling";
import type { Onboarding2LeadRow, Onboarding2SigningRow } from "./types";

/** The seven, in order. `day` is last and is handled by the caller, which needs dayOptions(). */
export type IntakeKey =
  | "website"
  | "phone"
  | "daypart"
  | "timezone"
  | "name"
  | "email"
  | "day";

/**
 * The daypart and the timezone, recovered from what they already said.
 *
 * ‼️ THERE IS NO COLUMN FOR THESE TWO AND THAT IS A DELIBERATE CHOICE, NOT AN OVERSIGHT.
 *
 * onboarding2_leads is keyed on EMAIL, and the email is the fifth question, so the daypart and
 * the timezone are answered two and three questions before there is any lead row to write them
 * to. The obvious fix is a scratch column on onboarding2_signings. It was written, and then
 * replaced by this, for one reason: THE ANSWERS ARE ALREADY STORED. Every user turn is a row in
 * onboarding2_chat_turns, durable, ordered, and rebuilt into history on the next turn regardless.
 * A column would have been a second copy of a fact the transcript already holds, kept in sync by
 * hand, and it would have made this flow undeployable until somebody ran a migration.
 *
 * Both are also promoted onto the lead's own typed columns the moment the lead is created, so
 * this replay only ever runs for the first four turns of a conversation.
 *
 * ‼️ THE REPLAY MATCHES EXACTLY, AND IT DID NOT HAVE TO UNTIL 2026-09-27. It used to use
 * readDaypart and readTimezone, which match a word ANYWHERE in a turn, and that was safe for one
 * reason only: the daypart and the zone were questions one and two, so no free text had been typed
 * yet. The comment here said so, and said a business name like "Eastern Aesthetics" could not win
 * "because the real answer came first".
 *
 * Moving the website and the phone in front of them inverted exactly that. Both matchers use word
 * boundaries, so "morningstar.com" is safe, but "am-clinic.com" is not: the hyphen IS a word
 * boundary, so `am` matches and a visitor typing their own website would have silently answered
 * the daypart question and skipped it. "eastern-dental.com" does the same to the zone.
 *
 * So the replay now accepts a turn only when the WHOLE turn is the answer, which is what a tapped
 * chip always sends. The loose matchers are still exactly right at the point of PARSING, where the
 * question has just been asked and "mornings please" should be understood; they are wrong for
 * guessing which of seven past turns was an answer to a question nobody has been asked yet.
 */
const REPLAY_DAYPART: Record<string, "morning" | "afternoon"> = {
  morning: "morning",
  mornings: "morning",
  am: "morning",
  afternoon: "afternoon",
  afternoons: "afternoon",
  pm: "afternoon",
};

/** A turn stripped to the bare word, so "Mornings." and "mornings" are the same answer. */
function bare(turn: string): string {
  return turn.trim().toLowerCase().replace(/[.!,?]+$/, "");
}
export interface IntakeDraft {
  daypart?: "morning" | "afternoon";
  timezone?: string;
}

export function replayDraft(userTurns: string[]): IntakeDraft {
  const out: IntakeDraft = {};
  for (let i = 0; i < userTurns.length; i++) {
    const daypart = REPLAY_DAYPART[bare(userTurns[i])];
    if (!daypart) continue;
    out.daypart = daypart;
    for (let j = i + 1; j < userTurns.length; j++) {
      // The zone is still read with readTimezone, but only from a turn that is nothing else: its
      // own exact-match branch answers a bare "Eastern" and the loose one cannot be reached here.
      const zone = readTimezone(bare(userTurns[j]));
      if (zone && bare(userTurns[j]).split(/\s+/).length <= 2) {
        out.timezone = zone;
        break;
      }
    }
    break;
  }
  return out;
}

/**
 * Which question is outstanding, or null when the conversation is ready for the calendar.
 *
 * ‼️ IT IS DERIVED, NEVER STORED, AND THAT IS WHAT MAKES THE FUNNEL RESUMABLE. There is no
 * "current step" column to fall out of sync with the answers. A refresh, a new tab, a cold
 * instance and a re-sent turn all compute the same answer from the same three sources: the
 * signing row for the identity, the lead row for the day, and the transcript for the two that
 * are answered before a lead exists.
 *
 * ‼️ THE LEAD WINS OVER THE REPLAY WHEREVER BOTH COULD ANSWER. Once the email lands, the daypart
 * and the zone are on the lead's own columns; the replay is only how the first four turns know
 * where they are.
 */
export function nextIntakeStep(
  row: Onboarding2SigningRow,
  lead: Onboarding2LeadRow | null,
  userTurns: string[]
): IntakeKey | null {
  const draft = replayDraft(userTurns);

  if (!row.website) return "website";
  if (!row.contact_phone) return "phone";
  if (!(lead?.call_daypart || draft.daypart)) return "daypart";
  if (!(lead?.call_timezone || draft.timezone)) return "timezone";
  if (!row.contact_name) return "name";
  if (!row.email) return "email";
  if (!lead?.call_day) return "day";
  return null;
}

export interface StepCopy {
  prompt: string;
  /** Tappable chips, or an empty array for a free-text answer. */
  options: string[];
}

/**
 * ‼️ THE COPY LIVES HERE AND NOT IN config/onboarding2.ts, WHICH IS THE ONE PLACE THIS FILE
 * DEPARTS FROM THE HOUSE PATTERN. Every other funnel string in this app goes through guard() in
 * that config. These four are the questions of a state machine whose reader is three lines away,
 * and splitting a seven-step machine's prompts from its validators is how a step gets asked for
 * one thing and validated for another. The guard() rule they would have inherited is a ban on em
 * dashes; there are none, and _probe-onboarding2-intake.ts asserts it.
 */
export const INTAKE_COPY: Record<Exclude<IntakeKey, "day" | "daypart" | "timezone">, StepCopy> = {
  // ‼️ THE FIRST TWO PROMPTS CARRY NO "Perfect" OR "Got it", BECAUSE NOTHING CAME BEFORE THEM.
  // Every prompt here used to open by acknowledging the previous answer, which reads correctly in the
  // middle of a conversation and reads like a non sequitur as the opening line of one.
  website: {
    prompt: ASK_WEBSITE,
    options: [],
  },
  phone: {
    prompt: ASK_PHONE,
    options: [],
  },
  name: {
    prompt: "Got it. And your full name?",
    options: [],
  },
  email: {
    prompt: "Thanks. What is the best email for you?",
    options: [],
  },
};

export type ParseResult =
  | { ok: true; value: string; extra?: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Read one answer for one step.
 *
 * ‼️ THE VALIDATORS ARE THE SAME FUNCTIONS /api/onboarding2/email USES, IMPORTED RATHER THAN
 * RESTATED. normalizeTarget is the gate the scanner and the hub lane both use, so anything
 * accepted here is something intakePatchFrom() can later turn into a real domain. A second,
 * looser regex living in the chat would let a website through the conversation that the delivery
 * board could not use, and nobody would find out until step 3.
 *
 * ‼️ WHAT IS STORED IS WHAT THEY TYPED. The normalised form is derived at delivery time. A funnel
 * that silently rewrote somebody's answer would be editing their input.
 */
export function parseIntake(step: IntakeKey, typed: string): ParseResult {
  if (step === "daypart") {
    const daypart = readDaypart(typed);
    return daypart
      ? { ok: true, value: daypart }
      : { ok: false, error: "Just tap one of the options below." };
  }

  if (step === "timezone") {
    const zone = readTimezone(typed);
    return zone
      ? { ok: true, value: zone }
      : { ok: false, error: "Just tap one of the options below." };
  }

  if (step === "website") {
    const typedSite = clean(typed, 300);
    if (!typedSite || !normalizeTarget(typedSite).ok) {
      return { ok: false, error: "That website address does not look right. Try again?" };
    }
    return { ok: true, value: typedSite };
  }

  if (step === "name") {
    // Two characters and at least one letter. This is a name field on a phone, not an identity
    // check, and the same rule the form used.
    const name = clean(typed, 120);
    if (name.length < 2 || !/\p{L}/u.test(name)) {
      return { ok: false, error: "Your full name, please." };
    }
    return { ok: true, value: name };
  }

  if (step === "email") {
    const email = clean(typed, 254).toLowerCase();
    if (!email || !validEmail(email)) {
      return { ok: false, error: "That email does not look right. Try again?" };
    }
    return { ok: true, value: email };
  }

  if (step === "phone") {
    // ‼️ BOTH FORMS, ALWAYS. E.164 is what every system downstream joins on; the typed string is
    // what the person wrote. normalizeLeadPhone returns the digits as given when it cannot make a
    // US number of them, so a leading + and ten digits is the real test rather than a truthy one.
    const typedPhone = clean(typed, 40);
    const e164 = typedPhone ? normalizeLeadPhone(typedPhone) : "";
    if (!typedPhone || !/^\+?\d{10,15}$/.test(e164)) {
      return { ok: false, error: "That number does not look right. Ten digits is enough." };
    }
    return { ok: true, value: e164, extra: { typed: typedPhone } };
  }

  return { ok: false, error: "Just tap one of the options below." };
}
