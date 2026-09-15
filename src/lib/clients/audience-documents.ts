// The avatar and offer framework's documents, per client audience. The one door to audience_documents.
//
// Matthew's framework (Desktop\SRT-Avatar-Offer-Framework-Prompt.md) produces, for every audience a client
// targets: a sales letter, a deep research, an avatar sheet, a short offer and the necessary beliefs.
// docs/2026-09-15-offers-and-framework.sql is the table.
//
// ‼️ APPEND-ONLY, AND A REPLACEMENT GOES THROUGH ONE FUNCTION. supersede_audience_document() marks the old
// live row superseded and inserts the new one in a single transaction. Doing those two writes from here
// would leave ZERO live rows whenever the insert failed, and the other order fails on the unique index.
//
// ‼️ OFFER DOCUMENTS HANG OFF AN OFFER, AVATAR DOCUMENTS DO NOT. A check constraint enforces it, so
// "the approved letter" can never have two answers. kindBelongsToOffer() is the same rule in code.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhrase } from "./phrase-quality";
import type { StoredOffer } from "./offers";

export type DocumentKind =
  | "sales_letter"
  | "deep_research"
  | "avatar_sheet"
  | "short_offer"
  | "necessary_beliefs"
  /** Step 21: one claim, risk reversal and anchor per awareness stage, for one offer. offer-ladder.ts. */
  | "awareness_ladder";
export type DocumentSource = "client_site" | "drafted" | "pasted";

export interface DocumentFault {
  rule: string;
  detail: string;
}

export interface AudienceDocument {
  id: string;
  clientId: string;
  audienceId: string;
  offerId: string | null;
  kind: DocumentKind;
  content: string;
  parsed: Record<string, unknown> | null;
  faults: DocumentFault[];
  source: DocumentSource;
  sourceUrl: string | null;
  status: "draft" | "approved";
  approvedAt: string | null;
  approvedBy: string | null;
  offerFingerprint: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** The rule the table's check constraint enforces, in code. */
export function kindBelongsToOffer(kind: DocumentKind): boolean {
  return kind === "sales_letter" || kind === "short_offer" || kind === "necessary_beliefs" || kind === "awareness_ladder";
}

/** A short id a person can type back, the first eight characters of the uuid. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * What an approval is pinned to: the treatment and the outcome, normalised.
 *
 * ‼️ NOT POSITIONING OR TERMS. lockOffer treats a positioning-only re-lock as unchanged, and new terms
 * add vocabulary without changing what the letter claims. A new treatment or a new outcome is a different
 * offer to write a letter about, so either one makes an approval stale.
 */
export function offerFingerprint(offer: Pick<StoredOffer, "treatment" | "outcomePromise">): string {
  return `${normalizePhrase(offer.treatment ?? "")}|${normalizePhrase(offer.outcomePromise ?? "")}`;
}

function rowToDocument(r: Record<string, unknown>): AudienceDocument {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    audienceId: String(r.audience_id),
    offerId: (r.offer_id as string | null) ?? null,
    kind: r.kind as DocumentKind,
    content: String(r.content ?? ""),
    parsed: (r.parsed as Record<string, unknown> | null) ?? null,
    faults: Array.isArray(r.faults) ? (r.faults as DocumentFault[]) : [],
    source: r.source as DocumentSource,
    sourceUrl: (r.source_url as string | null) ?? null,
    status: r.status === "approved" ? "approved" : "draft",
    approvedAt: (r.approved_at as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    offerFingerprint: (r.offer_fingerprint as string | null) ?? null,
    createdAt: String(r.created_at),
    createdBy: (r.created_by as string | null) ?? null,
  };
}

/** Where a document is addressed: an avatar document by audience, an offer document by offer. */
export interface DocumentAddress {
  audienceId: string;
  offerId: string | null;
  kind: DocumentKind;
}

/**
 * The live document, else the newest one.
 *
 * ‼️ "ELSE THE NEWEST" IS DELIBERATE. A replacement that failed half way leaves no live row, and reading
 * that as "nothing on file" would tell somebody their letter is gone when it is stored and one re-send
 * away from live.
 */
export async function currentDocument(
  addr: DocumentAddress
): Promise<{ ok: true; doc: AudienceDocument | null } | { ok: false; error: string }> {
  let query = supabaseAdmin
    .from("audience_documents")
    .select("*")
    .eq("audience_id", addr.audienceId)
    .eq("kind", addr.kind)
    .order("superseded_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(1);
  query = addr.offerId ? query.eq("offer_id", addr.offerId) : query.is("offer_id", null);

  const { data, error } = await query;
  if (error) return { ok: false, error: `audience_documents is unreadable (${error.message})` };
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return { ok: true, doc: row ? rowToDocument(row) : null };
}

/** Store a new version, atomically replacing the live one. */
export async function storeDocument(args: DocumentAddress & {
  clientId: string;
  content: string;
  parsed?: Record<string, unknown> | null;
  faults?: DocumentFault[];
  source: DocumentSource;
  sourceUrl?: string | null;
  by: string;
}): Promise<{ ok: true; doc: AudienceDocument } | { ok: false; error: string }> {
  if (kindBelongsToOffer(args.kind) !== Boolean(args.offerId)) {
    return {
      ok: false,
      error: kindBelongsToOffer(args.kind)
        ? "this document belongs to an offer, and no offer is on file for this audience yet."
        : "this document belongs to the audience, not to an offer.",
    };
  }

  const { data, error } = await supabaseAdmin.rpc("supersede_audience_document", {
    p_client_id: args.clientId,
    p_audience_id: args.audienceId,
    p_offer_id: args.offerId,
    p_kind: args.kind,
    p_content: args.content,
    p_parsed: args.parsed ?? null,
    p_faults: args.faults?.length ? args.faults : null,
    p_source: args.source,
    p_source_url: args.sourceUrl ?? null,
    p_created_by: args.by,
  });

  if (error) {
    // 23505: a second copy arrived at the same moment and lost. The first one is the one kept.
    if (error.code === "23505") {
      return { ok: false, error: "another version landed at the same moment, so this one was not saved. Send it again." };
    }
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
      return {
        ok: false,
        error: "the documents table is not set up yet (docs/2026-09-15-offers-and-framework.sql has not been run).",
      };
    }
    return { ok: false, error: error.message };
  }

  const id = String(data);
  const { data: row, error: readErr } = await supabaseAdmin.from("audience_documents").select("*").eq("id", id).single();
  if (readErr || !row) return { ok: false, error: `saved as ${shortId(id)}, but it could not be read back: ${readErr?.message ?? "no row"}` };
  return { ok: true, doc: rowToDocument(row as Record<string, unknown>) };
}

/**
 * Approve one exact version.
 *
 * ‼️ BY ID, NEVER "WHATEVER IS LIVE NOW". A `letter replace:` landing between the reply that showed a
 * version and the approval would otherwise be approved unread. The conditional update also refuses a
 * version that has been superseded since.
 */
export async function approveDocument(args: {
  id: string;
  by: string;
  fingerprint: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("audience_documents")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: args.by,
      offer_fingerprint: args.fingerprint,
    })
    .eq("id", args.id)
    .is("superseded_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "that version has been replaced since it was shown, so it was not approved." };
  return { ok: true };
}
