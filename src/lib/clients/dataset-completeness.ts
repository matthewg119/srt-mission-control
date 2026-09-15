// What each of a client's audiences is still missing, read live. The loader for dataset-spec.ts.
//
// One report per audience, primary first. Read-only: nothing here writes, and every read degrades
// to "missing" rather than throwing, because a completeness card that errors tells you less than
// one that says a field is empty.

import { supabaseAdmin } from "@/lib/db";
import { audiencesFor, sharedBankFor, type ResolvedAudience } from "./audiences";
import { avatarBriefFor } from "./avatars";
import { loadOffer } from "./offers";
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

/** Every audience this client has, each with its completeness. A client with none gets one empty report. */
export async function completenessFor(clientId: string): Promise<AudienceCompleteness[]> {
  const [audiences, offer, audit, reviews] = await Promise.all([
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
    // ‼️ THE ONE OFFER BELONGS TO THE PRIMARY AUDIENCE ONLY. clients.offer is a single row per client
    // until offers move under audiences, so showing it under a second audience would claim that
    // audience has an offer it does not.
    const offerApplies = audience === null || audience.isPrimary;
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
      avatar: await avatarState(audience),
      offer: {
        applies: offerApplies,
        treatment: offer.treatment,
        terms: offer.terms.length,
        positioning: offer.positioning,
        magnetKey: offer.magnetKey,
        lockedAt: offer.lockedAt,
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
