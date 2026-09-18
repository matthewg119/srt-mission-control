// What each of a client's audiences is still missing, read live. The loader for dataset-spec.ts.
//
// One report per audience, primary first. Read-only: nothing here writes, and every read degrades
// to "missing" rather than throwing, because a completeness card that errors tells you less than
// one that says a field is empty.

import { supabaseAdmin } from "@/lib/db";
import { audiencesFor, sharedBankFor, type ResolvedAudience } from "./audiences";
import { avatarBriefFor } from "./avatars";
import { EMPTY_OFFER, loadOffer, loadOfferForAudience } from "./offers";
import { RESEARCH_SECTION_KEYS } from "./artifacts/deep-research-run";
import {
  evaluateDatasets,
  formatDatasetReport,
  type DatasetReport,
  type DatasetSnapshot,
} from "./dataset-spec";
import type { AudienceDocument, DocumentKind } from "./audience-documents";
import type { StoredOffer } from "./offers";

/**
 * Rows a caller has ALREADY loaded, handed in rather than read again.
 *
 * ‼️ THIS IS THE ANTI-DOUBLE-FETCH LEVER AND IT IS THE ONLY ONE. lead-context.ts assembles the same
 * audiences, offers and documents for its own purposes; without this it would either read them twice or
 * grow its own copy of the rules below, and a second copy of "which offer applies to an option audience"
 * is exactly the drift this file exists to prevent. Every field is optional and every absent field is
 * read here as before, so an existing caller passing nothing behaves identically.
 */
export interface CompletenessInputs {
  audiences?: readonly ResolvedAudience[];
  primaryOffer?: StoredOffer;
  /** Keyed by audience id. A present key with a null value means "looked, and this audience has none". */
  offersByAudience?: ReadonlyMap<string, StoredOffer | null>;
  /** From documentsFor(), keyed by documentKey(). */
  documents?: ReadonlyMap<string, AudienceDocument>;
  audit?: DatasetSnapshot["audit"];
  reviews?: number;
}

export interface AudienceCompleteness {
  audience: ResolvedAudience | null;
  snapshot: DatasetSnapshot;
  reports: DatasetReport[];
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count: n, error } = await query;
    return error ? 0 : n ?? 0;
  } catch {
    return 0;
  }
}

async function auditState(clientId: string): Promise<DatasetSnapshot["audit"]> {
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("loom_state")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Array<{ loom_state: Record<string, unknown> | null }>;
  return {
    linked: rows.length > 0,
    pickedAvatar: rows.some((r) => Boolean(r.loom_state?.pickedAvatar)),
    buyerMap: rows.some((r) => Boolean(r.loom_state?.buyerMap)),
  };
}

async function avatarState(audience: ResolvedAudience | null): Promise<DatasetSnapshot["avatar"]> {
  if (!audience?.researchAvatarSlug) {
    return { researchText: null, vocQuotes: 0, approvedNumbers: 0, keywordRows: 0, keywordRowsWithUrl: 0, objectionRows: 0 };
  }
  const [brief, bank, keywordRows, keywordRowsWithUrl, objectionRows] = await Promise.all([
    avatarBriefFor(audience.researchVertical, audience.researchAvatarSlug),
    sharedBankFor(audience),
    count(
      supabaseAdmin
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("vertical", audience.researchVertical)
        .eq("avatar", audience.researchAvatarSlug)
        .eq("source", "keywords")
    ),
    count(
      supabaseAdmin
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("vertical", audience.researchVertical)
        .eq("avatar", audience.researchAvatarSlug)
        .eq("source", "keywords")
        .not("source_url", "is", null)
    ),
    // Scoped by vertical AND avatar, the same way the keyword counts above are. An avatar-blind
    // count is what let one buyer's objections satisfy another buyer's gate.
    count(
      supabaseAdmin
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("vertical", audience.researchVertical)
        .eq("avatar", audience.researchAvatarSlug)
        .eq("objection_phrase", true)
    ),
  ]);
  return {
    researchText: brief?.researchText ?? null,
    vocQuotes: bank.vocQuotes.length,
    approvedNumbers: bank.approvedNumbers.length,
    keywordRows,
    keywordRowsWithUrl,
    objectionRows,
  };
}

const NO_DOCUMENTS: DatasetSnapshot["documents"] = { avatarSheet: null, shortOffer: null, beliefs: 0, letterApproved: false };

/**
 * The framework documents on file for one audience, and this client's own research if it pasted one.
 *
 * ‼️ THE CLIENT'S OWN RESEARCH OUTRANKS THE SHARED ONE ON ITS OWN CARD. Framework research lands on the
 * audience first and reaches the shared avatar_briefs only when that was empty or on `share research`, so
 * the shared copy can be another client's. This audience's card says what THIS audience has.
 *
 * ‼️ IT READS A MAP NOW, AND ISSUES NO QUERY. This used to fire five currentDocument() calls per audience,
 * so a three-audience client paid fifteen round trips to learn what was on file. documentsFor() answers
 * all of them in one select and this picks out of the result. Pure: the read error, when there is one, is
 * the caller's to report, which is what lets lead-context.ts tell "no document" from "could not read".
 *
 * An absent key is still "not on file", the same answer the degraded read used to give.
 */
function documentsState(
  audience: ResolvedAudience | null,
  offer: StoredOffer,
  docs: ReadonlyMap<string, AudienceDocument>,
  fingerprintOf: (o: StoredOffer) => string,
  keyOf: (audienceId: string, offerId: string | null, kind: DocumentKind) => string
): { documents: DatasetSnapshot["documents"]; ownResearch: string | null } {
  if (!audience) return { documents: NO_DOCUMENTS, ownResearch: null };
  const answeredOf = (doc: { parsed: Record<string, unknown> | null } | null) =>
    doc && Array.isArray(doc.parsed?.answered) ? (doc.parsed!.answered as string[]) : doc ? [] : null;

  const pick = (offerId: string | null, kind: DocumentKind) => docs.get(keyOf(audience.id, offerId, kind)) ?? null;

  const research = pick(null, "deep_research");
  const sheet = pick(null, "avatar_sheet");
  const shortOffer = offer.id ? pick(offer.id, "short_offer") : null;
  const beliefs = offer.id ? pick(offer.id, "necessary_beliefs") : null;
  const letter = offer.id ? pick(offer.id, "sales_letter") : null;

  return {
    ownResearch: research?.content ?? null,
    documents: {
      avatarSheet: answeredOf(sheet),
      shortOffer: answeredOf(shortOffer),
      beliefs: beliefs && Array.isArray(beliefs.parsed?.beliefs) ? (beliefs.parsed!.beliefs as unknown[]).length : 0,
      letterApproved: Boolean(letter && letter.status === "approved" && letter.offerFingerprint === fingerprintOf(offer)),
    },
  };
}

/** Every audience this client has, each with its completeness. A client with none gets one empty report. */
export async function completenessFor(
  clientId: string,
  given: CompletenessInputs = {}
): Promise<AudienceCompleteness[]> {
  const [audiences, primaryOffer, audit, reviews] = await Promise.all([
    given.audiences ?? audiencesFor(clientId),
    given.primaryOffer ?? loadOffer(clientId),
    given.audit ?? auditState(clientId),
    given.reviews ??
      count(
        supabaseAdmin
          .from("page_sources")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .eq("source_type", "CUSTOMER_REVIEW")
      ),
  ]);

  const { documentsFor, documentKey, offerFingerprint } = await import("./audience-documents");
  // One select for every document this client holds, replacing five per audience.
  let docs: ReadonlyMap<string, AudienceDocument> = given.documents ?? new Map();
  if (!given.documents) {
    const read = await documentsFor({ clientId, audienceIds: audiences.map((a) => a.id) });
    // Degrades to "nothing on file", the contract this card has always had: a card that errors tells
    // you less than one that says a document is not there. lead-context.ts does NOT degrade; it calls
    // documentsFor itself so it can report `unreadable` and never ask for work already done.
    docs = read.ok ? read.docs : new Map();
  }

  const targets: ReadonlyArray<ResolvedAudience | null> = audiences.length ? audiences : [null];
  const out: AudienceCompleteness[] = [];
  for (const audience of targets) {
    // ‼️ OFFERS LIVE UNDER AUDIENCES SINCE 2026-09-15 (client_offers). Each audience reads its OWN
    // primary offer. The offer section applies to the primary audience always (it is the one being
    // worked, so a missing offer there is a real gap) and to an option audience only once it has an
    // offer of its own: an option nobody has sold to yet is not "missing six offer fields".
    const own = audience
      ? given.offersByAudience?.has(audience.id)
        ? given.offersByAudience.get(audience.id) ?? null
        : await loadOfferForAudience(audience.id)
      : null;
    const offer = audience && !audience.isPrimary ? (own ?? EMPTY_OFFER) : (own ?? primaryOffer);
    const offerApplies = audience === null || audience.isPrimary || own !== null;
    const { documents, ownResearch } = documentsState(audience, offer, docs, offerFingerprint, documentKey);
    const avatar = await avatarState(audience);
    const snapshot: DatasetSnapshot = {
      audience: audience
        ? {
            label: audience.label,
            isPrimary: audience.isPrimary,
            stance: audience.stance,
            hasVocabulary: Boolean(audience.vocabulary?.buyerSingular && audience.vocabulary?.offerSingular),
            buyerMarket: audience.buyerMarket,
            hardLines: audience.hardLines.length,
            confirmedAt: audience.confirmedAt,
          }
        : null,
      avatar: { ...avatar, researchText: ownResearch ?? avatar.researchText },
      documents,
      offer: {
        applies: offerApplies,
        treatment: offer.treatment,
        terms: offer.terms.length,
        positioning: offer.positioning,
        magnetKey: offer.magnetKey,
        lockedAt: offer.lockedAt,
        outcomePromise: offer.outcomePromise,
        price: offer.price,
      },
      audit,
      reviews,
    };
    out.push({ audience, snapshot, reports: evaluateDatasets(snapshot, RESEARCH_SECTION_KEYS) });
  }
  return out;
}

/** The card: every audience, what it has and what it is missing. */
export async function completenessCardLines(clientId: string): Promise<string[]> {
  const all = await completenessFor(clientId);
  const lines = [":clipboard: *What we know, and what we are still missing*"];
  for (const c of all) {
    if (!c.audience) {
      lines.push(
        "*No audience yet.* Confirm an avatar on the avatar step; that creates this client's first audience."
      );
      continue;
    }
    lines.push(...formatDatasetReport(c.audience.label, c.audience.isPrimary, c.reports, c.snapshot.offer.applies));
  }
  lines.push(
    "_:no_entry: marks a field a later step cannot run without. Everything else is a warning; nothing here stops a step on its own._"
  );
  return lines;
}
