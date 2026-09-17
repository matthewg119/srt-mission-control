// The raw idea of a page, decided before anybody writes a headline for it.
//
// Matthew, 2026-09-17, looking at step 21's card: "those are not the options for the headlines of the
// pillars are they? because those headlines are not good at all if anything we can get options for the
// raw Idea of the whole page itself and based on the idea we can generate headlines and lead magnets
// for that page."
//
// ‼️ HE IS DESCRIBING A MISSING LAYER, NOT A BAD PROMPT. Step 21 asks for a KEYWORD (`pillar: 7`, a
// client_keywords.rank) and then generates headlines from that keyword plus an awareness stage.
// Nothing in between ever decided what the page ARGUES. So the headline generator was asked to write
// a line about a phrase, and thirty-three candidates came back reading as thirty-three ways of saying
// the phrase out loud. A better prompt cannot fix that; there was nothing for it to be about.
//
// An angle is: what this page argues, the story it runs on, the belief it has to install, and the two
// awareness stages it moves the reader between. Three per planned page, one picked, and the headline
// AND the lead magnets are generated from the pick.
//
// ‼️ GENERATED FROM THE ANCHORED LADDER RUNG, NOT FROM NOTHING. offer-ladder.ts already writes a
// claim, a risk reversal, the reader's state and the beliefs for each stage of awareness, and step 21
// already makes somebody pick the rung the build is anchored at. An angle is that rung applied to one
// keyword. Generating angles independently would produce seven pages arguing seven unrelated things
// under one offer, which is the incoherence the ladder was built to stop.
//
// ‼️ NOTHING ON AN ANGLE MAY BE INVENTED, same rules the ladder already enforces:
//   - a number has to appear in what the model was given;
//   - a guarantee is only ever the client's own words, and with none on file a promise is refused;
//   - no em dash, anywhere;
//   - the three options must be DIFFERENT IDEAS, not three rewordings. That check is the whole point
//     of offering three, and its absence is what made the headline list feel useless.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";
import { isAwarenessStage, type AwarenessStage } from "@/lib/audit-engine/awareness";
import type { LadderRung } from "./offer-ladder";

const MODEL = "claude-sonnet-4-6" as const;

export const IDEA_MAX = 240;
export const PROMISE_MAX = 160;
export const NARRATIVE_MAX = 400;
export const BELIEF_MAX = 200;
/** Three is a choice. Two is a coin toss and five is a survey. */
export const ANGLES_PER_PAGE = 3;

export interface DraftedAngle {
  idea: string;
  promise: string;
  narrative: string;
  indoctrination: string;
  awarenessEntry: AwarenessStage;
  awarenessTarget: AwarenessStage;
  proofNeeded: string[];
  rationale: string | null;
}

export interface AngleInputs {
  clientName: string;
  /** The page this is for: its keyword, what it is, and where it sits under the pillar. */
  keyword: string;
  workingTitle: string;
  role: "pillar" | "support";
  keywordCategory: string | null;
  /** The rung the whole build is anchored at. The angle is this rung applied to one keyword. */
  rung: LadderRung | null;
  anchorStage: AwarenessStage | null;
  treatment: string;
  terms: string[];
  outcome: string | null;
  guarantee: string | null;
  buyer: string | null;
  beliefs: string[];
  objections: string[];
  /** Ideas already taken by this client's other planned pages, so seven pages are seven ideas. */
  taken: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure. Everything below is exercised by _probe-page-angles.ts without a model call.
// ─────────────────────────────────────────────────────────────────────────────

const GUARANTEE_WORDS =
  /\b(guarantee[ds]?|money[- ]back|refund|risk[- ]free|or you don'?t pay|you don'?t pay|free until|no results?,? no)\b/i;

function orphanNumbers(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/** Content words, for telling a different idea from the same idea reworded. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at", "by", "with", "from",
  "that", "this", "these", "those", "is", "are", "was", "were", "be", "been", "it", "its", "as",
  "you", "your", "they", "their", "we", "our", "how", "what", "why", "when", "who", "which",
]);

export function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/**
 * How much two ideas overlap, 0 to 1 (Jaccard over content words).
 *
 * ‼️ THIS IS THE CHECK THAT MAKES THREE OPTIONS WORTH OFFERING. Without it a model happily returns
 * one idea written three ways, which is what "the headlines are not good at all" actually describes:
 * not that any single line was bad, but that picking between them decided nothing.
 */
export function overlap(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

export const MAX_OVERLAP = 0.6;

/** Every reason a drafted set is not usable, in words a re-ask can act on. */
export function angleFaults(raw: unknown, inputs: AngleInputs): string[] {
  const faults: string[] = [];
  const v = raw as { angles?: unknown } | null;
  const list = Array.isArray(v?.angles) ? (v!.angles as Array<Record<string, unknown>>) : [];

  if (list.length !== ANGLES_PER_PAGE) {
    faults.push(`there must be exactly ${ANGLES_PER_PAGE} angles; got ${list.length}.`);
  }

  const haystack = JSON.stringify(inputs).replace(/[,$]/g, "");
  const ideas: string[] = [];

  list.forEach((a, i) => {
    const n = `angle ${i + 1}`;
    const idea = typeof a.idea === "string" ? a.idea.trim() : "";
    const promise = typeof a.promise === "string" ? a.promise.trim() : "";
    const narrative = typeof a.narrative === "string" ? a.narrative.trim() : "";
    const belief = typeof a.indoctrination === "string" ? a.indoctrination.trim() : "";

    if (!idea) faults.push(`${n}: idea is required.`);
    else if (idea.length > IDEA_MAX) faults.push(`${n}: idea is over ${IDEA_MAX} characters.`);
    if (!promise) faults.push(`${n}: promise is required.`);
    else if (promise.length > PROMISE_MAX) faults.push(`${n}: promise is over ${PROMISE_MAX} characters.`);
    if (!narrative) faults.push(`${n}: narrative is required.`);
    else if (narrative.length > NARRATIVE_MAX) faults.push(`${n}: narrative is over ${NARRATIVE_MAX} characters.`);
    if (!belief) faults.push(`${n}: indoctrination is required, it is what moves the reader a stage.`);
    else if (belief.length > BELIEF_MAX) faults.push(`${n}: indoctrination is over ${BELIEF_MAX} characters.`);

    const entry = Number(a.awareness_entry);
    const target = Number(a.awareness_target);
    if (!isAwarenessStage(entry)) faults.push(`${n}: awareness_entry must be 1 to 5.`);
    if (!isAwarenessStage(target)) faults.push(`${n}: awareness_target must be 1 to 5.`);
    // 5 is unaware and 1 is most aware, so a page moves a reader DOWN the numbers. A target above
    // the entry is a page that makes somebody less aware than it found them.
    if (isAwarenessStage(entry) && isAwarenessStage(target) && target > entry) {
      faults.push(`${n}: awareness_target (${target}) is further from the sale than awareness_entry (${entry}).`);
    }

    const all = [idea, promise, narrative, belief].join(" ");
    if (hasBannedDash(all)) faults.push(`${n}: carries an em dash.`);

    const orphans = orphanNumbers(all, haystack);
    if (orphans.length) faults.push(`${n}: ${orphans.join(", ")} appears nowhere in what you were given.`);

    if (!inputs.guarantee && GUARANTEE_WORDS.test(all)) {
      faults.push(`${n}: promises a guarantee, and this client has none on file. Say nothing about risk.`);
    }

    if (idea) ideas.push(idea);
  });

  // The three have to be three ideas.
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      const o = overlap(ideas[i], ideas[j]);
      if (o > MAX_OVERLAP) {
        faults.push(
          `angles ${i + 1} and ${j + 1} are the same idea reworded (${Math.round(o * 100)}% overlap). ` +
            "Three options only help if they are three different arguments."
        );
      }
    }
  }

  // And none of them may repeat a page this client already has planned.
  for (const [i, idea] of ideas.entries()) {
    const clash = inputs.taken.find((t) => overlap(idea, t) > MAX_OVERLAP);
    if (clash) faults.push(`angle ${i + 1} repeats a page already planned: "${clash.slice(0, 80)}".`);
  }

  return faults;
}

export function toAngles(raw: unknown): DraftedAngle[] {
  const v = raw as { angles: Array<Record<string, unknown>> };
  return v.angles.map((a) => ({
    idea: String(a.idea).trim(),
    promise: String(a.promise).trim(),
    narrative: String(a.narrative).trim(),
    indoctrination: String(a.indoctrination).trim(),
    awarenessEntry: Number(a.awareness_entry) as AwarenessStage,
    awarenessTarget: Number(a.awareness_target) as AwarenessStage,
    proofNeeded: Array.isArray(a.proof_needed) ? a.proof_needed.map(String).filter(Boolean) : [],
    rationale: typeof a.rationale === "string" ? a.rationale.trim() || null : null,
  }));
}

const SCHEMA_HINT = `{
  "angles": [
    {
      "idea": "what this page argues, one or two sentences, in her words",
      "promise": "what the reader can do or decide after reading it",
      "narrative": "the story spine the page runs on",
      "indoctrination": "the one belief this page has to install to move her a stage",
      "awareness_entry": 4,
      "awareness_target": 3,
      "proof_needed": ["what this angle obliges us to prove"],
      "rationale": "why this angle rather than the other two"
    }
  ]
}`;

const SYSTEM = [
  "You write the IDEA of one web page, before anybody writes a headline for it.",
  "",
  "You are given one keyword this page is aimed at, the offer it sells, and the rung of the awareness",
  "ladder the whole build is anchored at. Your job is to apply that rung to that keyword: what should",
  "this ONE page argue, what story does it run on, and what does the reader have to come to believe.",
  "",
  "An idea is not a headline. Do not write a title, do not write a hook, and do not try to be clever.",
  "Write what the page argues, the way you would explain it to the person who has to write it.",
  "",
  "RULES, and each one is checked:",
  "1. Return exactly three angles, and they must be three DIFFERENT ARGUMENTS. Three ways of saying",
  "   the same thing is a failure, not three options.",
  "2. Every number you use must appear in what you were given. Invent none.",
  "3. Say nothing about guarantees, refunds or risk unless the client's own guarantee is given to you.",
  "4. Never use an em dash.",
  "5. awareness_entry is where the reader starts and awareness_target is where this page leaves her.",
  "   5 is problem unaware and 1 is most aware, so the target is the same as or lower than the entry.",
  "6. The indoctrination is ONE belief, stated as a sentence she would have to accept. It is the thing",
  "   that moves her between those two stages, and it is the reason the page exists.",
].join("\n");

function userBlock(inputs: AngleInputs): string {
  return [
    `BUSINESS: ${inputs.clientName}`,
    `SELLS: ${inputs.treatment}`,
    inputs.terms.length ? `ITS CUSTOMERS CALL IT: ${inputs.terms.join(", ")}` : "",
    inputs.outcome ? `THE OUTCOME PROMISED: ${inputs.outcome}` : "",
    inputs.guarantee ? `ITS GUARANTEE, IN ITS OWN WORDS: ${inputs.guarantee}` : "NO GUARANTEE ON FILE. Say nothing about risk.",
    inputs.buyer ? `THE BUYER: ${inputs.buyer}` : "",
    "",
    `THIS PAGE IS A ${inputs.role.toUpperCase()}.`,
    `ITS KEYWORD: ${inputs.keyword}`,
    inputs.keywordCategory ? `WHAT THAT KEYWORD IS ABOUT: ${inputs.keywordCategory}` : "",
    `ITS WORKING TITLE: ${inputs.workingTitle}`,
    "",
    inputs.rung
      ? [
          `THE RUNG THIS BUILD IS ANCHORED AT (stage ${inputs.rung.stage}):`,
          `  the reader believes: ${inputs.rung.readerState}`,
          `  the angle that reaches her: ${inputs.rung.angle}`,
          `  the claim: ${inputs.rung.claim}`,
          inputs.rung.riskReversal ? `  the risk reversal: ${inputs.rung.riskReversal}` : "",
          inputs.rung.beliefs.length ? `  what she must believe: ${inputs.rung.beliefs.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "NO LADDER RUNG IS ANCHORED YET. Work from the offer alone and stay close to it.",
    "",
    inputs.beliefs.length ? `BELIEFS ON FILE:\n${inputs.beliefs.map((b) => `  - ${b}`).join("\n")}` : "",
    inputs.objections.length ? `OBJECTIONS HEARD:\n${inputs.objections.map((o) => `  - ${o}`).join("\n")}` : "",
    inputs.taken.length
      ? `IDEAS ALREADY TAKEN BY THIS CLIENT'S OTHER PAGES, do not repeat any of them:\n${inputs.taken.map((t) => `  - ${t}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Draft three angles for one planned page. Pure IO around the validators above. */
export async function draftAngles(
  inputs: AngleInputs
): Promise<{ ok: true; angles: DraftedAngle[] } | { ok: false; error: string }> {
  try {
    const res = await callClaudeJSON<{ angles: Array<Record<string, unknown>> }>({
      model: MODEL,
      system: SYSTEM,
      user: userBlock(inputs),
      maxTokens: 2500,
      temperature: 0.7, // Higher than the ladder's 0.4: three DIFFERENT ideas is the whole ask.
      schemaHint: SCHEMA_HINT,
      validate: (v): v is { angles: Array<Record<string, unknown>> } => angleFaults(v, inputs).length === 0,
      describeInvalid: (v) => angleFaults(v, inputs).join(" "),
    });
    return { ok: true, angles: toAngles(res.data) };
  } catch (e) {
    return { ok: false, error: `the angles were not drafted: ${(e as Error).message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

/** `what` says whether the command is about the idea or about the offer that rides on it. */
export type AngleCommand =
  | { kind: "list"; what: "angle" | "magnet" }
  | { kind: "auto"; what: "angle" | "magnet" }
  | { kind: "pick"; what: "angle" | "magnet"; page: number; option: number }
  | { kind: "more"; what: "angle" | "magnet"; page: number };

const LIST = /^\s*[`*_]*(angles?|magnets?|offers?)[`*_]*\s*$/i;
const AUTO = /^\s*[`*_]*(angles?|magnets?|offers?)\s+auto[`*_]*\s*$/i;
const PICK = /^\s*[`*_]*(angle|magnet|offer)\s+(\d+)\s+pick\s+(\d+)[`*_]*\s*$/i;
const MORE = /^\s*[`*_]*(angle|magnet|offer)\s+(\d+)\s+more[`*_]*\s*$/i;

function whatOf(word: string): "angle" | "magnet" {
  return /^angle/i.test(word) ? "angle" : "magnet";
}

/**
 * ‼️ AUTO IS TESTED BEFORE LIST, because the two regexes are close enough that reordering them
 * later would silently turn every auto into a list.
 *
 * `offer` is accepted as a synonym for `magnet` because that is what the thing IS in front of a
 * client, and somebody reading the card will type the word the card used. It does NOT collide with
 * `offer:` at step 10: that one ends in a colon and is matched by a different handler entirely.
 */
export function parseAngleCommand(text: string): AngleCommand | null {
  const a = AUTO.exec(text);
  if (a) return { kind: "auto", what: whatOf(a[1]) };
  const l = LIST.exec(text);
  if (l) return { kind: "list", what: whatOf(l[1]) };
  const p = PICK.exec(text);
  if (p) return { kind: "pick", what: whatOf(p[1]), page: Number(p[2]), option: Number(p[3]) };
  const m = MORE.exec(text);
  if (m) return { kind: "more", what: whatOf(m[1]), page: Number(m[2]) };
  return null;
}

export function isAngleCommand(text: string): boolean {
  return parseAngleCommand(text) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredAngle {
  id: string;
  planId: string;
  idea: string;
  promise: string | null;
  narrative: string | null;
  indoctrination: string | null;
  awarenessEntry: number | null;
  awarenessTarget: number | null;
  proofNeeded: string[];
  rationale: string | null;
  status: "draft" | "approved" | "rejected";
}

const ANGLE_COLUMNS =
  "id, plan_id, idea, promise, narrative, indoctrination, awareness_entry, awareness_target, proof_needed, rationale, status";

function toStored(r: Record<string, unknown>): StoredAngle {
  return {
    id: String(r.id),
    planId: String(r.plan_id),
    idea: String(r.idea),
    promise: (r.promise as string | null) ?? null,
    narrative: (r.narrative as string | null) ?? null,
    indoctrination: (r.indoctrination as string | null) ?? null,
    awarenessEntry: (r.awareness_entry as number | null) ?? null,
    awarenessTarget: (r.awareness_target as number | null) ?? null,
    proofNeeded: Array.isArray(r.proof_needed) ? (r.proof_needed as string[]) : [],
    rationale: (r.rationale as string | null) ?? null,
    status: r.status as StoredAngle["status"],
  };
}

/** Every angle for this client, oldest first, so the number beside one on the card is stable. */
export async function anglesFor(clientId: string): Promise<StoredAngle[]> {
  const { data, error } = await supabaseAdmin
    .from("page_angles")
    .select(ANGLE_COLUMNS)
    .eq("client_id", clientId)
    .neq("status", "rejected")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`[page-angles] read failed: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => toStored(r as Record<string, unknown>));
}

/**
 * Store three drafts for one planned page, replacing any undecided ones.
 *
 * ‼️ ONLY `draft` ROWS ARE CLEARED. An approved angle is a decision somebody made and `angle 3 more`
 * must not quietly delete it; the pick is what supersedes it, and rejected rows stay because they
 * are what teaches a preference.
 */
export async function storeAngles(args: {
  clientId: string;
  planId: string;
  audienceId: string | null;
  offerId: string | null;
  angles: DraftedAngle[];
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await supabaseAdmin
    .from("page_angles")
    .delete()
    .eq("client_id", args.clientId)
    .eq("plan_id", args.planId)
    .eq("status", "draft");

  const rows = args.angles.map((a) => ({
    client_id: args.clientId,
    plan_id: args.planId,
    audience_id: args.audienceId,
    offer_id: args.offerId,
    idea: a.idea,
    promise: a.promise,
    narrative: a.narrative,
    indoctrination: a.indoctrination,
    awareness_entry: a.awarenessEntry,
    awareness_target: a.awarenessTarget,
    proof_needed: a.proofNeeded,
    rationale: a.rationale,
    status: "draft",
    model: MODEL,
  }));

  const { error } = await supabaseAdmin.from("page_angles").insert(rows);
  if (error) {
    return {
      ok: false,
      error:
        `the angles could not be stored: ${error.message}. If that names page_angles, ` +
        "docs/2026-09-17-page-datasets-and-angles.sql has not been run on this database.",
    };
  }
  return { ok: true, count: rows.length };
}

/**
 * Approve one angle for a page and write the decision back onto the plan row.
 *
 * ‼️ THE PICK IS COPIED ONTO page_plan RATHER THAN LEFT TO A JOIN. page_plan.angle is read by the
 * drafter, the card, page-dataset and plan-links already; making all of them learn a new table to
 * find out what the page is about would be four places to forget. angle_id is the pointer back to
 * the row the other two options still live in.
 */
export async function pickAngle(args: {
  clientId: string;
  angleId: string;
  by: string;
}): Promise<{ ok: true; angle: StoredAngle } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("page_angles")
    .select(ANGLE_COLUMNS)
    .eq("id", args.angleId)
    .eq("client_id", args.clientId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: `that angle is not on file (${error?.message ?? "no row"}).` };
  const angle = toStored(data as Record<string, unknown>);

  // ‼️ THE SIBLINGS GO TO `rejected`, NOT DELETED. page_angles_one_approved is a partial unique
  // index on plan_id, so a second approve would be refused at the database rather than silently
  // leaving two. Rejecting first is what makes changing your mind work.
  const { error: sibErr } = await supabaseAdmin
    .from("page_angles")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: args.by })
    .eq("client_id", args.clientId)
    .eq("plan_id", angle.planId)
    .neq("id", args.angleId);
  if (sibErr) return { ok: false, error: sibErr.message };

  const { error: upErr } = await supabaseAdmin
    .from("page_angles")
    .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: args.by })
    .eq("id", args.angleId);
  if (upErr) return { ok: false, error: upErr.message };

  const { error: planErr } = await supabaseAdmin
    .from("page_plan")
    .update({
      angle: angle.idea,
      angle_id: angle.id,
      awareness_entry: angle.awarenessEntry,
      awareness_target: angle.awarenessTarget,
      updated_at: new Date().toISOString(),
    })
    .eq("id", angle.planId)
    .eq("client_id", args.clientId);
  if (planErr) return { ok: false, error: `the angle was approved but the plan row was not updated: ${planErr.message}` };

  return { ok: true, angle };
}

// ─────────────────────────────────────────────────────────────────────────────
// The step 21 half: build the inputs, draft for each planned page, render the card
// ─────────────────────────────────────────────────────────────────────────────

/** Three at a time, the same wave size the drafter uses. Seven sequential calls overrun the step. */
const CONCURRENCY = 3;

async function inWaves<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return out;
}

export interface AngleRunResult {
  ok: boolean;
  lines: string[];
  drafted: number;
  failed: number;
}

/**
 * Draft three angles for every planned page that has none, or for one page when `only` is given.
 *
 * ‼️ A PAGE WITH AN APPROVED ANGLE IS SKIPPED UNLESS IT IS NAMED. `angles auto` after a pick must
 * not silently rewrite a decision somebody already made; `angle 3 more` is how you change one on
 * purpose. Same rule the plan itself follows: a rerun tops up proposals and leaves decisions alone.
 */
export async function generateAnglesForPlan(args: {
  clientId: string;
  by: string;
  /** 1-based position on the card, as a person types it. */
  only?: number;
}): Promise<AngleRunResult> {
  const [{ ladderState }, { loadPlan }] = await Promise.all([
    import("./anchor-ladder"),
    import("./page-plan"),
  ]);

  const st = await ladderState(args.clientId);
  if (!st.inputs) {
    return {
      ok: false,
      drafted: 0,
      failed: 0,
      lines: [
        ":warning: The angles need what the ladder needs, and it is not all here yet:",
        ...st.missing.map((m) => `  • ${m}`),
      ],
    };
  }

  const plan = await loadPlan(args.clientId);
  if ("error" in plan) return { ok: false, drafted: 0, failed: 0, lines: [`:warning: ${plan.error}`] };

  const pages = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
  if (!pages.length) {
    return {
      ok: false,
      drafted: 0,
      failed: 0,
      lines: [":warning: No pages are planned yet. Pick the pillar and the supports first, then `angles`."],
    };
  }

  const existing = await anglesFor(args.clientId);
  const approvedBy = new Map(existing.filter((a) => a.status === "approved").map((a) => [a.planId, a]));
  const draftedBy = new Set(existing.filter((a) => a.status === "draft").map((a) => a.planId));

  let targets = pages;
  if (args.only !== undefined) {
    const one = pages[args.only - 1];
    if (!one) {
      return { ok: false, drafted: 0, failed: 0, lines: [`:warning: There is no page ${args.only}. \`angles\` lists them.`] };
    }
    targets = [one];
  } else {
    targets = pages.filter((p) => !approvedBy.has(p.id) && !draftedBy.has(p.id));
  }

  if (!targets.length) {
    return {
      ok: true,
      drafted: 0,
      failed: 0,
      lines: [":information_source: Every planned page already has angles. `angles` lists them, `angle 3 more` rewrites one."],
    };
  }

  const rung = st.ladder?.rungs.find((r) => r.stage === st.anchorStage) ?? null;
  // Ideas already spoken for, so seven pages argue seven things. A page being redrafted is kept out
  // of its own taken list below, or it would be refused for repeating itself.
  const takenAll = pages
    .map((p) => (approvedBy.get(p.id)?.idea ?? (p.angle || "")).trim())
    .filter(Boolean);

  const results = await inWaves(targets, async (row) => {
    const own = (approvedBy.get(row.id)?.idea ?? row.angle ?? "").trim();
    const taken = takenAll.filter((t) => t !== own);
    const res = await draftAngles({
      clientName: st.inputs!.clientName,
      keyword: row.targetKeyword,
      workingTitle: row.workingTitle,
      role: (row.role ?? "support") as "pillar" | "support",
      keywordCategory: row.keywordCategory,
      rung,
      anchorStage: st.anchorStage,
      treatment: st.inputs!.treatment,
      terms: st.inputs!.terms,
      outcome: st.inputs!.outcome,
      guarantee: st.inputs!.guarantee,
      buyer: st.inputs!.buyer,
      beliefs: st.inputs!.beliefs.map((b) => b.text),
      objections: st.inputs!.objections.map((o) => o.text),
      taken,
    });
    if (!res.ok) return { row, error: res.error };
    const stored = await storeAngles({
      clientId: args.clientId,
      planId: row.id,
      audienceId: st.audienceId,
      offerId: st.offerId,
      angles: res.angles,
    });
    return stored.ok ? { row, error: null as string | null } : { row, error: stored.error };
  });

  const failures = results.filter((r) => r.error);
  const drafted = results.length - failures.length;

  return {
    ok: drafted > 0,
    drafted,
    failed: failures.length,
    lines: [
      drafted
        ? `:bulb: *${drafted} page${drafted === 1 ? "" : "s"} now carry three ideas each.* \`angles\` lists them.`
        : ":warning: No angles were drafted.",
      ...failures.map((f) => `  • ${f.row.workingTitle}: ${f.error}`),
    ],
  };
}

/**
 * The card block: every planned page, its three ideas, and which one is picked.
 *
 * The number beside a page is its position in the plan and the number beside an idea is its position
 * under that page, which is what `angle 3 pick 2` means. Both orders are stable (rank, then
 * created_at then id) for the reason the headline shortlist already documents: a number that moves
 * between renders is a number somebody types wrong.
 */
export async function angleLines(clientId: string): Promise<string[]> {
  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(clientId);
  if ("error" in plan) return [];

  const pages = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
  if (!pages.length) return [];

  const angles = await anglesFor(clientId);
  const byPlan = new Map<string, StoredAngle[]>();
  for (const a of angles) {
    const list = byPlan.get(a.planId) ?? [];
    list.push(a);
    byPlan.set(a.planId, list);
  }

  const lines = ["*The idea each page argues*"];
  let anyMissing = false;

  pages.forEach((p, i) => {
    const n = i + 1;
    const mine = byPlan.get(p.id) ?? [];
    const picked = mine.find((a) => a.status === "approved");
    const label = `${n}. ${p.role === "pillar" ? "Pillar" : "Support"}: ${p.targetKeyword}`;

    if (picked) {
      lines.push(`${label}  :white_check_mark:`);
      lines.push(`     ${picked.idea}`);
      if (picked.awarenessEntry && picked.awarenessTarget) {
        lines.push(`     _moves her from stage ${picked.awarenessEntry} to ${picked.awarenessTarget}_`);
      }
      return;
    }

    if (!mine.length) {
      anyMissing = true;
      lines.push(`${label}  _no ideas yet_`);
      return;
    }

    lines.push(label);
    mine.forEach((a, j) => {
      lines.push(`     ${j + 1}. ${a.idea}`);
    });
  });

  lines.push("");
  lines.push(
    anyMissing
      ? "`angles auto` drafts three for every page that has none. `angle 3 pick 2` keeps one."
      : "`angle 3 pick 2` keeps one. `angle 3 more` rewrites the three under one page."
  );
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// The offer that rides on the idea
// ─────────────────────────────────────────────────────────────────────────────

interface PlanMagnet {
  id: string;
  planId: string;
  title: string;
  promise: string;
  ctaLabel: string;
  conciergeEntry: string;
  status: string;
}

async function magnetsByPlan(clientId: string): Promise<Map<string, PlanMagnet[]>> {
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("id, plan_id, title, promise, cta_label, concierge_entry, status")
    .eq("client_id", clientId)
    .not("plan_id", "is", null)
    .neq("status", "rejected")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  const out = new Map<string, PlanMagnet[]>();
  if (error || !data) {
    if (error) console.error(`[page-angles] magnet read failed: ${error.message}`);
    return out;
  }
  for (const r of data) {
    const m: PlanMagnet = {
      id: String(r.id),
      planId: String(r.plan_id),
      title: String(r.title),
      promise: String(r.promise),
      ctaLabel: String(r.cta_label),
      conciergeEntry: String(r.concierge_entry),
      status: String(r.status),
    };
    const list = out.get(m.planId) ?? [];
    list.push(m);
    out.set(m.planId, list);
  }
  return out;
}

/** Draft the offers for one planned page. Wrapped so a failure never costs the angle pick. */
async function draftMagnetsFor(clientId: string, planId: string): Promise<string> {
  try {
    const { draftMagnetsForPlan } = await import("@/lib/concierge/magnet-drafts");
    const res = await draftMagnetsForPlan(clientId, planId, { replace: true });
    return res.ok
      ? `:gift: ${res.candidates.length} offers drafted for it. \`magnets\` lists them.`
      : `:warning: No offers drafted: ${res.error ?? "unknown"}`;
  } catch (e) {
    return `:warning: No offers drafted: ${(e as Error).message}`;
  }
}

/** The card block for the offers, page by page, mirroring angleLines. */
export async function magnetLines(clientId: string): Promise<string[]> {
  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(clientId);
  if ("error" in plan) return [];

  const pages = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
  if (!pages.length) return [];

  const byPlan = await magnetsByPlan(clientId);
  const lines = ["*The offer the assistant hands over on each page*"];
  let anyMissing = false;

  pages.forEach((p, i) => {
    const mine = byPlan.get(p.id) ?? [];
    const label = `${i + 1}. ${p.role === "pillar" ? "Pillar" : "Support"}: ${p.targetKeyword}`;
    const chosen = p.frame?.title ? String(p.frame.title) : null;

    if (chosen) {
      lines.push(`${label}  :white_check_mark:`);
      lines.push(`     ${chosen}`);
      return;
    }
    if (!mine.length) {
      anyMissing = true;
      lines.push(`${label}  _no offers yet_`);
      return;
    }
    lines.push(label);
    mine.forEach((m, j) => lines.push(`     ${j + 1}. ${m.title}  _${m.ctaLabel}_`));
  });

  lines.push("");
  lines.push(
    anyMissing
      ? "`magnets auto` drafts offers for every page that has none. `magnet 3 pick 2` keeps one."
      : "`magnet 3 pick 2` keeps one. `magnet 3 more` rewrites the offers under one page."
  );
  return lines;
}

/** `angles`, `angles auto`, `angle 3 pick 2`, `angle 3 more`, and the same four for `magnet`. */
export async function handlePageAngleThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (args.stepKey !== "pre_call_pages") return null;
  const cmd = parseAngleCommand(args.text);
  if (!cmd) return null;

  const refresh = async () => {
    const { postStep } = await import("./step-engine");
    await postStep(args.clientId, "pre_call_pages").catch(() => {});
  };
  const say = async (text: string) => {
    const { notifyStep } = await import("./step-board");
    await notifyStep(args.clientId, "pre_call_pages", text).catch(() => {});
  };

  if (cmd.kind === "list") {
    const lines = cmd.what === "angle" ? await angleLines(args.clientId) : await magnetLines(args.clientId);
    return {
      message: lines.length
        ? lines.join("\n")
        : ":information_source: No pages are planned yet. Pick the pillar and the supports first.",
    };
  }

  // ── The offers ────────────────────────────────────────────────────────────
  if (cmd.what === "magnet") {
    const { loadPlan } = await import("./page-plan");
    const plan = await loadPlan(args.clientId);
    if ("error" in plan) return { message: `:warning: ${plan.error}` };
    const pages = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);

    if (cmd.kind === "auto" || cmd.kind === "more") {
      const targets =
        cmd.kind === "more"
          ? pages.slice(cmd.page - 1, cmd.page)
          : pages.filter((p) => !p.frame?.title);
      if (!targets.length) {
        return {
          message:
            cmd.kind === "more"
              ? `:warning: There is no page ${cmd.page}. \`magnets\` lists them.`
              : ":information_source: Every planned page already has an offer picked. `magnet 3 more` rewrites one.",
        };
      }
      return {
        message: `:hourglass_flowing_sand: Writing offers for ${targets.length} page${targets.length === 1 ? "" : "s"}, from the idea each one argues. About a minute.`,
        after: async () => {
          const notes: string[] = [];
          for (const t of targets) notes.push(`${t.targetKeyword}: ${await draftMagnetsFor(args.clientId, t.id)}`);
          const listed = await magnetLines(args.clientId);
          await say([...notes, ...(listed.length ? ["", ...listed] : [])].join("\n"));
          await refresh();
        },
      };
    }

    // magnet N pick K: the chosen framing becomes page_plan.magnet_frame, which is what the drafter
    // already mints from after the body. Nothing new mints here, deliberately: approveMagnetCandidate
    // stays the one and only route into lead_magnets.
    const row = pages[cmd.page - 1];
    if (!row) return { message: `:warning: There is no page ${cmd.page}. \`magnets\` lists them.` };

    const mine = (await magnetsByPlan(args.clientId)).get(row.id) ?? [];
    const choice = mine[cmd.option - 1];
    if (!choice) {
      return {
        message: `:warning: Page ${cmd.page} has ${mine.length} offer${mine.length === 1 ? "" : "s"} on file, so there is no option ${cmd.option}.`,
      };
    }

    const { error } = await supabaseAdmin
      .from("page_plan")
      .update({
        magnet_frame: {
          title: choice.title,
          ctaLabel: choice.ctaLabel,
          conciergeEntry: choice.conciergeEntry,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("client_id", args.clientId);
    if (error) return { message: `:warning: The offer was not saved: ${error.message}` };

    return {
      message: [
        `:gift: *Page ${cmd.page} hands over:* ${choice.title}`,
        `The pill reads: ${choice.ctaLabel}`,
        "It is minted into the catalogue when the page is drafted, and the assistant offers it on that page rather than whatever the ladder ranks.",
      ].join("\n"),
      after: refresh,
    };
  }

  // ‼️ THE ACK GOES BACK FIRST AND THE MODEL CALLS HAPPEN IN `after`. `angles auto` is one call per
  // planned page, seven of them in waves of three, which is well past the three seconds Slack waits
  // before it decides the app is down and shows the user a failure over work that is running fine.
  if (cmd.kind === "auto" || cmd.kind === "more") {
    const scope = cmd.kind === "more" ? `page ${cmd.page}` : "every page that has none";
    return {
      message: `:hourglass_flowing_sand: Writing three ideas for ${scope}, from the anchored rung and this page's keyword. About a minute.`,
      after: async () => {
        const res = await generateAnglesForPlan({
          clientId: args.clientId,
          by: args.by,
          only: cmd.kind === "more" ? cmd.page : undefined,
        });
        const listed = res.ok ? await angleLines(args.clientId) : [];
        await say([...res.lines, ...(listed.length ? ["", ...listed] : [])].join("\n"));
        await refresh();
      },
    };
  }

  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(args.clientId);
  if ("error" in plan) return { message: `:warning: ${plan.error}` };

  const pages = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
  const row = pages[cmd.page - 1];
  if (!row) return { message: `:warning: There is no page ${cmd.page}. \`angles\` lists them.` };

  const mine = (await anglesFor(args.clientId)).filter((a) => a.planId === row.id);
  const choice = mine[cmd.option - 1];
  if (!choice) {
    return {
      message: `:warning: Page ${cmd.page} has ${mine.length} idea${mine.length === 1 ? "" : "s"} on file, so there is no option ${cmd.option}.`,
    };
  }

  const res = await pickAngle({ clientId: args.clientId, angleId: choice.id, by: args.by });
  if (!res.ok) return { message: `:warning: ${res.error}`, after: refresh };

  return {
    message: [
      `:white_check_mark: *Page ${cmd.page} argues:* ${res.angle.idea}`,
      res.angle.indoctrination ? `The belief it installs: ${res.angle.indoctrination}` : "",
      res.angle.awarenessEntry && res.angle.awarenessTarget
        ? `It moves her from stage ${res.angle.awarenessEntry} to ${res.angle.awarenessTarget}.`
        : "",
      "The other two are kept as rejected, which is what teaches the next set.",
      "`headlines` now writes from this idea rather than from the keyword alone.",
      ":hourglass_flowing_sand: Drafting the offers this page hands over, from the idea.",
    ]
      .filter(Boolean)
      .join("\n"),
    // ‼️ THE OFFERS ARE DRAFTED ON THE PICK RATHER THAN WAITING TO BE ASKED FOR. The idea is the
    // brief for them, so the moment it exists is the moment they can be written, and a person who
    // has just decided what a page argues should not have to know a second command to get the thing
    // the assistant will hand over on it. Non-fatal: a failure here costs offers, never the pick.
    after: async () => {
      const note = await draftMagnetsFor(args.clientId, row.id);
      await say(`Page ${cmd.page}: ${note}`);
      await refresh();
    },
  };
}
