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
    return { researchText: null, vocQuotes: 0, approvedNumbers: 0, keywordRows: 0, keywordRowsWithUrl: 0 };
  }
  const [brief, bank, keywordRows, keywordRowsWithUrl] = await Promise.all([
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
  ]);
  return {
    researchText: brief?.researchText ?? null,
    vocQuotes: bank.vocQuotes.length,
    approvedNumbers: bank.approvedNumbers.length,
    keywordRows,
    keywordRowsWithUrl,
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
 * Degrades to nothing on any read error, the table missing included: a card that errors tells less than a
 * card that says a document is not on file.
 */
async function documentsState(
  audience: ResolvedAudience | null,
  offer: import("./offers").StoredOffer
): Promise<{ documents: DatasetSnapshot["documents"]; ownResearch: string | null }> {
  if (!audience) return { documents: NO_DOCUMENTS, ownResearch: null };
  const { currentDocument, offerFingerprint } = await import("./audience-documents");
  const answeredOf = (doc: { parsed: Record<string, unknown> | null } | null) =>
    doc && Array.isArray(doc.parsed?.answered) ? (doc.parsed!.answered as string[]) : doc ? [] : null;

  const [research, sheet] = await Promise.all([
    currentDocument({ audienceId: audience.id, offerId: null, kind: "deep_research" }),
    currentDocument({ audienceId: audience.id, offerId: null, kind: "avatar_sheet" }),
  ]);
  const byOffer = offer.id
    ? await Promise.all(
        (["short_offer", "necessary_beliefs", "sales_letter"] as const).map((kind) =>
          currentDocument({ audienceId: audience.id, offerId: offer.id, kind })
        )
      )
    : null;
  const pick = (r: Awaited<ReturnType<typeof currentDocument>> | undefined) => (r && r.ok ? r.doc : null);

  const letter = pick(byOffer?.[2]);
  const beliefs = pick(byOffer?.[1]);
  return {
    ownResearch: pick(research)?.content ?? null,
    documents: {
      avatarSheet: answeredOf(pick(sheet)),
      shortOffer: answeredOf(pick(byOffer?.[0])),
      beliefs: beliefs && Array.isArray(beliefs.parsed?.beliefs) ? (beliefs.parsed!.beliefs as unknown[]).length : 0,
      letterApproved: Boolean(letter && letter.status === "approved" && letter.offerFingerprint === offerFingerprint(offer)),
    },
  };
}

/** Every audience this client has, each with its completeness. A client with none gets one empty report. */
export async function completenessFor(clientId: string): Promise<AudienceCompleteness[]> {
  const [audiences, primaryOffer, audit, reviews] = await Promise.all([
    audiencesFor(clientId),
    loadOffer(clientId),
    auditState(clientId),
    count(
      supabaseAdmin
        .from("page_sources")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("source_type", "CUSTOMER_REVIEW")
    ),
  ]);

  const targets: Array<ResolvedAudience | null> = audiences.length ? audiences : [null];
  const out: AudienceCompleteness[] = [];
  for (const audience of targets) {
    // ‼️ OFFERS LIVE UNDER AUDIENCES SINCE 2026-09-15 (client_offers). Each audience reads its OWN
    // primary offer. The offer section applies to the primary audience always (it is the one being
    // worked, so a missing offer there is a real gap) and to an option audience only once it has an
    // offer of its own: an option nobody has sold to yet is not "missing six offer fields".
    const own = audience ? await loadOfferForAudience(audience.id) : null;
    const offer = audience && !audience.isPrimary ? (own ?? EMPTY_OFFER) : (own ?? primaryOffer);
    const offerApplies = audience === null || audience.isPrimary || own !== null;
    const { documents, ownResearch } = await documentsState(audience, offer);
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
