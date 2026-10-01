// The other half of CAN-SPAM: what has to be IN the message.
//
// ‼️ opt-out.ts SAYS THIS DOES NOT EXIST, AND IT WAS RIGHT UNTIL NOW. Its header reads: "This is
// also the CAN-SPAM surface, and it is HALF of one. A functioning opt-out mechanism is not
// optional at volume, and the honouring half now works. The OTHER half, an unsubscribe link and
// a physical postal address in the message itself, lives in the ReachInbox templates and cannot
// be enforced from this repo. Do not read this file as the compliance box being ticked."
//
// That was true while every cold email left through ReachInbox. §7 of the destinations build
// sends off-site outreach from OUR mailboxes, through outreach_send_queue, so the half that
// could not be enforced from this repo now has to be.
//
// ‼️ IT REFUSES RATHER THAN OMITTING. An email with no postal address is not slightly
// non-compliant, it is the thing the statute names, at up to five figures per message. A
// missing constant is a configuration problem somebody can fix in a minute; a sent message is
// not. So an unset address throws and the drafting lane reports it, the same shape
// SRT_ONBOARDING_CALL_URL's tri-state takes: unset is a real state that gets said out loud.
//
// ‼️ AND IT IS NOT A SIGNATURE. OUTREACH_SIGNATURE_NAME is who the mail is FROM, which is a
// different question and already answered elsewhere. This is the block underneath it.

/**
 * The postal address every cold message must carry.
 *
 * Env rather than a constant because it is a fact about the company that changes when they move,
 * and a move is exactly when nobody thinks to grep the source for their own address.
 */
export function postalAddress(): string | null {
  const raw = (process.env.OUTREACH_POSTAL_ADDRESS ?? "").trim();
  return raw || null;
}

export interface FooterResult {
  text: string;
  html: string;
}

/**
 * The compliance block, in both shapes.
 *
 * @param unsubscribeUrl Where a reader goes to stop. A mailto is acceptable and is what this
 *        lane uses: replies are already swept and `markDoNotContact` already honours them
 *        across every lane, so a mailto is a mechanism that genuinely works rather than a link
 *        to a page nobody built.
 *
 * ‼️ THE UNSUBSCRIBE HAS TO ACTUALLY DO SOMETHING, WHICH IS WHY IT IS A REPLY. A link to an
 * unsubscribe endpoint that does not exist is worse than no link: it is a promise in writing.
 * reply-sweep.ts reads these mailboxes every five minutes and opt-out.ts flips the flag across
 * the CRM, the sequences, the SMS lane and the worklist, so replying is the one mechanism here
 * that is already proven to work end to end.
 */
export function complianceFooter(unsubscribeUrl?: string | null): FooterResult {
  const address = postalAddress();
  if (!address) {
    throw new Error(
      "OUTREACH_POSTAL_ADDRESS is not set, so no cold message may be composed. CAN-SPAM requires " +
        "a valid physical postal address in the message itself. Set it and try again."
    );
  }

  const stop = unsubscribeUrl?.trim()
    ? `If you would rather not hear from me, unsubscribe here: ${unsubscribeUrl.trim()}`
    : "If you would rather not hear from me, reply with the word stop and I will not write again.";

  const text = ["", "---", stop, address].join("\n");

  const html =
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#666;margin:0 0 4px">${escapeHtml(stop)}</p>` +
    `<p style="font-size:12px;color:#666;margin:0">${escapeHtml(address)}</p>`;

  return { text, html };
}

/** Is a composed message carrying both halves? For a probe, and for a caller that wants to check. */
export function footerFaults(body: string): string[] {
  const out: string[] = [];
  const address = postalAddress();
  if (!address) {
    out.push("OUTREACH_POSTAL_ADDRESS is not set, so no message can carry a postal address.");
    return out;
  }
  if (!body.includes(address)) out.push("the postal address is missing.");
  if (!/unsubscribe|reply with the word stop/i.test(body)) out.push("there is no opt-out sentence.");
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
