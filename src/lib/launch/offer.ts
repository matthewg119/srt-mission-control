// The one offer, read out of the short offer document and confirmed by a person.
//
// ‼️ A PROVISIONAL OFFER EXISTS FROM PROVISIONING, FOR THE SAME REASON THE AUDIENCE DOES.
// `audience_documents` splits its kinds two ways: `deep_research` and `avatar_sheet` hang off the
// AUDIENCE, while `short_offer` and `necessary_beliefs` hang off an OFFER, enforced by a CHECK
// and by kindBelongsToOffer(). So without an offer row, two of the four foundation documents
// cannot be uploaded at all. And the offer is read OUT of one of those two. Same deadlock the
// provisional audience breaks, one level down.
//
// The row is created with `locked_at` null, which is what every downstream reader gates on:
// loadOffer() treats an unlocked offer as undecided, so a provisional one is inert rather than a
// half-truth. Nothing is guessed into `treatment`.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";

const OFFER_MODEL: ClaudeModel = "claude-sonnet-4-6";

/**
 * The empty offer a Launch Lane client starts with.
 *
 * Idempotent. `proposed_source` is left NULL: its CHECK allows null and none of the four values
 * it does allow is true here, since they all describe reading an intake form.
 */
export async function ensureProvisionalOffer(args: {
  clientId: string;
  audienceId: string;
}): Promise<{ ok: true; offerId: string; created: boolean } | { ok: false; error: string }> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("client_offers")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("is_primary", true)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };
  if (existing) return { ok: true, offerId: existing.id as string, created: false };

  const { data, error } = await supabaseAdmin
    .from("client_offers")
    .insert({
      client_id: args.clientId,
      audience_id: args.audienceId,
      is_primary: true,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The provisional offer was not written back." };
  return { ok: true, offerId: data.id as string, created: true };
}

export interface OfferProposal {
  /** What is actually sold. Goes to client_offers.treatment. */
  treatment: string;
  /** The single outcome it promises, in the client's own words. */
  outcomePromise: string;
  /** Where in the document each came from, for the card that asks somebody to confirm it. */
  rationale: string;
}

function isOfferProposal(v: unknown): v is OfferProposal {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return ["treatment", "outcomePromise", "rationale"].every(
    (k) => typeof p[k] === "string" && (p[k] as string).trim().length > 0
  );
}

const SYSTEM = [
  "You read a business's own short offer document and report two things it already says.",
  "You are extracting, not writing. Every word you return must be traceable to the document.",
  "",
  "treatment: the ONE thing this business sells, named the way the document names it.",
  "outcomePromise: the single outcome promised, in the document's own words where possible.",
  "",
  "NEVER use an em dash or an en dash. This is enforced in code and a dash rejects the whole",
  "proposal. Invent nothing. If the document does not say it, do not return it.",
].join("\n");

const SCHEMA_HINT = `{
  "treatment": "the one thing sold",
  "outcomePromise": "the single outcome promised",
  "rationale": "one sentence on which part of the document each came from"
}`;

export type OfferOutcome =
  | { ok: true; proposal: OfferProposal }
  | { ok: false; error: string };

/**
 * Read the offer out of the short offer document.
 *
 * ‼️ NEVER FROM A REQUEST PATH. Same rule as proposeVocabulary(): this proposes into a card a
 * person confirms, and the answer then lives on the row. A read-time derivation would make the
 * offer every page is built around non-deterministic.
 */
export async function proposeOfferFromDocument(clientId: string): Promise<OfferOutcome> {
  const { data, error } = await supabaseAdmin
    .from("audience_documents")
    .select("content")
    .eq("client_id", clientId)
    .eq("kind", "short_offer")
    .is("superseded_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `The short offer could not be read: ${error.message}` };
  if (!data?.content) {
    return {
      ok: false,
      error:
        "No short offer document is on file. Upload it first: the offer every page is built " +
        "around is read out of it, not typed from memory.",
    };
  }

  let proposal: OfferProposal;
  try {
    const result = await callClaudeJSON<OfferProposal>({
      model: OFFER_MODEL,
      system: SYSTEM,
      user: `SHORT OFFER DOCUMENT\n\n${(data.content as string).slice(0, 24_000)}`,
      maxTokens: 700,
      schemaHint: SCHEMA_HINT,
      validate: isOfferProposal,
      describeInvalid: () => "treatment, outcomePromise and rationale must all be non-empty strings",
    });
    proposal = result.data;
  } catch (e) {
    return { ok: false, error: `The offer could not be read: ${(e as Error).message}` };
  }

  const dashed = Object.entries(proposal).filter(([, v]) => hasBannedDash(String(v)));
  if (dashed.length) {
    return {
      ok: false,
      error: `That came back with a dash in: ${dashed.map(([k]) => k).join(", ")}. Run it again.`,
    };
  }

  return { ok: true, proposal };
}

/**
 * Lock the offer.
 *
 * `locked_at` is the half everything downstream reads as a decision, so it is only ever set here,
 * behind a person. It updates the primary row in place rather than inserting, for the reason
 * confirmVocabulary() does: the two offer-bound foundation documents are filed against THIS row,
 * and a second row would orphan them.
 */
export async function confirmOffer(args: {
  clientId: string;
  treatment: string;
  outcomePromise: string;
  by: string;
}): Promise<{ ok: true; offerId: string } | { ok: false; error: string }> {
  const treatment = args.treatment.trim();
  const outcome = args.outcomePromise.trim();
  if (!treatment) return { ok: false, error: "Say what is sold." };

  for (const [label, value] of [["what is sold", treatment], ["the promise", outcome]] as const) {
    if (hasBannedDash(value)) {
      return { ok: false, error: `There is a dash in ${label}. SRT copy uses commas and full stops.` };
    }
  }

  const { data: primary, error: readErr } = await supabaseAdmin
    .from("client_offers")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("is_primary", true)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };
  if (!primary) {
    return {
      ok: false,
      error:
        "This client has no primary offer to write to. It should have been created with the " +
        "client. Re-run provisioning.",
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("client_offers")
    .update({
      treatment,
      outcome_promise: outcome || null,
      outcome_set_at: outcome ? now : null,
      locked_at: now,
      locked_by: args.by,
      updated_at: now,
    })
    .eq("id", primary.id as string)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The offer was not written back." };
  return { ok: true, offerId: data.id as string };
}

/** What is on the row now, for the panel. */
export async function currentOffer(
  clientId: string
): Promise<{ treatment: string | null; outcomePromise: string | null; lockedAt: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("client_offers")
    .select("treatment, outcome_promise, locked_at")
    .eq("client_id", clientId)
    .eq("is_primary", true)
    .maybeSingle();

  if (error || !data) return null;
  return {
    treatment: (data.treatment as string | null) ?? null,
    outcomePromise: (data.outcome_promise as string | null) ?? null,
    lockedAt: (data.locked_at as string | null) ?? null,
  };
}
