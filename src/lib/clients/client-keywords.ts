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
import { slack } from "@/lib/slack-bot";
import type { Audience } from "@/lib/concierge/magnets";
import type { AutoResult } from "./artifacts/registry";
import { evidenceRows, type KeywordOrigin as SetOrigin } from "./keyword-set";
import { normalizePhrase, offerVocabulary } from "./phrase-quality";
import {
  EXPANSION_SCHEMA,
  EXPANSION_SYSTEM,
  KEYWORD_CATEGORIES,
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

export function offerFingerprint(treatment: string, terms: readonly string[], audience: Audience): string {
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
export async function keywordAudience(
  clientId: string
): Promise<{ audience: Audience; confirmed: boolean; vertical: string | null }> {
  const { conciergeTenant } = await import("@/lib/concierge/for-client");
  const { verticalFor } = await import("./harvest");
  const { proposeAudience } = await import("@/lib/concierge/audience-proposal");
  const [tenant, resolved] = await Promise.all([conciergeTenant(clientId), verticalFor(clientId)]);
  const vertical = resolved.ok ? resolved.vertical : null;
  if (tenant) return { audience: tenant.audience, confirmed: true, vertical };
  return { audience: proposeAudience(vertical).audience, confirmed: false, vertical };
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
      fingerprint: offerFingerprint(offer.treatment, offer.terms, aud.audience),
      categories: KEYWORD_CATEGORIES[aud.audience],
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

const KW_COLUMNS =
  "id, phrase, normalized, category, use, origin, offer_fingerprint, score, rank, currently_named, source_url, approved, dropped_at";

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
async function resetForNewOffer(clientId: string): Promise<string | null> {
  const { error: delError } = await supabaseAdmin
    .from("client_keywords")
    .delete()
    .eq("client_id", clientId)
    .neq("origin", "manual");
  if (delError) return delError.message;

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
    .eq("client_id", clientId);
  return error?.message ?? null;
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
      win.currentlyNamed !== cur.currentlyNamed;
    if (!changed) continue;
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({
        origin: win.origin,
        category: win.category,
        source_url: win.sourceUrl,
        currently_named: win.currentlyNamed,
        score: win.origin === cur.origin ? cur.score : win.score,
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
  deadline: number
): Promise<{ rows: RawRow[]; error: string | null }> {
  const left = deadline - Date.now();
  if (left < 20_000) return { rows: [], error: "the time budget ran out before this call" };
  try {
    const res = await callClaudeJSON<{ rows: RawRow[] }>({
      model: MODEL,
      system: EXPANSION_SYSTEM,
      user: expansionUser(ctx, asks, exclude),
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
    return { rows: res.data.rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}

function acceptRows(raw: readonly RawRow[], ctx: KeywordContext, seen: Set<string>): KeywordCandidate[] {
  const out: KeywordCandidate[] = [];
  for (const r of raw) {
    const cat = ctx.categories.find((c) => c.key === String(r.category ?? "").trim());
    if (!cat) continue;
    const phrase = cleanPhrase(String(r.phrase ?? ""));
    const use = classifyUse(typeof r.use === "string" ? r.use : null, phrase);
    if (keywordFault(phrase, use)) continue;
    const normalized = normalizePhrase(phrase);
    const key = `${use}|${normalized}`;
    if (!normalized || seen.has(key)) continue;
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
  only?: CategorySpec
): Promise<{ rows: KeywordCandidate[]; notes: string[] }> {
  const deadline = Date.now() + EXPANSION_BUDGET_MS;
  const seen = new Set(existing.map((r) => `${r.use}|${r.normalized}`));
  const notes: string[] = [];
  const cats = only ? [only] : ctx.categories;

  const halves = only ? [cats] : [cats.filter((_, i) => i % 2 === 0), cats.filter((_, i) => i % 2 === 1)];
  const first = await Promise.all(
    halves.map((half) =>
      askModel(
        ctx,
        half.map((c) => ({ category: c, count: c.target })),
        only ? existing.filter((r) => r.category === only.key).map((r) => r.phrase) : [],
        deadline
      )
    )
  );
  for (const f of first) if (f.error) notes.push(`:warning: One expansion call failed: ${f.error}`);
  const accepted = acceptRows(first.flatMap((f) => f.rows), ctx, seen);

  // A category that came back short is re-asked for that category alone, not the whole batch.
  if (!only) {
    const count = (key: string) => accepted.filter((r) => r.category === key && r.use === "query").length;
    const short = cats.filter((c) => count(c.key) < c.target);
    if (short.length) {
      const again = await Promise.all(
        short.map((c) =>
          askModel(
            ctx,
            [{ category: c, count: c.target - count(c.key) + 3 }],
            [...existing, ...accepted].filter((r) => r.category === c.key).map((r) => r.phrase),
            deadline
          )
        )
      );
      for (const a of again) if (a.error) notes.push(`:warning: A re-ask failed: ${a.error}`);
      accepted.push(...acceptRows(again.flatMap((a) => a.rows), ctx, seen));
    }
    const stillShort = cats
      .map((c) => [c, count(c.key)] as const)
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

async function uploadKeywordCsv(ctx: KeywordContext, rows: readonly StoredKeyword[]): Promise<boolean> {
  const { channelFor, anchorTsFor, notifyStep } = await import("./step-board");
  const channel = await channelFor(ctx.clientId);
  if (!channel) return false;
  const thread = await anchorTsFor(ctx.clientId, "keyword_set");
  if (!thread) return false;

  // ‼️ uploadFile RETURNS {ok:false} AND NEVER THROWS, and the share no-ops when the bot is not a
  // member. The scraper lane recorded both; same join first, same failure named in the thread.
  await slack.joinChannel(channel).catch(() => {});
  const name = ctx.clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  const file = `keywords-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  const res = (await slack.uploadFile(
    channel,
    file,
    Buffer.from(keywordCsv(rows, ctx.categories), "utf8"),
    "text/csv",
    thread
  )) as { ok?: boolean; error?: string };
  if (res?.ok !== true) {
    await notifyStep(ctx.clientId, "keyword_set", `:warning: The CSV could not be uploaded: ${res?.error ?? "no reason given"}.`).catch(() => {});
    return false;
  }
  return true;
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
    const resetError = await resetForNewOffer(clientId);
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
  if (!hasProposals || liveQueries < KEYWORD_FLOOR) {
    const ex = await expandKeywords(ctx, [...loaded.rows, ...ev.rows]);
    expansion = ex.rows;
    notes.push(...ex.notes);
  }

  const written = await writeMerged(ctx, loaded.rows, [...ev.rows, ...expansion]);
  if (written.error) return { ok: false, error: `Writing client_keywords failed: ${written.error}` };

  const after = await loadKeywords(clientId);
  const rows = "error" in after ? [] : after.rows;
  const uploaded = await uploadKeywordCsv(ctx, rows);
  const tally = tallyKeywords(rows, vocabFor(ctx, rows));
  const hooks = rows.filter((r) => !r.dropped && r.use === "hook").length;

  return {
    ok: true,
    note: [
      `:mag: *Keyword set written for ${ctx.treatment}.* ${tally.queries} queries (the floor is ${KEYWORD_FLOOR}) ` +
        `and ${hooks} hooks. ${expansion.length} proposed by the model this run, ${ev.rows.length} read from the market's evidence.`,
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
 * the offer to fill a pillar and eight supports, all written for the offer as it is locked now.
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

  return {
    ok: true,
    evidence: [
      `${tally.queries} query rows in client_keywords, ${tally.approvedQueries} approved`,
      `${tally.relevantApproved} approved queries are about ${c.ctx.treatment}; the plan needs 9`,
    ],
  };
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
  const categories = KEYWORD_CATEGORIES[aud.audience];
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

export async function handleKeywordThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<KeywordReply | null> {
  if (input.stepKey !== "keyword_set") return null;
  if (!/^\s*[`*_]*keywords\b/i.test(input.text)) return null;

  const aud = await keywordAudience(input.clientId);
  const cmd = parseKeywordCommand(input.text, KEYWORD_CATEGORIES[aud.audience]);
  if (!cmd) return null;

  switch (cmd.kind) {
    case "approve":
      return approveCommand(input.clientId, input.by);
    case "drop":
      return dropCommand(input.clientId, cmd.ranks);
    case "add":
      return cmd.phrases.length === 1
        ? addCommand(input.clientId, cmd.phrases[0], input.by)
        : addManyCommand(input.clientId, cmd.phrases, input.by);
    case "more":
      return moreCommand(input.clientId, cmd.category);
  }
}

async function approveCommand(clientId: string, by: string): Promise<KeywordReply> {
  const c = await keywordContext(clientId);
  if (!c.ok) return { message: `:warning: Nothing to approve yet. Missing: ${c.missing.join("; ")}.` };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .update({ approved: true, approved_at: now, approved_by: by, updated_at: now })
    .eq("client_id", clientId)
    .eq("use", "query")
    .is("dropped_at", null)
    .select("id");
  if (error) return { message: `:warning: Not approved: ${error.message}` };

  const n = (data ?? []).length;
  return {
    message:
      `:white_check_mark: *Approved ${n} queries* as shown. Hooks are kept for ads and emails and are ` +
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

async function dropCommand(clientId: string, ranks: number[]): Promise<KeywordReply> {
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

async function addCommand(clientId: string, phrase: string, by: string): Promise<KeywordReply> {
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
  const setApproved = use === "query" && loaded.rows.some((r) => r.approved && !r.dropped);
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
      updated_at: now,
    });
    if (error) return { message: `:warning: Not added: ${error.message}` };
  }

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
async function addManyCommand(clientId: string, phrases: readonly string[], by: string): Promise<KeywordReply> {
  const added: string[] = [];
  const hooks: string[] = [];
  const already: string[] = [];
  const refused: string[] = [];

  for (const phrase of phrases) {
    const res = await addCommand(clientId, phrase, by);
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
      `*${added.length + hooks.length} of ${phrases.length} added*, each ranked like evidence because you said it.`,
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

async function moreCommand(clientId: string, category: CategorySpec): Promise<KeywordReply> {
  return {
    message: `Writing about ${category.target} more for *${category.label}*. About a minute; they post here with their numbers.`,
    after: async () => {
      const c = await keywordContext(clientId);
      if (!c.ok) return say(clientId, `:warning: Nothing written. Missing: ${c.missing.join("; ")}.`);
      const loaded = await loadKeywords(clientId);
      if ("error" in loaded) return say(clientId, `:warning: ${loaded.error}. ${TABLE_HINT}`);

      const ex = await expandKeywords(c.ctx, loaded.rows, category);
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
      await uploadKeywordCsv(c.ctx, rows);
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

  await refreshKeywordCard(clientId);
  return { ok: true, ...out };
}
