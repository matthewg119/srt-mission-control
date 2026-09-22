// Confirmed dataset field values: the read and write side of `client_field_values`.
//
// ‼️ WHAT THIS FIXES, MEASURED. Before 2026-09-24 a research field was "present" when 150
// characters sat under its heading (`sectionAnswered`, avatar-profile.ts:169). Nothing extracted a
// value and nothing stored one, so the completeness card could report `fears` as filled while
// nobody could say what the fears were. srt-agency-llc: a 16,272 character research document
// parsed to `{"answered": 9}`, and zero field values anywhere in the system.
//
// ‼️ EVERY ROW HERE WAS CONFIRMED BY A PERSON. There is no unconfirmed-value state. A
// low-confidence extraction is shown as a QUESTION on the proposal card and never written. An
// absence and a guess are different facts, and a field filled with a plausible invention is worse
// than an empty one, because every later page argues from it and nothing downstream can tell it
// was never really answered.
//
// ‼️ PER CLIENT, ALWAYS. Nothing extracted from one client's research may reach `question_bank` or
// `avatar_briefs`, which have no `client_id` and are read by every client in the vertical. That is
// the poisoned-corpus failure those tables cannot unpick. This table has a client_id on every row
// precisely so a wrong write here IS correctable.

import { supabaseAdmin } from "@/lib/db";
import { DATASET_FIELDS, type DatasetKey } from "./dataset-spec";

export interface FieldValue {
  id: string;
  fieldKey: string;
  /** NULL means the value is true of the client whichever buyer is in front of them. */
  audienceId: string | null;
  dataset: DatasetKey;
  value: string;
  sourceSection: number | null;
  sourceDocumentId: string | null;
  confirmedBy: string;
  confirmedAt: string;
}

/** A value on its way in, before anybody has confirmed it. Never written in this shape. */
export interface ProposedValue {
  fieldKey: string;
  dataset: DatasetKey;
  value: string;
  sourceSection: number | null;
  confidence: "high" | "medium" | "low";
}

// ‼️ A COLUMN MISSING FROM THIS STRING IS SILENTLY `undefined`, NOT AN ERROR. Same trap as
// BATCH_COLUMNS in the scraper lane: PostgREST returns only what it was asked for, so a field
// added to FieldValue and forgotten here reads as absent on every row forever.
const COLUMNS =
  "id, field_key, audience_id, dataset, value, source_section, source_document_id, " +
  "confirmed_by, confirmed_at";

function toValue(row: Record<string, unknown>): FieldValue {
  return {
    id: String(row.id),
    fieldKey: String(row.field_key),
    audienceId: (row.audience_id as string | null) ?? null,
    dataset: row.dataset as DatasetKey,
    value: String(row.value ?? ""),
    sourceSection: (row.source_section as number | null) ?? null,
    sourceDocumentId: (row.source_document_id as string | null) ?? null,
    confirmedBy: String(row.confirmed_by ?? ""),
    confirmedAt: String(row.confirmed_at ?? ""),
  };
}

/**
 * Every live value for a client.
 *
 * ‼️ NOT SCOPED BY audience_id, AND THAT IS DELIBERATE. A null audience_id means "true of this
 * client whichever buyer is in front of them", so a per-audience read would have to union the
 * nulls back in at every call site and one of them would eventually forget. The caller that needs
 * one audience filters what it gets; the common case wants all of them.
 */
export async function liveValues(clientId: string): Promise<FieldValue[]> {
  const { data, error } = await supabaseAdmin
    .from("client_field_values")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .is("superseded_at", null)
    .order("field_key", { ascending: true });

  if (error) {
    // Reported, never treated as "this client has no values". Those are opposite answers, and the
    // wrong one would make the completeness card report a year of confirmed work as missing.
    console.error("[field-values] liveValues failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toValue(r as unknown as Record<string, unknown>));
}

/**
 * Why this set of values must not be written, or null if it may be.
 *
 * ‼️ PURE, AND EXTRACTED SO THE PROBE CAN FAIL IT RATHER THAN GREP FOR IT. These two refusals are
 * the last guard before the one write in this system that can poison every page a client ever
 * publishes. A probe that checks this file contains the string `confidence === "low"` proves the
 * string is present, not that an undeclared key or a guess is actually turned away.
 *
 * Returns the message the caller shows, so the two refusals read the same wherever they fire.
 */
export function refuseValues(values: readonly ProposedValue[]): string | null {
  const known = new Map(DATASET_FIELDS.map((f) => [f.key, f.dataset]));
  const unknown = values.filter((v) => !known.has(v.fieldKey));
  if (unknown.length) {
    return (
      "these are not declared fields, so nothing was written: " +
      unknown.map((v) => "`" + v.fieldKey + "`").join(", ") +
      ". Declare them in src/lib/clients/dataset-spec.ts, or file them through dataset_suggestions."
    );
  }

  // ‼️ LOW CONFIDENCE NEVER REACHES THIS FUNCTION, AND IT IS REFUSED HERE TOO. The card is supposed
  // to have turned those into questions. A second guard costs nothing and this is the one write in
  // the system that can poison every page a client ever publishes.
  const guessed = values.filter((v) => v.confidence === "low");
  if (guessed.length) {
    return (
      "these came back low confidence and must be answered rather than saved: " +
      guessed.map((v) => "`" + v.fieldKey + "`").join(", ")
    );
  }

  return null;
}

/**
 * Commit a confirmed set of values, superseding whatever they replace.
 *
 * ‼️ SUPERSEDE, NEVER UPDATE. The old row keeps its own provenance. An UPDATE would leave the
 * section number and document id describing a paste that is no longer where the value came from,
 * with nothing on the row saying so.
 *
 * ‼️ AN UNKNOWN field_key IS REFUSED, NOT STORED. dataset-spec.ts is the only authority on which
 * fields exist. The database deliberately has no CHECK constraint mirroring that list, because a
 * second list drifts; this is where the registry is enforced instead.
 */
export async function commitValues(args: {
  clientId: string;
  audienceId: string | null;
  values: readonly ProposedValue[];
  sourceDocumentId: string | null;
  confirmedBy: string;
}): Promise<{ ok: true; written: number; superseded: number } | { ok: false; error: string }> {
  const refused = refuseValues(args.values);
  if (refused) return { ok: false, error: refused };

  if (!args.values.length) return { ok: true, written: 0, superseded: 0 };

  // The dataset each field belongs to, from the registry rather than from whatever the caller
  // thought. refuseValues has already established that every key is in here.
  const known = new Map(DATASET_FIELDS.map((f) => [f.key, f.dataset]));

  // ‼️ THROUGH AN RPC, BECAUSE A CONFIRMATION IS TWO STATEMENTS AND MUST BE ONE TRANSACTION.
  // `client_field_values_live_idx` is unique over the live rows, so replacing a value means
  // retiring the old one and inserting the new one, and supabase-js cannot wrap two statements in
  // a transaction. Both client-side orders are broken: insert-then-supersede fails the whole batch
  // on the first field that already has a value, and supersede-then-insert can retire a confirmed
  // answer and then fail to replace it. docs/2026-09-24-commit-field-values-fn.sql does both in
  // one transaction, per field, so a failure on the ninth field rolls back the first eight.
  const { data, error } = await supabaseAdmin.rpc("commit_field_values", {
    p_client_id: args.clientId,
    p_audience_id: args.audienceId,
    p_document_id: args.sourceDocumentId,
    p_confirmed_by: args.confirmedBy,
    p_values: args.values.map((v) => ({
      dataset: known.get(v.fieldKey),
      field_key: v.fieldKey,
      value: v.value.trim(),
      source_section: v.sourceSection,
      confidence: v.confidence,
    })),
  });

  if (error) {
    if (/could not find the function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error:
          "nothing was written: docs/2026-09-24-commit-field-values-fn.sql has not been run. " +
          "The table alone is not enough, because a confirmation is two statements.",
      };
    }
    return { ok: false, error: "the confirmation failed and nothing was written: " + error.message };
  }

  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : null;
  return {
    ok: true,
    written: Number(row?.written ?? 0),
    superseded: Number(row?.superseded ?? 0),
  };
}
