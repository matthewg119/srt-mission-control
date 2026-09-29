// The four foundation documents, and the two places each one has to land.
//
// ‼️ THIS IS THE WHOLE REASON THE LANE WORKS WITHOUT A WEBSITE.
// In the Slack lane, what a page is written FROM is a crawl of the client's own site:
// site-replica.ts calls recordWebsiteSnapshot() and draft-page.ts calls researchWebsite(), and
// `isThinResearch()` is what refuses when there is not enough there. A Launch Lane client has no
// site at all, so if the documents only became audience_documents rows, every page would be
// drafted from nothing and the evidence rail would be empty.
//
// So each document is written TWICE, on purpose, to two tables that mean different things:
//
//   audience_documents   the FRAMEWORK. Append-only, superseded through an RPC, addressed by
//                        (audience, offer, kind). This is what the offer and avatar machinery
//                        reads. One live row per address.
//   page_sources         the EVIDENCE. `source_type = 'CLIENT_DOCUMENT'` and, critically,
//                        `page_id = null`, which page-evidence.ts documents as the CLIENT
//                        LIBRARY: "Anything about the business rather than about one question is
//                        filed with a null page_id and a topic, and every later page for that
//                        client reads it."
//
// That is not duplication for its own sake. A framework document answers "what is the offer";
// an evidence row answers "what may a page claim, and on whose authority". The publish gate
// counts unbacked claims against the second one and has never heard of the first.

import { supabaseAdmin } from "@/lib/db";
import { extractFileText } from "@/lib/deck/extract";
import {
  storeDocument,
  kindBelongsToOffer,
  type DocumentKind,
} from "@/lib/clients/audience-documents";
import { recordSource } from "@/lib/clients/page-evidence";

/**
 * The four that make a client ready to launch.
 *
 * `sales_letter` and `awareness_ladder` are real kinds and are welcome, but they are not part of
 * the foundation set: a client can go live without them, and the board must not refuse over a
 * document nobody promised.
 */
export const FOUNDATION_KINDS = [
  "deep_research",
  "avatar_sheet",
  "short_offer",
  "necessary_beliefs",
] as const satisfies readonly DocumentKind[];

export type FoundationKind = (typeof FOUNDATION_KINDS)[number];

export function isFoundationKind(kind: string): kind is FoundationKind {
  return (FOUNDATION_KINDS as readonly string[]).includes(kind);
}

/** What each document is, in the words the upload panel shows next to it. */
export const FOUNDATION_LABELS: Record<FoundationKind, string> = {
  deep_research: "Deep research: who this buyer is, in their own words",
  avatar_sheet: "Avatar sheet: the persona this whole build is aimed at",
  short_offer: "Short offer: what is sold, to whom, and the promise",
  necessary_beliefs: "Necessary beliefs: what they must believe before they buy",
};

/**
 * Text is required, and an unreadable file is a refusal rather than an empty row.
 *
 * ‼️ A SCANNED PDF EXTRACTS TO NOTHING AND MUST NOT BE STORED.
 * extractFileText uses unpdf and a docx unzipper and does NO model transcription, so a
 * photographed document comes back empty. Storing that would put a zero-length "document" on the
 * client, tick the step, and leave every page later citing a source with no text in it. The
 * Slack lane learned the same thing the expensive way: a 16,272-character document that reported
 * nine answered sections and stored zero values anywhere.
 */
const MIN_USEFUL_CHARS = 200;

export interface IngestResult {
  ok: boolean;
  kind: FoundationKind;
  error?: string;
  documentId?: string;
  sourceId?: string;
  chars?: number;
}

/**
 * Take one uploaded foundation document all the way in.
 *
 * `offerId` is required for the kinds that hang off an offer and must be absent for the two that
 * hang off the audience. kindBelongsToOffer() is the code copy of the DB check constraint, and
 * storeDocument() checks it again — this checks it a third time only so the error a person reads
 * names the document rather than the constraint.
 */
export async function ingestFoundationDocument(args: {
  clientId: string;
  audienceId: string;
  offerId: string | null;
  kind: FoundationKind;
  filename: string;
  contentType: string;
  bytes: Buffer;
  by: string;
}): Promise<IngestResult> {
  const { kind } = args;

  if (kindBelongsToOffer(kind) && !args.offerId) {
    return {
      ok: false,
      kind,
      error:
        `The ${kind.replace(/_/g, " ")} belongs to an offer, and no offer exists on this audience yet. ` +
        "Confirm the offer first, then upload this one.",
    };
  }
  if (!kindBelongsToOffer(kind) && args.offerId) {
    return { ok: false, kind, error: `The ${kind.replace(/_/g, " ")} belongs to the audience, not to an offer.` };
  }

  let text: string | null;
  try {
    text = await extractFileText(args.bytes, args.filename, args.contentType);
  } catch (e) {
    return { ok: false, kind, error: `That file could not be read: ${(e as Error).message}` };
  }

  const content = (text ?? "").trim();
  if (!content) {
    return {
      ok: false,
      kind,
      error:
        `No text could be read out of ${args.filename}. PDFs, .docx, .md and .txt are read directly ` +
        "and nothing is transcribed by a model, so a scanned or photographed document extracts to " +
        "nothing. Export it as text and upload it again.",
    };
  }
  if (content.length < MIN_USEFUL_CHARS) {
    return {
      ok: false,
      kind,
      error:
        `Only ${content.length} characters came out of ${args.filename}, which is too little to be ` +
        "the document it claims to be. Check the right file was picked.",
    };
  }

  // 1. The framework row. Append-only through the RPC, so a re-upload supersedes rather than
  //    overwrites and the previous version stays readable.
  const stored = await storeDocument({
    clientId: args.clientId,
    audienceId: args.audienceId,
    offerId: args.offerId,
    kind,
    content,
    source: "pasted",
    by: args.by,
  });
  if (!stored.ok) return { ok: false, kind, error: stored.error };

  // 2. The evidence row, in the client library.
  //
  // ‼️ VERBATIM, AND page_id STAYS NULL. Nothing here reads or summarises the text. The value of
  // page_sources is that it holds what was actually said, so a tidy-up would make every claim
  // traced back to it trace back to a paraphrase wearing the client's label.
  const source = await recordSource({
    clientId: args.clientId,
    pageId: null,
    sourceType: "CLIENT_DOCUMENT",
    sourceContent: content,
    topic: kind,
    collectedBy: args.by,
    collectedVia: "board",
  });

  if (!source.ok) {
    // ‼️ THE FRAMEWORK ROW IS ALREADY WRITTEN AND IS NOT ROLLED BACK.
    // There is no transaction across the RPC and this insert, and inventing one would mean
    // re-implementing supersede_audience_document(). A document present as framework and missing
    // as evidence is a visible, repairable state: the upload can simply be run again, because
    // storeDocument supersedes and recordSource is additive. Losing the framework row to "tidy
    // up" after a failed evidence write would be the worse trade.
    return {
      ok: false,
      kind,
      documentId: stored.doc.id,
      error:
        `The ${kind.replace(/_/g, " ")} was stored, but filing it as page evidence failed: ` +
        `${source.error}. Upload it again once that is fixed: every page this client publishes ` +
        "cites the evidence library, so a gap here is a gap in every page later.",
    };
  }

  return { ok: true, kind, documentId: stored.doc.id, sourceId: source.id, chars: content.length };
}

export interface FoundationStatus {
  kind: FoundationKind;
  label: string;
  present: boolean;
  /** True when the framework row is live but nothing matching is in the evidence library. */
  evidenceMissing: boolean;
  chars: number | null;
}

/**
 * What is on file, for the step card and for the verifier's refusal text.
 *
 * Reports the two tables SEPARATELY rather than collapsing them, because they fail separately:
 * the half-written state above is exactly what this is for, and a single "uploaded: yes" would
 * hide it.
 */
export async function foundationStatus(clientId: string): Promise<FoundationStatus[] | null> {
  const { data: docs, error: docErr } = await supabaseAdmin
    .from("audience_documents")
    .select("kind, content")
    .eq("client_id", clientId)
    .is("superseded_at", null);

  if (docErr) return null;

  const { data: sources, error: srcErr } = await supabaseAdmin
    .from("page_sources")
    .select("topic")
    .eq("client_id", clientId)
    .eq("source_type", "CLIENT_DOCUMENT")
    .is("page_id", null);

  if (srcErr) return null;

  const byKind = new Map((docs ?? []).map((d) => [d.kind as string, (d.content as string) ?? ""]));
  const topics = new Set((sources ?? []).map((s) => s.topic as string));

  return FOUNDATION_KINDS.map((kind) => {
    const content = byKind.get(kind);
    return {
      kind,
      label: FOUNDATION_LABELS[kind],
      present: content !== undefined,
      evidenceMissing: content !== undefined && !topics.has(kind),
      chars: content !== undefined ? content.length : null,
    };
  });
}

/**
 * The text of the foundation documents, for the one thing that legitimately reads all four at
 * once: proposing the audience vocabulary.
 *
 * Returns null on a read failure, never an empty array, so a caller cannot mistake an outage for
 * a client who uploaded nothing.
 */
export async function foundationText(
  clientId: string
): Promise<{ kind: FoundationKind; content: string }[] | null> {
  const { data, error } = await supabaseAdmin
    .from("audience_documents")
    .select("kind, content")
    .eq("client_id", clientId)
    .is("superseded_at", null);

  if (error) return null;

  return (data ?? [])
    .filter((d) => isFoundationKind(d.kind as string))
    .map((d) => ({ kind: d.kind as FoundationKind, content: (d.content as string) ?? "" }))
    .filter((d) => d.content.trim().length > 0);
}
