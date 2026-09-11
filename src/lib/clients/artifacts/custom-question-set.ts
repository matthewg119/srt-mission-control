// The custom question set — delivery step 12, Runner v3 section 11.
//
// Twenty (Core) or sixty (Complete) questions drafted from what this market actually types,
// composed for approval on the call. The universal twenty are the same for every client in the
// vertical; this is the half that is only true of THIS one.
//
// Three inputs, in priority order: the owner's own words from intake, the 4c harvest ranked by
// frequency and commercial intent, and what Photograph I's engines cited.
//
// ‼️ DETERMINISTIC. THERE IS NO MODEL IN THIS FILE, AND THAT IS THE MOST IMPORTANT LINE IN IT.
//
// harvest.ts already argues this for its own scores: "these scores decide which questions get
// TRACKED FROM DAY ZERO — a number that moves on its own would make the day-30 comparison
// meaningless." The custom set IS the tracked set, so the argument applies here at full
// strength. If a model picked these, re-running the step in October would produce a different
// sixty, and the day-90 report would be comparing two different measurements while presenting
// them as one trend.
//
// Selection is therefore ranking plus bucketing, both computed from columns already in the
// database, using the classifiers harvest.ts already exports.
//
// ‼️ MARKET PHRASINGS GO IN VERBATIM, TYPOS AND ALL.
// question_bank.phrase's own column comment: "Not cleaned up, not made grammatical, not turned
// into a keyword. The whole value of a harvest is the market's own wording." The only thing
// this file changes is bracket substitution, through the same chain the universal twenty use.
//
// ‼️ IT MUST NOT WRITE question_set_versions.
// docs/2026-08-19-harvest.sql calls a second writer of that table a BUILD STOP, and
// freezeUniversalV1() is its only one. This writes a DRAFT to client_question_sets. Freezing
// custom_v1 happens on approval, which is `call_held`, and is separate work.

import { supabaseAdmin } from "@/lib/db";
import { stepNumber } from "@/config/delivery-steps";
import { commercialIntent, isObjection, verticalFor } from "../harvest";
import { applySubstitutions, substitutionsFor } from "../question-sets";
import {
  startDoc,
  finishDoc,
  coverHeading,
  sectionHeading,
  paragraph,
  keyValueTable,
  bulletList,
  ensureSpace,
  plainFooter,
  MUTED,
  AMBER,
  type PageState,
  type TableRow,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";
import type { AutoResult } from "./registry";
import { filterPhrases, droppedLine } from "../phrase-quality";

/** Core gets twenty, Complete gets sixty. Runner v3 section 11. */
export const SET_SIZE: Record<"core" | "complete", number> = { core: 20, complete: 60 };

export type Bucket = "objection" | "comparison" | "neighbourhood" | "commercial";

/**
 * The composition target, and it is GUIDANCE rather than a quota.
 *
 * Runner v3 says so in those words. Forcing the exact split would mean padding a bucket the
 * harvest genuinely did not fill, which means inventing questions — and an invented question
 * is a page nobody is looking for and a tracked metric that measures nothing. Short buckets
 * are reported instead.
 */
export const COMPOSITION: Record<Bucket, number> = {
  objection: 0.4,
  comparison: 0.25,
  neighbourhood: 0.2,
  commercial: 0.15,
};

const BUCKET_LABEL: Record<Bucket, string> = {
  objection: "Objection",
  comparison: "Comparison",
  neighbourhood: "Neighbourhood",
  commercial: "Commercial",
};

/**
 * Which bucket a phrase belongs to, by shape.
 *
 * Objection is tested FIRST and wins outright: "is it safe if I have sensitive skin" is an
 * objection that happens to name a neighbourhood, and filing it under neighbourhood would put
 * the single most valuable question shape in the wrong pile.
 */
export function bucketOf(phrase: string): Bucket {
  if (isObjection(phrase)) return "objection";
  const p = phrase.toLowerCase();
  if (/\b(vs|versus|compare|better than|difference between)\b/.test(p)) return "comparison";
  if (/\b(near me|nearest|in |around|local|closest)\b/.test(p)) return "neighbourhood";
  return "commercial";
}

export interface CustomQuestion {
  question: string;
  bucket: Bucket;
  /** Where the phrase came from: 'harvest', 'deep_research', or the owner's own intake words. */
  source: string;
  frequency: number;
  intent: number;
}

export interface SetProvenance {
  harvest: number;
  deepResearch: number;
  ownerIntake: number;
  /** Approved, offer-relevant queries from the keyword step. See the push below. */
  keywords: number;
  /** Buckets the corpus could not fill to target, with how short each ran. */
  shortfall: Array<{ bucket: Bucket; wanted: number; got: number }>;
}

/**
 * The owner's own objections, verbatim from intake.
 *
 * These outrank everything harvested, for the same reason `intake_answers` outranks the generic
 * avatar set in the audit thread: they came from the person who actually answers these questions
 * all day. Turned into questions only by punctuation, never reworded.
 */
function ownerPhrases(idealPatient: Record<string, unknown>): string[] {
  const raw = [
    idealPatient.objection_1,
    idealPatient.objection_2,
    idealPatient.objection_3,
    idealPatient.common_questions,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .flatMap((v) => v.split(/[\n;]|(?<=\?)\s+/));

  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .map((s) => (s.endsWith("?") ? s : `${s}?`));
}

/**
 * The approved keyword queries that may join the tracked set, best first.
 *
 * ‼️ SPREAD ACROSS CATEGORIES, FOCUS FIRST, AND CAPPED PER CATEGORY. The keyword set is ranked by
 * score, and score rewards the visibility gap, so the top of it can be twenty price phrases on a
 * client nobody is named for. A tracked set of twenty price questions measures one thing twenty
 * times. The four buying questions (price, fears, comparisons, how it works) are the `focus`
 * categories the page plan already builds its supports from, so the same order is used here.
 *
 * Deterministic: same rows in, same questions out. The whole file depends on that (see the header).
 */
async function approvedKeywordQuestions(
  clientId: string,
  cap: number
): Promise<Array<{ phrase: string; score: number; intent: number }>> {
  if (cap <= 0) return [];

  const { planKeywords } = await import("../client-keywords");
  const { isRelevantKeyword } = await import("../keyword-expansion");

  const plan = await planKeywords(clientId);
  // No approved set yet is the normal case before the keyword step is worked. The set is still
  // drafted from the corpus, and the stale-blocker re-aim re-runs this the moment it is approved.
  if ("error" in plan) return [];

  const PER_CATEGORY = 3;
  const relevant = plan.rows
    .filter((r) => isRelevantKeyword(r, plan.vocab))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));

  const focusKeys = new Set(plan.ctx.categories.filter((c) => c.focus).map((c) => c.key));
  const ordered = [
    ...relevant.filter((r) => focusKeys.has(r.category)),
    ...relevant.filter((r) => !focusKeys.has(r.category)),
  ];

  const taken = new Map<string, number>();
  const out: Array<{ phrase: string; score: number; intent: number }> = [];
  for (const row of ordered) {
    if (out.length >= cap) break;
    const used = taken.get(row.category) ?? 0;
    if (used >= PER_CATEGORY) continue;
    taken.set(row.category, used + 1);
    out.push({
      phrase: row.phrase,
      score: row.score,
      intent: plan.ctx.categories.find((c) => c.key === row.category)?.intent ?? 0,
    });
  }
  return out;
}

export async function generateCustomQuestionSet(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, vertical_slug, business_type, tier_scope, ideal_patient")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  // ‼️ AN APPROVED SET IS FROZEN AND THIS MUST NOT WRITE OVER IT.
  //
  // The upsert below is unconditional on (client_id, version), and it writes status "draft". Once
  // Photograph II has run, custom_v1 IS the tracked set: the day 30/60/90 numbers are scored
  // against exactly those questions, and audit_reports.prompts on the archived run is the record of
  // what was asked. Re-running this step afterwards would silently replace the questions while the
  // measurement of the old ones stayed on the board, and every later comparison would be between
  // two different sets presented as one trend.
  const { data: frozen } = await supabaseAdmin
    .from("client_question_sets")
    .select("status, approved_at")
    .eq("client_id", clientId)
    .eq("version", "custom_v1")
    .maybeSingle();

  if ((frozen?.status as string | null) === "approved") {
    return {
      ok: false,
      error:
        `custom_v1 was approved${frozen?.approved_at ? ` on ${String(frozen.approved_at).slice(0, 10)}` : ""} and is ` +
        `the frozen tracked set, so it cannot be redrafted. The day 30, 60 and 90 numbers are scored ` +
        `against exactly those questions. A change of wording is a NEW version, never an edit of ` +
        `this one.`,
    };
  }

  // ‼️ REFUSES RATHER THAN GUESSING, and this is the READ side of the same bug harvest.ts
  // documents. A wrong vertical here does not corrupt anything, it silently builds the client's
  // tracked question set out of SOMEBODY ELSE'S corpus — which is worse, because it looks right.
  const resolvedVertical = await verticalFor(clientId);
  if (!resolvedVertical.ok) return { ok: false, error: resolvedVertical.error };
  const vertical = resolvedVertical.vertical;
  const tier = ((client.tier_scope as string | null) ?? "core") === "complete" ? "complete" : "core";
  const target = SET_SIZE[tier];

  const subs = await substitutionsFor(clientId);
  if (!subs) return { ok: false, error: "Client not found while reading substitutions." };

  const { data: bank } = await supabaseAdmin
    .from("question_bank")
    .select("phrase, source, frequency_score, commercial_intent_score, objection_phrase")
    .eq("vertical", vertical)
    .order("commercial_intent_score", { ascending: false })
    .order("frequency_score", { ascending: false })
    .limit(500);

  // ‼️ TWO THIRDS OF THIS CORPUS IS EXTRACTION DEBRIS, AND FILLING SIXTY SLOTS OUT OF IT IS WHY
  // THE PDF READS AS PADDING. Measured on SRT's own vertical, 2026-09-08: 169 usable rows of
  // 451. The rest are URLs glued onto quotes, citation markers the model left in, headline
  // fields from a brief, and whole paragraphs of somebody's prose. The composition targets then
  // guarantee all sixty slots get filled, so the padding was structural rather than incidental.
  //
  // Filtered on READ. Nothing is deleted: question_bank has no client_id and is shared by every
  // client in the vertical forever, so a delete is not something one client's session gets to
  // do. See src/lib/clients/phrase-quality.ts for the rules and the numbers.
  const bankFiltered = filterPhrases(bank ?? [], (r) => String(r.phrase ?? ""));

  const provenance: SetProvenance = { harvest: 0, deepResearch: 0, ownerIntake: 0, keywords: 0, shortfall: [] };
  const pool: CustomQuestion[] = [];
  const seen = new Set<string>();

  const push = (phrase: string, source: string, frequency: number, intent: number) => {
    const question = applySubstitutions(phrase, subs);
    const key = question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    pool.push({ question, bucket: bucketOf(phrase), source, frequency, intent });
    if (source === "deep_research") provenance.deepResearch += 1;
    else if (source === "owner_intake") provenance.ownerIntake += 1;
    else if (source === "keywords") provenance.keywords += 1;
    else provenance.harvest += 1;
  };

  // The owner's words go in FIRST, so dedup can never drop one in favour of a harvested
  // near-duplicate. Given the highest frequency so they sort to the top of their bucket.
  for (const phrase of ownerPhrases((client.ideal_patient ?? {}) as Record<string, unknown>)) {
    push(phrase, "owner_intake", Number.MAX_SAFE_INTEGER, commercialIntent(phrase));
  }

  // ‼️ THE APPROVED KEYWORDS JOIN THE TRACKED SET (2026-09-12), AND THAT IS THE WHOLE OF D2.
  //
  // Measured on SRT, 2026-09-11: its one client-linked audit asked twenty classifier-invented
  // questions and NOT ONE of them matched a keyword or a page candidate. So the set being measured
  // from Day 0 and the set the pages were written against were different sets, and the day 30/60/90
  // numbers would have described questions nobody chose. A person approved these phrases in the
  // keyword step; the audit asks them; applyMeasurement writes the answers back onto the same rows.
  //
  // Relevance is the same test the page plan uses, so a phrase that cannot be a pillar or a support
  // cannot become a tracked question either. Second in priority, after the owner's own words and
  // before the shared corpus: the owner's sentences are the only thing here that came from the
  // person who answers these questions all day.
  //
  // Capped at half the set. A tracked set made only of keywords would drop the market's own
  // phrasings, which is the half that makes the day-30 comparison about the MARKET and not about
  // what we chose to aim at.
  const keywordSeeds = await approvedKeywordQuestions(clientId, Math.floor(target / 2));
  for (const seed of keywordSeeds) {
    push(seed.phrase, "keywords", seed.score, seed.intent);
  }

  for (const row of bankFiltered.kept) {
    const phrase = ((row.phrase as string) ?? "").trim();
    if (!phrase) continue;
    push(
      phrase,
      (row.source as string) ?? "harvest",
      (row.frequency_score as number) ?? 1,
      (row.commercial_intent_score as number) ?? commercialIntent(phrase)
    );
  }

  if (pool.length === 0) {
    return {
      ok: false,
      error:
        `Nothing to draft from: question_bank is empty for "${vertical}" and intake recorded no ` +
        `objections in the owner's own words. Run the avatar phrase harvest ` +
        `(step ${stepNumber("avatar_harvest")}) first.`,
    };
  }

  // ── Selection: fill each bucket to its share, best first ──────────────────
  const byBucket = new Map<Bucket, CustomQuestion[]>();
  for (const q of pool) {
    const list = byBucket.get(q.bucket) ?? [];
    list.push(q);
    byBucket.set(q.bucket, list);
  }
  for (const list of byBucket.values()) {
    list.sort((a, b) => b.intent - a.intent || b.frequency - a.frequency);
  }

  const chosen: CustomQuestion[] = [];
  for (const bucket of Object.keys(COMPOSITION) as Bucket[]) {
    const wanted = Math.round(target * COMPOSITION[bucket]);
    const available = byBucket.get(bucket) ?? [];
    const take = available.slice(0, wanted);
    chosen.push(...take);
    if (take.length < wanted) {
      provenance.shortfall.push({ bucket, wanted, got: take.length });
    }
  }

  // Short buckets leave the set under target. Backfill from whatever ranked highest overall
  // rather than shipping a set of forty when sixty was promised — but the shortfall is still
  // reported above, so the composition drift is visible rather than smoothed over.
  if (chosen.length < target) {
    const already = new Set(chosen.map((q) => q.question));
    const rest = pool
      .filter((q) => !already.has(q.question))
      .sort((a, b) => b.intent - a.intent || b.frequency - a.frequency);
    chosen.push(...rest.slice(0, target - chosen.length));
  }

  const questions = chosen.slice(0, target);

  const { error: writeError } = await supabaseAdmin.from("client_question_sets").upsert(
    {
      client_id: clientId,
      version: "custom_v1",
      status: "draft",
      questions: questions.map((q) => q.question),
      composition: questions.reduce<Record<string, number>>((acc, q) => {
        acc[q.bucket] = (acc[q.bucket] ?? 0) + 1;
        return acc;
      }, {}),
      sources: provenance,
    },
    { onConflict: "client_id,version" }
  );

  if (writeError) {
    return { ok: false, error: `Writing client_question_sets failed: ${writeError.message}` };
  }

  // ── The document ──────────────────────────────────────────────────────────
  const name = (client.dba_name || client.legal_name || "Client") as string;
  const state: PageState = startDoc({
    title: `${name} — custom question set (draft)`,
    footer: plainFooter(`${name} — custom question set · DRAFT, not approved`),
  });

  coverHeading(state, {
    eyebrow: "Custom question set — DRAFT",
    title: name,
    subtitle:
      "Drafted from this market's own words. Approved on the call, and frozen only after that.",
  });

  sectionHeading(state, `${questions.length} questions · ${tier === "complete" ? "Complete" : "Core"} scope`);
  paragraph(
    state,
    "These run alongside the universal twenty, not instead of them. The universal set is the " +
      "same for every clinic in this vertical and makes comparison possible; this set is the " +
      "half that is only true of this business.",
    { size: 9.5 }
  );

  // ‼️ A thin run has to LOOK thin. harvest_runs.sources records provenance for exactly this
  // reason, and a set assembled mostly from three sentences typed at intake is a different
  // artifact from one assembled from four hundred harvested phrases, however similar the
  // page looks.
  sectionHeading(state, "Where these came from");
  keyValueTable(
    state,
    [
      { label: "Harvested", value: `${provenance.harvest} phrases from cited sources` },
      { label: "Deep research", value: `${provenance.deepResearch} from the pasted-back brief` },
      { label: "Owner's own words", value: `${provenance.ownerIntake} from intake, verbatim` },
      {
        label: "Approved keywords",
        value: `${provenance.keywords} from the keyword step, each one approved by a person and about the offer`,
      },
      // ‼️ THE SKIPPED COUNT IS PART OF THE PROVENANCE, NOT A FOOTNOTE. A set drawn from 169
      // usable rows out of 451 stored is a different artifact from one drawn from 451, and the
      // difference is invisible unless it is printed. Without this line a thin set looks like a
      // thin market, and somebody goes and runs another harvest that adds more of the same.
      {
        label: "Skipped",
        value: `${bankFiltered.dropped} stored rows were extraction debris, not phrases`,
      },
    ] as TableRow[],
    { labelWidth: 45 }
  );

  {
    const line = droppedLine(bankFiltered, (bank ?? []).length);
    if (line) {
      paragraph(
        state,
        `${line} Nothing was deleted: question_bank is shared by every client in this vertical, ` +
          `so debris is filtered when it is read rather than removed. The rules are mechanical ` +
          `and each one names the reason a row was skipped.`,
        { size: 9.5 }
      );
    }
  }

  if (provenance.harvest + provenance.deepResearch < target) {
    paragraph(
      state,
      "The harvest supplied fewer phrases than this set needs, so some of it is composed from " +
        "the owner's intake answers and the highest-ranked phrases available. That is a thinner " +
        "basis than a full harvest, and it is worth a second harvest pass before this is frozen.",
      { color: AMBER, size: 9.5 }
    );
  }

  if (provenance.shortfall.length) {
    paragraph(
      state,
      "Composition ran short in: " +
        provenance.shortfall
          .map((s) => `${BUCKET_LABEL[s.bucket].toLowerCase()} (${s.got} of ${s.wanted})`)
          .join(", ") +
        ". The shortfall was backfilled from the top of the overall ranking rather than by " +
        "writing new questions, because a question nobody asked measures nothing.",
      { color: AMBER, size: 9.5 }
    );
  }

  sectionHeading(state, "The set");
  paragraph(
    state,
    "Read for approval. Wording is the market's, not ours: a question is not tidied up, because " +
      "rewording it makes it a different question with its own baseline.",
    { color: MUTED, size: 9 }
  );

  for (const bucket of Object.keys(COMPOSITION) as Bucket[]) {
    const list = questions.filter((q) => q.bucket === bucket);
    if (!list.length) continue;
    ensureSpace(state, 24);
    sectionHeading(state, `${BUCKET_LABEL[bucket]} — ${list.length}`);
    bulletList(
      state,
      list.map((q) => q.question + (q.source === "owner_intake" ? "  [their words, from intake]" : "")),
      { size: 9 }
    );
  }

  sectionHeading(state, "What happens to this");
  bulletList(state, [
    "It is a DRAFT. Nothing is frozen and nothing is being measured against it yet.",
    "It is approved out loud on the call, alongside the universal twenty, and anything missing gets added there. The addition is the point.",
    "Only after approval is it frozen as custom_v1, and from that moment the wording cannot change without becoming a new version.",
  ]);

  const buffer = finishDoc(state);

  const delivered = await deliverArtifact({
    clientId,
    stepKey: "custom_question_set",
    filename: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-custom-questions-draft.pdf`,
    buffer,
    message:
      `*Custom question set — ${name}* (DRAFT)\n` +
      `${questions.length} questions for ${tier === "complete" ? "Complete" : "Core"} scope, ` +
      `drafted from ${provenance.harvest + provenance.deepResearch} harvested phrases and ` +
      `${provenance.ownerIntake} of the owner's own` +
      // ‼️ ON THE CARD, NOT ONLY IN THE PDF. The number that explains a short set has to be
      // where somebody reads it, and nobody opens a PDF to find out why it looks thin.
      (bankFiltered.dropped > 0
        ? `, after skipping ${bankFiltered.dropped} stored rows that were extraction debris`
        : "") +
      `.\n` +
      `Not frozen. It is approved on the call and frozen after that.`,
  });

  if (!delivered.ok) return { ok: false, error: delivered.error };

  return {
    ok: true,
    docId: delivered.docId,
    note:
      `Custom question set drafted: ${questions.length} questions (${tier})` +
      (provenance.shortfall.length ? `, composition short in ${provenance.shortfall.length} bucket(s).` : ".") +
      // The other half of the pair page-candidates.ts states on step 13, said here so step 12
      // says it too. Both steps are mode:"auto", so postReadySteps skips them and
      // instructionsFor is never reached — this note is the whole surface either one has, and a
      // distinction stated on only one of two steps that share a corpus is not stated.
      `\n*This is step ${stepNumber("custom_question_set")}, the MEASUREMENT set: these are frozen at Day 0 and the day 30/60/90 ` +
      `numbers are scored against exactly them.* Nothing is ever published from this list. ` +
      `Step ${stepNumber("page_candidates")} is the PUBLISHING backlog, same corpus, opposite job.`,
  };
}
