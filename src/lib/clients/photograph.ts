// Photograph II: the Day 0 measurement, and the day 30/60/90 re-tests that answer it.
//
// ‼️ `photograph_2` HAS EXISTED AS A VALUE SINCE 2026-08-18 AND HAD NO WRITER UNTIL NOW.
// day-zero.ts says it plainly: "photograph_2 means a real archived run wrote it and nothing writes
// that today". Every Day 0 in this system's history is therefore `manual_step`, which is an
// ASSERTION that the archive happened rather than evidence of it. This file is the writer.
//
// What it measures, and why it is exactly this:
//
//   universal_v1   the same twenty for every client in the vertical. Comparison across clients
//                  is the only thing this half is for, and it is frozen per vertical.
//   custom_v1      the half that is only true of this client, and since 2026-09-12 that includes
//                  the approved keywords (custom-question-set.ts). Matthew: "this should be done
//                  after we do the visibility audit or simply use the results we got from the
//                  visibility audit from that profile specifically."
//
// ‼️ FROZEN AT THE MOMENT OF THE RUN, NOT BEFORE AND NOT AFTER. The questions are copied onto the
// report row (audit_reports.prompts) and custom_v1 is marked approved in the same pass. From then
// on the wording cannot move: a re-test re-asks the archived run's own prompts, verbatim, so day 90
// is compared against day 0 rather than against a set that drifted underneath it.
//
// ‼️ A2 D-P16 DECIDES WHAT THIS IS CALLED. One engine is keyed, so resolveRunLabel downgrades a
// requested photograph to a `measurement`: the questions are asked, the keywords are measured, and
// the Day 0 wall is NOT stamped from it. See run-labels.ts. Nothing here asserts a fidelity it
// does not have, and the day a second engine is keyed the same command writes photograph_2.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhrase } from "./phrase-quality";
import { runSuppliedAudit, type SuppliedPrompt } from "@/lib/audit-engine/supplied-run";
import { COST_PER_QUESTION } from "./client-keywords";
import {
  KEYED_ENGINES,
  PHOTOGRAPH_MIN_ENGINES,
  resolveRunLabel,
  type SuppliedLabel,
} from "@/lib/audit-engine/run-labels";

export interface TrackedSet {
  prompts: SuppliedPrompt[];
  universal: number;
  custom: number;
  /** Approved query rows whose phrase is in the set, and how many exist in total. */
  keywordsTracked: number;
  keywordsApproved: number;
  /** The frozen universal version, for the note. Null when it could not be frozen. */
  universalVersion: string | null;
  vertical: string | null;
}

/**
 * The questions this client is measured on: universal_v1 plus custom_v1, deduped.
 *
 * Keyword ids ride along on the prompts they came from, so applyMeasurement can write the answers
 * back without matching on text. A question that is not a keyword (the universal twenty, a
 * harvested phrasing) simply carries no id and measures the client rather than a row.
 */
export async function trackedSetFor(clientId: string): Promise<TrackedSet | { error: string }> {
  const { universalSetFor } = await import("./question-sets");
  const { planKeywords } = await import("./client-keywords");

  const universal = await universalSetFor(clientId);
  if (!universal.ok) return { error: universal.error };

  const { data: custom } = await supabaseAdmin
    .from("client_question_sets")
    .select("questions")
    .eq("client_id", clientId)
    .eq("version", "custom_v1")
    .maybeSingle();

  const customQuestions = Array.isArray(custom?.questions)
    ? (custom.questions as unknown[]).map((q) => String(q ?? "").trim()).filter(Boolean)
    : [];

  // The approved keywords, so a tracked question that IS one carries its id.
  const plan = await planKeywords(clientId);
  const keywordIdByNormal = new Map<string, string>();
  let keywordsApproved = 0;
  if (!("error" in plan)) {
    keywordsApproved = plan.rows.length;
    for (const row of plan.rows) {
      if (!keywordIdByNormal.has(row.normalized)) keywordIdByNormal.set(row.normalized, row.id);
    }
  }

  const seen = new Set<string>();
  const prompts: SuppliedPrompt[] = [];
  let universalCount = 0;
  let customCount = 0;
  let keywordsTracked = 0;

  const add = (text: string, fromCustom: boolean) => {
    const phrase = text.trim();
    const key = normalizePhrase(phrase);
    if (!phrase || !key || seen.has(key)) return;
    seen.add(key);
    const keywordId = keywordIdByNormal.get(key);
    if (keywordId) keywordsTracked += 1;
    if (fromCustom) customCount += 1;
    else universalCount += 1;
    prompts.push(keywordId ? { prompt: phrase, keywordId } : { prompt: phrase });
  };

  // The universal set first: it is the half that makes two clients comparable, so it is never the
  // half that gets dropped to a duplicate.
  for (const q of universal.questions) add(q, false);
  for (const q of customQuestions) add(q, true);

  if (prompts.length === 0) {
    return {
      error:
        "there are no tracked questions: the universal set is empty and custom_v1 has not been " +
        "drafted. The custom set is written by its own step, from the approved keywords.",
    };
  }

  return {
    prompts,
    universal: universalCount,
    custom: customCount,
    keywordsTracked,
    keywordsApproved,
    universalVersion: universal.frozen ? universal.version : null,
    vertical: universal.vertical ?? null,
  };
}

/** What a run of this set costs, stated as the estimate it is. */
export function costOf(questions: number): string {
  return `$${(questions * COST_PER_QUESTION).toFixed(2)}`;
}

/**
 * Freeze custom_v1 for this client, at the moment it is measured.
 *
 * Two records, because they answer two questions. `client_question_sets.status = approved` is what
 * generateCustomQuestionSet reads to refuse a redraft. The `question_set_versions` row is the
 * immutable copy, written through the ONE writer in question-sets.ts, so the questions can still be
 * read back verbatim if the live row is ever edited.
 */
async function freezeCustomV1(clientId: string, questions: readonly string[], vertical: string | null): Promise<void> {
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("client_question_sets")
    .update({ status: "approved", approved_at: now, approved_by: "photograph", updated_at: now })
    .eq("client_id", clientId)
    .eq("version", "custom_v1")
    .neq("status", "approved");

  if (!vertical || questions.length === 0) return;

  const { freezeQuestionSet } = await import("./question-sets");
  await freezeQuestionSet({
    // Per client, because custom_v1 IS per client. question_set_versions is keyed on version
    // alone, so the client id has to be inside the key rather than beside it.
    version: `custom_v1@client:${clientId}`,
    vertical,
    questions,
    note:
      "custom_v1 as it stood when the Day 0 measurement was taken. The day 30, 60 and 90 numbers " +
      "are scored against exactly these, and a re-test re-asks the archived run's own prompts.",
  });
}

export interface PhotographResult {
  ok: true;
  reportId: string;
  label: SuppliedLabel;
  questions: number;
  downgradeReason: string | null;
}

/**
 * Take the Day 0 measurement (or a re-test), from the tracked set.
 *
 * The step is NOT ticked here and the wall is NOT stamped here. finishReport hands the finished run
 * to onSuppliedRunDone, which writes the keyword answers and ticks the step through setDeliveryStep,
 * so the tick still goes past its verifier and the stamp still rides on the tick. Writing either
 * from this function would open the wall while the step sat pending, and day-zero.ts's whole design
 * is that those two cannot drift.
 */
export async function runPhotograph(
  clientId: string,
  requested: SuppliedLabel = "photograph_2"
): Promise<PhotographResult | { ok: false; error: string }> {
  const set = await trackedSetFor(clientId);
  if ("error" in set) return { ok: false, error: set.error };

  const resolved = resolveRunLabel(requested);

  // Frozen BEFORE the questions go out, so what is archived is what was asked.
  const customQuestions = set.prompts.slice(set.universal).map((p) => p.prompt);
  await freezeCustomV1(clientId, customQuestions, set.vertical);

  const run = await runSuppliedAudit({
    clientId,
    prompts: set.prompts,
    runLabel: requested,
  });

  if (!run.ok) return { ok: false, error: run.error };

  return {
    ok: true,
    reportId: run.reportId,
    label: run.label,
    questions: run.questions,
    downgradeReason: resolved.reason,
  };
}

/**
 * Re-ask an archived run's own prompts, verbatim.
 *
 * ‼️ THE PROMPTS COME OFF THE ARCHIVED ROW, NEVER FROM trackedSetFor(). Re-composing the set at day
 * 30 would quietly re-measure whatever the tracked set has become since, and the comparison would
 * be between two different question sets presented as one trend. This is the same rule findings.ts
 * states about audit_reports.prompts being regenerated by every classified run.
 */
export async function runRetest(
  clientId: string,
  day: 30 | 60 | 90
): Promise<PhotographResult | { ok: false; error: string }> {
  const photograph = await day0PhotographFor(clientId);
  if (!photograph) {
    return {
      ok: false,
      error:
        "there is no archived Day 0 photograph for this client, so there is nothing to re-test " +
        "against. A re-test measured against a set that was never archived is not a comparison.",
    };
  }

  const label = `retest_${day}` as SuppliedLabel;

  const { data: already } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("client_id", clientId)
    .eq("run_label", label)
    .limit(1)
    .maybeSingle();

  if (already) return { ok: false, error: `the ${label} has already been run for this client` };

  const run = await runSuppliedAudit({
    clientId,
    prompts: photograph.prompts,
    runLabel: label,
  });

  if (!run.ok) return { ok: false, error: run.error };
  return {
    ok: true,
    reportId: run.reportId,
    label: run.label,
    questions: run.questions,
    downgradeReason: null,
  };
}

export interface Day0Photograph {
  id: string;
  questions: number;
  answered: number;
  prompts: SuppliedPrompt[];
  takenAt: string;
}

/**
 * This client's archived Day 0 photograph, or null.
 *
 * ‼️ `photograph_2` ONLY, NEVER A `measurement`. The downgraded one-engine run asks the same
 * questions and is a perfectly good measurement, but A2 D-P16 says it is not a photograph, so it
 * cannot open the Day 0 wall and it cannot be the thing a re-test is compared against. Reading
 * this correctly is what keeps that distinction real rather than a comment.
 */
export async function day0PhotographFor(clientId: string): Promise<Day0Photograph | null> {
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id, prompts, created_at")
    .eq("client_id", clientId)
    .eq("run_label", "photograph_2")
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const stored = Array.isArray(data.prompts) ? (data.prompts as Array<Record<string, unknown>>) : [];
  const prompts: SuppliedPrompt[] = stored
    .map((p) => ({
      prompt: String(p.prompt ?? "").trim(),
      ...(typeof p.keyword_id === "string" ? { keywordId: p.keyword_id } : {}),
    }))
    .filter((p) => p.prompt.length > 0);

  const { count } = await supabaseAdmin
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", data.id as string)
    .eq("status", "ok");

  return {
    id: data.id as string,
    questions: prompts.length,
    answered: count ?? 0,
    prompts,
    takenAt: data.created_at as string,
  };
}

/** The lines the Day 0 card carries about measuring. Kept here so the cost is stated once. */
export async function photographCardLines(clientId: string): Promise<string[]> {
  const taken = await day0PhotographFor(clientId);
  if (taken) {
    return [
      `:camera: *Photograph II is archived*: ${taken.questions} questions, ${taken.answered} answered, ` +
        `taken ${taken.takenAt.slice(0, 10)}.`,
      "The day 30, 60 and 90 re-tests re-ask exactly those questions.",
    ];
  }

  const set = await trackedSetFor(clientId);
  if ("error" in set) {
    return [`:camera: *Photograph II cannot run yet*: ${set.error}`];
  }

  const resolved = resolveRunLabel("photograph_2");
  const lines = [
    `:camera: *Reply \`photograph\` to measure the tracked set*: ${set.prompts.length} questions ` +
      `(${set.universal} universal, ${set.custom} custom), about ${costOf(set.prompts.length)} at ` +
      `$${COST_PER_QUESTION.toFixed(2)} a question.`,
  ];

  if (set.keywordsApproved > 0) {
    lines.push(
      `  ${set.keywordsTracked} of your ${set.keywordsApproved} approved keywords are in it, and the ` +
        `answers are written back onto those rows.`
    );
  }

  if (resolved.downgraded) {
    lines.push(
      `  :warning: This will be filed as a *${resolved.label}*, not a photograph. ${resolved.reason}`
    );
  } else {
    lines.push(
      `  ${KEYED_ENGINES.length} engines are keyed, so this earns the \`photograph_2\` stamp ` +
        `(A2 D-P16 needs ${PHOTOGRAPH_MIN_ENGINES}).`
    );
  }

  return lines;
}

/** `photograph` in the Day 0 step's thread. Exact and anchored: this thread also takes dictation. */
export async function handlePhotographThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (input.stepKey !== "day_zero_archive") return null;
  const text = input.text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  if (!/^photograph$/i.test(text)) return null;

  const taken = await day0PhotographFor(input.clientId);
  if (taken) {
    return {
      message:
        `:camera: Photograph II is already archived for this client (${taken.questions} questions, ` +
        `${taken.takenAt.slice(0, 10)}). It is never taken twice: the day 30, 60 and 90 re-tests ` +
        `re-ask exactly those questions.`,
    };
  }

  const set = await trackedSetFor(input.clientId);
  if ("error" in set) return { message: `:warning: Nothing was run: ${set.error}` };

  const resolved = resolveRunLabel("photograph_2");

  return {
    message: [
      `Measuring the tracked set: *${set.prompts.length} questions*, one call each, roughly ` +
        `*${costOf(set.prompts.length)}*. The answers post here when they are back.`,
      resolved.downgraded ? `:warning: Filed as a *${resolved.label}*. ${resolved.reason}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    after: async () => {
      const result = await runPhotograph(input.clientId, "photograph_2");
      if (!result.ok) {
        const { notifyStep } = await import("./step-board");
        await notifyStep(input.clientId, "day_zero_archive", `:x: It did not start: ${result.error}`).catch(() => {});
      }
    },
  };
}
