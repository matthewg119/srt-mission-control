// Whether payment has been RECORDED for a client, and how to say so.
//
// ‼️ AN ASSERTION THE BOARD RECORDS, NEVER EVIDENCE OF A CHARGE.
//
// Nothing in this application talks to a payment processor. Matthew ticks it, with a note, which
// is exactly what `clients.day_0_source` distinguishes with 'photograph_2' (a real archived run
// wrote it) versus 'manual_step' (a human ticked a box, which is an assertion that the thing
// happened rather than evidence of it). `paymentLine()` is the ONLY approved wording and every
// surface uses it, so the phrase cannot drift into "payment received" on one card and stay
// honest on the other three.
//
// ‼️ IT IS A SEPARATE MODULE BECAUSE THE GATE IS NEEDED IN TWO SHARED FILES.
// step-verify.ts's `access_granted` verifier is the real gate: setDeliveryStep runs verifyStep
// before the row write on every surface, and the client board's checkbox route calls
// setDeliveryStep and nothing else. step-engine.ts's stepPrecondition carries the same refusal
// so the Slack button answers at the press. Two copies of the read is how the two answers start
// disagreeing about the same client.

import { supabaseAdmin } from "@/lib/db";

export interface PaymentRecord {
  recordedAt: string | null;
  recordedBy: string | null;
  terms: string | null;
  note: string | null;
}

export const EMPTY_PAYMENT: PaymentRecord = {
  recordedAt: null,
  recordedBy: null,
  terms: null,
  note: null,
};

/** Read the four columns off a `clients` row somebody already selected. */
export function paymentFrom(client: Record<string, unknown> | null | undefined): PaymentRecord {
  if (!client) return EMPTY_PAYMENT;
  return {
    recordedAt: (client.payment_recorded_at as string | null) ?? null,
    recordedBy: (client.payment_recorded_by as string | null) ?? null,
    terms: (client.payment_terms as string | null) ?? null,
    note: (client.payment_note as string | null) ?? null,
  };
}

export function isRecorded(p: PaymentRecord): boolean {
  return Boolean(p.recordedAt);
}

/**
 * The one approved sentence.
 *
 * ‼️ "recorded by X on DATE", NEVER "payment received". The second one claims we observed money
 * arriving and nothing here did. `scripts/test-onboarding-artifacts.ts` greps for the banned
 * phrasing for the same reason it greps for "no issues found" in a client PDF.
 */
export function paymentLine(p: PaymentRecord): string {
  if (!isRecorded(p)) return "No payment has been recorded.";
  const day = (p.recordedAt ?? "").slice(0, 10);
  const who = p.recordedBy?.trim() || "somebody unnamed";
  return [
    `Payment recorded by ${who} on ${day}`,
    p.terms ? `. Agreed: ${p.terms}` : "",
    p.note ? `. ${p.note}` : "",
  ].join("");
}

/**
 * Has payment been recorded for this client?
 *
 * ‼️ A FAILED QUERY IS `null`, NOT `false`. A verifier that read a Supabase blip as "no payment"
 * would tell somebody their work is blocked on a thing that is already done. Same reasoning
 * step-verify.ts's countRows() gives for returning null rather than zero. The callers report
 * that state as broken rather than as work owed.
 */
export async function paymentRecorded(
  clientId: string
): Promise<{ ok: true; payment: PaymentRecord } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("payment_recorded_at, payment_recorded_by, payment_terms, payment_note")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "client not found" };
  return { ok: true, payment: paymentFrom(data as Record<string, unknown>) };
}

/**
 * Why step 21 waits, in words, and the words are the point.
 *
 * A refusal that states the RULE ("payment must be recorded first") teaches people to look for
 * the way round it. This one states the REASON, which is the thing that actually stops somebody
 * asking early.
 */
export const ACCESS_GATE_REASON =
  "Technical access is collected AFTER the commitment. A client who has not committed does not " +
  "hand over their Google account, and asking early is how a call ends with neither the access " +
  "nor the client.";

/** The line every card and refusal appends, so the two never drift apart. */
export const ACCESS_GATE_TODO =
  "Record it on the client board, Payment panel: what was agreed, whether a card is on file, and " +
  "who recorded it. It is an assertion this board keeps, not proof of a charge, so write what is " +
  "actually true.";
