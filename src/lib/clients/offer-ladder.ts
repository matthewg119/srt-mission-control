// The awareness ladder: one claim, one risk reversal and one anchor offer per stage of awareness.
//
// Matthew, 2026-09-15, looking at step 21's "anchor: <key>": "am I supposed to come up with it? based on
// this depends the whole structure so I guess this should be combination of avatar with offer, with angle
// so we need to break down problems of this customer, stage of awareness etc in order to come up with each
// level of awareness type of claim / Guarantee or anchor offer."
//
// So step 21 no longer asks for a key out of a list. It writes a LADDER for the locked offer: for each stage
// (5 unaware to 1 most aware, Matthew's numbering, see audit-engine/awareness.ts) what the reader believes,
// the angle that reaches them, the claim, the risk reversal, and which offer in the catalogue is the right
// free thing to hand them there. A person picks the rung the build is anchored at, the anchor is set from
// it, and then the pillar and supports are picked from the approved keywords. Only then is a page planned.
//
// ‼️ NOTHING ON A RUNG MAY BE INVENTED, AND THE VALIDATORS ARE WHY THAT IS TRUE RATHER THAN HOPED.
//   - A guarantee is only ever the client's own words from `guarantee:`. With none on file, a rung that
//     guarantees anything is refused.
//   - A number on a rung has to appear in what the model was given.
//   - The anchor is a key from THIS client's catalogue, and a deliverable one: a rung whose anchor hands
//     over nothing cannot be picked, the rule anchorReply already kept.
//   - No em dash, anywhere.
//
// ‼️ STORED AS A DOCUMENT, NOT A TABLE. audience_documents already versions per offer with draft/approved,
// supersede and an offer fingerprint, which is exactly the life a ladder has: rewritten when the offer or
// the guarantee changes, approved by the pick.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { AWARENESS_STAGES, type AwarenessStage } from "@/lib/audit-engine/awareness";

const MODEL = "claude-sonnet-4-6" as const;
export const CLAIM_MAX = 180;
export const ANGLE_MAX = 140;

export interface LadderRung {
  stage: AwarenessStage;
  readerState: string;
  angle: string;
  claim: string;
  /** Null when the client has no guarantee on file: the ladder does not invent one. */
  riskReversal: string | null;
  anchorKey: string;
  /** An offer the catalogue does not have yet but this rung wants. Staged as an idea, never minted here. */
  proposedMagnet: { title: string; promise: string } | null;
  beliefs: string[];
  keywordExamples: string[];
  proofNeeded: string;
}

export interface Ladder {
  rungs: LadderRung[];
  recommendedStage: AwarenessStage;
  why: string;
}

export interface LadderInputs {
  clientName: string;
  audienceLabel: string | null;
  buyer: string | null;
  treatment: string;
  terms: string[];
  positioning: string | null;
  outcome: string | null;
  price: string | null;
  guarantee: string | null;
  beliefs: Array<{ id: string; text: string }>;
  avatarNotes: string[];
  objections: Array<{ text: string; belief: string | null }>;
  shortOffer: string | null;
  /** Approved query keywords by stage, top few each, with how many sit at each stage. */
  keywordsByStage: Record<AwarenessStage, { count: number; examples: string[] }>;
  catalogue: Array<{ key: string; title: string; promise: string; deliverable: boolean }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure
// ─────────────────────────────────────────────────────────────────────────────

/** The stage holding most approved queries: where the buyers this build is written for actually are. */
export function recommendStage(byStage: LadderInputs["keywordsByStage"]): AwarenessStage {
  // Ties go to 4, then 3: Matthew's rule is that pages move a reader from 5 toward 3 and 4.
  const order: AwarenessStage[] = [4, 3, 2, 5, 1];
  let best: AwarenessStage = 4;
  let bestCount = -1;
  for (const s of order) {
    const n = byStage[s]?.count ?? 0;
    if (n > bestCount) {
      best = s;
      bestCount = n;
    }
  }
  return best;
}

function orphanNumbers(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

const GUARANTEE_WORDS = /\b(guarantee[ds]?|money[- ]back|refund|risk[- ]free|or you don'?t pay|you don'?t pay|free until|no results?,? no)\b/i;

/** Every reason a drafted ladder is not usable, in words the re-ask can act on. Pure, for the probe. */
export function ladderFaults(raw: unknown, inputs: LadderInputs): string[] {
  const faults: string[] = [];
  const v = raw as { rungs?: unknown; recommended_stage?: unknown } | null;
  const rungs = Array.isArray(v?.rungs) ? (v!.rungs as Array<Record<string, unknown>>) : [];
  if (rungs.length !== 5) faults.push(`there must be exactly 5 rungs, one per stage; got ${rungs.length}.`);

  const haystack = JSON.stringify(inputs).replace(/[,$]/g, "");
  const keys = new Map(inputs.catalogue.map((c) => [c.key, c]));
  const seen = new Set<number>();

  for (const r of rungs) {
    const stage = Number(r.stage);
    const name = `stage ${Number.isFinite(stage) ? stage : "?"}`;
    if (!Number.isInteger(stage) || stage < 1 || stage > 5) faults.push(`${name}: stage must be 1 to 5.`);
    else if (seen.has(stage)) faults.push(`${name} appears twice.`);
    else seen.add(stage);

    const claim = String(r.claim ?? "").trim();
    const angle = String(r.angle ?? "").trim();
    const reader = String(r.reader_state ?? "").trim();
    const risk = r.risk_reversal == null ? "" : String(r.risk_reversal).trim();
    if (!claim) faults.push(`${name}: claim is empty.`);
    if (claim.length > CLAIM_MAX) faults.push(`${name}: claim is ${claim.length} characters, the limit is ${CLAIM_MAX}.`);
    if (!angle) faults.push(`${name}: angle is empty.`);
    if (angle.length > ANGLE_MAX) faults.push(`${name}: angle is ${angle.length} characters, the limit is ${ANGLE_MAX}.`);
    if (!reader) faults.push(`${name}: reader_state is empty.`);

    const copy = [claim, angle, reader, risk, String(r.proof_needed ?? "")].join(" ");
    if (hasBannedDash(copy)) faults.push(`${name}: contains an em dash, an en dash or a double hyphen.`);
    const invented = orphanNumbers(`${claim} ${angle} ${risk}`, haystack);
    if (invented.length) faults.push(`${name}: states ${invented.join(", ")}, which nothing you were given contains.`);

    // ‼️ THE GUARANTEE RULE. With none on file, nothing guarantees; with one, the reversal restates it.
    if (!inputs.guarantee) {
      if (risk) faults.push(`${name}: risk_reversal must be null. The client has not given a guarantee.`);
      if (GUARANTEE_WORDS.test(claim)) faults.push(`${name}: the claim guarantees something, and the client has not given a guarantee.`);
    } else if (risk && GUARANTEE_WORDS.test(risk) && !inputs.guarantee.split(/\s+/).some((w) => w.length > 3 && risk.toLowerCase().includes(w.toLowerCase()))) {
      faults.push(`${name}: risk_reversal promises something other than the guarantee on file ("${inputs.guarantee}").`);
    }

    const key = String(r.anchor_key ?? "").trim();
    const found = keys.get(key);
    if (!found) faults.push(`${name}: anchor_key "${key}" is not in the catalogue.`);
    else if (!found.deliverable) faults.push(`${name}: anchor_key "${key}" has no asset, so it hands over nothing. Pick a deliverable one.`);

    const pm = r.proposed_magnet as { title?: unknown; promise?: unknown } | null | undefined;
    if (pm && (hasBannedDash(String(pm.title ?? "")) || hasBannedDash(String(pm.promise ?? "")))) {
      faults.push(`${name}: proposed_magnet contains a dash.`);
    }
  }
  return faults;
}

export function toLadder(raw: unknown, inputs: LadderInputs): Ladder {
  const v = raw as { rungs: Array<Record<string, unknown>>; recommended_stage?: unknown; why?: unknown };
  const rungs: LadderRung[] = v.rungs
    .map((r) => {
      const pm = r.proposed_magnet as { title?: unknown; promise?: unknown } | null | undefined;
      return {
        stage: Number(r.stage) as AwarenessStage,
        readerState: String(r.reader_state ?? "").trim(),
        angle: String(r.angle ?? "").trim(),
        claim: String(r.claim ?? "").trim(),
        riskReversal: r.risk_reversal == null || String(r.risk_reversal).trim() === "" ? null : String(r.risk_reversal).trim(),
        anchorKey: String(r.anchor_key ?? "").trim(),
        proposedMagnet:
          pm && String(pm.title ?? "").trim() ? { title: String(pm.title).trim(), promise: String(pm.promise ?? "").trim() } : null,
        beliefs: Array.isArray(r.beliefs) ? (r.beliefs as unknown[]).map(String).slice(0, 4) : [],
        keywordExamples: Array.isArray(r.keyword_examples) ? (r.keyword_examples as unknown[]).map(String).slice(0, 4) : [],
        proofNeeded: String(r.proof_needed ?? "").trim(),
      };
    })
    .sort((a, b) => b.stage - a.stage);
  const rec = Number(v.recommended_stage);
  return {
    rungs,
    recommendedStage: Number.isInteger(rec) && rec >= 1 && rec <= 5 ? (rec as AwarenessStage) : recommendStage(inputs.keywordsByStage),
    why: String(v.why ?? "").trim(),
  };
}

/** The ladder as a person reads it in Slack. */
export function ladderLines(ladder: Ladder, catalogue: LadderInputs["catalogue"], opts: { pickedStage?: number | null } = {}): string[] {
  const title = (key: string) => catalogue.find((c) => c.key === key)?.title ?? key;
  const lines: string[] = [];
  for (const r of ladder.rungs) {
    const stageName = AWARENESS_STAGES.find((s) => s.stage === r.stage)?.name ?? `stage ${r.stage}`;
    const mark = opts.pickedStage === r.stage ? ":white_check_mark: " : ladder.recommendedStage === r.stage ? ":star: " : "";
    lines.push(`${mark}*${r.stage}. ${stageName}*  _${r.readerState}_`);
    lines.push(`   Angle: ${r.angle}`);
    lines.push(`   Claim: *${r.claim}*`);
    if (r.riskReversal) lines.push(`   Risk reversal: ${r.riskReversal}`);
    lines.push(`   Anchor: ${title(r.anchorKey)} (\`${r.anchorKey}\`)${r.proposedMagnet ? `. Idea for later: ${r.proposedMagnet.title}` : ""}`);
    if (r.keywordExamples.length) lines.push(`   Searches here: ${r.keywordExamples.map((k) => `"${k}"`).join(", ")}`);
    if (r.proofNeeded) lines.push(`   Proof it needs: ${r.proofNeeded}`);
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// The model call
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = `You are a direct response strategist. You write an AWARENESS LADDER for one offer: for each of the five stages of awareness, what the buyer believes, the angle that reaches them there, the claim a page makes to them, the risk reversal, and which free offer from the catalogue is the right thing to hand them at that stage.

The stages, numbered the client's way (5 is furthest from buying, 1 is closest):
${AWARENESS_STAGES.map((s) => `${s.stage}. ${s.name}: ${s.means}`).join("\n")}

Rules:
1. Exactly five rungs, stages 5, 4, 3, 2, 1, one each.
2. reader_state: what this buyer believes or feels at that stage, in their terms. One sentence.
3. angle: the way in that meets that belief. Under ${ANGLE_MAX} characters.
4. claim: what a page says to them there. Specific to this offer and this buyer, under ${CLAIM_MAX} characters. A claim at stage 5 names the situation, not the product; a claim at stage 1 names the offer and the next step.
5. risk_reversal: restate the client's GUARANTEE in words that fit the stage, or null when no guarantee was given. Never invent a guarantee, a refund, a "risk free" or a "you don't pay".
6. anchor_key: a key from the CATALOGUE that is marked deliverable. The same key may serve several stages.
7. proposed_magnet: null, or {title, promise} for an offer that would fit this stage better and does not exist yet. It is an idea, not a promise on a page.
8. beliefs: the ids of the necessary beliefs this rung moves (from the list), or short belief statements when none were given.
9. keyword_examples: up to 3 approved searches from that stage, copied exactly.
10. proof_needed: the evidence the claim needs before it can be published (a measured result, a review, a case).
11. No number that is not in what you were given. No em dashes, no en dashes, no double hyphens.
12. recommended_stage: where to anchor the build, and why in one sentence. Prefer the stage where most approved searches sit.`;

function userPrompt(i: LadderInputs): string {
  const lines = [
    `CLIENT: ${i.clientName}`,
    `BUYER: ${i.audienceLabel ?? "unknown"}${i.buyer ? ` (${i.buyer})` : ""}`,
    `OFFER: ${i.treatment}`,
    i.terms.length ? `WORDS THE BUYER USES FOR IT: ${i.terms.join(", ")}` : "",
    i.positioning ? `POSITIONING: ${i.positioning}` : "",
    `OUTCOME PROMISED: ${i.outcome ?? "not given"}`,
    `PRICE: ${i.price ?? "not given"}`,
    `GUARANTEE: ${i.guarantee ?? "NONE GIVEN. risk_reversal is null on every rung and no claim guarantees anything."}`,
    "",
    i.shortOffer ? `THE SHORT OFFER:\n${i.shortOffer.slice(0, 2500)}\n` : "",
    i.beliefs.length ? `NECESSARY BELIEFS:\n${i.beliefs.map((b) => `${b.id}: ${b.text}`).join("\n")}\n` : "NECESSARY BELIEFS: none on file yet.\n",
    i.avatarNotes.length ? `AVATAR SHEET:\n${i.avatarNotes.map((n) => `- ${n}`).join("\n")}\n` : "",
    i.objections.length ? `OBJECTIONS THIS BUYER RAISES:\n${i.objections.map((o) => `- "${o.text}"${o.belief ? ` (needs: ${o.belief})` : ""}`).join("\n")}\n` : "",
    "APPROVED SEARCHES BY STAGE:",
    ...([5, 4, 3, 2, 1] as AwarenessStage[]).map(
      (s) => `  ${s}: ${i.keywordsByStage[s].count} searches${i.keywordsByStage[s].examples.length ? `, e.g. ${i.keywordsByStage[s].examples.map((e) => `"${e}"`).join(", ")}` : ""}`
    ),
    "",
    "CATALOGUE (anchor_key must be one of the deliverable keys):",
    ...i.catalogue.map((c) => `  ${c.key}${c.deliverable ? "" : " (NOT deliverable)"}: ${c.title}. ${c.promise}`),
    "",
    'Return JSON: { "rungs": [ { "stage", "reader_state", "angle", "claim", "risk_reversal", "anchor_key", "proposed_magnet", "beliefs", "keyword_examples", "proof_needed" } ], "recommended_stage", "why" }',
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function draftLadder(inputs: LadderInputs): Promise<{ ok: true; ladder: Ladder } | { ok: false; error: string }> {
  let faults: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await callClaudeJSON<Record<string, unknown>>({
        model: MODEL,
        system: SYSTEM,
        user: userPrompt(inputs) + (faults.length ? `\n\nYour last answer was refused for:\n${faults.map((f) => `- ${f}`).join("\n")}\nFix every one.` : ""),
        maxTokens: 4000,
        temperature: 0.4,
        validate: (v): v is Record<string, unknown> => Array.isArray((v as { rungs?: unknown } | null)?.rungs),
        describeInvalid: () => 'Return { "rungs": [...5 rungs...], "recommended_stage": 4, "why": "..." }.',
        timeoutMs: 120_000,
      });
      faults = ladderFaults(res.data, inputs);
      if (faults.length === 0) return { ok: true, ladder: toLadder(res.data, inputs) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: `the ladder was refused twice: ${faults.slice(0, 4).join(" ")}` };
}
