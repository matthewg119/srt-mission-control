// The keyword step, the half that talks to the database, the model and Slack.
//
// keyword-expansion.ts holds the rules (the category tables, query or hook, the scoring by
// provenance, the grammar) and proves them without a network. This file runs the step: it reads
// the locked offer and the market's evidence, asks the model for the ways the offer is said,
// merges the two with evidence winning, stores them in client_keywords with frozen ranks, posts the
// full list as a CSV, and answers `keywords approve` and the rest in the step's thread.
//
// ‼️ THE PAGE PLAN DRAWS ONLY FROM WHAT A PERSON APPROVED HERE. Before this step nothing selected
// keywords at all: the studio printed a ranked list and nothing saved it.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { awarenessOf, isAwarenessStage, type AwarenessStage } from "@/lib/audit-engine/awareness";
import { blockFor } from "@/lib/audit-engine/supplied-run";
import { slack } from "@/lib/slack-bot";
import type { Audience } from "@/lib/concierge/magnets";
import type { AudienceVocabulary } from "./audiences";
import type { AutoResult } from "./artifacts/registry";
import { evidenceRows, type KeywordOrigin as SetOrigin } from "./keyword-set";
import { normalizePhrase, offerVocabulary } from "./phrase-quality";
import {
  EXPANSION_SCHEMA,
  EXPANSION_SYSTEM,
  KEYWORD_CATEGORIES,
  categoriesFor,
  KEYWORD_FLOOR,
  categoryLabel,
  classifyCategory,
  classifyUse,
  cleanPhrase,
  compareKeywords,
  expansionUser,
  formatKeywordCard,
  gapDelta,
  isHookShaped,
  keywordCsv,
  keywordFault,
  keywordVerdict,
  mergeKeywords,
  parseKeywordCommand,
  scoreKeyword,
  tallyKeywords,
  type CategorySpec,
  type ExpansionContext,
  type KeywordCandidate,
  type KeywordOrigin,
  type KeywordUse,
  type StoredKeyword,
} from "./keyword-expansion";
import { KeywordRunRecorder, recordKeywordDecisions, recordKeywordRun } from "./keyword-dataset";

const MODEL = "claude-sonnet-4-6" as const;

/**
 * How long the expansion may take, re-asks included.
 *
 * ‼️ IT RUNS INSIDE THE CASCADE, which runs inside a route with a 300 second ceiling and other
 * steps' runners after it. A category still short when the budget runs out goes on the card with
 * `keywords more <category>` as the fix, and the verifier refuses the floor, which is the honest
 * outcome. A runner that overran the route would leave the step parked at `running` forever.
 */
const EXPANSION_BUDGET_MS = 150_000;

// ─────────────────────────────────────────────────────────────────────────────
// Who the keywords are for
// ─────────────────────────────────────────────────────────────────────────────

export interface KeywordContext extends ExpansionContext {
  clientId: string;
  vertical: string | null;
  website: string | null;
  audienceConfirmed: boolean;
  /** Which offer an expansion was written for. A different one resets the proposals. */
  fingerprint: string;
  categories: readonly CategorySpec[];
}

/**
 * What a keyword expansion is pinned to: the treatment, the customer's own words, and the audience.
 *
 * ‼️ THE SIBLING IS `documentFingerprint` IN audience-documents.ts, AND THE DIFFERENCE IS DELIBERATE.
 * That one covers treatment + outcome, because it answers "is this written copy still about this
 * offer". This one adds `terms` and the audience because it answers a different question: "are
 * these still the right phrases to rank for". `terms` is "the words their CUSTOMERS use for it"
 * (offers.ts), so it is exactly what an expansion is built from, and the audience decides which
 * phrase table applies at all. Both were called `offerFingerprint` until 2026-09-22, which read as
 * an inconsistency to settle; it was really two questions sharing one name. ‼️ Do not add a third.
 */
export function keywordFingerprint(treatment: string, terms: readonly string[], audience: Audience): string {
  return [normalizePhrase(treatment), [...terms].map(normalizePhrase).sort().join(","), audience].join("|");
}

/**
 * Which audience's table applies.
 *
 * ‼️ NEVER A DEFAULT AUDIENCE, which for-client.ts's header forbids. The concierge row when one
 * exists; before concierge_preview has provisioned it, the SAME proposal provisioning will seed
 * the row with, and the card says it is a proposal. `?? "patient"` would have expanded an agency's
 * offer into lip filler questions, because the agency verticals propose `owner`.
 */
export async function keywordAudience(clientId: string): Promise<{
  audience: Audience;
  confirmed: boolean;
  vertical: string | null;
  /** The preset this client's audience was seeded from, when it has one. */
  seededFrom: string | null;
  /** The audience's own nouns, used to derive a category table when no preset names one. */
  vocabulary: AudienceVocabulary | null;
}> {
  const { audienceFor } = await import("./audiences");
  const { conciergeTenant } = await import("@/lib/concierge/for-client");
  const { verticalFor } = await import("./harvest");
  const { proposeAudience } = await import("@/lib/concierge/audience-proposal");

  // ‼️ THE AUDIENCE ROW FIRST, AND IT ANSWERS ALL FOUR QUESTIONS AT ONCE. When it resolves,
  // nothing below it runs: the stance, the vertical, the preset and the nouns all come off one
  // row a person owns, rather than off a widget row plus a harvest lookup plus a proposal.
  const own = await audienceFor(clientId);
  if (own.ok) {
    return {
      audience: own.audience.stance,
      confirmed: own.audience.confirmedAt !== null,
      vertical: own.audience.researchVertical,
      seededFrom: own.audience.seededFrom,
      vocabulary: own.audience.vocabulary,
    };
  }

  // The legacy path, for a client with no audience row yet. Unchanged in behaviour, and it
  // still never defaults the stance: proposeAudience refuses to decide and says so.
  const [tenant, resolved] = await Promise.all([conciergeTenant(clientId), verticalFor(clientId)]);
  const vertical = resolved.ok ? resolved.vertical : null;
  if (tenant) {
    return { audience: tenant.audience, confirmed: true, vertical, seededFrom: null, vocabulary: null };
  }
  return {
    audience: proposeAudience(vertical).audience,
    confirmed: false,
    vertical,
    seededFrom: null,
    vocabulary: null,
  };
}

/**
 * The category table for whatever keywordAudience could work out.
 *
 * ‼️ THE STANCE TABLE IS THE FALLBACK, NOT THE ANSWER. A client with an audience row gets the
 * table its preset names, or one derived from its own nouns. A client without one falls back to
 * the two written tables, which is what every caller got before audiences existed.
 */
function categoriesForAudience(aud: {
  audience: Audience;
  seededFrom: string | null;
  vocabulary: AudienceVocabulary | null;
}): readonly CategorySpec[] {
  if (aud.vocabulary) {
    return categoriesFor({ seededFrom: aud.seededFrom, vocabulary: aud.vocabulary });
  }
  return KEYWORD_CATEGORIES[aud.audience];
}

export async function keywordContext(
  clientId: string
): Promise<{ ok: true; ctx: KeywordContext } | { ok: false; missing: string[] }> {
  const { loadOffer, isLocked } = await import("./offers");
  const { confirmedAvatarFor, avatarBriefFor } = await import("./avatars");
  const { stepNumber } = await import("@/config/delivery-steps");

  const [offer, avatar, aud, clientRes] = await Promise.all([
    loadOffer(clientId),
    confirmedAvatarFor(clientId),
    keywordAudience(clientId),
    supabaseAdmin.from("clients").select("legal_name, dba_name, city, website, domain").eq("id", clientId).maybeSingle(),
  ]);

  if (!isLocked(offer) || !offer.treatment) {
    return { ok: false, missing: [`the offer, locked on the prep call at step ${stepNumber("offer_locked")}`] };
  }

  const client = (clientRes.data ?? {}) as Record<string, unknown>;
  const research =
    avatar && aud.vertical ? ((await avatarBriefFor(aud.vertical, avatar.slug))?.researchText ?? null) : null;
  const cityRaw = typeof client.city === "string" && client.city.trim() ? client.city.trim() : null;

  return {
    ok: true,
    ctx: {
      clientId,
      clientName: ((client.dba_name as string | null) || (client.legal_name as string | null)) ?? "this business",
      treatment: offer.treatment,
      terms: offer.terms,
      positioning: offer.positioning,
      avatarLabel: avatar?.label ?? null,
      research,
      // Only a business that sells to people nearby is local. The owner lane sells to clinics
      // anywhere, so a city there would aim SRT's pages at its own street.
      city: aud.audience === "patient" ? cityRaw : null,
      audience: aud.audience,
      audienceConfirmed: aud.confirmed,
      vertical: aud.vertical,
      website: ((client.website as string | null) || (client.domain as string | null)) ?? null,
      fingerprint: keywordFingerprint(offer.treatment, offer.terms, aud.audience),
      categories: categoriesForAudience(aud),
    },
  };
}

/** The offer vocabulary: the treatment, the customer terms, and every naming variant still in the set. */
export function vocabFor(
  ctx: Pick<KeywordContext, "treatment" | "terms" | "categories">,
  rows: readonly StoredKeyword[]
): string[] {
  const naming = ctx.categories.find((c) => c.naming)?.key;
  return offerVocabulary({
    treatment: ctx.treatment,
    terms: ctx.terms,
    variants: rows.filter((r) => !r.dropped && r.use === "query" && r.category === naming).map((r) => r.phrase),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The rows
// ─────────────────────────────────────────────────────────────────────────────

// ‼️ awareness_stage IS IN THE FLAT LIST ON PURPOSE, matching this file's convention rather than
// page-plan.ts's tolerant selects: a missing column fails loadKeywords LOUDLY with TABLE_HINT, which
// names the migration. docs/2026-09-15-awareness-stages.sql runs before the deploy that reads it.
const KW_COLUMNS =
  "id, phrase, normalized, category, use, origin, offer_fingerprint, score, rank, currently_named, source_url, approved, dropped_at, awareness_stage, evidence_ids, role";

/**
 * The awareness stage of the person typing a phrase, by the deterministic rule. See awareness.ts.
 *
 * No client name is passed to blockFor: a keyword that names the client is a brand query, and the
 * keyword set is built from what buyers type about the OFFER, so the name check has nothing to find.
 */
function stageOf(phrase: string): AwarenessStage {
  return awarenessOf(phrase, blockFor(phrase, null));
}

interface LoadedKeywords {
  rows: StoredKeyword[];
  /** The offers the stored PROPOSALS were written for. More than the current one means a reset. */
  fingerprints: Set<string>;
}

function toStored(r: Record<string, unknown>): StoredKeyword {
  const origin = String(r.origin) as KeywordOrigin;
  return {
    id: String(r.id),
    phrase: String(r.phrase ?? ""),
    normalized: String(r.normalized ?? ""),
    category: String(r.category ?? ""),
    use: r.use === "hook" ? "hook" : "query",
    origin,
    frequency: 0,
    intent: 0,
    objection: false,
    currentlyNamed: typeof r.currently_named === "boolean" ? r.currently_named : null,
    sourceUrl: (r.source_url as string | null) ?? null,
    score: Number(r.score ?? 0),
    rank: typeof r.rank === "number" ? r.rank : r.rank == null ? null : Number(r.rank),
    approved: r.approved === true,
    dropped: r.dropped_at != null,
    awarenessStage: isAwarenessStage(r.awareness_stage) ? r.awareness_stage : null,
    evidenceIds: Array.isArray(r.evidence_ids) ? (r.evidence_ids as unknown[]).map(String) : [],
    role: r.role === "pillar" || r.role === "support" ? r.role : null,
  };
}

/**
 * Every stored row for this client.
 *
 * ‼️ A READ FAILURE IS RETURNED, NOT SWALLOWED INTO AN EMPTY SET. "No keywords yet" and "the table
 * is not there" send somebody to two different places, and the second is what happens between a
 * deploy and docs/2026-09-11-one-strategy.sql being run.
 */
export async function loadKeywords(clientId: string): Promise<LoadedKeywords | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select(KW_COLUMNS)
    .eq("client_id", clientId)
    .order("rank", { ascending: true, nullsFirst: false })
    .range(0, 2999);
  if (error) return { error: error.message };

  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const fingerprints = new Set<string>();
  for (const r of raw) {
    if ((r.origin === "expansion" || r.origin === "measured") && typeof r.offer_fingerprint === "string") {
      fingerprints.add(r.offer_fingerprint);
    }
  }
  return { rows: raw.map(toStored), fingerprints };
}

const TABLE_HINT =
  "If that names client_keywords, docs/2026-09-11-one-strategy.sql has not been run on this database.";

/**
 * The offer changed: forget what was proposed for the old one.
 *
 * ‼️ MANUAL ROWS SURVIVE, EVERYTHING ELSE IS REBUILT. A phrase Matthew typed is still something he
 * said; a proposal written for "lip filler" is not a proposal for "Botox", and an approval of the
 * old set is not an approval of a new one. Evidence rows are deleted too because they are cheap to
 * re-read and their categories and relevance were computed against the old vocabulary.
 */
async function resetForNewOffer(
  clientId: string,
  before: { rows: readonly StoredKeyword[]; fingerprints: Set<string> },
  newFingerprint: string
): Promise<string | null> {
  // ‼️ THE OLD SET IS KEPT WHOLE BEFORE IT IS DELETED (2026-09-16). What was proposed for the last
  // offer, and what a person approved and dropped from it, is exactly the history a training set
  // needs; the delete below used to be the end of it.
  await recordKeywordRun({
    clientId,
    reason: "reset",
    offerFingerprint: [...before.fingerprints][0] ?? null,
    rows: before.rows,
    context: { replacedBy: newFingerprint, fingerprints: [...before.fingerprints] },
  });

  const { error: delError } = await supabaseAdmin
    .from("client_keywords")
    .delete()
    .eq("client_id", clientId)
    .neq("origin", "manual");
  if (delError) return delError.message;

  // ‼️ A PHRASE A PERSON TYPED KEEPS ITS APPROVAL, AND ONLY THAT KIND DOES. Measured 2026-09-23:
  // thirteen phrases were added by hand and approved, the offer fingerprint moved, and this cleared
  // all thirteen along with the model's 340. The rows survived, because the delete above spares
  // `manual`; the approval did not, and nothing on screen said it had gone.
  //
  // The distinction is what the approval was ABOUT. Approving an expansion row is a judgement about
  // a proposal written for one offer, and a new offer voids it. Typing a phrase and approving it is
  // a judgement about the PHRASE, and "how to get more google reviews for a med spa" is still what
  // this buyer searches whatever we decide to call the thing we sell.
  //
  // The rank is cleared either way, because the card renumbers from the new set and a stale number
  // is worse than none: `keywords drop 12` would take the wrong row.
  const { error } = await supabaseAdmin
    .from("client_keywords")
    .update({
      approved: false,
      approved_at: null,
      approved_by: null,
      dropped_at: null,
      rank: null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .neq("origin", "manual");
  if (error) return error.message;

  const { error: mineError } = await supabaseAdmin
    .from("client_keywords")
    .update({ dropped_at: null, rank: null, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("origin", "manual");
  return mineError?.message ?? null;
}

/** What `keywords delete all` would destroy, counted before anybody presses anything. */
export interface KeywordWipeCount {
  keywords: number;
  reads: number;
  clusters: number;
  locked: boolean;
  /** Rows in OTHER steps that lose their link to a keyword. Named so nobody discovers it later. */
  plannedPages: number;
  headlines: number;
}

/** Count what a wipe would take, so the confirmation names real numbers rather than a warning. */
export async function countKeywordWipe(clientId: string): Promise<KeywordWipeCount> {
  const countOf = async (table: string, column = "client_id"): Promise<number> => {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, clientId);
    // A table this database has not got yet holds nothing, which is the honest count.
    return error ? 0 : (count ?? 0);
  };

  // ‼️ ONLY THE ROWS THAT ACTUALLY LOSE SOMETHING. Counting every page_plan row would tell somebody
  // that all nineteen planned pages are affected when four of them carry a keyword link, and a
  // confirmation that overstates what it destroys is one people learn to click through.
  const linkedOf = async (table: string, column: string): Promise<number> => {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .not(column, "is", null);
    return error ? 0 : (count ?? 0);
  };

  const [keywords, reads, clusters, plannedPages, headlines] = await Promise.all([
    countOf("client_keywords"),
    countOf("keyword_serp_reads"),
    countOf("keyword_clusters"),
    linkedOf("page_plan", "target_keyword_id"),
    linkedOf("client_headlines", "keyword_id"),
  ]);

  const lock = await supabaseAdmin
    .from("client_keyword_strategy")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  return {
    keywords,
    reads,
    clusters,
    plannedPages,
    headlines,
    locked: !lock.error && (lock.count ?? 0) > 0,
  };
}

/**
 * Throw the whole keyword set away, on purpose, and start again.
 *
 * ‼️ THIS IS NOT resetForNewOffer AND MUST NOT BE FOLDED INTO IT. That one is AUTOMATIC, fires when
 * the locked offer changes, and spares `origin = 'manual'` rows because a phrase somebody typed is
 * still something they said. Neither is true here: this is a person asking, out loud, for an empty
 * set, and the rows they typed are exactly the ones they want gone. Sparing them would leave the
 * pasted list behind and make the command a lie.
 *
 * ‼️ THE SET IS SNAPSHOTTED BEFORE IT IS DELETED, the same way resetForNewOffer does it. What was
 * proposed, and what a person approved and dropped from it, is the training record, and the delete
 * below used to be the end of it.
 *
 * ‼️ THE SCREENSHOTS GO TOO, AND THAT IS A DEPARTURE FROM THIS LANE'S USUAL RULE. keyword_serp_reads
 * normally survives everything, because a SERP is a fact about Google on a day and stays true after
 * we re-word what we sell, and it re-attaches by `normalized`. That is right for an offer change.
 * It is wrong for a deliberate wipe: a reading that silently re-attaches to a phrase pasted next
 * week would clear that keyword's gate without anybody looking at a picture, which is the one thing
 * the gate exists to prevent. Asked for explicitly, the pictures go.
 *
 * ‼️ WHAT SURVIVES, AND IT IS SAID ON THE CARD RATHER THAN LEFT TO BE DISCOVERED. keyword_runs and
 * keyword_decisions keep the history. client_docs keeps the uploaded files: the gate reads
 * keyword_serp_reads, not client_docs, so deleting the readings is what makes everything unpictured,
 * and client_docs is the whole board's evidence store which other steps verify against.
 * page_plan.secondary_keyword_ids is a uuid[] with NO foreign key, so it keeps ids of rows that no
 * longer exist and nothing in this repo cleans it.
 */
export async function deleteEveryKeyword(args: {
  clientId: string;
  by: string;
  /** What the button was drawn for. A set that has moved since is not the set they agreed to wipe. */
  expected: number;
}): Promise<
  | { ok: true; deleted: KeywordWipeCount }
  | { ok: false; error: string; current?: number }
> {
  const { clientId, by } = args;

  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { ok: false, error: `${loaded.error}. ${TABLE_HINT}` };

  // ‼️ A STALE BUTTON DELETES NOTHING. The count travels on the button so a press made after
  // somebody pasted forty more phrases is refused rather than silently taking them too. Same rule
  // the card already lives by: a stale number is worse than no number.
  if (loaded.rows.length !== args.expected) {
    return {
      ok: false,
      error: `the set changed since that button was drawn: it had ${args.expected} and now has ${loaded.rows.length}`,
      current: loaded.rows.length,
    };
  }

  const before = await countKeywordWipe(clientId);

  await recordKeywordRun({
    clientId,
    reason: "reset",
    offerFingerprint: [...loaded.fingerprints][0] ?? null,
    rows: loaded.rows,
    context: { deletedEverything: true, by, counts: before },
  });

  await recordKeywordDecisions({
    clientId,
    action: "delete_all",
    actor: by,
    rows: loaded.rows,
    context: { counts: before },
  }).catch(() => {});

  // Every foreign key into these is `on delete set null`, so the order is for reading rather than
  // for integrity. Readings first, because they are the thing whose survival would be a bug.
  for (const table of ["keyword_serp_reads", "keyword_clusters", "client_keyword_strategy"]) {
    const { error } = await supabaseAdmin.from(table).delete().eq("client_id", clientId);
    // A table this database has not got is nothing to delete from, which is not a failure.
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: `${table} was not cleared: ${error.message}` };
    }
  }

  const { error } = await supabaseAdmin.from("client_keywords").delete().eq("client_id", clientId);
  if (error) return { ok: false, error: `the keywords were not deleted: ${error.message}` };

  return { ok: true, deleted: before };
}

/**
 * Merge what came in with what is stored, then write it.
 *
 * ‼️ A STORED ROW KEEPS ITS RANK, ITS APPROVAL AND ITS DROP. Only its provenance and score move,
 * and only by the merge precedence (an evidenced reading of a phrase replaces a proposal of it).
 * New rows are ranked after everything that exists, so a number on an earlier card or CSV still
 * names the same phrase. Only a fresh set is ranked from 1.
 */
async function writeMerged(
  ctx: KeywordContext,
  stored: readonly StoredKeyword[],
  incoming: readonly KeywordCandidate[]
): Promise<{ inserted: number; updated: number; error?: string }> {
  const now = new Date().toISOString();
  const byKey = new Map(stored.map((r) => [`${r.use}|${r.normalized}`, r]));
  const fresh: KeywordCandidate[] = [];
  let updated = 0;

  for (const inc of mergeKeywords(incoming)) {
    const cur = byKey.get(`${inc.use}|${inc.normalized}`);
    if (!cur) {
      fresh.push(inc);
      continue;
    }
    const [win] = mergeKeywords([cur, inc]);
    const changed =
      win.origin !== cur.origin ||
      win.category !== cur.category ||
      win.sourceUrl !== cur.sourceUrl ||
      win.currentlyNamed !== cur.currentlyNamed ||
      (win.evidenceIds ?? []).length !== (cur.evidenceIds ?? []).length;
    if (!changed) continue;
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({
        origin: win.origin,
        category: win.category,
        source_url: win.sourceUrl,
        currently_named: win.currentlyNamed,
        score: win.origin === cur.origin ? cur.score : win.score,
        evidence_ids: win.evidenceIds ?? [],
        updated_at: now,
      })
      .eq("id", cur.id);
    if (error) return { inserted: 0, updated, error: error.message };
    updated += 1;
  }

  // Rows that lost their rank to a reset get one again, after the fresh ones are placed.
  const unranked = stored.filter((r) => r.rank === null);
  let next = stored.reduce((m, r) => Math.max(m, r.rank ?? 0), 0) + 1;
  const toRank = [...fresh, ...unranked].sort(compareKeywords);

  const inserts: Array<Record<string, unknown>> = [];
  for (const r of toRank) {
    const rank = next++;
    if ("id" in r && typeof (r as StoredKeyword).id === "string" && unranked.includes(r as StoredKeyword)) {
      await supabaseAdmin.from("client_keywords").update({ rank, updated_at: now }).eq("id", (r as StoredKeyword).id);
      continue;
    }
    inserts.push({
      client_id: ctx.clientId,
      phrase: r.phrase,
      normalized: r.normalized,
      category: r.category,
      use: r.use,
      origin: r.origin,
      audience: ctx.audience,
      offer_fingerprint: ctx.fingerprint,
      score: Math.round(r.score * 100) / 100,
      rank,
      currently_named: r.currentlyNamed,
      source_url: r.sourceUrl,
      approved: false,
      awareness_stage: stageOf(r.phrase),
      evidence_ids: r.evidenceIds ?? [],
      updated_at: now,
    });
  }

  for (let i = 0; i < inserts.length; i += 250) {
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .upsert(inserts.slice(i, i + 250), { onConflict: "client_id,normalized,use", ignoreDuplicates: true });
    if (error) return { inserted: i, updated, error: error.message };
  }
  return { inserted: inserts.length, updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// The evidence, and the expansion
// ─────────────────────────────────────────────────────────────────────────────

/** The market's own phrases, placed in this offer's categories. Nothing here is proposed. */
export async function evidenceCandidates(
  ctx: KeywordContext,
  vocab: readonly string[]
): Promise<{ rows: KeywordCandidate[]; note: string | null }> {
  const ev = await evidenceRows(ctx.clientId);
  if ("error" in ev) return { rows: [], note: `The market's evidence could not be read: ${ev.error}` };

  const rows = ev.rows.map((e) => {
    const use: KeywordUse = isHookShaped(e.phrase) ? "hook" : "query";
    const category = classifyCategory(e.phrase, ctx.categories, vocab);
    const origin: KeywordOrigin = e.origin === "harvest" ? "harvest" : "research";
    const spec = ctx.categories.find((c) => c.key === category);
    const base: KeywordCandidate = {
      phrase: e.phrase,
      normalized: e.normalized,
      category,
      use,
      origin,
      // Volume only when a source URL backs it, the rule extractKeywords applies at ingest.
      frequency: origin === "research" && !e.sourceUrl ? Math.min(e.frequency, 1) : e.frequency,
      intent: e.intent,
      objection: e.objection,
      currentlyNamed: e.currentlyNamed,
      sourceUrl: e.sourceUrl,
      score: 0,
      evidenceIds: e.bankIds,
    };
    return { ...base, score: scoreKeyword(base, spec?.intent ?? 0) };
  });
  return { rows, note: null };
}

interface RawRow {
  phrase?: unknown;
  category?: unknown;
  use?: unknown;
}

async function askModel(
  ctx: KeywordContext,
  asks: ReadonlyArray<{ category: CategorySpec; count: number }>,
  exclude: readonly string[],
  deadline: number,
  recorder?: KeywordRunRecorder
): Promise<{ rows: RawRow[]; error: string | null }> {
  const left = deadline - Date.now();
  if (left < 20_000) return { rows: [], error: "the time budget ran out before this call" };
  const user = expansionUser(ctx, asks, exclude);
  const started = Date.now();
  try {
    const res = await callClaudeJSON<{ rows: RawRow[] }>({
      model: MODEL,
      system: EXPANSION_SYSTEM,
      user,
      maxTokens: 12000,
      temperature: 0.7,
      schemaHint: EXPANSION_SCHEMA,
      // Structure only. A bad ROW is dropped in code rather than failing the batch: one dash in
      // one of two hundred phrases is not a reason to throw away the other hundred and ninety-nine.
      validate: (v): v is { rows: RawRow[] } =>
        Array.isArray((v as { rows?: unknown } | null)?.rows) && ((v as { rows: unknown[] }).rows.length > 0),
      describeInvalid: () => 'Return { "rows": [ { "phrase": ..., "category": ..., "use": ... } ] }, one object per phrase.',
      timeoutMs: left,
    });
    recorder?.call({ system: EXPANSION_SYSTEM, user, rows: res.data.rows, error: null, ms: Date.now() - started });
    return { rows: res.data.rows, error: null };
  } catch (e) {
    recorder?.call({ system: EXPANSION_SYSTEM, user, rows: [], error: (e as Error).message, ms: Date.now() - started });
    return { rows: [], error: (e as Error).message };
  }
}

function acceptRows(
  raw: readonly RawRow[],
  ctx: KeywordContext,
  seen: Set<string>,
  recorder?: KeywordRunRecorder
): KeywordCandidate[] {
  const out: KeywordCandidate[] = [];
  for (const r of raw) {
    // ‼️ EVERY REFUSAL IS WRITTEN DOWN WITH ITS REASON. What the model proposed and the rules threw
    // out is half of what a person would teach a model of our own, and it used to vanish here.
    const rawPhrase = String(r.phrase ?? "");
    const rawCategory = String(r.category ?? "").trim();
    const cat = ctx.categories.find((c) => c.key === rawCategory);
    if (!cat) {
      recorder?.reject({ phrase: rawPhrase, category: rawCategory, reason: "unknown_category" });
      continue;
    }
    const phrase = cleanPhrase(rawPhrase);
    const use = classifyUse(typeof r.use === "string" ? r.use : null, phrase);
    const fault = keywordFault(phrase, use);
    if (fault) {
      recorder?.reject({ phrase: rawPhrase, category: cat.key, reason: String(fault) });
      continue;
    }
    const normalized = normalizePhrase(phrase);
    const key = `${use}|${normalized}`;
    if (!normalized || seen.has(key)) {
      recorder?.reject({ phrase: rawPhrase, category: cat.key, reason: normalized ? "duplicate" : "empty" });
      continue;
    }
    seen.add(key);
    const base: KeywordCandidate = {
      phrase,
      normalized,
      category: cat.key,
      use,
      origin: "expansion",
      frequency: 0,
      intent: cat.intent,
      objection: false,
      currentlyNamed: null,
      sourceUrl: null,
      score: 0,
    };
    out.push({ ...base, score: scoreKeyword(base, cat.intent) });
  }
  return out;
}

/**
 * Ask for the ways the offer is said. Two calls for the whole table (half the categories each, so
 * neither has to write two hundred rows in one go), then each short category re-asked alone.
 * `only` re-expands one category, for `keywords more`.
 */
export async function expandKeywords(
  ctx: KeywordContext,
  existing: ReadonlyArray<Pick<KeywordCandidate, "normalized" | "use" | "category" | "phrase">>,
  only?: CategorySpec,
  recorder?: KeywordRunRecorder
): Promise<{ rows: KeywordCandidate[]; notes: string[] }> {
  const deadline = Date.now() + EXPANSION_BUDGET_MS;
  const seen = new Set(existing.map((r) => `${r.use}|${r.normalized}`));
  const notes: string[] = [];
  const cats = only ? [only] : ctx.categories;

  // ‼️ RESEARCH FIRST, THE MODEL FILLS WHAT IS LEFT (2026-09-13). This used to ask every category
  // for its FULL target no matter how much evidence was already sitting in `existing`, so a
  // category the market had already answered got a second, invented answer of the same size, and
  // the proposals outnumbered the evidence from the first run onwards. Matthew: "why are they
  // lifted straight from my list if this is not how people would google it".
  //
  // The shortfall is counted in QUERY rows, the same unit `target` is written in and the same one
  // KEYWORD_FLOOR and the re-ask below count. A category already at its target is not asked at
  // all, which is also the only way this step ever spends less than a full expansion.
  //
  // `only` (a `keywords more <category>` by hand) is deliberately exempt: he asked for more of
  // that category knowing what is in it, and second-guessing that with a count would ignore him.
  const alreadyHave = (key: string): number =>
    existing.filter((r) => r.category === key && r.use === "query").length;
  const asks = (only ? [{ category: only, count: only.target }] : cats.map((c) => ({ category: c, count: c.target - alreadyHave(c.key) }))).filter(
    (a) => a.count > 0
  );

  if (!asks.length) {
    return {
      rows: [],
      notes: [
        "The market's evidence already fills every category, so the model was not asked for any. " +
          "Every row in this set came from research, the harvest, or you.",
      ],
    };
  }

  const filled = cats.filter((c) => !asks.some((a) => a.category.key === c.key));
  if (!only && filled.length) {
    notes.push(
      `Evidence already filled ${filled.length} of ${cats.length} categories, so the model was not asked for those: ` +
        `${filled.map((c) => c.label).join(", ")}.`
    );
  }

  const halves = only ? [asks] : [asks.filter((_, i) => i % 2 === 0), asks.filter((_, i) => i % 2 === 1)];
  const first = await Promise.all(
    halves
      .filter((half) => half.length > 0)
      .map((half) =>
        askModel(
          ctx,
          half,
          only ? existing.filter((r) => r.category === only.key).map((r) => r.phrase) : [],
          deadline,
          recorder
        )
      )
  );
  for (const f of first) if (f.error) notes.push(`:warning: One expansion call failed: ${f.error}`);
  const accepted = acceptRows(first.flatMap((f) => f.rows), ctx, seen, recorder);

  // A category that came back short is re-asked for that category alone, not the whole batch.
  if (!only) {
    // Counts EVIDENCE PLUS what the model just wrote, for the same reason the ask above does: a
    // category the market answered is not short just because the model added nothing to it.
    const count = (key: string) =>
      alreadyHave(key) + accepted.filter((r) => r.category === key && r.use === "query").length;
    const short = asks.map((a) => a.category).filter((c) => count(c.key) < c.target);
    if (short.length) {
      const again = await Promise.all(
        short.map((c) =>
          askModel(
            ctx,
            [{ category: c, count: c.target - count(c.key) + 3 }],
            [...existing, ...accepted].filter((r) => r.category === c.key).map((r) => r.phrase),
            deadline,
            recorder
          )
        )
      );
      for (const a of again) if (a.error) notes.push(`:warning: A re-ask failed: ${a.error}`);
      accepted.push(...acceptRows(again.flatMap((a) => a.rows), ctx, seen, recorder));
    }
    const stillShort = asks
      .map((a) => [a.category, count(a.category.key)] as const)
      .filter(([c, n]) => n < c.target)
      .map(([c, n]) => `${c.label} ${n} of ${c.target}`);
    if (stillShort.length) {
      notes.push(`Short after re-asking: ${stillShort.join(", ")}. \`keywords more <category>\` asks again for one.`);
    }
  }

  return { rows: accepted, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// The runner
// ─────────────────────────────────────────────────────────────────────────────

async function uploadKeywordCsv(
  ctx: KeywordContext,
  rows: readonly StoredKeyword[]
): Promise<{ uploaded: boolean; docId: string | null }> {
  const name = ctx.clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  const file = `keywords-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  const buffer = Buffer.from(keywordCsv(rows, ctx.categories), "utf8");

  // ‼️ FILED BEFORE IT IS POSTED (2026-09-16). The CSV used to exist in Slack only, so a run's list as
  // it stood that day could not be read back from anywhere we own. Same order deliver.ts keeps: store,
  // then post. A failed store is logged and the post still happens.
  const { storeGeneratedDoc } = await import("./onboarding-docs");
  const stored = await storeGeneratedDoc({
    clientId: ctx.clientId,
    stepKey: "keyword_set",
    filename: file,
    buffer,
    contentType: "text/csv",
  }).catch((e) => ({ ok: false, docId: undefined as string | undefined, error: (e as Error).message }));
  if (!stored.ok) console.error("[client-keywords] CSV not filed:", stored.error);
  const docId = stored.docId ?? null;

  const { channelFor, anchorTsFor, notifyStep } = await import("./step-board");
  const channel = await channelFor(ctx.clientId);
  if (!channel) return { uploaded: false, docId };
  const thread = await anchorTsFor(ctx.clientId, "keyword_set");
  if (!thread) return { uploaded: false, docId };

  // ‼️ uploadFile RETURNS {ok:false} AND NEVER THROWS, and the share no-ops when the bot is not a
  // member. The scraper lane recorded both; same join first, same failure named in the thread.
  await slack.joinChannel(channel).catch(() => {});
  const res = (await slack.uploadFile(channel, file, buffer, "text/csv", thread)) as { ok?: boolean; error?: string };
  if (res?.ok !== true) {
    await notifyStep(ctx.clientId, "keyword_set", `:warning: The CSV could not be uploaded: ${res?.error ?? "no reason given"}.`).catch(() => {});
    return { uploaded: false, docId };
  }
  return { uploaded: true, docId };
}

export async function runKeywordStep(clientId: string): Promise<AutoResult> {
  const c = await keywordContext(clientId);
  // ‼️ ok:true WITH A NOTE, NOT AN ERROR. An error is terminal and never retried, so a missing lock
  // would park this step for good. Waiting leaves it `ready` with the card saying what is missing.
  if (!c.ok) {
    return {
      ok: true,
      note: `:hourglass: Nothing is expanded yet. Missing: ${c.missing.join("; ")}. The keyword set is written from it.`,
    };
  }
  const ctx = c.ctx;

  let loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { ok: false, error: `client_keywords could not be read (${loaded.error}). ${TABLE_HINT}` };

  const notes: string[] = [];
  if ([...loaded.fingerprints].some((f) => f !== ctx.fingerprint)) {
    const resetError = await resetForNewOffer(clientId, loaded, ctx.fingerprint);
    if (resetError) return { ok: false, error: `Resetting the old keyword set failed: ${resetError}` };
    notes.push(
      "_The offer or its terms changed since the last set was written, so the old proposals were cleared and nothing is approved. Phrases you added yourself were kept._"
    );
    loaded = await loadKeywords(clientId);
    if ("error" in loaded) return { ok: false, error: `client_keywords could not be read (${loaded.error}). ${TABLE_HINT}` };
  }

  const vocab = vocabFor(ctx, loaded.rows);
  const ev = await evidenceCandidates(ctx, vocab);
  if (ev.note) notes.push(`:warning: ${ev.note}`);

  const liveQueries = loaded.rows.filter((r) => !r.dropped && r.use === "query").length;
  const hasProposals = loaded.rows.some((r) => r.origin === "expansion" || r.origin === "measured");

  // A re-run of an existing set (Retry, a new research paste) re-merges the evidence and spends
  // nothing. Only a set with no proposals, or one under the floor, goes back to the model.
  let expansion: KeywordCandidate[] = [];
  const recorder = new KeywordRunRecorder();
  if (!hasProposals || liveQueries < KEYWORD_FLOOR) {
    const ex = await expandKeywords(ctx, [...loaded.rows, ...ev.rows], undefined, recorder);
    expansion = ex.rows;
    notes.push(...ex.notes);
  }

  const written = await writeMerged(ctx, loaded.rows, [...ev.rows, ...expansion]);
  if (written.error) return { ok: false, error: `Writing client_keywords failed: ${written.error}` };

  const after = await loadKeywords(clientId);
  const rows = "error" in after ? [] : after.rows;
  const { uploaded, docId } = await uploadKeywordCsv(ctx, rows);
  const tally = tallyKeywords(rows, vocabFor(ctx, rows));
  await recordKeywordRun({
    clientId,
    reason: recorder.calls.length ? "expansion" : "rerun",
    offerFingerprint: ctx.fingerprint,
    ...(await offerAndAudienceIds(clientId)),
    model: recorder.calls.length ? MODEL : null,
    recorder,
    evidenceCount: ev.rows.length,
    expansionCount: expansion.length,
    rows,
    csvDocId: docId,
    notes,
    context: { treatment: ctx.treatment, terms: ctx.terms, audience: ctx.audience, vertical: ctx.vertical },
  });
  const hooks = rows.filter((r) => !r.dropped && r.use === "hook").length;

  return {
    ok: true,
    note: [
      // ‼️ THE SPLIT IS THE FIRST THING SAID, NOT THE LAST. The totals used to lead and the
      // provenance trailed, which reads as "213 queries" when the truth was "13 from the market
      // and 200 a model made up". Research first is only a real rule if the card shows when it
      // did not happen.
      `:mag: *Keyword set written for ${ctx.treatment}.* ${ev.rows.length} read from the market's evidence, ` +
        `${expansion.length} proposed by the model to fill what was left.`,
      `${tally.queries} queries in all (the floor is ${KEYWORD_FLOOR}) and ${hooks} hooks.` +
        (expansion.length > ev.rows.length
          ? " *More of this set was invented than evidenced.* That is worth knowing before you approve it: " +
            "the deep research KEYWORDS block is what moves the balance, and `keywords add:` ranks like evidence."
          : ""),
      ...notes,
      uploaded
        ? "The whole list is the CSV above. The card has the top 40 and the commands."
        : "The card has the top 40 and the commands.",
    ].join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The card, the verifier, and what the plan reads
// ─────────────────────────────────────────────────────────────────────────────

export async function keywordCardLines(clientId: string): Promise<string[]> {
  const c = await keywordContext(clientId);
  if (!c.ok) return [`Nothing is expanded until this exists: ${c.missing.join("; ")}.`];
  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return [`:warning: client_keywords could not be read (${loaded.error}). ${TABLE_HINT}`];
  if (loaded.rows.length === 0) {
    return ["No keyword set has been written yet. It writes itself when this step runs; if this stays empty, Retry on the board."];
  }
  const ctx = c.ctx;
  return formatKeywordCard(
    {
      clientName: ctx.clientName,
      treatment: ctx.treatment,
      terms: ctx.terms,
      audience: ctx.audience,
      audienceConfirmed: ctx.audienceConfirmed,
      city: ctx.city,
      vocab: vocabFor(ctx, loaded.rows),
    },
    loaded.rows,
    ctx.categories
  );
}

export type KeywordCheck =
  | { ok: true; evidence: string[] }
  | { ok: false; broken: boolean; found: string; todo: string };

/**
 * System tier. At least the floor of query rows, approved, and enough of the approved ones about
 * the offer to fill a pillar and six supports, all written for the offer as it is locked now.
 */
export async function verifyKeywordSet(clientId: string): Promise<KeywordCheck> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { ok: false, broken: false, found: `missing: ${c.missing.join("; ")}`, todo: "Lock the offer on the prep call step first." };

  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) {
    return {
      ok: false,
      broken: true,
      found: `client_keywords could not be read: ${loaded.error}`,
      todo: "Run docs/2026-09-11-one-strategy.sql on this database, then Re-check.",
    };
  }

  if ([...loaded.fingerprints].some((f) => f !== c.ctx.fingerprint)) {
    return {
      ok: false,
      broken: false,
      found: "the stored proposals were written for a different offer or different terms than the ones locked now",
      todo: "Retry this step on the board, so it re-expands for the offer as it stands.",
    };
  }

  const tally = tallyKeywords(loaded.rows, vocabFor(c.ctx, loaded.rows));
  const verdict = keywordVerdict(tally);
  if (!verdict.ok) return { ok: false, broken: false, found: verdict.found, todo: verdict.todo };

  // ‼️ THE SCREENSHOT GATE, AS EVIDENCE. This repo's own doctrine is that a checkmark is evidence
  // and not a button press, so a step whose strategy was locked over keywords nobody has a picture
  // for must not tick. It is the fourth door on the gate and the only one that speaks the board's
  // language: the other three refuse a write, and this refuses a claim that the work is done.
  //
  // ‼️ A CLIENT WITH NO LOCKED STRATEGY PASSES, UNCHANGED. Most of step 12's history predates the
  // strategy half entirely. Blocking those would refuse a step for not using a feature that did not
  // exist when it ran, which is not evidence of anything.
  const unpictured = await unpicturedLockedPillars(clientId);
  if (unpictured.length) {
    return {
      ok: false,
      broken: false,
      found:
        `the strategy is locked over ${unpictured.length} keyword${unpictured.length === 1 ? "" : "s"} with no Google screenshot on file: ` +
        unpictured.slice(0, 4).join("; ") +
        (unpictured.length > 4 ? `; and ${unpictured.length - 4} more` : ""),
      todo:
        "Google each one, paste the screenshot in this thread with `keywords serp N` in the same message, then Re-check. " +
        "`keywords shortlist` reprints the numbers.",
    };
  }

  return {
    ok: true,
    evidence: [
      `${tally.queries} query rows in client_keywords, ${tally.approvedQueries} approved`,
      `${tally.relevantApproved} approved queries are about ${c.ctx.treatment}; the plan needs 9`,
    ],
  };
}

/**
 * Approved cluster pillars with no screenshot behind them.
 *
 * ‼️ ITS OWN TOLERANT SELECT, AND EMPTY ON ANY FAILURE. The tables arrive with a migration that has
 * not run, and this is a VERIFIER: a step that refuses to tick because a table is absent would block
 * every client on the board the moment this deploys, before the SQL, in a repo that deploys code
 * first. Absent reads as "no strategy locked", which is what it is.
 */
async function unpicturedLockedPillars(clientId: string): Promise<string[]> {
  const clusters = await supabaseAdmin
    .from("keyword_clusters")
    .select("pillar_keyword_id, label")
    .eq("client_id", clientId)
    .eq("status", "approved");
  if (clusters.error || !clusters.data?.length) return [];

  const byId = new Map<string, string>();
  for (const c of clusters.data) {
    const id = c.pillar_keyword_id as string | null;
    if (id) byId.set(id, (c.label as string) ?? id);
  }
  if (!byId.size) return [];

  const { picturedIds } = await import("./serp-gate");
  const shot = await picturedIds(clientId, [...byId.keys()]);
  if (!shot.ok) return [];

  return [...byId.entries()].filter(([id]) => !shot.pictured.has(id)).map(([, label]) => label);
}

/** The approved queries, for buildKeywordSet and the studio. Null when there is no approved set. */
export async function approvedKeywordSet(clientId: string): Promise<{
  vertical: string | null;
  avatar: string | null;
  rows: Array<{
    phrase: string;
    normalized: string;
    score: number;
    origin: SetOrigin;
    category: string;
    categoryLabel: string;
    currentlyNamed: boolean | null;
    sourceUrl: string | null;
  }>;
} | null> {
  const loaded = await loadKeywords(clientId);
  // Tolerant: a missing table means no approved set, and the computed list still shows.
  if ("error" in loaded) return null;
  const approved = loaded.rows
    .filter((r) => r.approved && !r.dropped && r.use === "query")
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  if (approved.length === 0) return null;

  const aud = await keywordAudience(clientId);
  const categories = categoriesForAudience(aud);
  return {
    vertical: aud.vertical,
    avatar: null,
    rows: approved.map((r) => ({
      phrase: r.phrase,
      normalized: r.normalized,
      score: r.score,
      origin: r.origin,
      category: r.category,
      categoryLabel: categoryLabel(categories, r.category),
      currentlyNamed: r.currentlyNamed,
      sourceUrl: r.sourceUrl,
    })),
  };
}

/** Everything the pre-call plan needs: the approved queries, the vocabulary, the categories. */
export async function planKeywords(
  clientId: string
): Promise<{ ctx: KeywordContext; rows: StoredKeyword[]; vocab: string[] } | { error: string }> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { error: `missing: ${c.missing.join("; ")}` };
  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { error: `client_keywords could not be read (${loaded.error}). ${TABLE_HINT}` };
  const rows = loaded.rows.filter((r) => r.approved && !r.dropped && r.use === "query");
  return { ctx: c.ctx, rows, vocab: vocabFor(c.ctx, loaded.rows) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

export interface KeywordReply {
  message: string;
  /** Work that runs after the reply, in waitUntil: a model call, the checks, a card redraw. */
  after?: () => Promise<void>;
}

async function refreshKeywordCard(clientId: string): Promise<void> {
  const { postStep } = await import("./step-engine");
  await postStep(clientId, "keyword_set").catch((e) =>
    console.error("[client-keywords] card refresh failed:", (e as Error).message)
  );
}

async function say(clientId: string, text: string): Promise<void> {
  const { notifyStep } = await import("./step-board");
  await notifyStep(clientId, "keyword_set", text).catch(() => {});
}

/**
 * Write more ways to say ONE phrase, each stamped as a variation of it.
 *
 * ‼️ THE SAME WRITE PATH `keywords variations` USES, and not a second one. It goes through
 * writeMerged, so a phrase already in the set keeps its rank, its approval and its drop, and a
 * variation that somebody had already picked is not quietly demoted to a proposal.
 *
 * ‼️ THEY ARRIVE UNAPPROVED, which is what makes the card's tick mean something. A variation is a
 * model's proposal until a person looks at its own results page and keeps it, and `origin:
 * "expansion"` is this repo's word for exactly that.
 *
 * ‼️ variation_of IS STAMPED IN A SECOND, TOLERANT WRITE. The column arrives with
 * docs/2026-09-27-keyword-decision-cards.sql and this repo deploys code first, so a database without
 * it still gets the phrases and loses only the parent link, which is a label rather than the work.
 */
export async function writeVariationsOf(args: {
  clientId: string;
  parent: { id: string; phrase: string };
  phrases: readonly string[];
}): Promise<{ ok: true; rows: Array<{ id: string; phrase: string }> } | { ok: false; error: string }> {
  if (!args.phrases.length) return { ok: true, rows: [] };

  const c = await keywordContext(args.clientId);
  if (!c.ok) return { ok: false, error: `missing: ${c.missing.join("; ")}` };

  const loaded = await loadKeywords(args.clientId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const vocab = vocabFor(c.ctx, loaded.rows);
  const { isObjection } = await import("./harvest");

  const candidates: KeywordCandidate[] = args.phrases.map((phrase) => {
    const category = classifyCategory(phrase, c.ctx.categories, vocab);
    const spec = c.ctx.categories.find((s) => s.key === category);
    const base: KeywordCandidate = {
      phrase,
      normalized: normalizePhrase(phrase),
      category,
      use: "query",
      origin: "expansion",
      frequency: 1,
      intent: spec?.intent ?? 0,
      objection: isObjection(phrase),
      currentlyNamed: null,
      sourceUrl: null,
      score: 0,
    };
    return { ...base, score: scoreKeyword(base, spec?.intent ?? 0) };
  });

  const written = await writeMerged(c.ctx, loaded.rows, candidates);
  if (written.error) return { ok: false, error: written.error };

  // writeMerged returns counts, not ids, so the rows are read back by the phrase they were written
  // under. `normalized` is the unique key (client_id, normalized, use), which is what makes this
  // exact rather than a guess.
  const wanted = candidates.map((k) => k.normalized);
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id, phrase, normalized")
    .eq("client_id", args.clientId)
    .eq("use", "query")
    .in("normalized", wanted);
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []).map((r) => ({ id: r.id as string, phrase: r.phrase as string }));
  // Never stamp a parent onto itself: a model that returns the phrase it was given would otherwise
  // make the row its own variation, and the card would print "another way of saying" itself.
  const ids = rows.map((r) => r.id).filter((id) => id !== args.parent.id);
  if (ids.length) {
    const stamp = await supabaseAdmin
      .from("client_keywords")
      .update({ variation_of: args.parent.id, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (stamp.error) {
      console.error("[client-keywords] variation_of not stamped:", stamp.error.message);
    }
  }

  return { ok: true, rows: rows.filter((r) => r.id !== args.parent.id) };
}

export async function handleKeywordThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<KeywordReply | null> {
  if (input.stepKey !== "keyword_set") return null;
  if (!/^\s*[`*_]*keywords\b/i.test(input.text)) return null;

  const aud = await keywordAudience(input.clientId);
  const cmd = parseKeywordCommand(input.text, categoriesForAudience(aud));
  if (!cmd) return null;

  switch (cmd.kind) {
    case "approve":
      return approveCommand(input.clientId, input.by, null);
    case "approve_some":
      return approveCommand(input.clientId, input.by, { ranks: cmd.ranks });
    case "approve_mine":
      return approveCommand(input.clientId, input.by, { manualOnly: true });
    case "drop":
      return dropCommand(input.clientId, cmd.ranks, input.by);
    case "add":
      return cmd.phrases.length === 1
        ? addCommand(input.clientId, cmd.phrases[0], input.by)
        : addManyCommand(input.clientId, cmd.phrases, input.by);
    case "pick":
      return pickCommand(input.clientId, cmd.phrases, input.by);
    case "variations":
      return variationsCommand(input.clientId, input.by);
    case "delete_all":
      return deleteAllCommand(input.clientId);
    case "more":
      return moreCommand(input.clientId, cmd.category);
    case "prompt":
      return promptCommand(input.clientId);
  }
}

/**
 * `keywords prompt`: hand over the research prompt for this offer.
 *
 * ‼️ IT UPLOADS A FILE RATHER THAN POSTING A MESSAGE, for the reason postFinalPrompt and
 * postFrameworkScript both record: this prompt carries the research on file, the documents and
 * every phrase already stored, which is tens of thousands of characters on a real client, and a
 * Slack section over 3,000 fails the WHOLE message rather than truncating.
 *
 * ‼️ ALL_SLICES, NOT A HAND-WRITTEN LIST. "All of the context possible" is the requirement, and a
 * slice list retyped here stops being all of it the day one is added to lead-context.ts.
 *
 * ‼️ IT REFUSES RATHER THAN DEGRADING. No locked offer means there is no offer to find keywords
 * for, and a prompt sent anyway returns keywords for a category rather than for this business.
 */
async function promptCommand(clientId: string): Promise<KeywordReply> {
  const { leadContext, ALL_SLICES } = await import("./lead-context");
  const ctx = await leadContext(clientId, { include: [...ALL_SLICES] });

  // buildContext refuses without a confirmed avatar. Unlike the deep research prompt, that is NOT
  // fatal here: a keyword is a search phrase, this door files nothing into the shared per-vertical
  // phrase corpus, and the offer alone is enough to ask the question. So a missing avatar costs the
  // owner's own words and nothing else.
  //
  // ‼️ THE CORPUS IS NOT NAMED IN WORDS HERE ON PURPOSE. scripts/_step-wiring.ts greps source as
  // TEXT to work out which files touch which table, so a comment mentioning one counts as a reader
  // and silently moves a number in a generated document. Same class of trap as the publish-gate
  // hole checks, which count a quoting comment as a second call site.
  const { buildContext } = await import("./artifacts/deep-research-run");
  const built = await buildContext(clientId).catch(() => ({ ok: false as const, error: "unreadable" }));

  const { docTextsFor } = await import("./doc-text");
  const docs = await docTextsFor(clientId).catch(() => []);

  const loaded = await loadKeywords(clientId);
  const existing = "error" in loaded
    ? []
    : loaded.rows
        .filter((r) => !r.dropped)
        .map((r) => ({ phrase: r.phrase, origin: r.origin, category: r.category, approved: r.approved }));

  const { gapsFrom } = await import("./step-gaps");
  const stepGaps = gapsFrom(ctx, "keyword_set").gaps;

  const { buildKeywordPrompt, keywordPromptSummary } = await import("./keyword-prompt");
  const { ADD_MAX } = await import("./keyword-expansion");
  const result = buildKeywordPrompt({
    ctx,
    research: built.ok ? built.ctx : null,
    docs,
    existing,
    stepGaps,
    addMax: ADD_MAX,
  });

  if (!result.ok) return { message: `:warning: No keyword prompt: ${result.error}` };
  const prompt = result.prompt;

  const name = (ctx.identity.name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = `keyword-prompt-${name || "client"}.txt`;

  return {
    message: keywordPromptSummary(prompt),
    after: async () => {
      const { channelFor, anchorTsFor } = await import("./step-board");
      const channel = await channelFor(clientId);
      const thread = await anchorTsFor(clientId, "keyword_set");
      if (!channel || !thread) return;

      // uploadFile returns {ok:false} and never throws, and the share no-ops when the bot is not
      // a member of the channel.
      await slack.joinChannel(channel).catch(() => {});
      const res = (await slack.uploadFile(
        channel,
        file,
        Buffer.from(prompt.body, "utf8"),
        "text/plain",
        thread
      )) as { ok?: boolean; error?: string };

      if (res?.ok !== true) {
        const { postClientReply } = await import("./client-events");
        await postClientReply({
          clientId,
          stepKey: "keyword_set",
          channel,
          threadTs: thread,
          text: `:warning: The keyword prompt was built but could not be uploaded: ${res?.error ?? "no reason given"}.`,
        }).catch(() => {});
      }
    },
  };
}

/** Which rows an approve is about. Null means every query row, which is the blunt original. */
interface ApproveScope {
  /** Ranks as the card prints them, already expanded from any ranges. */
  ranks?: number[];
  /** Only rows a person typed, which is `origin = 'manual'`. */
  manualOnly?: boolean;
}

/**
 * Approve the set, or the part of it somebody actually chose.
 *
 * ‼️ THE BARE FORM APPROVES EVERY QUERY ROW, AND THAT WAS THE WHOLE PROBLEM. Measured 2026-09-23:
 * fifteen chosen phrases were pasted, thirteen stored, `keywords approve` typed, and the reply said
 * "Approved 413 queries". The page plan draws ONLY from approved queries, so 149 model proposals
 * nobody had read became the pool every page is chosen from. A scope makes "these thirteen" sayable.
 */
async function approveCommand(clientId: string, by: string, scope: ApproveScope | null): Promise<KeywordReply> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { message: `:warning: Nothing to approve yet. Missing: ${c.missing.join("; ")}.` };

  const now = new Date().toISOString();
  let q = supabaseAdmin
    .from("client_keywords")
    .update({ approved: true, approved_at: now, approved_by: by, updated_at: now })
    .eq("client_id", clientId)
    .eq("use", "query")
    .is("dropped_at", null);

  if (scope?.manualOnly) q = q.eq("origin", "manual");
  if (scope?.ranks?.length) q = q.in("rank", scope.ranks);

  const { data, error } = await q.select("id, phrase, category, rank, score, origin, use");
  if (error) return { message: `:warning: Not approved: ${error.message}` };

  const n = (data ?? []).length;

  // ‼️ A NARROW APPROVE THAT MATCHED NOTHING IS A REFUSAL, NOT A SUCCESS. "Approved 0 queries" reads
  // as done. The numbers on the card are RANKS, and a reset clears every rank, so yesterday's
  // numbers match nothing today. Saying so is the only way anybody finds that out.
  if (n === 0 && scope) {
    return {
      message: scope.manualOnly
        ? ":warning: *Nothing was approved.* There are no phrases you typed yourself in this set. `keywords add:` puts them in first."
        : ":warning: *Nothing was approved.* No live query row carries those numbers. They are the ranks the card prints, and a re-run renumbers them, so `keywords` first.",
    };
  }
  await recordKeywordDecisions({
    clientId,
    action: "approve",
    actor: by,
    rows: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      phrase: String(r.phrase ?? ""),
      category: String(r.category ?? ""),
      rank: typeof r.rank === "number" ? r.rank : null,
      score: Number(r.score ?? 0),
      origin: r.origin as KeywordOrigin,
      use: (r.use === "hook" ? "hook" : "query") as KeywordUse,
    })),
    context: { fingerprint: c.ctx.fingerprint },
  });
  const scoped = scope?.manualOnly
    ? " that you typed yourself"
    : scope?.ranks?.length
      ? " you picked"
      : " as shown";

  return {
    message:
      `:white_check_mark: *Approved ${n} quer${n === 1 ? "y" : "ies"}*${scoped}. Hooks are kept for ads and emails and are ` +
      "not part of it.\nChecking the set now. The step ticks itself if it passes and says why if it does not.",
    after: async () => {
      const { setDeliveryStep } = await import("./delivery-checklist");
      const res = await setDeliveryStep({ clientId, stepKey: "keyword_set", transition: "complete", actor: by });
      if (!res.ok) {
        const todo = res.verdict && !res.verdict.ok && res.verdict.kind === "not_yet" ? `\n${res.verdict.todo}` : "";
        await say(clientId, `:hourglass: Not ticked: ${res.error ?? "the check refused"}${todo}`);
        await refreshKeywordCard(clientId);
      }
    },
  };
}

async function dropCommand(clientId: string, ranks: number[], by: string): Promise<KeywordReply> {
  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { message: `:warning: ${loaded.error}. ${TABLE_HINT}` };

  const byRank = new Map(loaded.rows.filter((r) => r.rank !== null).map((r) => [r.rank as number, r]));
  const hit = ranks.map((n) => byRank.get(n)).filter((r): r is StoredKeyword => Boolean(r) && !r!.dropped);
  const missing = ranks.filter((n) => !byRank.has(n));
  const highest = Math.max(0, ...byRank.keys());

  if (hit.length === 0) {
    return { message: `Nothing dropped. There is no live row ${ranks.join(", ")}; the card and the CSV number them 1 to ${highest}.` };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("client_keywords")
    .update({ dropped_at: now, approved: false, approved_at: null, approved_by: null, updated_at: now })
    .in("id", hit.map((r) => r.id));
  if (error) return { message: `:warning: Not dropped: ${error.message}` };
  await recordKeywordDecisions({ clientId, action: "drop", actor: by, rows: hit });

  return {
    message: [
      `Dropped ${hit.length}:`,
      ...hit.map((r) => `  ${r.rank}. ~${r.phrase}~`),
      ...(missing.length ? [`_No row ${missing.join(", ")}._`] : []),
      "A later expansion will not bring them back. The numbers of every other row stay the same.",
    ].join("\n"),
    after: () => refreshKeywordCard(clientId),
  };
}

async function addCommand(
  clientId: string,
  phrase: string,
  by: string,
  opts?: { approve?: boolean }
): Promise<KeywordReply> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { message: `:warning: Not added. Missing: ${c.missing.join("; ")}.` };
  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { message: `:warning: ${loaded.error}. ${TABLE_HINT}` };

  const use = classifyUse("query", phrase);
  const fault = keywordFault(phrase, use);
  if (fault) {
    return { message: `:warning: Not added: that reads as ${fault.replace(/_/g, " ")}. Type it the way somebody would search it.` };
  }

  const normalized = normalizePhrase(phrase);
  const existing = loaded.rows.find((r) => r.normalized === normalized && r.use === use);
  if (existing && !existing.dropped) {
    // ‼️ `pick:` SELECTS A ROW THAT IS ALREADY THERE, AND WITHOUT THIS IT DID NOTHING AT ALL.
    // Measured on SRT Agency 2026-09-24: fifteen phrases had been added earlier, so every one hit
    // this branch, returned "Already in the set", and the approve never ran. The reply said
    // "0 of 15 added" and the shortlist stayed empty, which reads as the paste being ignored twice.
    // Being in the set and being CHOSEN are different facts, and `pick` is about the second.
    if (opts?.approve && use === "query" && !existing.approved) {
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from("client_keywords")
        .update({ approved: true, approved_at: now, approved_by: by, updated_at: now })
        .eq("id", existing.id);
      if (error) return { message: `:warning: ${existing.phrase} could not be selected: ${error.message}` };
      return { message: `:white_check_mark: Selected *${existing.phrase}*, already in the set.` };
    }
    if (opts?.approve && existing.approved) {
      return { message: `:white_check_mark: Selected *${existing.phrase}*, already in the set.` };
    }
    return { message: `Already in the set as *${existing.rank}. ${existing.phrase}* (${existing.origin}).` };
  }

  const vocab = vocabFor(c.ctx, loaded.rows);
  const category = classifyCategory(phrase, c.ctx.categories, vocab);
  const spec = c.ctx.categories.find((s) => s.key === category);
  const { isObjection } = await import("./harvest");
  const base: KeywordCandidate = {
    phrase,
    normalized,
    category,
    use,
    origin: "manual",
    frequency: 1,
    intent: spec?.intent ?? 0,
    objection: isObjection(phrase),
    currentlyNamed: null,
    sourceUrl: null,
    score: 0,
  };
  const score = scoreKeyword(base, spec?.intent ?? 0);
  // He said it, so it joins an approved set as approved. A hook never joins the approval.
  //
  // ‼️ AND `keywords pick:` APPROVES REGARDLESS, WHICH IS THE WHOLE DIFFERENCE BETWEEN THE TWO VERBS.
  // The condition below asks whether an approval already EXISTS to join, which is right for `add:`
  // and silently wrong for the first paste on a new client: at zero approved it stores every phrase
  // and selects none, so the next `keywords shortlist` answers "no approved queries yet" about
  // fifteen phrases somebody just chose. Measured on SRT Agency, 2026-09-24. A hook still never
  // joins the approval, whichever verb was typed: it is not a thing a page can be aimed at.
  const setApproved =
    use === "query" && (opts?.approve === true || loaded.rows.some((r) => r.approved && !r.dropped));
  const now = new Date().toISOString();

  let rank: number;
  if (existing) {
    rank = existing.rank ?? Math.max(0, ...loaded.rows.map((r) => r.rank ?? 0)) + 1;
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({
        dropped_at: null,
        origin: "manual",
        score,
        rank,
        approved: setApproved,
        approved_at: setApproved ? now : null,
        approved_by: setApproved ? by : null,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) return { message: `:warning: Not added: ${error.message}` };
  } else {
    rank = Math.max(0, ...loaded.rows.map((r) => r.rank ?? 0)) + 1;
    const { error } = await supabaseAdmin.from("client_keywords").insert({
      client_id: clientId,
      phrase,
      normalized,
      category,
      use,
      origin: "manual",
      audience: c.ctx.audience,
      offer_fingerprint: c.ctx.fingerprint,
      score,
      rank,
      approved: setApproved,
      approved_at: setApproved ? now : null,
      approved_by: setApproved ? by : null,
      awareness_stage: stageOf(phrase),
      updated_at: now,
    });
    if (error) return { message: `:warning: Not added: ${error.message}` };
  }

  await recordKeywordDecisions({
    clientId,
    action: existing ? "restore" : "add",
    actor: by,
    rows: [{ id: existing?.id ?? "", phrase, category, rank, score, origin: "manual", use }],
    context: { approved: setApproved },
  });

  return {
    message:
      `:white_check_mark: ${existing ? "Brought back" : "Added"} as *${rank}. ${phrase}* ` +
      `(${categoryLabel(c.ctx.categories, category)}, manual, ranks like evidence).` +
      (use === "hook"
        ? " It reads as a marketing line, so it is stored as a hook and will never be a page's keyword."
        : setApproved
          ? " The set was already approved, so this is approved with it."
          : ""),
    after: () => refreshKeywordCard(clientId),
  };
}

/**
 * A pasted list. Each line goes through the SAME single-phrase add, so a list follows exactly the
 * rules one phrase does (the filter, query or hook, approved with an approved set), and the reply
 * is one summary rather than thirty messages.
 */
async function addManyCommand(
  clientId: string,
  phrases: readonly string[],
  by: string,
  opts?: { approve?: boolean }
): Promise<KeywordReply> {
  const added: string[] = [];
  const hooks: string[] = [];
  const already: string[] = [];
  const refused: string[] = [];

  for (const phrase of phrases) {
    const res = await addCommand(clientId, phrase, by, opts);
    const m = res.message;
    if (m.startsWith(":white_check_mark:")) {
      const label = m.match(/\*([^*]+)\*/)?.[1] ?? phrase;
      (m.includes("stored as a hook") ? hooks : added).push(label);
    } else if (m.startsWith("Already in the set")) {
      already.push(phrase);
    } else {
      refused.push(`${phrase} (${m.replace(/^:warning:\s*/, "").slice(0, 80)})`);
      if (m.includes("Missing:") || m.includes(TABLE_HINT)) break;
    }
  }

  const list = (items: string[]) => items.slice(0, 40).map((i) => `  • ${i}`).concat(items.length > 40 ? [`  • and ${items.length - 40} more`] : []);
  return {
    message: [
      // ‼️ "added" IS THE WRONG WORD FOR A PICK AND IT SAID "0 of 15" ON A RUN THAT WORKED. Under
      // `pick:` most rows are usually already in the set, so what happened to them is that they were
      // SELECTED, not added, and a count of additions reads as nothing having happened.
      opts?.approve
        ? `*${added.length + hooks.length} of ${phrases.length} selected*, each ranked like evidence because you said it.`
        : `*${added.length + hooks.length} of ${phrases.length} added*, each ranked like evidence because you said it.`,
      ...(added.length ? ["*Queries* (can become a page's keyword):", ...list(added)] : []),
      ...(hooks.length
        ? ["*Hooks* (marketing lines: kept for ads and emails, never a page's keyword):", ...list(hooks)]
        : []),
      ...(already.length ? [`_Already in the set: ${already.join("; ")}._`] : []),
      ...(refused.length ? ["*Not added:*", ...list(refused)] : []),
    ].join("\n"),
    after: () => refreshKeywordCard(clientId),
  };
}

/**
 * `keywords pick:` then the list. Add and SELECT in one move, then hand back the numbers.
 *
 * ‼️ THE PASTE IS THE SELECTION, AND THAT IS THE WHOLE POINT. Pasting fifteen chosen phrases and
 * then being told there is nothing to shortlist is not a smaller problem than being told nothing at
 * all: it reads as the system losing them. addCommand only approved into an approval that already
 * existed, so on a client at zero approved, which is every client the first time, a paste selected
 * nothing. `pick` says what the paste already meant.
 *
 * ‼️ IT PRINTS THE SHORTLIST NUMBERS, NOT THE RANKS. `keywords serp N` takes a position in
 * shortlistOf()'s output, which is deduped by subject and capped, and the ranks the add path prints
 * are something else entirely. Handing back the wrong number is how somebody screenshots the wrong
 * keyword and never finds out.
 */
async function pickCommand(clientId: string, phrases: readonly string[], by: string): Promise<KeywordReply> {
  const added = await addManyCommand(clientId, phrases, by, { approve: true });
  // A refusal from the add path (no locked offer, unreadable table) is returned as it stands: it
  // already names what is missing and there is nothing to be numbered.
  if (added.message.startsWith(":warning:")) return added;

  const { finalistsFor } = await import("./keyword-strategy");
  const res = await finalistsFor(clientId);
  if (!res.ok) {
    return {
      message: [added.message, "", `_The shortlist could not be read back: ${res.error}_`].join("\n"),
      after: added.after,
    };
  }

  const picked = new Set(phrases.map((p) => normalizePhrase(p)));
  const lines: string[] = [
    added.message,
    "",
    `*Selected, and these are the numbers \`keywords serp N\` takes:*`,
    "",
  ];

  res.list.forEach((r, i) => {
    const mine = picked.has(r.normalized) ? "" : "  _(already in the set)_";
    lines.push(`\`${String(i + 1).padStart(2, " ")}\` ${r.phrase}${mine}`);
  });

  // ‼️ SAID OUT LOUD WHEN THE SHORTLIST IS SHORTER THAN THE PASTE, AND SAID ACCURATELY. Somebody who
  // pastes fifteen and counts twelve assumes three were dropped on the floor. There are three
  // different reasons a phrase is not its own row, only ONE of them needs anything doing about it,
  // and a single sentence covering all three would be wrong about two of them.
  const onShortlist = new Set(res.list.map((r) => r.normalized));
  const missing = phrases.filter((p) => !onShortlist.has(normalizePhrase(p)));

  if (missing.length) {
    const { searchable, SHORTLIST_PER_CATEGORY } = await import("./keyword-strategy-rules");
    const notSearches = missing.filter((p) => !searchable(p));
    const rest = missing.filter((p) => searchable(p));

    lines.push("", `_${missing.length} of what you pasted are not separate rows above._`);

    // The one that needs acting on: it is stored and approved, and it will never get a screenshot,
    // because googling a sentence tells nobody anything.
    if (notSearches.length) {
      lines.push(
        `‼️ _${notSearches.length} of them ${notSearches.length === 1 ? "is not a search" : "are not searches"}: a statement ending in a full stop, or a question naming nothing ("how much does this cost"). ${notSearches.length === 1 ? "It is" : "They are"} still in the set and still useful to the concierge and the page angles, but ${notSearches.length === 1 ? "it" : "they"} will not get a screenshot:_`
      );
      for (const p of notSearches.slice(0, 6)) lines.push(`      ${p}`);
    }

    if (rest.length) {
      // "The other N" is wrong when there was no first group, and it read as thirty phrases from a
      // paste of fifteen.
      const lead = notSearches.length ? `The other ${rest.length}` : `${rest.length} of them`;
      lines.push(
        `_${lead} folded into a row above, because two phrasings of one question are one subject and one screenshot answers both. At most ${SHORTLIST_PER_CATEGORY} subjects per category reach the shortlist, so a batch about one thing shows fewer rows than it has phrases. Nothing was lost: they count as the page's phrase family._`
      );
    }
  }

  lines.push(
    "",
    "*Next:*",
    "  • Google one, then paste the screenshot here with `keywords serp 4` in the same message.",
    "  • `keywords variations` writes more ways to say the ones you just picked.",
    "  • `strategy` groups what is checked, `serp cards` puts the pictures and scores here to approve."
  );

  return { message: lines.join("\n"), after: added.after };
}

/**
 * `keywords variations`: more ways to say what has already been picked.
 *
 * ‼️ IT WIDENS THE PHRASE FAMILY, NOT THE SHORTLIST, AND THE CARD SAYS SO. shortlistOf dedupes by
 * sameSubject, so twenty variations of five picked phrases still produce five subjects and five
 * screenshots. That is the design: one page ranks for a family of phrasings, and the family is what
 * gets written into the title, the H1 and the subheads. Without the line saying so, this looks
 * broken the moment somebody counts the shortlist afterwards.
 *
 * ‼️ PROPOSALS, NEVER AUTO-APPROVED. They join as `expansion`, which precedence ranks below anything
 * a person typed, and wait for `keywords approve 411-423`.
 */
/**
 * The action_id the confirm button mints.
 *
 * ‼️ A CONSTANT BECAUSE TWO FILES HAVE TO AGREE ON IT: this one draws the button and
 * src/app/api/slack/actions/route.ts switches on it, and scripts/_probe-serp-gate.ts already checks
 * every action_id a keyword card mints against that switch.
 */
export const KEYWORD_WIPE_ACTION = "kwdelete_all";

/**
 * `keywords delete all`: say what would go, and offer one button.
 *
 * ‼️ IT DELETES NOTHING. There is no two-press flow anywhere else in this repo, and this is the
 * first: everything destructive here is either automatic (resetForNewOffer) or a CLI script behind
 * `--yes`. A typed phrase that wiped four hundred rows on the spot would be one autocorrect away
 * from a very bad afternoon, and the count on the button is what makes the second press specific.
 */
async function deleteAllCommand(clientId: string): Promise<KeywordReply> {
  const counts = await countKeywordWipe(clientId);

  if (counts.keywords === 0) {
    return { message: "There are no keywords to delete. `keywords pick:` then the list starts a new set." };
  }

  const alsoLoses: string[] = [];
  if (counts.plannedPages) alsoLoses.push(`${counts.plannedPages} planned page${counts.plannedPages === 1 ? "" : "s"}`);
  if (counts.headlines) alsoLoses.push(`${counts.headlines} headline${counts.headlines === 1 ? "" : "s"}`);

  const goes = [
    `*${counts.keywords}* keyword${counts.keywords === 1 ? "" : "s"}, including the ones you typed`,
    counts.reads ? `*${counts.reads}* SERP reading${counts.reads === 1 ? "" : "s"}, so every keyword needs a fresh screenshot` : "",
    counts.clusters ? `*${counts.clusters}* cluster${counts.clusters === 1 ? "" : "s"}` : "",
    counts.locked ? "the locked strategy" : "",
  ].filter(Boolean);

  return {
    message: [
      ":warning: *This empties the keyword set for this client.*",
      "",
      "Deleted:",
      ...goes.map((g) => `  •  ${g}`),
      alsoLoses.length ? `  •  ${alsoLoses.join(" and ")} lose their link to a keyword` : "",
      "",
      "Kept: the history. The whole set is snapshotted to `keyword_runs` first, and every approve and drop stays in `keyword_decisions`. The screenshot files stay in this thread; it is the readings that go, which is what makes everything need a fresh picture.",
      "",
      "Press the button to go ahead. Nothing has been deleted yet.",
    ]
      .filter(Boolean)
      .join("\n"),
    after: async () => {
      const { notifyStep } = await import("./step-board");
      await notifyStep(
        clientId,
        "keyword_set",
        `Delete all ${counts.keywords} keywords?`,
        [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                style: "danger",
                text: { type: "plain_text", text: `Yes, delete all ${counts.keywords}` },
                action_id: KEYWORD_WIPE_ACTION,
                // ‼️ THE CLIENT ID FIRST, then the count the button was drawn for. The actions
                // route's automatic button log matches a UUID PREFIX to attribute the press, so
                // anything in front of it makes the press unattributable. The count is the
                // staleness check: a press after the set has moved deletes nothing.
                value: `${clientId}:${counts.keywords}`,
              },
            ],
          },
        ] as unknown as Parameters<typeof notifyStep>[3]
      ).catch(() => {});
    },
  };
}

async function variationsCommand(clientId: string, by: string): Promise<KeywordReply> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { message: `:warning: Nothing written. Missing: ${c.missing.join("; ")}.` };

  const loaded = await loadKeywords(clientId);
  if ("error" in loaded) return { message: `:warning: ${loaded.error}. ${TABLE_HINT}` };

  // The picked set: approved queries somebody typed. Not the model's own proposals, which would make
  // this a machine writing variations of a machine's guesses.
  const picked = loaded.rows.filter((r) => r.approved && !r.dropped && r.use === "query" && r.origin === "manual");
  if (!picked.length) {
    return {
      message: [
        ":warning: Nothing has been picked yet, so there is nothing to write variations of.",
        "`keywords pick:` then the list, one per line. Or `keywords approve mine` if they are already in the set.",
      ].join("\n"),
    };
  }

  return {
    message: `Writing more ways to say the ${picked.length} phrase${picked.length === 1 ? "" : "s"} you picked. About a minute; they post here with their numbers.`,
    after: async () => {
      const { variationsFor } = await import("./keyword-variations");
      const res = await variationsFor({ ctx: c.ctx, picked: picked.map((r) => r.phrase) });
      if (!res.ok) return say(clientId, `:warning: No variations: ${res.error}`);
      if (!res.rows.length) {
        return say(clientId, "No variations worth keeping came back. The phrases you picked are already the way people type them.");
      }

      const vocab = vocabFor(c.ctx, loaded.rows);
      const { isObjection } = await import("./harvest");
      const candidates: KeywordCandidate[] = res.rows.map((v) => {
        const category = classifyCategory(v.phrase, c.ctx.categories, vocab);
        const spec = c.ctx.categories.find((s) => s.key === category);
        const base: KeywordCandidate = {
          phrase: v.phrase,
          normalized: normalizePhrase(v.phrase),
          category,
          use: "query",
          origin: "expansion",
          frequency: 1,
          intent: spec?.intent ?? 0,
          objection: isObjection(v.phrase),
          currentlyNamed: null,
          sourceUrl: null,
          score: 0,
        };
        return { ...base, score: scoreKeyword(base, spec?.intent ?? 0) };
      });

      const written = await writeMerged(c.ctx, loaded.rows, candidates);
      if (written.error) return say(clientId, `:warning: Not written: ${written.error}`);

      const byParent = new Map<string, string[]>();
      for (const v of res.rows) byParent.set(v.of, [...(byParent.get(v.of) ?? []), v.phrase]);

      const lines: string[] = [
        `*${written.inserted} more ways to say them* (${by}). Proposals, not picks: nothing is approved.`,
        "",
      ];
      for (const [parent, kids] of byParent) {
        lines.push(`*${parent}*`);
        for (const k of kids) lines.push(`      ${k}`);
      }
      lines.push(
        "",
        "‼️ _These do NOT add screenshots. Two phrasings of one question are one subject, so the shortlist is the same length and one picture answers the whole family. They widen what a page ranks for, which is what goes into the title, the H1 and the subheads._",
        "",
        "`keywords` to see them with their ranks, then `keywords approve 411-423` for the ones worth keeping."
      );

      await say(clientId, lines.join("\n"));
      await refreshKeywordCard(clientId);
    },
  };
}

async function moreCommand(clientId: string, category: CategorySpec): Promise<KeywordReply> {
  return {
    message: `Writing about ${category.target} more for *${category.label}*. About a minute; they post here with their numbers.`,
    after: async () => {
      const c = await keywordContext(clientId);
      if (!c.ok) return say(clientId, `:warning: Nothing written. Missing: ${c.missing.join("; ")}.`);
      const loaded = await loadKeywords(clientId);
      if ("error" in loaded) return say(clientId, `:warning: ${loaded.error}. ${TABLE_HINT}`);

      const recorder = new KeywordRunRecorder();
      const ex = await expandKeywords(c.ctx, loaded.rows, category, recorder);
      const written = await writeMerged(c.ctx, loaded.rows, ex.rows);
      if (written.error) return say(clientId, `:warning: Not written: ${written.error}`);

      const after = await loadKeywords(clientId);
      const rows = "error" in after ? [] : after.rows;
      const added = new Set(ex.rows.map((r) => `${r.use}|${r.normalized}`));
      const fresh = rows.filter((r) => added.has(`${r.use}|${r.normalized}`) && r.origin === "expansion");

      await say(
        clientId,
        [
          fresh.length
            ? `:heavy_plus_sign: *${fresh.length} new for ${category.label}.* Not approved until \`keywords approve\`.`
            : `Nothing new for *${category.label}*: everything the model wrote was already in the set or failed the filter.`,
          ...fresh.slice(0, 40).map((r) => `  ${r.rank}. ${r.phrase}${r.use === "hook" ? "  _(hook)_" : ""}`),
          ...ex.notes,
        ].join("\n")
      );
      const csv = await uploadKeywordCsv(c.ctx, rows);
      await recordKeywordRun({
        clientId,
        reason: "more",
        offerFingerprint: c.ctx.fingerprint,
        ...(await offerAndAudienceIds(clientId)),
        model: MODEL,
        recorder,
        expansionCount: ex.rows.length,
        rows,
        csvDocId: csv.docId,
        notes: ex.notes,
        context: { category: category.key },
      });
      await refreshKeywordCard(clientId);
    },
  };
}

/**
 * An estimate, stated as one. The Responses API with web_search on the audit model is billed per
 * search call plus tokens; about three cents a question is the planning figure, not a quote.
 *
 * It is on the card because a person is deciding whether to spend it: the tracked set is the
 * universal twenty plus custom_v1, so a Complete client's Photograph II is eighty questions.
 */
export const COST_PER_QUESTION = 0.03;

export interface MeasurementOutcome {
  ok: boolean;
  error?: string;
  /** Rows whose currently_named actually moved. A re-run of the same result updates nothing. */
  updated: number;
  named: number;
  notNamed: number;
  /** Questions that came back with no answer. They record NOTHING. */
  skipped: number;
}

/**
 * Write a finished audit run's answers back onto this client's keywords.
 *
 * ‼️ THIS REPLACED `keywords check` ON 2026-09-12, AND THE REPLACEMENT IS THE WHOLE POINT.
 * That command put the top twenty phrases to ChatGPT on its own, in a second runner, with its own
 * scoring and its own idea of what "not named" meant. Matthew: "this should be done after we do
 * the visibility audit or simply use the results we got from the visibility audit from that
 * profile specifically." So the approved keywords now join the tracked question set, ONE audit
 * measures them, and this reads that audit's rows. There is no second engine caller left.
 *
 * ‼️ A no_data ANSWER RECORDS NOTHING, NEVER "not named". run-prompts.ts's header states the rule
 * and the 2026-08-05 outage is why: twenty unanswered questions scored as twenty absences produced
 * a fabricated 0/100. Only `status = 'ok'` rows are read here.
 *
 * ‼️ THE +15 GAP TERM IS APPLIED ON A TRANSITION, NOT ON A MEASUREMENT. The old command wrote
 * `score + 15` every time it ran, so a re-test of a phrase that is still unnamed would have added
 * fifteen again, and again at day 60 and day 90, until an unchanged fact outranked everything in
 * the set. It is added when a row BECOMES unnamed and taken off when it stops being, so the score
 * describes the state rather than counting how often it was looked at.
 */
export async function applyMeasurement(clientId: string, reportId: string): Promise<MeasurementOutcome> {
  const empty = { updated: 0, named: 0, notNamed: 0, skipped: 0 };

  const [{ data: report }, { data: runRows, error: runError }, loaded, c] = await Promise.all([
    supabaseAdmin.from("audit_reports").select("prompts").eq("id", reportId).maybeSingle(),
    supabaseAdmin.from("audit_runs").select("prompt, mentioned, status").eq("report_id", reportId),
    loadKeywords(clientId),
    keywordContext(clientId),
  ]);

  if (runError) return { ok: false, error: `audit_runs could not be read: ${runError.message}`, ...empty };
  if ("error" in loaded) return { ok: false, error: `${loaded.error}. ${TABLE_HINT}`, ...empty };

  // The prompts carry the keyword id they were built from. Matching on the id rather than on the
  // text is what survives a phrase being tidied in one place and not the other.
  const idByPrompt = new Map<string, string>();
  for (const p of ((report?.prompts as Array<Record<string, unknown>> | null) ?? [])) {
    const text = typeof p.prompt === "string" ? p.prompt : "";
    const keywordId = typeof p.keyword_id === "string" ? p.keyword_id : "";
    if (text && keywordId) idByPrompt.set(normalizePhrase(text), keywordId);
  }

  const byId = new Map(loaded.rows.map((r) => [r.id, r]));
  const byNormalized = new Map<string, StoredKeyword>();
  for (const r of loaded.rows) {
    if (r.use === "query" && !byNormalized.has(r.normalized)) byNormalized.set(r.normalized, r);
  }

  const now = new Date().toISOString();
  const out = { ...empty };

  for (const run of (runRows ?? []) as Array<{ prompt: string; mentioned: boolean | null; status: string }>) {
    if (run.status !== "ok" || typeof run.mentioned !== "boolean") {
      out.skipped += 1;
      continue;
    }

    const key = normalizePhrase(run.prompt ?? "");
    const row = byId.get(idByPrompt.get(key) ?? "") ?? byNormalized.get(key);
    // A tracked question that is not a keyword (the universal twenty) measures the client, not a
    // keyword row. It is counted below and written nowhere, which is correct.
    if (!row) continue;

    if (run.mentioned) out.named += 1;
    else out.notNamed += 1;

    if (row.currentlyNamed === run.mentioned) continue;

    const spec = c.ok ? c.ctx.categories.find((s) => s.key === row.category) : undefined;
    const intent = spec?.intent ?? 0;
    const origin: KeywordOrigin = row.origin === "expansion" ? "measured" : row.origin;

    // A measured row's score is rebuilt from its provenance. An evidence row keeps the terms that
    // are not stored individually, so only the gap term moves, and only by the transition.
    const score =
      origin === "measured"
        ? scoreKeyword(
            { origin, frequency: 0, intent, objection: false, currentlyNamed: run.mentioned },
            intent
          )
        : row.score + gapDelta(row.currentlyNamed, run.mentioned);

    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({ currently_named: run.mentioned, origin, score, updated_at: now })
      .eq("id", row.id);

    if (!error) out.updated += 1;
  }

  if (out.updated > 0) {
    const after = await loadKeywords(clientId);
    await recordKeywordRun({
      clientId,
      reason: "measurement",
      offerFingerprint: c.ok ? c.ctx.fingerprint : null,
      rows: "error" in after ? [] : after.rows,
      context: { reportId, ...out },
    });
  }

  await refreshKeywordCard(clientId);
  return { ok: true, ...out };
}

/** The offer and audience a run was written for, as ids. Null when the offer predates client_offers. */
async function offerAndAudienceIds(clientId: string): Promise<{ offerId: string | null; audienceId: string | null }> {
  const { loadOffer } = await import("./offers");
  const offer = await loadOffer(clientId).catch(() => null);
  return { offerId: offer?.id ?? null, audienceId: offer?.audienceId ?? null };
}
