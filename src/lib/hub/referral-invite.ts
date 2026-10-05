// The referral invite: who she would send our way, what both of them get, and how the friend is
// reached.
//
// ‼️ THE OFFER IS CONSIDERATION FOR A REFERRAL AND NEVER FOR A REVIEW, AND EVERY RULE BELOW IS
// DOWNSTREAM OF THAT SENTENCE.
//
// client-intake.ts asks every clinic "do you currently offer anything in exchange for a review?",
// sets review_incentive_flag when they say yes, and its comment says the practice "stops before
// it is built on". That question and that flag are untouched by this file and still mean exactly
// what they meant, because this is a different thing:
//
//   - both codes are earned by NAMING A FRIEND, not by writing or posting anything
//   - they are shown and recorded BEFORE she has typed a word of her review
//   - a No to the recommend question takes nothing away: she reaches the same review questions,
//     the same editable box, the same copy button and the same destination links
//   - no string in this file, or in review-script.ts, mentions a review near the offer
//
// scripts/_probe-review-gating.ts asserts the last one against this file's source, because it is
// the one that a well-meaning copy edit would break first.
//
// ‼️ SHE NOW GETS A REWARD TOO (2026-10-05), WHICH IS A REAL CHANGE TO THE RISK AND IS MATTHEW'S
// CALL. "refer a friend for 20% off on your next session and the friend gets 20% off also."
// Until now only the friend was offered anything, which kept the person writing the review
// entirely outside the transaction. The mitigation that keeps this an ordinary refer-a-friend
// programme rather than a paid review: HER reward is earned when the FRIEND claims, which is an
// event she does not control and that has nothing to do with whether she posts. The copy says so,
// and nothing anywhere offers her a thing for the review itself.
//
// ‼️ WE DO NOT SEND THE MESSAGE. SHE DOES, FROM HER OWN PHONE, OR NOBODY DOES AND THE CLINIC
// FOLLOWS UP. Mission Control has no SMS sender wired to this lane: the LoopMessage, iMessage and
// SalesTwin senders are other applications with their own numbers and their own consent stories.
// Beyond that, the friend never gave anybody their number, so a text sent from our servers on the
// clinic's behalf is the clinic's TCPA exposure, created by our button. The two modes below are
// the two honest shapes that has: her thumb, or a human at the clinic.
//
// ‼️ THE FRIEND'S DETAILS DO NOT GO IN review_tool_submissions. That table was built with no
// column for a name, an email or a phone and its migration says "the absence of the column is the
// enforcement". A friend's contact is PII belonging to a THIRD PARTY who is not even the person
// using the tool. It goes to referral_invites, which points AT a submission rather than being
// pointed at from one, so the submissions table gains nothing.

import { guard } from "@/lib/copy-guard";

/**
 * How long a code is good for. Matthew, 2026-10-05: "14 days max so they can go claim."
 *
 * ‼️ A HARD EXPIRY AND NOTHING ELSE. No reminder, no nudge, no cron. Reminding the friend would
 * mean messaging a person who still has not given anybody permission to message them, which is
 * the whole reason we are not the sender in the first place.
 */
export const INVITE_TTL_DAYS = 14;

/** When a code minted now stops working. */
export function inviteExpiry(from: Date = new Date()): Date {
  const out = new Date(from);
  out.setDate(out.getDate() + INVITE_TTL_DAYS);
  return out;
}

/**
 * The two shapes the referral can take, which is the choice Matthew asked to see both of.
 *
 * `text`     She sends it. The invite step opens a message already written on her own phone,
 *            with the clinic as a second recipient where the clinic has a number on file, so the
 *            clinic is on the thread from the first message and the friend has a real person to
 *            reply to. Her thumb is the send button.
 *
 * `internal` Nobody sends anything. The referral is recorded, she is told the clinic will reach
 *            out, and a human at the clinic works the lead. No message leaves the building, so
 *            there is no consent question at all.
 *
 * ‼️ BOTH WRITE THE SAME ROW AND BOTH MINT THE SAME CLAIM LINK. The difference is only who puts
 * the link in front of the friend. That is what lets a clinic switch between them without
 * changing anything a patient sees up to that point, and what makes the comparison fair.
 */
export type InviteMode = "text" | "internal";

export const DEFAULT_INVITE_MODE: InviteMode = "text";

export function readInviteMode(raw: unknown): InviteMode {
  return raw === "internal" ? "internal" : DEFAULT_INVITE_MODE;
}

/**
 * How a `text` invite opens.
 *
 * ‼️ ONLY `sms` IS ACTUALLY THREE-WAY, AND THE LABELS MUST NOT PRETEND OTHERWISE. A WhatsApp
 * deep link (wa.me) takes exactly ONE recipient and cannot open a group, so that option is her
 * messaging the friend one to one and the clinic is not in it. Calling it a 3-way text on screen
 * would be a promise the link cannot keep, so its label says what it is.
 */
export type InviteChannel = "sms" | "whatsapp" | "copy";

export interface InviteChannelOption {
  key: InviteChannel;
  /** What she taps. Says what will actually happen, including who is on the thread. */
  label: string;
  /** Whether the clinic ends up on the thread. Drives the label and nothing else. */
  threeWay: boolean;
}

export const INVITE_CHANNELS: readonly InviteChannelOption[] = [
  {
    key: "sms",
    label: guard("invite sms", "Text us both"),
    threeWay: true,
  },
  {
    key: "whatsapp",
    // Named for what it is: her to the friend, no clinic on the thread.
    label: guard("invite whatsapp", "WhatsApp them"),
    threeWay: false,
  },
  {
    key: "copy",
    label: guard("invite copy", "Copy the message"),
    threeWay: false,
  },
] as const;

/** The tokens a message template may carry. No template literals, same rule as review-script.ts. */
export const INVITE_TOKENS = {
  friend: "{friend}",
  business: "{business}",
  service: "{service}",
  offer: "{offer}",
  link: "{link}",
  days: "{days}",
} as const;

export interface InviteTemplate {
  key: string;
  /** What the front desk sees when picking. Never sent. */
  label: string;
  body: string;
}

/**
 * The three messages, which is the "options for that 3 way text" Matthew asked for.
 *
 * ‼️ EVERY ONE OF THEM IS IN HER VOICE, BECAUSE IT IS SENT FROM HER PHONE. A message that reads
 * like the clinic wrote it, arriving from her number, is the thing that makes a friend feel
 * handed over rather than recommended. So no "we" that means the clinic, no marketing line, and
 * the clinic is referred to by name.
 *
 * ‼️ EACH ONE ENDS IN A LINK AND NOT IN A CODE. Matthew, 2026-10-05: "lets just make sure we send
 * a link with a form they can complete so the customer receives the lead." A code read off a
 * phone screen and quoted at a desk needs the friend to turn up before the clinic knows they
 * exist; a form means the clinic has the lead the moment the friend fills it in, whether or not
 * they ever walk in. The code still exists and still expires, it just travels inside the URL.
 *
 * ‼️ AND NOT ONE OF THEM MENTIONS A REVIEW. Checked by the probe. The friend is being offered
 * something for coming in, which is an ordinary refer-a-friend deal; the moment the message ties
 * the offer to the review she is about to write, it becomes an incentivised review with an
 * undisclosed material connection, and that is the line this lane does not cross.
 */
export const INVITE_TEMPLATES: readonly InviteTemplate[] = [
  {
    key: "warm",
    label: guard("invite warm label", "Warm"),
    body: guard(
      "invite warm",
      "Hi {friend}, I just had {service} done at {business} and I really liked it. " +
        "They are giving you {offer} if you want to try them. " +
        "Here is the link, it is good for {days} days: {link}"
    ),
  },
  {
    key: "short",
    label: guard("invite short label", "Short"),
    body: guard("invite short", "{friend}, you should try {business}. {offer}: {link}"),
  },
  {
    key: "intro",
    label: guard("invite intro label", "Introduction"),
    body: guard(
      "invite intro",
      "{friend}, meet {business}. I had {service} done with them and it was great. " +
        "They are giving you {offer}. Fill this in and they will look after you: {link}. " +
        "I will let you two take it from here."
    ),
  },
] as const;

export function templateByKey(key: string): InviteTemplate {
  return INVITE_TEMPLATES.find((t) => t.key === key) ?? INVITE_TEMPLATES[0];
}

export interface InviteFacts {
  friendName: string;
  businessName: string;
  serviceLabel: string;
  /** What the FRIEND gets. Never her own reward: that is not the friend's business. */
  offerText: string;
  /** Where the friend claims it. See claimUrl(). */
  link: string;
}

/**
 * Fill a template. One place, so the message she previews and the message that opens cannot
 * differ.
 *
 * ‼️ HER OWN REWARD IS NOT A TOKEN HERE, DELIBERATELY. The message goes to the friend, and a
 * friend reading "and she gets 20% off for sending you this" is being told they are the
 * mechanism of somebody else's discount. She is told what she gets, on screen, by the walk.
 *
 * A missing fact becomes an empty string rather than the token, because a patient must never see
 * the literal "{offer}" in a message about to go to her friend.
 */
export function fillInvite(body: string, facts: InviteFacts): string {
  return body
    .split(INVITE_TOKENS.friend)
    .join(facts.friendName.trim())
    .split(INVITE_TOKENS.business)
    .join(facts.businessName.trim())
    .split(INVITE_TOKENS.service)
    .join(facts.serviceLabel.trim())
    .split(INVITE_TOKENS.offer)
    .join(facts.offerText.trim())
    .split(INVITE_TOKENS.link)
    .join(facts.link.trim())
    .split(INVITE_TOKENS.days)
    .join(String(INVITE_TTL_DAYS))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The code the friend's link carries.
 *
 * ‼️ NOT A SECRET AND NOT A BEARER TOKEN. It names one deal on one clinic, and the claim form it
 * opens asks the friend who they are rather than assuming. The alphabet drops every character
 * that is ambiguous out loud or in handwriting, because somebody will read one over a phone: no
 * O or 0, no I, L or 1, no S or 5, no B or 8.
 */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY234679";
const CODE_LENGTH = 6;

export function inviteCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** A code as typed or pasted by a human: upper-cased, everything else dropped. */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The shape of a claim path, shared by the link builder and the hub allowlist. */
export const CLAIM_PATH_PREFIX = "/r/";

/**
 * Where the friend claims the offer.
 *
 * ‼️ ON THE CLINIC'S OWN REVIEWS HOST, NOT ON mission.srtagency.com. The patient is texting this
 * to somebody she knows and vouching for the clinic; a link to an agency domain reads as a
 * forwarded advert and is the single easiest thing for the friend to distrust. The host is the
 * one their QR cards already resolve to.
 *
 * Falls back to the app's own origin when the clinic has no reviews host attached, because a
 * referral that produces an unopenable link is worse than an off-brand one.
 */
export function claimUrl(host: string | null, code: string, fallbackOrigin: string): string {
  const base = host ? `https://${host}` : fallbackOrigin.replace(/\/+$/, "");
  return `${base}${CLAIM_PATH_PREFIX}${normaliseCode(code)}`;
}

/**
 * A phone number reduced to what a `sms:` URI can carry.
 *
 * Digits and a leading plus, nothing else. Not validation and not E.164: this is a href, and a
 * number the operating system cannot dial is a message she can fix in her own messages app,
 * whereas refusing her friend's number at the counter ends the referral.
 */
export function dialable(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^0-9]/g, "");
}

export interface ComposeInput {
  channel: InviteChannel;
  /** The friend's number. Required for sms and whatsapp, ignored by copy. */
  friendContact: string;
  /** The clinic's number, so the thread is three-way. Absent means her and the friend only. */
  clinicContact?: string | null;
  message: string;
}

export type ComposeResult =
  /** Open this href. Nothing has been sent; she still has to press send. */
  | { kind: "open"; href: string; threeWay: boolean }
  /** Nothing to open. Put the text on the clipboard. */
  | { kind: "clipboard"; text: string }
  /** The caller asked for something this build cannot do. */
  | { kind: "unavailable"; reason: string };

/**
 * Build the thing the invite button does in `text` mode.
 *
 * ‼️ IT RETURNS AN HREF AND NEVER PERFORMS A SEND. There is no fetch in this module and there must
 * not be one. The only way a message leaves is her own messages app, with her finger on the
 * button, which is what makes her the sender of record rather than us.
 */
export function composeInvite(input: ComposeInput): ComposeResult {
  const body = input.message.trim();
  if (!body) return { kind: "unavailable", reason: "There is no message to send." };

  if (input.channel === "copy") return { kind: "clipboard", text: body };

  const friend = dialable(input.friendContact);
  if (!friend) return { kind: "unavailable", reason: "We need their phone number first." };

  if (input.channel === "whatsapp") {
    // wa.me takes ONE recipient. The clinic is not on this thread and the label says so.
    return {
      kind: "open",
      href: `https://wa.me/${friend.replace("+", "")}?text=${encodeURIComponent(body)}`,
      threeWay: false,
    };
  }

  // ‼️ `sms:` WITH TWO RECIPIENTS IS THE ONLY TRUE THREE-WAY HERE, AND THE SHAPE BELOW IS THE
  // CROSS-PLATFORM ONE. iOS wants the addresses comma separated before the query and Android
  // accepts the same, so `sms:a,b?&body=` is the form both honour. A group is created by the
  // operating system, not by us, which is why the clinic's number has to be real for the thread
  // to include them: a blank one degrades to a normal text from her to the friend.
  const clinic = input.clinicContact ? dialable(input.clinicContact) : "";
  const to = [friend, clinic].filter(Boolean).join(",");
  return {
    kind: "open",
    href: `sms:${to}?&body=${encodeURIComponent(body)}`,
    threeWay: Boolean(clinic),
  };
}

/** What the submit route writes to referral_invites. Not a review row and never stored as one. */
export interface ReferralInvite {
  clientId: string;
  submissionId: string | null;
  serviceLabel: string | null;
  /**
   * Both deals as they stood when she was shown them, so a later edit to the clinic's offers
   * cannot change what either person was promised.
   */
  offerSnapshot: {
    serviceLabel: string | null;
    offerText: string;
    referrerOfferText: string | null;
    templateKey: string;
  };
  code: string;
  friendName: string | null;
  friendContact: string | null;
  mode: InviteMode;
  channel: InviteChannel | null;
  expiresAt: string;
}
