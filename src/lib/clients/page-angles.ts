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

export type AngleCommand =
  | { kind: "list" }
  | { kind: "auto" }
  | { kind: "pick"; page: number; option: number }
  | { kind: "more"; page: number };

const LIST = /^\s*[`*_]*angles?[`*_]*\s*$/i;
const AUTO = /^\s*[`*_]*angles?\s+auto[`*_]*\s*$/i;
const PICK = /^\s*[`*_]*angle\s+(\d+)\s+pick\s+(\d+)[`*_]*\s*$/i;
const MORE = /^\s*[`*_]*angle\s+(\d+)\s+more[`*_]*\s*$/i;

/**
 * ‼️ AUTO IS TESTED BEFORE LIST, because `angles auto` also matches nothing in LIST but the two
 * regexes are close enough that reordering them later would silently turn every auto into a list.
 */
export function parseAngleCommand(text: string): AngleCommand | null {
  if (AUTO.test(text)) return { kind: "auto" };
  if (LIST.test(text)) return { kind: "list" };
  const p = PICK.exec(text);
  if (p) return { kind: "pick", page: Number(p[1]), option: Number(p[2]) };
  const m = MORE.exec(text);
  if (m) return { kind: "more", page: Number(m[1]) };
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
