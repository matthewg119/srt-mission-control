// The four emails a referral can produce, and who may receive each.
//
// ‼️ EVERY ONE IS OFF BY DEFAULT AND PER CLIENT. referralEmailConfig() in referral-config.ts is
// the gate; nothing here decides whether to send, it only decides what a message says. A clinic
// that has not discussed email with us sends none of these.
//
// ‼️ SRT IS THE ENVELOPE SENDER AND THE COPY SAYS SO. /users/{mailbox}/sendMail only reaches
// mailboxes inside this tenant, so a clinic's own address can never be the From. Writing a
// patient-facing email as though the clinic had sent it, out of an srtagency.com mailbox, would
// be a sender the recipient cannot verify and a reply nobody reads. So every message that reaches
// a member of the public says plainly that the clinic asked us to send it, and `replyTo` puts the
// clinic on the other end. A genuine from-the-clinic send needs a separate sending domain and a
// per-client delegation record. That is not this, and this does not pretend to be it.
//
// ‼️ THE WORD FOR WHAT SHE WRITES DOES NOT APPEAR IN ANY COPY HERE, AND A PROBE ENFORCES IT.
// scripts/_probe-review-gating.ts fails the build if a discount, an offer, a percentage or a code
// lands within eighty characters of it. That is the whole legal position of this lane: a reward
// for REFERRING somebody is an ordinary refer-a-friend programme, and a reward for writing
// something is an incentivised endorsement with an undisclosed material connection. The patient's
// reward is earned when her friend comes in. No message may connect the two, and the cheapest way
// to be certain is for these emails never to raise the subject at all.
//
// ‼️ NOTHING HERE THROWS. A failed send must never fail the walk or the claim: the patient has
// already finished at the counter and the friend is looking at a form they just submitted. Every
// entry point catches, logs and returns.
//
// ‼️ AND NOTHING IS SENT TO AN ADDRESS GIVEN SECOND HAND. The friend is written to at the address
// THEY typed on the claim form, never at the contact a patient recited at a counter; the patient
// at the address SHE typed. referral_invites.friend_contact is the clinic's record of who was
// referred, not a mailing list, and the header of
// src/app/api/hub/reviews/invite/route.ts says why that distinction is the architecture.

import { microsoft } from "@/lib/microsoft";
import { toGraphMailbox } from "@/config/outreach-mailboxes";
import type { ReferralEmailConfig } from "./referral-config";

/** Inline styles, because an email client is not a browser and a stylesheet does not travel. */
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const WRAP_OPEN = `<div style="font:16px/1.6 ${FONT};color:#14181f">`;
const WRAP_CLOSE = "</div>";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One paragraph.
 *
 * ‼️ IT ESCAPES, AND EVERY CALLER PASSES PLAIN TEXT. Three of these messages quote a name and a
 * contact detail that a member of the public typed into a form, straight into an HTML email. An
 * unescaped build here is the one place in this lane where somebody else's input becomes markup.
 */
function p(text: string): string {
  return `<p style="margin:0 0 16px">${escapeHtml(text)}</p>`;
}

/**
 * The line that says who actually sent this and why.
 *
 * ‼️ ON EVERY MESSAGE THAT REACHES A MEMBER OF THE PUBLIC. The From address is ours and the
 * message is about somebody else's business, which is exactly the case where the recipient is
 * entitled to be told. Clinic-facing notices do not carry it: they already know who we are.
 */
function sentFor(clinicName: string): string {
  return (
    `<p style="margin:24px 0 0;font-size:13px;color:#6b7280">` +
    `${escapeHtml(clinicName)} asked SRT to send this on their behalf. ` +
    `Reply to this email and it reaches them.` +
    `</p>`
  );
}

async function send(args: {
  to: string;
  subject: string;
  html: string;
  config: ReferralEmailConfig;
  label: string;
}): Promise<void> {
  try {
    await microsoft.sendMail({
      to: args.to,
      subject: args.subject,
      body: `${WRAP_OPEN}${args.html}${WRAP_CLOSE}`,
      isHtml: true,
      fromMailbox: toGraphMailbox(args.config.fromMailbox),
      // Undefined rather than our own address when the clinic has given none: a reply-to pointing
      // back at SRT would invite a patient to discuss her appointment with the wrong company.
      replyTo: args.config.replyTo ?? undefined,
    });
  } catch (e) {
    // Logged and swallowed. See the header: the person at the counter is already finished.
    console.error(`[hub/referral-emails] ${args.label} send failed:`, (e as Error).message);
  }
}

export interface ReferralFacts {
  clinicName: string;
  config: ReferralEmailConfig;
  /** What the patient said about her friend. Hearsay, and said to be hearsay in the copy. */
  friendName: string | null;
  friendContact: string | null;
  serviceLabel: string | null;
  /** What the friend was promised, frozen at the moment it was shown to her. */
  friendOfferText: string;
  /** What the patient was promised, when the clinic offers her anything at all. */
  referrerOfferText: string | null;
  code: string;
  /** "text" (she sent it herself) or "internal" (nobody sent anything). */
  mode: string;
  /** The claim link, when there is a live host to build one on. */
  claimUrl: string | null;
}

/**
 * The clinic hears that a patient referred somebody. Sent when the invite row is written.
 *
 * ‼️ THIS IS THE ONE THAT MATTERS IN `internal` MODE. There, nobody sent the friend anything: the
 * referral was recorded, the patient was told the clinic would reach out, and a human at the
 * clinic has to work it. Until this email existed that lead sat in a table nothing read, which is
 * what _probe-dead-wires.ts had been saying about these columns since they were created.
 */
export async function emailReferralCreated(facts: ReferralFacts): Promise<void> {
  const { config } = facts;
  if (!config.enabled || !config.notifyClinic || !config.notifyTo) return;

  const parts: string[] = [];
  parts.push(p("A patient just referred somebody."));

  if (facts.friendName) parts.push(p(`Their friend: ${facts.friendName}`));
  if (facts.friendContact) parts.push(p(`How to reach them: ${facts.friendContact}`));
  if (facts.serviceLabel) parts.push(p(`What your patient came in for: ${facts.serviceLabel}`));
  parts.push(p(`What their friend was promised: ${facts.friendOfferText}`));
  if (facts.referrerOfferText) {
    parts.push(p(`What your patient gets when they come in: ${facts.referrerOfferText}`));
  }
  parts.push(p(`Their code: ${facts.code}`));

  // ‼️ THE DETAILS ARE WHAT THE PATIENT SAID, AND THE CLINIC IS TOLD THAT. The migration keeps
  // what she said apart from what the friend later types for exactly this reason: a mismatch is
  // the clinic finding out the number was mistyped, not a fault to be reconciled away.
  parts.push(
    p("Those details are what your patient told us at the counter, so check them when you call.")
  );

  if (facts.mode === "internal") {
    parts.push(p("Nobody has contacted them. This one is yours to work."));
  } else {
    parts.push(p("Your patient messaged them from her own phone, with you on the thread."));
  }

  if (facts.claimUrl) parts.push(p(`Their link: ${facts.claimUrl}`));

  const who = facts.friendName ? `: ${facts.friendName}` : "";
  await send({
    to: config.notifyTo,
    subject: `New referral at ${facts.clinicName}${who}`,
    html: parts.join(""),
    config,
    label: "clinic referral notice",
  });
}

export interface ClaimFacts extends ReferralFacts {
  /** What the FRIEND typed: their own details, on the clinic's domain, told what it is for. */
  claimedName: string;
  claimedContact: string;
  claimedEmail: string | null;
  claimedService: string | null;
  /** The patient's own address, if she gave one at the invite step. Optional, always. */
  referrerEmail: string | null;
}

/**
 * Everything that goes out when the friend fills the claim form in. Up to three messages.
 *
 * ‼️ IT RUNS AFTER THE ROW IS WRITTEN AND NEVER BEFORE. The claim is the product; an email that
 * failed first and aborted the write would cost the clinic the lead this page exists to deliver.
 */
export async function emailReferralClaimed(facts: ClaimFacts): Promise<void> {
  if (!facts.config.enabled) return;

  await Promise.all([
    emailClinicOnClaim(facts),
    emailFriendOnClaim(facts),
    emailReferrerOnClaim(facts),
  ]);
}

async function emailClinicOnClaim(facts: ClaimFacts): Promise<void> {
  const { config } = facts;
  if (!config.notifyClinic || !config.notifyTo) return;

  const parts: string[] = [];
  parts.push(p("A referred friend just claimed theirs. They are expecting to hear from you."));
  parts.push(p(`Name: ${facts.claimedName}`));
  parts.push(p(`How to reach them: ${facts.claimedContact}`));
  if (facts.claimedEmail) parts.push(p(`Email: ${facts.claimedEmail}`));
  if (facts.claimedService) parts.push(p(`What they are interested in: ${facts.claimedService}`));
  parts.push(p(`What they were promised: ${facts.friendOfferText}`));
  parts.push(p(`Code: ${facts.code}`));

  // The two names disagreeing is worth saying out loud rather than leaving to be noticed.
  const said = (facts.friendName ?? "").trim().toLowerCase();
  const typed = facts.claimedName.trim().toLowerCase();
  if (said && typed && said !== typed) {
    parts.push(
      p(
        `Your patient gave the name as "${facts.friendName}" and they typed ` +
          `"${facts.claimedName}". Both are on the record, and neither is a mistake to correct.`
      )
    );
  }

  if (facts.referrerOfferText) {
    parts.push(
      p(
        `Your patient has now earned ${facts.referrerOfferText}, due when this one comes in.`
      )
    );
  }

  await send({
    to: config.notifyTo,
    subject: `Referral claimed at ${facts.clinicName}: ${facts.claimedName}`,
    html: parts.join(""),
    config,
    label: "clinic claim notice",
  });
}

/**
 * The friend hears what they claimed.
 *
 * ‼️ AT THE ADDRESS THEY TYPED, AND ONLY THAT ONE. Never friend_contact: that is a detail a
 * patient recited at a counter about somebody who had agreed to nothing. This address was typed
 * by its owner, on the clinic's own domain, under a line saying what it would be used for.
 */
async function emailFriendOnClaim(facts: ClaimFacts): Promise<void> {
  const { config } = facts;
  if (!config.emailFriend || !facts.claimedEmail) return;

  const parts: string[] = [];
  parts.push(p(`Thanks for claiming this at ${facts.clinicName}.`));
  parts.push(p(`What you have: ${facts.friendOfferText}`));
  parts.push(p(`Quote this when you book or when you arrive: ${facts.code}`));
  parts.push(p(`${facts.clinicName} has your details and will be in touch to book you in.`));
  parts.push(sentFor(facts.clinicName));

  await send({
    to: facts.claimedEmail,
    subject: `Your offer at ${facts.clinicName}`,
    html: parts.join(""),
    config,
    label: "friend claim confirmation",
  });
}

/**
 * The patient hears that her friend came in, and that her own reward is due.
 *
 * ‼️ IT FIRES AT THE CLAIM AND NOT AT THE INVITE, WHICH IS THE WHOLE POINT. Her reward is earned
 * when her friend actually turns up, so this is the first moment there is anything true to tell
 * her. Sending at the invite would promise her something nobody had yet earned, and that promise
 * is the difference between a referral programme and a payment.
 *
 * ‼️ AND IT SAYS NOTHING ABOUT WHAT SHE WROTE, because what she wrote has nothing to do with it.
 * See the module header.
 */
async function emailReferrerOnClaim(facts: ClaimFacts): Promise<void> {
  const { config } = facts;
  if (!config.emailReferrer || !facts.referrerEmail || !facts.referrerOfferText) return;

  const parts: string[] = [];
  parts.push(p("Good news. The friend you recommended has booked themselves in."));
  parts.push(p(`So this is yours: ${facts.referrerOfferText}`));
  parts.push(
    p(`Mention it next time you are in at ${facts.clinicName} and they will sort it out.`)
  );
  parts.push(sentFor(facts.clinicName));

  await send({
    to: facts.referrerEmail,
    subject: `Your referral came in at ${facts.clinicName}`,
    html: parts.join(""),
    config,
    label: "referrer reward notice",
  });
}
