// What a clinic gets in their inbox after finishing /cards/p.
//
// ‼️ UNTIL THIS EXISTED THEY GOT NOTHING. The funnel's whole promise is "we will send the email
// with your free PDF card shortly", and a clinic that typed their address and then heard silence
// has been given a reason to assume the thing is not real. The #hot-leads card has shouted
// "OWES THEM THE PDF" since the lane shipped, but that is a note to Matthew, not an answer to them.
//
// ‼️ A LINK, NOT AN ATTACHMENT, SINCE 2026-10-11. The card was attached for two days. Matthew:
// "we should just email the link". It is also the better shape: /api/cards/pdf/<token>
// regenerates on every request, so one URL serves the CUSTOMISED card the moment it exists, where
// an attachment freezes today's sample-figure version in their inbox and is the one they print.
//
// ‼️ AND THE COPY SAYS THE CARD IS NOT FINISHED, BECAUSE IT IS NOT. What the generator produces
// carries PREVIEW_OFFER_SAMPLE, which is OUR figure: the clinic told us their real one two
// questions earlier and nothing substitutes it yet. Calling this a finished card would be
// advertising a discount they never agreed to, on their own card stock.
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
  /** What they said a referred patient gets. May be "Not decided yet". */
  referralOffer: string;
  /** They pressed the grey button, so a few design options are owed within two hours. */
  wantsCustom: boolean;
  /**
   * Where their card lives, absolute, or null when there is no lead to address one to.
   *
   * Null degrades the copy to "it is coming", never the send.
   */
  cardUrl: string | null;
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
    ["A referred patient gets", facts.referralOffer || "not answered"],
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
      facts.cardUrl
        ? "Thanks for taking a look. Here is your QR referral card so far: " +
          `<a href="${escapeHtml(facts.cardUrl)}" style="color:#0f7a65">open your card</a>. ` +
          "It still needs customising for your clinic, so hold off printing a batch until we have " +
          "talked. The link always gives you the latest version."
        : "Thanks for taking a look. Your QR referral card is being put together and we will " +
          "email you the link as soon as it is ready."
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
    // ‼️ SAID PLAINLY, BECAUSE A PRINTED CODE AND A PRINTED FIGURE CANNOT BE CHANGED. The offer
    // on the card is OUR sample, and the code opens a page on OUR address. Both move on the call:
    // the figure becomes theirs and the code becomes reviews.{theirdomain}. A clinic that printed
    // a thousand without being told either of those would have a right to be annoyed.
    p(
      "Two things change on that call. The offer printed on the card is our example rather than " +
        "yours, and the code points at your page on our address rather than your own domain. " +
        "That is the version to print in bulk."
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
  facts: PreviewEmailFacts
): Promise<{ sent: boolean; error?: string }> {
  if (!to) return { sent: false, error: "no address" };
  try {
    await microsoft.sendMail({
      to,
      subject: previewEmailSubject(facts),
      body: previewEmailHtml(facts),
      isHtml: true,
      fromMailbox: connectedMailbox(),
    });
    return { sent: true };
  } catch (e) {
    console.error("[cards/preview-email] send failed:", (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}
