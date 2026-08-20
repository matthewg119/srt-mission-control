// What an inbound email means, decided in code rather than by a model.
//
// WHY NOT A MODEL
// This runs on every inbound message on a 5-minute cadence, and its only job is to answer
// "may we keep emailing this person, and how urgently do they need a human". A model call here
// buys nuance we do not act on, costs latency on a hot path, cannot be unit tested, and fails
// by mis-scoring a real prospect. The pure version fails by sending an unclassifiable reply to
// the top of the digest, where a person reads it. That is the right direction to fail in.
//
// THE DEFAULT IS THE POINT. Anything unrecognised is an OBJECTION, which applyReply() schedules
// for today and the digest surfaces as HOT. A human reply never silently continues the ladder.
//
// Spanish is in the patterns from day one. A large share of this pipeline is Spanish-speaking
// (see call-coach-language.ts), and an English-only matcher would file every "si, mandalo"
// as an objection.

import type { ReplyClassification } from "./cadence";

/** Strip accents so "quitame" matches "quítame" without duplicating every pattern. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const OPT_OUT = [
  /\bunsubscribe\b/, /\bremove me\b/, /\btake me off\b/, /\bstop emailing\b/, /\bdo not (?:contact|email)\b/,
  /\bnot interested\b/, /\bno longer\b/, /\bopt.?out\b/, /\bleave me alone\b/,
  /\bquitame\b/, /\bno me interesa\b/, /\bno contacten\b/, /\bdar de baja\b/,
];

const PRICE = [
  /\bhow much\b/, /\bwhat(?:'s| is| does)? (?:it|this) cost\b/, /\bpricing\b/, /\byour rates?\b/,
  /\bprice\b/, /\bcuanto (?:cuesta|vale|es)\b/, /\bprecio\b/, /\btarifas?\b/,
];

const INTERESTED = [
  /\bsend it\b/, /\bsend (?:it |them |the )?over\b/, /\bgo ahead\b/, /\bsounds good\b/,
  /\bi'?d like\b/, /\byes,? please\b/, /^\s*(?:yes|yeah|yep|sure|ok(?:ay)?)\b/,
  /\blet'?s (?:do|talk|chat)\b/, /\binterested\b/, /\bmandalo\b/, /\benvialo\b/, /\bmandamelo\b/,
  /^\s*si\b/, /\bme interesa\b/,
];

/** "next week", "in 2 weeks", "next month", "after the holidays". */
function deferDaysFrom(text: string): number | undefined {
  if (/\bnext week\b|\bla proxima semana\b/.test(text)) return 7;
  if (/\bnext month\b|\bel proximo mes\b/.test(text)) return 30;
  if (/\bafter the holidays?\b|\bafter the new year\b/.test(text)) return 30;
  const n = /\bin (\d{1,2}) (day|week|month)s?\b/.exec(text);
  if (n) {
    const qty = Number(n[1]);
    const mult = n[2] === "day" ? 1 : n[2] === "week" ? 7 : 30;
    return Math.min(180, qty * mult);
  }
  if (/\bcheck back\b|\bcircle back\b|\breach out (?:again )?later\b|\bbusy right now\b/.test(text)) return 14;
  return undefined;
}

/**
 * Classify one inbound message from its subject and body preview.
 *
 * Order matters: an opt-out that also mentions price is an opt-out, and a price question that
 * also says "yes" is a price question, because that is the one a human should answer first.
 */
export function classifyReply(subject: string | null, bodyPreview: string | null): ReplyClassification {
  const raw = `${subject ?? ""}\n${bodyPreview ?? ""}`.trim();
  const text = fold(raw);
  const summary = raw.replace(/\s+/g, " ").slice(0, 200);

  if (OPT_OUT.some((re) => re.test(text))) {
    return { state: "CLOSED", summary, askedPrice: false, wantsOut: true };
  }
  if (PRICE.some((re) => re.test(text))) {
    return { state: "ASKED_PRICE_HOT", summary, askedPrice: true, wantsOut: false };
  }
  if (INTERESTED.some((re) => re.test(text))) {
    return { state: "REPLIED_INTERESTED", summary, askedPrice: false, wantsOut: false };
  }
  const deferDays = deferDaysFrom(text);
  if (deferDays) {
    return { state: "SENT_NO_REPLY", summary, askedPrice: false, wantsOut: false, deferDays };
  }
  // Unrecognised, and therefore owed a human today.
  return { state: "OBJECTION", summary, askedPrice: false, wantsOut: false };
}

// ── Automated mail ──────────────────────────────────────────────────
// An out-of-office is not a human and must never clear last_reply_at as if it were, or the
// nudge stops for someone who never actually read the email.

export const BOT_SENDER =
  /(mailer-daemon|postmaster|no-?reply|noreply|bounce|mailerdaemon|donotreply)/i;
export const BOT_SUBJECT =
  /^\s*(automatic reply|auto[- ]?reply|out of office|undeliverable|delivery status notification|mail delivery|undelivered mail|read:|fuera de la oficina|respuesta autom)/i;

/** A hard bounce. Continuing to email a dead address is the cheapest way to lose domain
 *  reputation, which matters more the moment send volume goes up. */
export const BOUNCE_SUBJECT =
  /^\s*(undeliverable|delivery status notification|mail delivery|undelivered mail|returned mail)/i;

export function isAutomated(from: string, subject: string | null): boolean {
  return BOT_SENDER.test(from) || BOT_SUBJECT.test(subject ?? "");
}

export function isBounce(from: string, subject: string | null): boolean {
  return /mailer-daemon|postmaster|mailerdaemon/i.test(from) || BOUNCE_SUBJECT.test(subject ?? "");
}
