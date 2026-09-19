// The writer for "this person asked us to stop", next to the reader that enforces it.
//
// ‼️ THIS EXISTED AS A READ WITH NO WRITE. suppression.ts checks `contacts.do_not_contact` and
// calls it "the last-resort gate"; the sequence engine, the follow-up and email directors, the SMS
// import, the touch policy and the CRM worklist all read the same flag. The ONLY thing that ever
// set it was the CRM stage picker landing a lead on "Take Off List", by hand. An opt-out that
// arrived by email closed the prospect row and stopped exactly one ladder, leaving the address
// contactable on every other lane we own.
//
// ‼️ THIS IS ALSO THE CAN-SPAM SURFACE, AND IT IS HALF OF ONE. A functioning opt-out mechanism is
// not optional at volume, and the honouring half now works. The OTHER half, an unsubscribe link and
// a physical postal address in the message itself, lives in the ReachInbox templates and cannot be
// enforced from this repo. Do not read this file as the compliance box being ticked.

import { supabaseAdmin } from "@/lib/db";
import { normalizeEmail } from "./suppression";

/** Prefix on `do_not_contact_reason`, so a later reader can tell WHERE the opt-out came from. */
export const EMAIL_OPT_OUT_REASON = "Replied asking to stop";

export interface OptOutResult {
  /** How many contact rows were flipped. Zero is normal: cold prospects have no CRM row. */
  contactsFlipped: number;
}

/**
 * Honour an opt-out across every lane, not just the one it arrived on.
 *
 * Existing rows only, on purpose. A cold prospect who never became a lead has no `contacts` row,
 * and minting one here would put every unsubscriber into the CRM as a contact, which is both
 * misleading and the opposite of what they asked for. That case is already covered: the prospect
 * row is CLOSED with an opt-out `closed_reason`, and suppression.ts reads that as `opted_out`.
 *
 * ‼️ NEVER UNSETS. There is no path in this file that turns the flag back off. Undoing somebody
 * else's opt-out is a thing only a person should be able to do, and crm.ts already guards its own
 * undo by checking the reason string it wrote.
 */
export async function markDoNotContact(
  email: string | null | undefined,
  detail?: string | null
): Promise<OptOutResult> {
  const addr = normalizeEmail(email);
  if (!addr) return { contactsFlipped: 0 };

  const reason = detail ? `${EMAIL_OPT_OUT_REASON}: ${detail}`.slice(0, 500) : EMAIL_OPT_OUT_REASON;

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .update({
      do_not_contact: true,
      do_not_contact_reason: reason,
      do_not_contact_at: new Date().toISOString(),
      // ‼️ working_state, NOT application_stage. Landing a stage is the CRM's own transition and it
      // carries origin, timestamps and automations; writing one from here would fire them from a
      // mailbox sweep. The flag plus the working state is what every outreach path actually reads,
      // which is the same argument crm.ts makes where it sets these two together.
      working_state: "closed",
    })
    .eq("email", addr)
    .eq("do_not_contact", false)
    .select("id");

  if (error) throw new Error("markDoNotContact: " + error.message);
  return { contactsFlipped: data?.length ?? 0 };
}
