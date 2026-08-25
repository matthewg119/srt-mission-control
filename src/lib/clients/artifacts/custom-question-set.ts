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

export async function generateCustomQuestionSet(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, vertical_slug, business_type, tier_scope, ideal_patient")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

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

  const provenance: SetProvenance = { harvest: 0, deepResearch: 0, ownerIntake: 0, shortfall: [] };
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
    else provenance.harvest += 1;
  };

  // The owner's words go in FIRST, so dedup can never drop one in favour of a harvested
  // near-duplicate. Given the highest frequency so they sort to the top of their bucket.
  for (const phrase of ownerPhrases((client.ideal_patient ?? {}) as Record<string, unknown>)) {
    push(phrase, "owner_intake", Number.MAX_SAFE_INTEGER, commercialIntent(phrase));
  }

  for (const row of bank ?? []) {
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
        `objections in the owner's own words. Run the avatar phrase harvest (step 10) first.`,
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
    ] as TableRow[],
    { labelWidth: 45 }
  );

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
      `${provenance.ownerIntake} of the owner's own.\n` +
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
      `\n*This is step 12, the MEASUREMENT set: these are frozen at Day 0 and the day 30/60/90 ` +
      `numbers are scored against exactly them.* Nothing is ever published from this list. ` +
      `Step 13 is the PUBLISHING backlog, same corpus, opposite job.`,
  };
}
