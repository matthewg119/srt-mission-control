// Step 21, between the anchor and the plan: thirty three headlines at the anchored rung, seven kept.
//
// Matthew, 2026-09-16: "the workflow I want is to generate pages after we select the actual headlines...
// thats the most important thing ... it should tell to build the pages next after I approve 7 headlines
// (please make sure we are using our headline engine to generate headlines for the problem aware
// audience) Generate 33 new headlines for that specific sector".
//
// ‼️ THE HEADLINE IS THE DECISION AND THE KEYWORD RIDES ON IT. The plan used to be picked keyword first,
// which meant a person chose a search phrase and only saw the sentence a reader would actually read two
// stages later. Every candidate here is written FOR one approved keyword and carries its id, so keeping a
// headline keeps its keyword, `role` is set through the same setRole() the buttons use, and
// selectOfferPlan, the category caps and the keyword decision log all keep working untouched. Nothing was
// replaced; the order was reversed.
//
// ‼️ ONLY THE ANCHORED RUNG'S KEYWORDS ARE OFFERED. A rung is a reader state, and the whole point of
// anchoring at one is that every page speaks to it. Drawing candidates from the full approved set would
// hand back a page written for somebody three rungs away with no sign on it that it was.
//
// ‼️ AND IT REFUSES ON AN EMPTY EMOTIONAL LAYER. Matthew: "when we need to add a new vertical make sure
// the slack bot asks me for that new 20 emotional set of questions to leverage on the emotional layer the
// ecosystem has and build the narrative of the problems around those layers." A headline engine pointed at
// a vertical with no objections and no beliefs on file writes competent, generic copy and nothing says it
// is generic. So it stops and asks.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { AWARENESS_STAGES, type AwarenessStage } from "@/lib/audit-engine/awareness";
import { headlineFaults, headlinePrompt, normalizeHeadline } from "./client-headlines";
import type { StoredKeyword } from "./keyword-expansion";

/** Matthew asked for thirty three every time this runs. */
export const PRE_CALL_HEADLINES = 33;

/** One pillar and six supports. Must match PRE_CALL_SUPPORTS + 1 in page-plan.ts. */
export const PRE_CALL_PAGES = 7;

/** The fewest emotional rows a vertical needs before headlines may be written for it. */
export const EMOTIONAL_FLOOR = 20;

const STEP = "pre_call_pages";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

function stageName(stage: AwarenessStage): string {
  return AWARENESS_STAGES.find((s) => s.stage === stage)?.name ?? `stage ${stage}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The emotional layer a vertical has to have first
// ─────────────────────────────────────────────────────────────────────────────

export interface EmotionalLayer {
  vertical: string | null;
  /** Objection-shaped phrases on file for this vertical. */
  count: number;
  /** Necessary beliefs on file for this client's audience. */
  beliefs: number;
  ok: boolean;
}

export async function emotionalLayer(clientId: string): Promise<EmotionalLayer> {
  const { conciergeTenant } = await import("@/lib/concierge/for-client");
  const tenant = await conciergeTenant(clientId);
  const vertical = tenant?.vertical ?? null;

  const { storyContextFor } = await import("./story-context");
  const story = await storyContextFor(clientId).catch(() => null);
  const beliefs = story?.beliefs?.length ?? 0;

  if (!vertical) return { vertical, count: 0, beliefs, ok: false };

  const { count } = await supabaseAdmin
    .from("question_bank")
    .select("id", { count: "exact", head: true })
    .eq("vertical", vertical)
    .eq("objection_phrase", true);

  const found = count ?? 0;
  // ‼️ THE OBJECTIONS BLOCK AND THE BELIEFS ONLY WARN (2026-09-16). Requiring both refused SRT, whose
  // vertical carries 47 objections and whose necessary_beliefs document has never been pasted: the ladder
  // had already been written and anchored without them, and the headline prompt treats beliefs as one
  // block among several. Matthew asked for the twenty emotional questions per vertical, which is what
  // this gate is, and a missing framework document is a thing to say on the card rather than a wall.
  return { vertical, count: found, beliefs, ok: found >= EMOTIONAL_FLOOR };
}

/** What to post when a vertical has never been given its emotional layer. */
export function emotionalAskLines(layer: EmotionalLayer): string[] {
  return [
    `:octagonal_sign: *No headlines yet.* ${layer.vertical ?? "This client's vertical"} has ${layer.count} objection${layer.count === 1 ? "" : "s"} on file and ${layer.beliefs} necessary belief${layer.beliefs === 1 ? "" : "s"}.`,
    `The engine needs ${EMOTIONAL_FLOOR} to write to a rung rather than to a category. Without them it writes competent copy about the service and nothing in the output says it was generic.`,
    "",
    `*Paste ${EMOTIONAL_FLOOR} questions this buyer actually asks*, one per line, in their words, under an \`emotional:\` line:`,
    "```emotional:\nwhy does it cost that much when the place down the road is half\nwhat happens if it goes wrong and I have to get it fixed\n...\n```",
    "Fears, money, time, regret, comparison, who else has done it. Not features, not what we sell.",
    layer.beliefs === 0
      ? "*And the beliefs.* `beliefs:` in the prep call's thread writes the few things they must believe before buying."
      : "",
  ].filter(Boolean);
}

const EMOTIONAL = /^emotional\s*:\s*\n([\s\S]+)$/i;

/** `emotional:` followed by one phrase per line. Seeds the vertical, not the client. */
export async function ingestEmotional(args: {
  clientId: string;
  text: string;
  by: string;
}): Promise<{ ok: boolean; message: string } | null> {
  const m = EMOTIONAL.exec(args.text.trim());
  if (!m) return null;

  const layer = await emotionalLayer(args.clientId);
  if (!layer.vertical) {
    return { ok: false, message: ":warning: Nothing stored. This client has no vertical on its concierge row yet." };
  }

  const { normalizePhrase } = await import("./phrase-quality");
  const seen = new Set<string>();
  const rows = m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 8 && l.length <= 200)
    .map((phrase) => ({ phrase, normalized: normalizePhrase(phrase) }))
    .filter((r) => r.normalized && !seen.has(r.normalized) && seen.add(r.normalized))
    .map((r) => ({
      vertical: layer.vertical as string,
      phrase: r.phrase,
      normalized: r.normalized,
      source: "seed",
      frequency_score: 1,
      commercial_intent_score: 2,
      objection_phrase: true,
      kind: "objection",
      speaker: "buyer",
      avatar: null,
    }));

  if (rows.length === 0) return { ok: false, message: ":warning: Nothing stored. No line was long enough to be a question somebody asks." };

  // ‼️ ignoreDuplicates, SO A RE-PASTE ADDS AND NEVER OVERWRITES. A phrase already in the bank may have
  // arrived from a real sales call (source 'sales_call'), which outranks a seed, and a seed paste must
  // not quietly demote it.
  const { error } = await supabaseAdmin
    .from("question_bank")
    .upsert(rows, { onConflict: "vertical,avatar,normalized", ignoreDuplicates: true });
  if (error) return { ok: false, message: `:warning: Nothing stored: ${error.message}` };

  const after = await emotionalLayer(args.clientId);
  return {
    ok: true,
    message: [
      `:white_check_mark: *${rows.length} question${rows.length === 1 ? "" : "s"} filed against ${layer.vertical}* by ${args.by}. Every client in this vertical reads them.`,
      after.ok
        ? "The emotional layer is complete. `headlines` writes the thirty three."
        : `Still ${Math.max(0, EMOTIONAL_FLOOR - after.count)} short of ${EMOTIONAL_FLOOR}${after.beliefs === 0 ? ", and no necessary beliefs are on file" : ""}.`,
    ].join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing the thirty three
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate {
  headline: string;
  keyword: StoredKeyword;
}

interface KeywordPool {
  rows: StoredKeyword[];
  /** How many of them are already bucketed at the anchored rung. They come first. */
  atRung: number;
  /** The category a pillar keyword comes from, so the card can say which picks are offer pages. */
  naming: string | null;
}

/**
 * The searches the headlines are written for: this rung's first, then the rest of the approved set.
 *
 * ‼️ THE RUNG DECIDES HOW A HEADLINE SPEAKS, NOT WHICH SEARCHES EXIST, and filtering the pool by
 * stage was wrong (measured on SRT, 2026-09-16). Its approved set buckets 340 queries at stage 3, 30 at
 * stage 2 and SIX at stage 4, so anchoring at problem aware left six searches to build seven pages on and
 * the pick could never be satisfied: keeping seven headlines needs seven distinct keywords, because two
 * pages answering one search is the single thing the plan exists to prevent. Nothing else in the lane
 * filters keywords by stage either; `awareness_stage` is a label on a query, and the anchor is a decision
 * about the reader. So the rung's own searches lead the list, the rest follow, and the prompt says which
 * is which so the model writes to the rung either way.
 */
async function headlineKeywordPool(clientId: string, stage: AwarenessStage): Promise<KeywordPool> {
  const { planKeywords } = await import("./client-keywords");
  const { isRelevantKeyword } = await import("./keyword-expansion");
  const pk = await planKeywords(clientId);
  if ("error" in pk) return { rows: [], atRung: 0, naming: null };
  const relevant = [...pk.rows]
    .filter((r) => isRelevantKeyword(r, pk.vocab))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const here = relevant.filter((r) => r.awarenessStage === stage);
  const rest = relevant.filter((r) => r.awarenessStage !== stage);
  return {
    rows: [...here, ...rest],
    atRung: here.length,
    naming: pk.ctx.categories.find((c) => c.naming)?.key ?? null,
  };
}

interface Generated {
  headlines: Array<{ headline?: unknown; keyword?: unknown }>;
}

/**
 * Thirty three headlines, every one written for one of this rung's approved keywords.
 *
 * ‼️ ONE MODEL CALL, NOT ONE PER KEYWORD. generateKeywordHeadlines writes three for a single phrase and
 * is right for a plan row that already exists; asking it eleven times to fill a shortlist would be eleven
 * calls and eleven chances for a partial failure to leave a half-written card. The keyword is carried as
 * an index into a numbered list instead, which the validator checks is in range.
 */
export async function generatePreCallHeadlines(args: {
  clientId: string;
  stage: AwarenessStage;
  rung: { readerState: string; angle: string; claim: string };
  count?: number;
}): Promise<{ ok: true; candidates: Candidate[]; dropped: number } | { ok: false; error: string }> {
  const count = args.count ?? PRE_CALL_HEADLINES;
  const pool = await headlineKeywordPool(args.clientId, args.stage);
  const keywords = pool.rows;
  if (keywords.length < PRE_CALL_PAGES) {
    return {
      ok: false,
      error:
        `only ${keywords.length} approved search is about this offer, and seven pages need seven. ` +
        "`keywords more` at the keyword step, then approve them.",
    };
  }

  const { headlineContext } = await import("./client-headlines");
  const got = await headlineContext(args.clientId);
  if (!got.ok) return got;
  const ctx = got.ctx;
  const numberHaystack = [...ctx.approvedNumbers, ...ctx.quotes.map((q) => q.text)].join(" ");

  const numbered = keywords.slice(0, 18);
  const system = [
    headlinePrompt(ctx, count),
    "",
    "THE RUNG YOU ARE WRITING TO",
    `Stage ${args.stage} of 5, ${stageName(args.stage)}. 5 is furthest from buying, 1 is closest.`,
    `Where her head is: ${args.rung.readerState}`,
    `The angle: ${args.rung.angle}`,
    `What we may claim here: ${args.rung.claim}`,
    "",
    "Every headline must enter through THIS rung's door. A line that assumes she already knows the",
    "category, or already knows us, belongs to a lower rung and is wrong here however good it reads.",
    "",
    "THE SEARCHES, NUMBERED",
    ...numbered.map(
      (k, i) =>
        `  ${i + 1}. ${k.phrase}` +
        (k.awarenessStage === args.stage ? "  (already at this rung)" : "") +
        (pool.naming && k.category === pool.naming ? "  (names the offer itself)" : "")
    ),
    "",
    "Each headline carries exactly one of these, by its number, in her phrasing rather than welded in",
    "whole. A search marked as being at another rung is still legal: write it in THIS rung's voice, which",
    "is the door, not the wording of the query. Spread them: no search takes more than three of the set.",
  ].join("\n");

  // ‼️ THE BATCH IS FILTERED, NOT REFUSED, AND THAT IS THE WHOLE DIFFERENCE AT THIRTY THREE.
  // The weekly lane validates all-or-nothing inside callClaudeJSON, which is right for twenty lines
  // where one fault means the model misread the brief. At thirty three it means one invented figure
  // throws away the other thirty two, twice, and a person waits two minutes for nothing: measured on
  // SRT, where two runs in a row produced zero headlines over an invented score and four repeated
  // openings. So the model call only has to return the right SHAPE, every line is judged on its own
  // afterwards, and what passes is kept. A shortfall asks once more with the faults quoted.
  const maxPerOpening = Math.max(2, Math.ceil(count / 11));
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];

  const harvest = (rows: Generated["headlines"]): void => {
    for (const row of rows) {
      const headline = stripEmDashes(String(row.headline ?? "")).trim();
      const key = normalizeHeadline(headline);
      if (!key || seen.has(key)) continue;
      const keyword = numbered[Number(row.keyword) - 1];
      if (!keyword) continue;
      // count 0 skips the "expected N and got M" rule: this judges one line at a time. The opening
      // rule is applied against what is already kept, so the third "how do I" is refused and the
      // first two stand.
      const faults = headlineFaults([...kept.map((k) => k.headline), headline], 0, numberHaystack, maxPerOpening);
      const mine = faults.filter((f) => f.headline === headline || f.headline === "");
      if (mine.length) {
        dropped.push(`"${headline}" ${mine[0].why}`);
        continue;
      }
      seen.add(key);
      kept.push({ headline, keyword });
      if (kept.length >= count) return;
    }
  };

  const ask = async (want: number, correction: string): Promise<void> => {
    const { data } = await callClaudeJSON<Generated>({
      model: model(),
      system,
      user:
        `Return JSON with exactly ${want} headlines, in English, each with the number of the search it carries.` +
        correction,
      maxTokens: 6000,
      temperature: 0.9,
      schemaHint: '{ "headlines": [{ "headline": string, "keyword": number }] }',
      // Shape only. The copy rules are applied per line by harvest(), so one bad line costs one line.
      validate: (v): v is Generated => {
        const p = v as Generated | null;
        return Boolean(
          p &&
            Array.isArray(p.headlines) &&
            p.headlines.length > 0 &&
            p.headlines.every((h) => typeof h.headline === "string" && h.headline.trim())
        );
      },
      describeInvalid: () => 'Return { "headlines": [{ "headline": "...", "keyword": 3 }] } and nothing else.',
      timeoutMs: 180_000,
    });
    harvest(data.headlines);
  };

  try {
    await ask(count, "");
    if (kept.length < count) {
      const why = dropped.slice(0, 6).map((d) => `- ${d}`).join("\n");
      await ask(
        count - kept.length,
        `\n\nThese were refused, so do not repeat the fault:\n${why}\n` +
          `Do not repeat any of these lines:\n${kept.map((k) => `- ${k.headline}`).join("\n")}`
      );
    }
  } catch (e) {
    // A thrown call with lines already banked is a partial success, not a failure.
    if (kept.length === 0) return { ok: false, error: (e as Error).message };
    console.error(`[precall-headlines] second pass failed with ${kept.length} banked: ${(e as Error).message}`);
  }

  if (kept.length === 0) {
    return { ok: false, error: `every line was refused. ${dropped.slice(0, 3).join("; ")}` };
  }
  return { ok: true, candidates: kept, dropped: dropped.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Storing and showing them
// ─────────────────────────────────────────────────────────────────────────────

export interface ShortlistRow {
  id: string;
  headline: string;
  keywordId: string | null;
  keyword: string | null;
  approved: boolean;
  usedPageId: string | null;
}

/**
 * File the candidates against this client, tagged with the rung and the keyword each one carries.
 *
 * ‼️ A SIBLING OF storeHeadlines() RATHER THAN A WIDENING OF IT. That function is the weekly lane's and
 * writes three columns; this one writes the awareness pair and the keyword id as well. Widening it would
 * put four optional arguments on the path the Thursday cron takes, for the sake of one caller.
 */
export async function storePreCall(args: {
  clientId: string;
  stage: AwarenessStage;
  candidates: Candidate[];
  audienceId: string | null;
}): Promise<{ ok: true; stored: number; duplicates: number } | { ok: false; error: string }> {
  const { awarenessTarget } = await import("@/lib/audit-engine/awareness");
  const rows = args.candidates.map((c) => ({
    client_id: args.clientId,
    headline: c.headline,
    normalized: normalizeHeadline(c.headline),
    origin: "pre_call",
    awareness_entry: args.stage,
    awareness_target: awarenessTarget(args.stage),
    keyword_id: c.keyword.id,
    ...(args.audienceId ? { audience_id: args.audienceId } : {}),
  }));

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .upsert(rows, { onConflict: "client_id,normalized", ignoreDuplicates: true })
    .select("id");
  if (error) {
    return {
      ok: false,
      error:
        `the headlines could not be filed: ${error.message}. If this names keyword_id or awareness_entry, ` +
        `docs/2026-09-16-board-fixes.sql and docs/2026-09-15-awareness-stages.sql have not both been run.`,
    };
  }
  const stored = (data ?? []).length;
  return { ok: true, stored, duplicates: rows.length - stored };
}

/** This client's un-used pre-call headlines, newest run first, with the search each one carries. */
export async function shortlist(clientId: string): Promise<ShortlistRow[]> {
  const { data } = await supabaseAdmin
    .from("client_headlines")
    .select("id, headline, approved, used_page_id, keyword_id, client_keywords(phrase)")
    .eq("client_id", clientId)
    .eq("origin", "pre_call")
    .is("dropped_at", null)
    // ‼️ TIE-BROKEN ON id, AND WITHOUT IT THE NUMBERS LIE. All thirty three are inserted by one
    // statement, so they share a created_at to the microsecond and Postgres is free to return them in
    // any order. The number beside a headline on the card IS its position in this list, and
    // `headlines pick 4` resolves position four from a second call to this function: two different
    // orders means a person keeps a line they never read.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const kw = (Array.isArray(r.client_keywords) ? r.client_keywords[0] : r.client_keywords) as
      | { phrase?: unknown }
      | undefined;
    return {
      id: String(r.id),
      headline: String(r.headline ?? ""),
      keywordId: typeof r.keyword_id === "string" ? r.keyword_id : null,
      keyword: typeof kw?.phrase === "string" ? kw.phrase : null,
      approved: r.approved === true,
      usedPageId: typeof r.used_page_id === "string" ? r.used_page_id : null,
    };
  });
}

/** The numbered card. The number IS the position in this list, which is what `headlines pick` takes. */
export function shortlistLines(rows: ShortlistRow[], stage: AwarenessStage): string[] {
  const lines = [
    `:memo: *${rows.length} headlines at stage ${stage}, ${stageName(stage)}.* Each one carries one approved search.`,
    "",
  ];
  rows.forEach((r, i) => {
    const mark = r.approved ? ":white_check_mark: " : "";
    lines.push(`  ${i + 1}. ${mark}${r.headline}`, `      _${r.keyword ?? "no search on file"}_`);
  });
  lines.push(
    "",
    `*Keep ${PRE_CALL_PAGES}.* The first one you name is the pillar, the other six are the supports:`,
    "`headlines pick 4, 9, 12, 18, 22, 27, 31`",
    "The seven pages are planned around them the moment you do."
  );
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keeping seven
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approve seven, set their keywords' roles, and let the existing runner plan the pages.
 *
 * ‼️ THE ROLES GO THROUGH client_keywords EXACTLY AS THE BUTTONS DO. pickPillar and pickSupports write
 * `role`, `picked_at`, `picked_by` and a keyword_decisions row, and proposePreCallPlan refuses until a
 * person has set a pillar. Writing the plan rows directly from the headlines would skip all three and
 * leave the keyword history with no record that anybody chose anything.
 */
export async function pickHeadlines(args: {
  clientId: string;
  positions: number[];
  by: string;
}): Promise<{ ok: boolean; message: string; after?: () => Promise<void> }> {
  const rows = await shortlist(args.clientId);
  if (rows.length === 0) {
    return { ok: false, message: ":warning: Nothing picked. There are no headlines yet. `headlines` writes them." };
  }

  const wanted = args.positions.filter((n) => Number.isInteger(n) && n >= 1 && n <= rows.length);
  const unknown = args.positions.filter((n) => !wanted.includes(n));
  if (unknown.length) {
    return { ok: false, message: `:warning: Nothing picked. There is no headline ${unknown.join(", ")}; the list runs 1 to ${rows.length}.` };
  }
  if (new Set(wanted).size !== wanted.length) {
    return { ok: false, message: ":warning: Nothing picked. One of those is named twice." };
  }
  if (wanted.length !== PRE_CALL_PAGES) {
    return {
      ok: false,
      message: `:warning: Nothing picked. That is ${wanted.length}; the build is one pillar and six supports, so it takes ${PRE_CALL_PAGES}.`,
    };
  }

  const chosen = wanted.map((n) => rows[n - 1]);
  const missing = chosen.filter((r) => !r.keywordId);
  if (missing.length) {
    return {
      ok: false,
      message: `:warning: Nothing picked. ${missing.length} of those carry no search, so there is no keyword to build a page on. Pick others, or \`headlines\` writes a fresh set.`,
    };
  }

  // ‼️ TWO HEADLINES ON ONE SEARCH IS TWO PAGES COMPETING FOR IT, which is the single thing the whole
  // page plan exists to avoid. Caught here rather than at draft time, where it would already be six
  // model calls too late.
  const keywordIds = chosen.map((r) => r.keywordId as string);
  if (new Set(keywordIds).size !== keywordIds.length) {
    return { ok: false, message: ":warning: Nothing picked. Two of those carry the same search, and two pages cannot answer one." };
  }

  const { pickPillarById, pickSupportsByIds } = await import("./anchor-ladder");
  const pillar = await pickPillarById(args.clientId, keywordIds[0], args.by);
  if (!pillar.ok) return { ok: false, message: pillar.message };
  const supports = await pickSupportsByIds(args.clientId, keywordIds.slice(1), args.by);
  if (!supports.ok) return { ok: false, message: supports.message };

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("client_headlines")
    .update({ approved: true, approved_at: now, approved_by: args.by })
    .in("id", chosen.map((r) => r.id));

  return {
    ok: true,
    message: [
      `:white_check_mark: *${PRE_CALL_PAGES} headlines kept* by ${args.by}.`,
      `  *Pillar:* ${chosen[0].headline}`,
      ...chosen.slice(1).map((r, i) => `  ${i + 1}. ${r.headline}`),
      "",
      ":hourglass_flowing_sand: *Planning the seven pages around them now.* `plan` shows it, `plan approve` drafts them.",
    ].join("\n"),
    after: async () => {
      const { proposeWhenPicked } = await import("./anchor-ladder");
      const note = await proposeWhenPicked(args.clientId);
      if (note) {
        const { notifyStep } = await import("./step-board");
        await notifyStep(args.clientId, STEP, note).catch(() => {});
      }
      const { bindHeadlinesToPlan } = await import("./headline-plan");
      await bindHeadlinesToPlan(args.clientId, args.by).catch((e) =>
        console.error("[precall-headlines] binding failed:", (e as Error).message)
      );
      const { postStep } = await import("./step-engine");
      await postStep(args.clientId, STEP).catch(() => {});
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

const HEADLINES = /^headlines$/i;
const PICK = /^headlines\s+pick\s+([\d,\s#]+)$/i;

/** True when the text is one of this file's commands, for step-commands.ts's wrong-thread pointer. */
export function isHeadlineCommand(text: string): boolean {
  const t = text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  return HEADLINES.test(t) || PICK.test(t) || EMOTIONAL.test(t);
}

/**
 * `headlines`, `headlines pick ...` and `emotional:` in step 21's thread.
 *
 * ‼️ A BARE `headlines` FALLS THROUGH ONCE A PLAN EXISTS, AND THAT IS THE WHOLE OVERLOAD. The word means
 * two different things at two points in the same step: before a plan it means "write the set I choose the
 * seven pages from", and after one it means "write three options for each page I already have", which
 * pre-call-pages.ts has done since 2026-09-14. Returning null here rather than claiming the word keeps
 * the later meaning exactly as it was and puts the branch in one place instead of two.
 */
export async function handlePreCallHeadlineReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (input.stepKey !== STEP) return null;
  const raw = input.text.trim();
  const t = raw.replace(/^[`*_]+|[`*_]+$/g, "").trim();

  const say = async (text: string) => {
    const { notifyStep } = await import("./step-board");
    await notifyStep(input.clientId, STEP, text).catch(() => {});
  };

  if (EMOTIONAL.test(raw)) {
    const res = await ingestEmotional({ clientId: input.clientId, text: raw, by: input.by });
    if (res) return { message: res.message };
  }

  const pick = PICK.exec(t);
  if (pick) {
    const positions = pick[1]
      .split(/[,\s]+/)
      .map((n) => n.replace(/^#/, ""))
      .filter(Boolean)
      .map(Number);
    const res = await pickHeadlines({ clientId: input.clientId, positions, by: input.by });
    return { message: res.message, after: res.after };
  }

  if (!HEADLINES.test(t)) return null;

  // Once the seven pages exist, the word belongs to the batch lane. See the doctrine above.
  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(input.clientId);
  if (!("error" in plan) && plan.rows.some((r) => r.role)) return null;

  const existing = await shortlist(input.clientId);
  const { ladderState } = await import("./anchor-ladder");
  const state = await ladderState(input.clientId);
  const stage = state.anchorStage;
  if (!stage || !state.ladder) {
    return {
      message:
        ":warning: No rung is anchored yet, and a headline with no rung is a headline about the service. " +
        "`ladder` writes the five, then `anchor at 4` (or any rung) picks one.",
    };
  }

  // Already written and nobody has kept seven: show them again rather than spending another call.
  if (existing.length >= PRE_CALL_PAGES && !existing.some((r) => r.approved)) {
    return { message: shortlistLines(existing, stage).join("\n") };
  }

  const layer = await emotionalLayer(input.clientId);
  if (!layer.ok) return { message: emotionalAskLines(layer).join("\n") };
  // Not a refusal: the prompt is weaker without them and the thread should say so once.
  const thin = layer.beliefs === 0;

  const rung = state.ladder.rungs.find((r) => r.stage === stage);
  if (!rung) return { message: `:warning: The stored ladder has no stage ${stage}. \`ladder\` rewrites it.` };

  return {
    message:
      `:hourglass_flowing_sand: Writing ${PRE_CALL_HEADLINES} headlines at stage ${stage}, ${stageName(stage)}, one approved search each. About a minute.` +
      (thin
        ? "\n:warning: No necessary beliefs are on file for this audience, so the lines are written from the objections and the offer alone. `beliefs:` at the prep call step sharpens the next run."
        : ""),
    after: async () => {
      const got = await generatePreCallHeadlines({
        clientId: input.clientId,
        stage,
        rung: { readerState: rung.readerState, angle: rung.angle, claim: rung.claim },
      });
      if (!got.ok) {
        await say(`:warning: No headlines: ${got.error}`);
        return;
      }
      const stored = await storePreCall({
        clientId: input.clientId,
        stage,
        candidates: got.candidates,
        audienceId: state.audienceId,
      });
      if (!stored.ok) {
        await say(`:warning: ${stored.error}`);
        return;
      }
      const rows = await shortlist(input.clientId);
      const note =
        got.dropped > 0
          ? `\n_${got.dropped} more were written and refused by the rules, so they were dropped rather than shown._`
          : "";
      await say(shortlistLines(rows, stage).join("\n") + note);
      const { postStep } = await import("./step-engine");
      await postStep(input.clientId, STEP).catch(() => {});
    },
  };
}
