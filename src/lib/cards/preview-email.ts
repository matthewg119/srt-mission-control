// What a clinic gets in their inbox after finishing /cards/p.
//
// ‼️ UNTIL THIS EXISTED THEY GOT NOTHING. The funnel's whole promise is "we will send the email
// with your free PDF card shortly", and a clinic that typed their address and then heard silence
// has been given a reason to assume the thing is not real. The #hot-leads card has shouted
// "OWES THEM THE PDF" since the lane shipped, but that is a note to Matthew, not an answer to them.
//
// ‼️ IT CARRIES THE CARD SINCE 2026-10-09, AND THE COPY MOVED WITH IT. It used to promise a PDF
// "shortly", made by a person, because renderReviewCard could only produce the neutral wording and
// the preview shows the offer one. That renderer takes a copy set now, so the real card, with
// their name and a code that opens their own page, is attached to this message. The sentence that
// said a person was making it is gone: it would be the one line in here that is no longer true.
//
// ‼️ THE ATTACHMENT IS OPTIONAL AND ITS ABSENCE IS NOT FATAL. A render failure must not cost the
// clinic the whole email, so the caller passes what it has and the copy below branches once.
//
// ‼️ SRT IS THE SENDER AND THERE IS NO PER-CLIENT FROM. Same position referral-emails.ts takes:
// /users/{mailbox}/sendMail only works for mailboxes in our own tenant, so a "from the clinic"
// option would be a lie the mail headers would contradict.
//
// ‼️ IT NEVER THROWS. Called with void from the route after the lead is already saved. A mail
// outage must not cost the lead, and the clinic's screen is finished before this runs.

import { microsoft } from "@/lib/microsoft";
import { connectedMailbox } from "@/config/outreach-mailboxes";
import { guard } from "@/lib/copy-guard";
import type { CardCopySet } from "@/config/card-preview";

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PreviewEmailFacts {
  firstName: string;
  /** Their clinic, when the link carried one. The email reads fine without it. */
  businessName: string | null;
  /** The words on the card they looked at. */
  copy: CardCopySet;
  /** Their best seller, as typed. */
  topProduct: string;
  /** What they said a referred friend gets. May be "Not decided yet". */
  referralOffer: string;
  /** They pressed the grey button, so a few design options are owed within two hours. */
  wantsCustom: boolean;
  /** True when the printable card is attached. False degrades the copy, never the send. */
  hasCard: boolean;
}

/**
 * The subject.
 *
 * ‼️ IT NAMES THE THING AND NOT THE COMPANY. A clinic owner who tapped a button ten seconds ago
 * is scanning for the card, not for us.
 */
export function previewEmailSubject(facts: PreviewEmailFacts): string {
  return facts.businessName
    ? `Your QR referral card for ${facts.businessName}`
    : guard("preview email subject", "Your QR referral card");
}

/** The body, as HTML. Plain enough to survive any client, because half of them are Outlook. */
export function previewEmailHtml(facts: PreviewEmailFacts): string {
  const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
  const name = escapeHtml(facts.firstName);
  const rows: string[] = [
    ["What the card says", `${facts.copy.promise} / ${facts.copy.scanLine}`],
    ["Your best seller", facts.topProduct || "not answered"],
    ["A referred friend gets", facts.referralOffer || "not answered"],
  ].map(
    ([k, v]) =>
      `<tr>` +
      `<td style="padding:6px 16px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>` +
      `<td style="padding:6px 0;color:#14181f">${escapeHtml(v)}</td>` +
      `</tr>`
  );

  return (
    `<div style="font:16px/1.6 ${FONT};color:#14181f">` +
    p(`Hi ${name},`) +
    p(
      facts.hasCard
        ? "Thanks for taking a look. Your QR referral card is attached, print ready. Print it " +
          "double sided on card stock and start handing it out."
        : "Thanks for taking a look. Your QR referral card is being put together and it will be " +
          "in your inbox as a print ready PDF shortly."
    ) +
    p("Here is what we have against your clinic:") +
    `<table style="border-collapse:collapse;margin:0 0 16px;font:15px/1.5 ${FONT}">${rows.join("")}</table>` +
    (facts.wantsCustom
      ? p(
          "<strong>You asked for a custom design.</strong> A few options will be with you within " +
            "two hours. Nothing is printed until you have picked one."
        )
      : "") +
    p(
      "Hand the card to every patient. They scan it at home, on their own phone, and answer a few " +
        "questions in their own words. Nothing is posted anywhere unless they post it."
    ) +
    // ‼️ SAID PLAINLY, BECAUSE A PRINTED CODE CANNOT BE CHANGED. The code on this card opens a
    // page on OUR host carrying their name. Once their own domain is pointed at us it moves to
    // reviews.{theirdomain} and that batch needs reprinting. A clinic that printed a thousand
    // without being told would have a right to be annoyed.
    p(
      "The code on this card opens your page on our address. On the setup call we point it at " +
        "your own domain, and that is the version to print in bulk."
    ) +
    // ‼️ THE CALL IS DESCRIBED, NOT CLAIMED. Whether they actually booked is Calendly's to know,
    // and this email is sent the moment the questions are answered, which is before the calendar
    // has been touched. "If you have picked a time" is the only honest form of this sentence.
    p(
      "If you picked a time for the fifteen minute setup, you will have a calendar invite " +
        "separately. That is where we set your offers and point the card at your own page."
    ) +
    p("Matthew<br/>SRT Agency") +
    `</div>`
  );
}

/**
 * Send it. Best effort, never throws, and silent when mail is not configured.
 *
 * ‼️ THE CLINIC'S OWN ADDRESS IS THE ONLY RECIPIENT. No bcc to ourselves: the #hot-leads card
 * already carries every one of these facts, and a copy of each one in a mailbox is a second
 * inbox to keep clear.
 */
export async function sendPreviewEmail(
  to: string,
  facts: PreviewEmailFacts,
  card?: { filename: string; bytes: Buffer } | null
): Promise<{ sent: boolean; error?: string }> {
  if (!to) return { sent: false, error: "no address" };
  try {
    await microsoft.sendMail({
      to,
      subject: previewEmailSubject(facts),
      body: previewEmailHtml(facts),
      isHtml: true,
      fromMailbox: connectedMailbox(),
      attachments: card
        ? [
            {
              name: card.filename,
              contentType: "application/pdf",
              contentBytes: card.bytes.toString("base64"),
            },
          ]
        : undefined,
    });
    return { sent: true };
  } catch (e) {
    console.error("[cards/preview-email] send failed:", (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}
