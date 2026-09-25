// One proposal a week, toward one goal.
//
// Matthew, 2026-09-23: "I want my onboarding intelligence to read its own code and make suggestions,
// max 1 per week, so make sure it is very strategic about it ... each proposal I want to make sure
// it has the category of the fix and the bulletpoints of what needs to be fixed and why ... our
// priority is data collection to create more hands off workflows." And the north star it is aimed
// at: "one day I want my whole workflow routine to work simply like I was opening claude.com, but
// Claude has a schedule of my day."
//
// ‼️ IT READS THE SYSTEM'S OWN BEHAVIOUR FIRST AND THE CODE SECOND. A proposal from reading source
// alone is an opinion about style. A proposal from reading where people actually get stuck is an
// observation with a number behind it, and the code is only how you say what to do about it. So the
// signals come first and the files are fetched for whatever the largest signal is about.
//
// ‼️ IT CANNOT READ THE FILESYSTEM, AND THAT IS NOT A CHOICE. `src/` is not in the Vercel serverless
// bundle. The allSource() pattern in _probe-do-this-now.ts works because a probe is a SCRIPT with
// the repo on disk. At runtime the only thing in this repo that reads its own code is Code Guardian,
// through the GitHub API, and this uses the same door.
//
// ‼️ A WEEK CAN PASS IN SILENCE. If nothing observed moves the north star or simplifies a workflow,
// nothing is posted. A weekly card that always speaks is a weekly card nobody reads by week three,
// which is exactly why stepDigest filters at 48 hours.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postInfraAlert } from "@/lib/alerts";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { STEP_COMMANDS } from "@/lib/clients/step-grammar";

const SQL = "docs/2026-09-26-code-suggestions.sql";
const MODEL = "claude-sonnet-4-6" as const;

export const CATEGORIES = [
  "simplify",
  "one-ui",
  "data-collection",
  "reliability",
  "security",
  "cost",
] as const;
export type SuggestionCategory = (typeof CATEGORIES)[number];

/**
 * The goal every proposal is judged against.
 *
 * ‼️ ONE STRING, IN THE PROMPT AND IN THE REFUSAL. A model asked for "improvements" returns tidier
 * code. A model asked whether something moves a named goal can answer no, and answering no is what
 * makes one a week possible.
 */
export const NORTH_STAR = [
  "Mission Control should run the whole working routine from one page: a schedule of the day that can",
  "be reordered, and a chat beside it that does the work. Everything not about AI Engine Optimization",
  "or the AI Referral Engine is noise. The priority under that is DATA COLLECTION: capturing what the",
  "system currently forgets, so more of the work can become hands off.",
].join(" ");

/**
 * Work that is not merely low value but DECOMMISSIONED, so finding any of it is itself the proposal.
 *
 * Matthew, 2026-09-25: "everything regarding funding must be deleted from the code, make sure you
 * remember this and the code analyzer suggester aswell whenever it runs the scan and finds anything old
 * regarding to funding srt agency doesnt do any type of business funding".
 *
 * ‼️ THIS IS A SUGGESTION AND NOT A GUARANTEE, and the split is structural rather than a choice.
 * This module CANNOT read the filesystem: `src/` is not in the Vercel serverless bundle, which its own
 * header records, so it only ever sees whatever files a signal made it fetch through the GitHub API. A
 * prose rule cannot enforce anything it never looks at. The guarantee is
 * scripts/_probe-dead-wires.ts, which reads every docs/*.sql and all of src/ off disk, fails on an
 * unread funding column, and prints the count of files still mentioning funding at all. Same doctrine
 * this repo applies to the em-dash ban and the price gate: the prompt asks, the code enforces.
 */
export const DECOMMISSIONED = [
  "SRT does NO business funding of any kind, and has not since 2026-08-17. Anything about lenders,",
  "factor or buy or sell rates, underwriting boxes, bank statements, repayment frequency, positions",
  "funded or deal submissions is decommissioned: it is to be DELETED, never tidied, never documented,",
  "and never allowlisted as deliberate. If anything you are shown contains it, that is worth a",
  "proposal on its own, and the proposal is removal.",
].join(" ");

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the system says about itself
// ─────────────────────────────────────────────────────────────────────────────

export interface Signal {
  key: string;
  /** One sentence with a number in it. Printed verbatim in the proposal. */
  says: string;
  /** How loud it is, for picking which one to propose about. */
  weight: number;
  /** Source files that own whatever this is about, resolved from the grammar table. */
  files: string[];
  evidence: Record<string, unknown>;
}

/** The files that own a step's behaviour, from a map the repo already keeps. */
function filesForStep(key: StepKey): string[] {
  const specs = STEP_COMMANDS[key] ?? [];
  const out = new Set<string>();
  for (const spec of specs) {
    out.add(spec.implementedIn);
    if (spec.gatedIn) out.add(spec.gatedIn);
  }
  return [...out];
}

/**
 * Where people TYPE rather than press.
 *
 * ‼️ THE MOST VALUABLE SIGNAL IN THE SYSTEM AND NOTHING HAS EVER READ IT. client_events records every
 * message, command, button and bot post per client, is never deleted from, and has no reader. A step
 * whose thread carries a lot of free text is a step whose card did not explain itself, which is
 * precisely the "hands off" gap.
 */
async function typingSignal(since: string): Promise<Signal | null> {
  const { data, error } = await supabaseAdmin
    .from("client_events")
    .select("step_key, kind")
    .gte("created_at", since)
    .in("kind", ["message", "command"])
    .limit(5000);
  if (error || !data?.length) return null;

  const perStep = new Map<string, { message: number; command: number }>();
  for (const r of data) {
    const key = (r.step_key as string) ?? "";
    if (!key) continue;
    const at = perStep.get(key) ?? { message: 0, command: 0 };
    if (r.kind === "message") at.message += 1;
    else at.command += 1;
    perStep.set(key, at);
  }

  let worst: { key: string; message: number; command: number } | null = null;
  for (const [key, counts] of perStep) {
    if (counts.message < 4) continue;
    if (!worst || counts.message > worst.message) worst = { key, ...counts };
  }
  if (!worst) return null;

  const isStep = DELIVERY_STEPS.some((s) => s.key === worst.key);
  return {
    key: `typing:${worst.key}`,
    says: `Step ${isStep ? stepNumber(worst.key as StepKey) : "?"} (${worst.key}) took ${worst.message} free-text messages against ${worst.command} commands in the last week. People are explaining themselves to that card rather than using it.`,
    weight: worst.message,
    files: isStep ? filesForStep(worst.key as StepKey) : [],
    evidence: { step: worst.key, messages: worst.message, commands: worst.command },
  };
}

/** Steps sitting on a person, and for how long. */
async function dwellSignal(): Promise<Signal | null> {
  const { openStepWork } = await import("@/lib/clients/step-engine");
  const rows = await openStepWork().catch(() => []);
  if (!rows.length) return null;

  const now = Date.now();
  const perStep = new Map<string, number>();
  for (const r of rows) {
    const days = Math.floor((now - new Date(r.updatedAt).getTime()) / 86_400_000);
    perStep.set(r.stepKey, Math.max(perStep.get(r.stepKey) ?? 0, days));
  }

  let worst: { key: string; days: number } | null = null;
  for (const [key, days] of perStep) {
    if (days < 3) continue;
    if (!worst || days > worst.days) worst = { key, days };
  }
  if (!worst) return null;

  const isStep = DELIVERY_STEPS.some((s) => s.key === worst.key);
  return {
    key: `dwell:${worst.key}`,
    says: `Step ${isStep ? stepNumber(worst.key as StepKey) : "?"} (${worst.key}) has been waiting on a person for ${worst.days} days. Whatever it asks for is either unclear or genuinely hard.`,
    weight: worst.days * 2,
    files: isStep ? filesForStep(worst.key as StepKey) : [],
    evidence: { step: worst.key, days: worst.days },
  };
}

/** What the page gate keeps refusing. */
async function gateSignal(since: string): Promise<Signal | null> {
  const { data, error } = await supabaseAdmin
    .from("page_gate_runs")
    .select("verdict, checks, created_at")
    .gte("created_at", since)
    .limit(200);
  if (error || !data?.length) return null;

  const perCheck = new Map<string, number>();
  for (const run of data) {
    const checks = Array.isArray(run.checks) ? (run.checks as Array<{ key?: string; status?: string }>) : [];
    for (const c of checks) {
      if (c.status !== "fail" || !c.key) continue;
      perCheck.set(c.key, (perCheck.get(c.key) ?? 0) + 1);
    }
  }
  let worst: { key: string; n: number } | null = null;
  for (const [key, n] of perCheck) if (!worst || n > worst.n) worst = { key, n };
  if (!worst || worst.n < 3) return null;

  return {
    key: `gate:${worst.key}`,
    says: `The publish gate failed "${worst.key}" ${worst.n} times in the last week. Either the pages are wrong in the same way every time, or the check is.`,
    weight: worst.n,
    files: ["src/lib/hub/page-gate.ts"],
    evidence: { check: worst.key, failures: worst.n },
  };
}

/** How much of what the keyword step proposes gets thrown away. */
async function keywordDropSignal(since: string): Promise<Signal | null> {
  const { data, error } = await supabaseAdmin
    .from("keyword_decisions")
    .select("action")
    .gte("created_at", since)
    .in("action", ["approve", "drop"])
    .limit(4000);
  if (error || !data?.length) return null;

  const drops = data.filter((r) => r.action === "drop").length;
  const approvals = data.length - drops;
  if (drops < 20 || !approvals) return null;
  const rate = Math.round((drops / data.length) * 100);
  if (rate < 25) return null;

  return {
    key: "keywords:drop-rate",
    says: `${rate}% of the keyword decisions last week were drops (${drops} of ${data.length}). The expansion is proposing a lot that a person then has to remove by hand.`,
    weight: drops,
    files: ["src/lib/clients/keyword-expansion.ts", "src/lib/clients/client-keywords.ts"],
    evidence: { drops, approvals, ratePercent: rate },
  };
}

/** Fields declared and empty on most clients: the data-collection gap, named. */
async function fieldGapSignal(): Promise<Signal | null> {
  const { data, error } = await supabaseAdmin
    .from("dataset_suggestions")
    .select("field_key, status")
    .eq("status", "open")
    .limit(200);
  if (error || !data?.length) return null;

  return {
    key: "datasets:open-proposals",
    says: `${data.length} field proposal${data.length === 1 ? " is" : "s are"} sitting open in dataset_suggestions. The corpus scan keeps finding things the pages need that nothing asks for.`,
    weight: data.length * 2,
    files: ["src/lib/clients/dataset-spec.ts", "src/lib/clients/dataset-suggestions.ts"],
    evidence: { open: data.length },
  };
}

export async function collectSignals(now: Date): Promise<Signal[]> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const out = await Promise.all([
    typingSignal(since).catch(() => null),
    dwellSignal().catch(() => null),
    gateSignal(since).catch(() => null),
    keywordDropSignal(since).catch(() => null),
    fieldGapSignal().catch(() => null),
  ]);
  return out.filter((s): s is Signal => s !== null).sort((a, b) => b.weight - a.weight);
}

// ─────────────────────────────────────────────────────────────────────────────
// The proposal
// ─────────────────────────────────────────────────────────────────────────────

export interface Proposal {
  category: SuggestionCategory;
  title: string;
  observation: string;
  bullets: string[];
  files: string[];
  claudePrompt: string;
}

/**
 * ‼️ EVERY GENERATED PROMPT ENDS BY REQUIRING A PREVIEW. Matthew, 2026-09-23: "what I want is the
 * prompt that the code guardian gives me, says to give us a preview at the end so we can edit
 * whatever we create and or integrate right away." It is appended here rather than asked of the
 * model, because a requirement the model can forget is not a requirement.
 */
export const PREVIEW_REQUIREMENT = [
  "",
  // ‼️ NO `---` SEPARATOR HERE, AND THE REASON IS RECORDED. copy-guard's BANNED is /[emdash]|--/, and
  // the `--` half catches a markdown horizontal rule. That false positive already cost four replica
  // pages once: the retry rewrote "Founding Offer - 5 spots" as "Founding Offer. 5 spots", so a
  // false positive taught the correction to damage good copy. This string is appended to text a
  // model wrote and may pass a copy guard, so it simply does not contain one. A blank line separates
  // just as well.
  "Before you finish: give me a preview I can look at and edit.",
  "",
  "- If this changes a page or a card, deploy it and hand me the URL, or paste the rendered output.",
  "- If this changes what a workflow says, show me the exact text it would produce, for a real client,",
  "  so I can rewrite the wording before it goes anywhere.",
  "- If it can only be seen by running something, give me the one command and what I should see.",
  "",
  "Do not report it as done until I can look at it.",
].join("\n");

const SCHEMA = `{
  "worthPosting": boolean,
  "category": "simplify" | "one-ui" | "data-collection" | "reliability" | "security" | "cost",
  "title": string,
  "observation": string,
  "bullets": string[],
  "claudePrompt": string
}`;

function faults(v: unknown): string[] {
  const out: string[] = [];
  const d = v as Partial<Proposal> & { worthPosting?: unknown };
  if (typeof d?.worthPosting !== "boolean") out.push("worthPosting must be true or false.");
  if (d?.worthPosting === false) return out;
  if (!d?.category || !CATEGORIES.includes(d.category as SuggestionCategory)) {
    out.push(`category must be one of ${CATEGORIES.join(", ")}.`);
  }
  if (!d?.title?.trim()) out.push("title is missing.");
  if ((d?.title ?? "").length > 90) out.push("title is over 90 characters.");
  if (!d?.observation?.trim()) out.push("observation is missing.");
  if (!Array.isArray(d?.bullets) || d.bullets.length < 2) out.push("bullets must have at least two entries.");
  if (Array.isArray(d?.bullets) && d.bullets.length > 6) out.push("bullets must have at most six entries.");
  if (!d?.claudePrompt?.trim()) out.push("claudePrompt is missing.");
  if ((d?.claudePrompt ?? "").length < 200) out.push("claudePrompt is too short to act on.");
  return out;
}

export async function writeProposal(signals: readonly Signal[], source: string): Promise<Proposal | null> {
  if (!signals.length) return null;

  const system = [
    "You review one engineering system once a week and propose ONE change. You are not a code reviewer: tidier code is not a proposal.",
    "",
    "THE GOAL EVERY PROPOSAL IS JUDGED AGAINST:",
    NORTH_STAR,
    "",
    "DECOMMISSIONED, AND FINDING IT IS ITSELF A PROPOSAL:",
    DECOMMISSIONED,
    "",
    "‼️ IF NOTHING OBSERVED BELOW MOVES THAT GOAL OR MAKES A WORKFLOW SIMPLER, RETURN worthPosting: false.",
    "A week of silence is a correct outcome. A weekly note that always speaks stops being read.",
    "",
    "WHAT A GOOD PROPOSAL LOOKS LIKE:",
    "- category: what KIND of fix it is.",
    "- title: under 90 characters, naming the change, not the symptom.",
    "- observation: what was measured, with the numbers, in one or two sentences. Never a guess.",
    "- bullets: two to six lines, each saying what to fix AND why, in that order.",
    "- claudePrompt: a prompt somebody can paste into Claude Code and act on. Name the real files. Say",
    "  what to change and what must NOT change. Assume the reader has the repository and nothing else.",
    "",
    "RULES:",
    "- Propose about what was MEASURED. Do not invent a second problem you find more interesting.",
    "- Never an em dash, an en dash or a double hyphen, anywhere.",
    "- Never a number that is not in the observations you were given.",
    "- Do not propose changing anything to do with business funding, lenders, trading or coaching. Those",
    "  products are decommissioned and work on them is noise.",
  ].join("\n");

  const user = [
    "WHAT THE SYSTEM SAID ABOUT ITSELF THIS WEEK, loudest first:",
    "",
    ...signals.map((s, i) => `${i + 1}. ${s.says}`),
    "",
    "THE SOURCE FILES THAT OWN THE LOUDEST ONE:",
    "",
    source || "(none could be fetched, so propose from the observation alone and say so)",
  ].join("\n");

  try {
    const { data } = await callClaudeJSON<Proposal & { worthPosting: boolean }>({
      model: MODEL,
      system,
      user,
      maxTokens: 3000,
      temperature: 0.2,
      schemaHint: SCHEMA,
      validate: (v): v is Proposal & { worthPosting: boolean } => faults(v).length === 0,
      describeInvalid: (v) => `Fix these and answer again:\n${faults(v).map((f) => `  - ${f}`).join("\n")}`,
    });

    if (!data.worthPosting) return null;
    return {
      category: data.category,
      title: data.title.trim(),
      observation: data.observation.trim(),
      bullets: data.bullets.map((b) => b.trim()).filter(Boolean),
      files: [...new Set(signals.flatMap((s) => s.files))],
      // The requirement is appended, never asked for: a rule the model can forget is not a rule.
      claudePrompt: `${data.claudePrompt.trim()}${PREVIEW_REQUIREMENT}`,
    };
  } catch (e) {
    console.error("[ops/self-review] proposal failed:", (e as Error).message);
    return null;
  }
}

/** The source the model is shown: the files that own the loudest signal, through the GitHub API. */
async function sourceFor(signals: readonly Signal[]): Promise<string> {
  const paths = [...new Set(signals.flatMap((s) => s.files))].slice(0, 4);
  if (!paths.length) return "";

  const { fetchFileContents, guardianRepo } = await import("./source-read");
  const files = await fetchFileContents(guardianRepo(), paths).catch(() => []);
  if (!files.length) return "";

  return files
    .map((f) => `### ${f.path}\n\n${f.content.slice(0, 14_000)}`)
    .join("\n\n");
}

export function renderProposal(p: Proposal, week: string): string {
  return [
    `:brain: *Weekly review, ${week}* · \`${p.category}\``,
    `*${p.title}*`,
    "",
    p.observation,
    "",
    ...p.bullets.map((b) => `  • ${b}`),
    p.files.length ? `\n_Read: ${p.files.join(", ")}_` : "",
    "",
    "*Paste this into Claude Code:*",
    "```",
    p.claudePrompt,
    "```",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewResult {
  posted: boolean;
  week: string;
  skipped: string | null;
  category?: string;
}

/**
 * Thursday only, one proposal, and the database enforces the cap.
 *
 * ‼️ THE UNIQUE INDEX IS THE CAP, NOT THIS FUNCTION. A cap in TypeScript is one somebody bypasses by
 * calling the function twice. The insert happens BEFORE the post, so a duplicate week fails the
 * insert and nothing is said.
 */
export async function runWeeklySelfReview(opts: { dry?: boolean; now?: Date; force?: boolean } = {}): Promise<ReviewResult> {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);

  // Thursday, riding followup-digest, the same day the other three weekly passengers run.
  if (!opts.force && now.getUTCDay() !== 4) return { posted: false, week, skipped: "not Thursday" };

  const already = await supabaseAdmin.from("code_suggestions").select("id").eq("iso_week", week).limit(1);
  if (already.error) {
    if (/does not exist|schema cache|PGRST205/i.test(already.error.message)) {
      return { posted: false, week, skipped: `${SQL} has not been run` };
    }
    return { posted: false, week, skipped: already.error.message };
  }
  if ((already.data ?? []).length) return { posted: false, week, skipped: "already proposed this week" };

  const signals = await collectSignals(now);
  if (!signals.length) return { posted: false, week, skipped: "nothing measured worth proposing about" };
  if (opts.dry) return { posted: false, week, skipped: `dry run, ${signals.length} signals` };

  const source = await sourceFor(signals);
  const proposal = await writeProposal(signals, source);
  if (!proposal) return { posted: false, week, skipped: "nothing observed moves the goal" };

  const { error } = await supabaseAdmin.from("code_suggestions").insert({
    iso_week: week,
    category: proposal.category,
    title: proposal.title,
    observation: proposal.observation,
    bullets: proposal.bullets,
    files: proposal.files,
    claude_prompt: proposal.claudePrompt,
    evidence: Object.fromEntries(signals.map((s) => [s.key, s.evidence])),
    model: MODEL,
  });

  // ‼️ A FAILED INSERT MEANS NOTHING IS POSTED. The row is the cap; posting without it would let a
  // second run that week say the same thing again.
  if (error) {
    console.error("[ops/self-review] not filed, so not posted:", error.message);
    return { posted: false, week, skipped: `not filed: ${error.message}` };
  }

  await postInfraAlert(renderProposal(proposal, week));
  return { posted: true, week, skipped: null, category: proposal.category };
}
