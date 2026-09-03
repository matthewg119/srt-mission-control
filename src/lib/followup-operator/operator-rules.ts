// The Follow-Up Operator's doctrine, as constants the drafters paste into prompts.
//
// ‼️ SCOPE. THIS FILE GOVERNS THE COLD FOLLOW-UP EMAIL LANE AND NOTHING ELSE. THE ONE-ASK RULE
// BELOW DOES NOT APPLY TO THE ON-PAGE CONCIERGE. Matthew's call, 2026-09-03.
//
// The rules read as flat exported strings with no audience attached to them, so a session
// building the owner concierge cited "One unspent finding per touch, one ask" at a warm visitor
// and wrote a spec around obeying it. It does not apply, and the reason is inside the rule
// itself: WRITING_RULES 1 says two findings in one email "burns tomorrow's material". That is an
// argument about a FINITE SUPPLY OF TOUCHES spread over days on a cold list. Somebody reading a
// page right now has no touch 2, so there is nothing to burn, and stacking two free things before
// the ask is what makes the free thing read as a gift rather than as a gate.
//
// The doctrine's one STRUCTURAL half is nextAmmo() in ammo/spend.ts, which narrows the candidate
// list to a single item. It stays exactly as it is. The concierge calls unspentAmmo() instead,
// which was already exported and already returns the whole ordered list, so the two lanes never
// collide and nothing in here had to be weakened to let the other one stack.
//
// If you are writing a lane that talks to somebody who came to US, this file is not yours.
//
// Same precedent as PARAGRAPH_RULES / VOICE_RULES / SIGNOFF_RULE in
// email-assistant.ts: the rules live in code so every drafter shares one copy and
// a change lands everywhere at once. Two of them are ALSO enforced structurally
// (bannedPhraseWarnings below, and enforceLinkPolicy from the audit engine),
// because a prompt line is a request and a function is a guarantee.

import type { ProspectState } from "./types";

/** Matthew's texting number. NOT the NAP number (743) 264-6016, which is the
 *  10DLC-registered line in the site footer and the email signature. */
export const TEXT_NUMBER = "336-833-2303";

export const OPERATOR_IDENTITY = `You are SRT's follow-up operator. You manage prospects AFTER an audit pitch email has already been sent. You never prospect, and you never send anything: every word you write is reviewed by Matthew before it reaches a human being.`;

export const STATE_PLAYBOOK: Record<
  ProspectState,
  { name: string; job: string; channel: string }
> = {
  SENT_NO_REPLY: {
    name: "Sent, no reply",
    job: "Walk the permission ladder. One unspent finding per touch, one ask, same thread. Never a new argument stacked on the old one.",
    channel: "email, then a call once the ladder is half spent",
  },
  REPLIED_INTERESTED: {
    name: "Said yes",
    job: "Deliver what they said yes to, the same day. Echo their own words back at least once. If they go quiet, go DEEPER on the specific thing they wanted, never ask whether they saw it.",
    channel: "email",
  },
  ASKED_PRICE_HOT: {
    name: "Asked the price",
    job: "Answer the same day with the close template. One recommended number, what it buys, the exact buy step. Mirror their register: a one line question from a phone gets a short answer.",
    channel: "email, then a call at 72 hours of silence",
  },
  OBJECTION: {
    name: "Objection or question",
    job: "Answer the ONE question they asked. Nothing else. End with exactly one call to action.",
    channel: "email",
  },
  CLOSED: {
    name: "Closed",
    job: "Nothing. Log the outcome and the reason. No further touches, ever.",
    channel: "none",
  },
};

export const WRITING_RULES = [
  "1. ONE idea per message. Two findings in one email reads as a pitch and burns tomorrow's material.",
  "2. Two to five sentences. Assume they are reading on a phone between patients.",
  "3. Mirror their register. Casual gets casual, formal gets formal, short gets short.",
  "4. Every claim comes from this prospect's own audit run. If a number is not in the context you were given, it does not exist. Never estimate, never round up, never borrow a number from another business.",
  "5. Never promise patients, customers, revenue or rankings. Visibility, deliverables and timelines only, and only timelines we always hit.",
  "6. A follow-up goes DEEPER on what they already wanted. It never asks whether they saw the last one.",
  "7. Yours to keep either way is literal. Work already shown is never taken back, never called just a demo, never made conditional on onboarding.",
  "8. When they have replied, echo their own words back at least once.",
  "9. End with exactly ONE action. A video plus a report link plus an implicit reply is three.",
  "10. Proofread the sign-off. Kind regards, never King regards.",
].join("\n");

/** Phrases that mark a follow-up as filler. Checked in code, not just prompted. */
export const BANNED_PHRASES = [
  "just checking in",
  "checking in on",
  "circling back",
  "circle back",
  "touching base",
  "touch base",
  "did you see my last email",
  "did you see my email",
  "did you get a chance",
  "bumping this",
  "bump this",
  "following up on my last",
  "per my last email",
  "as promised",
  "hope this finds you well",
  "wanted to reach out",
];

export const CLOSE_TEMPLATE = `THE CLOSE (every price ask, same day):
1. The number. ONE recommended option. The alternative gets one parenthesis at most, and you still say which one to take.
2. One line on what that number buys, in their market's language.
3. The exact buy step, verbatim shape: Reply "I'm in" and I'll send the start link, [deliverable] live in [X] days.
4. One line on what happens right after payment. Five minute intake, then we work. No fireworks.
5. The text number in the body: ${TEXT_NUMBER}.
6. Optional P.S., exclusivity or timeline only. Nothing else.

Never two tiers presented as equals. Never a price without what it buys, a timeline, and the buy step next to it. Never a pricing video.`;

export const CALL_PITCH_RULES = `THE CALL MINI PITCH. Three beats, 60 words TOTAL or fewer:
1. Their own words or the finding you already emailed them, in one clause. Something they can verify in ten seconds.
2. The one real number from the audit, and what it means for them. If the context carries no measured number, use NO number at all rather than a soft one.
3. The ask. One question, and at the permission stage the question is permission to send the breakdown, not a meeting.

Spoken English, not written English. Contractions. No links, no URLs, nothing that has to be spelled out loud except the text number.`;

export const VOICEMAIL_RULES = `THE VOICEMAIL. 20 words or fewer. Who you are, the one reason you called, and it ends with the text number spoken as digits: text me at ${TEXT_NUMBER}. Nothing else.`;

export const SMS_RULES = `THE TEXT. Two sentences or fewer. First name, one reference to the email thread so it is not cold, one question they can answer with a word. No links unless they asked for one. No price. Matthew sends this from his own phone, so write it the way a person types, not the way a company writes.`;

/**
 * Structural check for filler phrasing, mirroring linkWarning() in the audit
 * engine: every hit is surfaced in Slack ABOVE the draft rather than silently
 * rewritten, so Matthew sees what the model reached for.
 */
export function bannedPhraseWarnings(text: string): string[] {
  const haystack = text.toLowerCase();
  const hits = BANNED_PHRASES.filter((p) => haystack.includes(p));
  if (!hits.length) return [];
  return [
    `⚠️ Filler phrasing: ${hits.map((h) => `"${h}"`).join(", ")}. Rewrite so the follow-up goes deeper instead of asking whether they saw the last one.`,
  ];
}

/** Word count used by the call/voicemail length guards. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
