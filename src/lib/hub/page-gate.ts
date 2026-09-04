// The content quality gate: the check between a draft and a live page on the client's domain.
//
// !! THIS IS THE SECOND HARD RAIL IN THIS CODEBASE AND IT WAS ADDED ON PURPOSE.
// CLAUDE.md recorded that Approve was dropped because a second rail conflicted with the doctrine
// that Day 0 is the one place this system blocks. Matthew reversed that on 2026-08-26 and chose
// the shape: BLOCK ON EVIDENCE, WARN ON STYLE. The narrow half of the original objection still
// holds and must keep holding: no new client_pages.status value exists. A page is draft,
// published or archived, and the gate is a recorded verdict that page_publish consults. Nobody
// has to move a page through an extra state.
//
// THE TWO TIERS, and why the line is drawn where it is:
//
//   BLOCK  things that can be WRONG. A claim with nothing behind it, a number nobody gave, a
//          near-duplicate of a page already live, a page that does not answer its own question.
//          These are publishable-and-false, and false on a domain the client controls, under
//          their name, is the failure this whole product cannot survive.
//
//   WARN   things that can be WEAK. Thin, generic, keyword-shaped, low first-party ratio. Real
//          problems, and none of them make the page untrue. A gate that blocks on taste gets
//          waived out of habit within a fortnight, and a rail everybody steps over is worse
//          than no rail because it looks like one.
//
// !! THE HOLE CHECK, and it is the same shape day-zero.ts uses:
//
//   grep -rn "assertGatePassed" src/    -> must match GATED below, exactly
//   grep -rn "setPublished" src/        -> must still return exactly ONE caller
//
// If the second grep ever returns two, both walls have a hole in them at once.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import {
  loadNumberedEvidence,
  isFirstParty,
  type EvidenceRef,
} from "@/lib/clients/page-evidence";
import type { EvidenceClaim } from "@/lib/hub/draft-page";
import { offerForPage } from "@/lib/concierge/for-client";

/**
 * Every path that consults this gate. Documentation, not enforcement: enforcement is the call
 * to assertGatePassed() inside each one.
 */
export const GATED = ["POST /api/clients/[id]/hub  action=page_publish"] as const;

/**
 * Deliberately NOT gated, and why.
 *
 *   page_save / startPageDraft / appendPageBody / the page studio
 *     A draft is not published. Gating the draft would mean a page cannot be written down
 *     before it is good, which is the opposite of what a draft is for.
 *   page_unpublish
 *     Taking a page down is the remedy, not the harm. Same reasoning the Day 0 wall gives.
 *   the preview route
 *     Ours, noindex, no client DNS.
 *   the review tool
 *     Publishes nothing and is regulated separately. No model may go near it.
 */
export const NOT_GATED = [
  "POST /api/clients/[id]/hub  action=page_save",
  "POST /api/clients/[id]/hub  action=page_unpublish",
  "hub/pages.ts startPageDraft / appendPageBody  (the page studio)",
  "the preview route",
  "the review tool",
  // The site replica (client_replica_pages, /preview/{token}?kind=site). It is OUTSIDE this
  // gate rather than waived from it, and the distinction is structural: replica rows are not
  // client_pages, they have no status column, and there is no code path that could put one on a
  // client host. A gate exists to stop something publishable from publishing badly; there is
  // nothing publishable here. See src/lib/clients/site-replica.ts.
  "the site replica",
] as const;

export type CheckTier = "block" | "warn";
export type CheckStatus = "pass" | "fail" | "skip";

export interface GateCheck {
  key: string;
  tier: CheckTier;
  status: CheckStatus;
  /** Said in words, because this is read by a person deciding what to fix. */
  detail: string;
}

export type Verdict = "pass" | "warn" | "block";

export interface GateRun {
  id: string | null;
  verdict: Verdict;
  checks: GateCheck[];
  bodyHash: string;
  createdAt: string;
}

/**
 * The hash a verdict is about.
 *
 * !! THIS IS THE WHOLE RELIABILITY OF THE GATE. A verdict describes the body it read. Edit
 * answer_md after a pass and that pass describes text that no longer exists. Publishing on a
 * stale pass would put a green light on unread words, which is worse than having no gate at
 * all, because nobody re-reads a page the system says it already checked.
 *
 * Whitespace is normalised first, so re-wrapping a paragraph does not invalidate a real check
 * while changing a single word does.
 */
export function hashBody(answerMd: string): string {
  return crypto
    .createHash("sha256")
    .update(answerMd.replace(/\s+/g, " ").trim())
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------

/**
 * Numbers the page states that no source contains.
 *
 * !! THE CHEAPEST CHECK HERE AND THE ONE MOST LIKELY TO CATCH A REAL INVENTION. A model that
 * has drifted invents a price, a percentage or a number of years long before it invents a whole
 * false paragraph, and a wrong price on a clinic's own domain is the single most damaging thing
 * this system could publish.
 *
 * SINGLE DIGITS ARE IGNORED ON PURPOSE. "3 steps", "2 to 4 days" and every ordered list in
 * markdown are single digits, they are almost never the kind of number that can be wrong in a
 * costly way, and including them made the check fire on nearly every page, which is how a check
 * becomes something people click past.
 */
function checkOrphanNumbers(answerMd: string, evidence: EvidenceRef[]): GateCheck {
  const haystack = evidence
    .map((s) => s.content)
    .join("\n")
    .replace(/[,$]/g, "");

  const stated = new Set<string>();
  // Currency, percentages and any number of two digits or more, commas stripped so 1,200 and
  // 1200 are the same number.
  for (const m of answerMd.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const raw = m[0];
    const bare = raw.replace(/[,$%]/g, "");
    if (!bare) continue;
    if (bare.length < 2) continue;
    stated.add(bare);
  }

  const orphans = [...stated].filter((n) => !haystack.includes(n));

  if (orphans.length === 0) {
    return {
      key: "orphan_numbers",
      tier: "block",
      status: "pass",
      detail: stated.size
        ? `Every number on the page appears in a source (${stated.size} checked).`
        : "The page states no numbers.",
    };
  }

  return {
    key: "orphan_numbers",
    tier: "block",
    status: "fail",
    detail:
      `The page states ${orphans.length === 1 ? "a number" : "numbers"} that no source contains: ` +
      `${orphans.slice(0, 8).join(", ")}${orphans.length > 8 ? ", and more" : ""}. ` +
      `Either file the source that says it, or take the number out.`,
  };
}

/** Word overlap, for "is this the page we already published". */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Is this page nearly one of the client's other pages?
 *
 * Measured against the SMALLER page, not the union, because the failure being caught is a short
 * page that is wholly contained in a longer one. Jaccard over the union scores that pair low and
 * would let exactly the duplicate everybody worries about straight through.
 */
async function checkDuplicate(
  clientId: string,
  pageId: string,
  answerMd: string
): Promise<GateCheck> {
  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, title, answer_md, status")
    .eq("client_id", clientId)
    .neq("status", "archived")
    .neq("id", pageId);

  const mine = tokens(answerMd);
  let worst: { slug: string; score: number } | null = null;

  for (const row of data ?? []) {
    const score = similarity(mine, tokens((row.answer_md as string) ?? ""));
    if (!worst || score > worst.score) worst = { slug: (row.slug as string) ?? "", score };
  }

  if (!worst || worst.score < 0.6) {
    return {
      key: "duplicate",
      tier: "block",
      status: "pass",
      detail: worst
        ? `Closest existing page shares ${Math.round(worst.score * 100)}% of its words.`
        : "This is the client's only page.",
    };
  }

  return {
    key: "duplicate",
    tier: "block",
    status: "fail",
    detail:
      `This page shares ${Math.round(worst.score * 100)}% of its words with /${worst.slug}. ` +
      `Two pages answering the same thing split the citation rather than doubling it. ` +
      `Either fold them together or answer a different question.`,
  };
}

/**
 * Claims the drafter itself marked as resting on nothing.
 *
 * !! A NULL evidence_map IS A SKIP, NOT A FAILURE, AND THAT IS THE MOST IMPORTANT LINE HERE.
 * A page dictated straight into the body by the person who does the work has no evidence_map,
 * because no model ever wrote it. That page is the BEST case this product has, and blocking it
 * for missing a machine-generated field would mean the gate punished the exact behaviour the
 * whole lane exists to encourage.
 */
function checkUnbackedClaims(evidenceMap: EvidenceClaim[] | null): GateCheck {
  if (evidenceMap === null) {
    return {
      key: "unbacked_claims",
      tier: "block",
      status: "skip",
      detail:
        "No claim map on this page, so nothing was drafted by a model. Written by hand or " +
        "dictated, which needs no map.",
    };
  }

  const unbacked = evidenceMap.filter((c) => c.sourceRef === null);
  if (unbacked.length === 0) {
    return {
      key: "unbacked_claims",
      tier: "block",
      status: "pass",
      detail: `All ${evidenceMap.length} claims trace to a source.`,
    };
  }

  return {
    key: "unbacked_claims",
    tier: "block",
    status: "fail",
    detail:
      `${unbacked.length} of ${evidenceMap.length} claims have no source behind them:\n` +
      unbacked
        .slice(0, 5)
        .map((c) => `  - ${c.claim}`)
        .join("\n") +
      (unbacked.length > 5 ? `\n  and ${unbacked.length - 5} more` : "") +
      `\nFile the evidence, or cut the claim.`,
  };
}

function checkNoEvidence(evidence: EvidenceRef[]): GateCheck {
  const usable = evidence;
  if (usable.length === 0) {
    return {
      key: "no_evidence",
      tier: "block",
      status: "fail",
      detail:
        "Nothing has been filed for this page or this client. A page with no evidence behind " +
        "it is a page nobody can defend if the client is asked where it came from. Run `ask` " +
        "in the page studio and dictate two answers.",
    };
  }
  return {
    key: "no_evidence",
    tier: "block",
    status: "pass",
    detail: `${usable.length} source${usable.length === 1 ? "" : "s"} on file.`,
  };
}

/**
 * What the concierge will actually offer on this page once it is live.
 *
 * !! TWO TIERS OUT OF ONE CHECK, AND THE LINE IS THE ONE THIS FILE ALREADY DRAWS.
 *
 *   BLOCK when nothing resolves at all. The launcher still renders and still carries a label, so
 *          a visitor is shown a button that hands over nothing. `A magnet is a promise` in
 *          concierge/magnets.ts refuses that one row at a time and `resolveBooking` refuses it
 *          for the call; this is the same refusal asked about a whole page before it is live on
 *          the client's own domain. It is publishable-and-false, which is the block tier's rule.
 *
 *   WARN  when the page named no magnet but the ladder still reaches one. The offer is generic
 *          rather than absent, which is weak and not wrong. Matthew's instruction is that the
 *          magnet is chosen before drafting, and this is where a page that skipped that says so,
 *          but blocking on it would refuse every page written before the column existed and a
 *          rail everybody steps over is worse than no rail.
 */
async function checkMagnet(clientId: string, magnetKey: string | null): Promise<GateCheck> {
  const { magnet, chosen } = await offerForPage(clientId, magnetKey);

  if (!magnet) {
    return {
      key: "no_magnet",
      tier: "block",
      status: "fail",
      detail: chosen
        ? `This page is written toward "${magnetKey}", and that magnet no longer resolves. It was ` +
          `deactivated, renamed, or its asset is gone. The widget would still show a pill and hand ` +
          `over nothing. Pick a magnet that exists on the board, or fix the row.`
        : "This page names no lead magnet and the ladder reaches none either, so the widget would " +
          "show a pill that hands over nothing. Choose the magnet on the board before publishing.",
    };
  }

  if (!chosen) {
    return {
      key: "no_magnet",
      tier: "warn",
      status: "fail",
      detail:
        `No magnet was chosen for this page, so the widget falls back to "${magnet.title}" for ` +
        `every page on this hub. Choose the one this page actually earns.`,
    };
  }

  return {
    key: "no_magnet",
    tier: "warn",
    status: "pass",
    detail: `Written toward "${magnet.title}".`,
  };
}

function checkThin(answerMd: string): GateCheck {
  const words = answerMd.trim().split(/\s+/).filter(Boolean).length;
  return words >= 150
    ? { key: "thin", tier: "warn", status: "pass", detail: `${words} words.` }
    : {
        key: "thin",
        tier: "warn",
        status: "fail",
        detail: `${words} words. Short is fine when the evidence is thin, but check it actually answers the question before it stops.`,
      };
}

/**
 * Is the question's own wording hammered into the body?
 *
 * The tell of a page written to rank rather than to answer. Measured on the rarest word in the
 * question, because the common ones ("best", "near") legitimately recur.
 */
function checkKeywordShaped(question: string, answerMd: string): GateCheck {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);

  const body = answerMd.toLowerCase();
  const total = answerMd.trim().split(/\s+/).filter(Boolean).length || 1;

  let worstWord = "";
  let worstRate = 0;
  for (const w of words) {
    const count = body.split(w).length - 1;
    const rate = count / total;
    if (rate > worstRate) {
      worstRate = rate;
      worstWord = w;
    }
  }

  if (worstRate <= 0.035) {
    return {
      key: "keyword_shaped",
      tier: "warn",
      status: "pass",
      detail: worstWord
        ? `Heaviest question term "${worstWord}" is ${(worstRate * 100).toFixed(1)}% of the page.`
        : "No repeated question terms.",
    };
  }

  return {
    key: "keyword_shaped",
    tier: "warn",
    status: "fail",
    detail:
      `"${worstWord}" is ${(worstRate * 100).toFixed(1)}% of the page. That reads as written for a ` +
      `search engine rather than for the person who asked, and an engine reading it will think so too.`,
  };
}

function checkFirstPartyRatio(
  evidenceMap: EvidenceClaim[] | null,
  evidence: EvidenceRef[]
): GateCheck {
  // Refs come from the shared numbering, so "S3" here is the same S3 the drafter cited.
  const firstPartyRefs = new Set(
    evidence.filter((e) => isFirstParty(e.type)).map((e) => e.ref)
  );

  if (evidenceMap === null || evidenceMap.length === 0) {
    const firstParty = firstPartyRefs.size;
    return {
      key: "first_party_ratio",
      tier: "warn",
      status: firstParty > 0 ? "pass" : "fail",
      detail:
        firstParty > 0
          ? `No claim map, and ${firstParty} first-party source${firstParty === 1 ? "" : "s"} on file.`
          : "No claim map and no first-party source. Nothing here came from the business.",
    };
  }

  const backed = evidenceMap.filter((c) => c.sourceRef && firstPartyRefs.has(c.sourceRef)).length;
  const rate = backed / evidenceMap.length;

  return rate >= 0.5
    ? {
        key: "first_party_ratio",
        tier: "warn",
        status: "pass",
        detail: `${backed} of ${evidenceMap.length} claims come from the business itself.`,
      }
    : {
        key: "first_party_ratio",
        tier: "warn",
        status: "fail",
        detail:
          `Only ${backed} of ${evidenceMap.length} claims come from the business itself. ` +
          `The rest is outside research, which any competitor's page can also say.`,
      };
}

/**
 * House style, checked rather than asked for.
 *
 * WARN, not block, because the tier line is evidence versus taste and none of these make the
 * page untrue. They are also all fixable in ten seconds, which is the other reason blocking on
 * them would only teach people to waive.
 */
function checkHouseStyle(page: { title: string; answerMd: string; metaDescription: string | null }): GateCheck {
  const problems: string[] = [];

  if (
    hasBannedDash(page.answerMd) ||
    hasBannedDash(page.title) ||
    hasBannedDash(page.metaDescription ?? "")
  ) {
    problems.push("an em dash is present");
  }
  if (/^#\s/m.test(page.answerMd)) problems.push("the body contains an H1, which collides with the title");
  if (/\]\(/.test(page.answerMd)) problems.push("the body contains a markdown link");
  if (!page.metaDescription?.trim()) problems.push("there is no meta description");

  return problems.length === 0
    ? { key: "house_style", tier: "warn", status: "pass", detail: "Clean." }
    : {
        key: "house_style",
        tier: "warn",
        status: "fail",
        detail: `${problems.join("; ")}.`,
      };
}

// ---------------------------------------------------------------------------
// The model checks
// ---------------------------------------------------------------------------

interface ModelVerdict {
  answersTheQuestion: boolean;
  answersDetail: string;
  unsupported: string[];
  generic: boolean;
  genericDetail: string;
}

const REVIEW_SYSTEM = `You are checking one page before it is published on a small business's own
website. You are not editing it and you are not rewriting it. You answer three questions about it.

1. ANSWERS THE QUESTION. Does the page answer the question it claims to answer, near the top, in
   a way that would satisfy the person who typed it? A page that circles the subject, or answers
   a neighbouring question, or spends its first paragraph introducing the business, does not.

2. UNSUPPORTED. List any sentence that asserts something specific about THIS BUSINESS which no
   source below carries: a service, a price, a credential, a piece of equipment, a policy, a
   number, an amount of experience, a guarantee. Quote the sentence.
   Two things are NOT unsupported and must not be listed: general background about the subject
   that asserts nothing about this particular business, and something a source says in different
   words. You are looking for invention, not paraphrase.

3. GENERIC. Would this page read exactly the same with a different business's name on it? If
   nothing in it could only have come from these people, say so.

BE STRICT ON 2 AND FORGIVING ON 3. An unsupported claim is published on their domain under their
name and can be checked by a reader. A generic page is merely weak. If you are unsure whether
something is supported, list it: a person reads this list and decides.`;

function isModelVerdict(v: unknown): v is ModelVerdict {
  const d = v as ModelVerdict;
  return (
    !!d &&
    typeof d.answersTheQuestion === "boolean" &&
    typeof d.answersDetail === "string" &&
    Array.isArray(d.unsupported) &&
    d.unsupported.every((s) => typeof s === "string") &&
    typeof d.generic === "boolean" &&
    typeof d.genericDetail === "string"
  );
}

async function modelChecks(args: {
  clientName: string;
  question: string;
  answerMd: string;
  evidence: EvidenceRef[];
}): Promise<{ checks: GateCheck[]; model: string | null }> {
  const evidence = args.evidence
    .map((s) => `[${s.ref}] ${s.label}${s.topic ? `, on ${s.topic}` : ""}\n${s.content}`)
    .join("\n\n");

  const user = [
    `THE BUSINESS: ${args.clientName}`,
    `THE QUESTION THIS PAGE CLAIMS TO ANSWER: ${args.question}`,
    "",
    "THE PAGE:",
    args.answerMd,
    "",
    "THE SOURCES, and there are no others:",
    evidence || "(none on file)",
  ].join("\n");

  try {
    const res = await callClaudeJSON<ModelVerdict>({
      model: "claude-sonnet-4-6",
      system: REVIEW_SYSTEM,
      user,
      maxTokens: 1500,
      temperature: 0,
      schemaHint: `{ "answersTheQuestion": boolean, "answersDetail": string, "unsupported": string[], "generic": boolean, "genericDetail": string }`,
      validate: isModelVerdict,
      describeInvalid: () =>
        "Return all five fields: answersTheQuestion, answersDetail, unsupported, generic, genericDetail.",
    });

    const d = res.data;
    return {
      model: "claude-sonnet-4-6",
      checks: [
        {
          key: "answers_the_question",
          tier: "block",
          status: d.answersTheQuestion ? "pass" : "fail",
          detail: d.answersDetail,
        },
        {
          key: "unsupported",
          tier: "block",
          status: d.unsupported.length === 0 ? "pass" : "fail",
          detail:
            d.unsupported.length === 0
              ? "Nothing asserted that a source does not carry."
              : `${d.unsupported.length} statement${d.unsupported.length === 1 ? "" : "s"} no source supports:\n` +
                d.unsupported.slice(0, 6).map((s) => `  - ${s}`).join("\n"),
        },
        {
          key: "generic",
          tier: "warn",
          status: d.generic ? "fail" : "pass",
          detail: d.genericDetail,
        },
      ],
    };
  } catch (e) {
    // !! A FAILED REVIEW IS A SKIP, NOT A PASS AND NOT A BLOCK.
    // Passing would let an API outage publish anything. Blocking would make every page in the
    // system unpublishable while a vendor is down, on a check that never actually ran. It is
    // recorded as skipped with the reason, and the verdict is computed from what did run, so
    // the card says out loud which checks are missing.
    return {
      model: null,
      checks: [
        {
          key: "model_review",
          tier: "block",
          status: "skip",
          detail: `The read-through did not run: ${(e as Error).message}. The checks it covers are unknown for this page.`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function verdictOf(checks: GateCheck[]): Verdict {
  if (checks.some((c) => c.tier === "block" && c.status === "fail")) return "block";
  if (checks.some((c) => c.status === "fail")) return "warn";
  return "pass";
}

interface PageRow {
  id: string;
  title: string;
  question: string;
  answer_md: string;
  meta_description: string | null;
  evidence_map: EvidenceClaim[] | null;
  lead_magnet_key: string | null;
}

/**
 * Run every check and record the verdict.
 *
 * `skipModel` exists for the probe and for a re-check that only needs the cheap half. It is not
 * exposed on the board: a person pressing Check expects the whole thing.
 */
export async function runGate(
  clientId: string,
  pageId: string,
  opts?: { runBy?: string | null; skipModel?: boolean }
): Promise<{ ok: true; run: GateRun } | { ok: false; error: string }> {
  const { data: pageData, error: pageError } = await supabaseAdmin
    .from("client_pages")
    .select("id, title, question, answer_md, meta_description, evidence_map, lead_magnet_key")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (pageError) return { ok: false, error: pageError.message };
  if (!pageData) return { ok: false, error: "That page does not exist." };

  const page = pageData as unknown as PageRow;
  const body = (page.answer_md ?? "").trim();
  if (!body) return { ok: false, error: "The page is empty, so there is nothing to check." };

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();

  const clientName =
    ((client?.dba_name as string | null) || (client?.legal_name as string | null)) ?? "this client";

  const evidence = await loadNumberedEvidence(clientId, pageId);
  const evidenceMap = Array.isArray(page.evidence_map) ? page.evidence_map : null;

  const checks: GateCheck[] = [
    checkNoEvidence(evidence),
    await checkMagnet(clientId, page.lead_magnet_key),
    checkUnbackedClaims(evidenceMap),
    checkOrphanNumbers(body, evidence),
    await checkDuplicate(clientId, pageId, body),
    checkThin(body),
    checkKeywordShaped(page.question ?? "", body),
    checkFirstPartyRatio(evidenceMap, evidence),
    checkHouseStyle({
      title: page.title ?? "",
      answerMd: body,
      metaDescription: page.meta_description,
    }),
  ];

  let model: string | null = null;
  if (!opts?.skipModel) {
    const m = await modelChecks({
      clientName,
      question: page.question ?? "",
      answerMd: body,
      evidence,
    });
    checks.push(...m.checks);
    model = m.model;
  }

  const verdict = verdictOf(checks);
  const bodyHash = hashBody(body);

  const { data: saved, error } = await supabaseAdmin
    .from("page_gate_runs")
    .insert({
      page_id: pageId,
      client_id: clientId,
      verdict,
      checks,
      body_hash: bodyHash,
      model,
      run_by: opts?.runBy ?? null,
    })
    .select("id, created_at")
    .maybeSingle();

  if (error) return { ok: false, error: `The gate ran but the verdict was not saved: ${error.message}` };

  return {
    ok: true,
    run: {
      id: (saved?.id as string | null) ?? null,
      verdict,
      checks,
      bodyHash,
      createdAt: (saved?.created_at as string) ?? new Date().toISOString(),
    },
  };
}

/** The most recent verdict for a page, whatever it said. */
export async function latestGateRun(pageId: string): Promise<GateRun | null> {
  const { data } = await supabaseAdmin
    .from("page_gate_runs")
    .select("id, verdict, checks, body_hash, created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    verdict: data.verdict as Verdict,
    checks: (data.checks as GateCheck[] | null) ?? [],
    bodyHash: data.body_hash as string,
    createdAt: data.created_at as string,
  };
}

export type GateBlockReason = "never_run" | "stale" | "blocked";

/** Thrown by assertGatePassed. Carries what the route answers with, like Day0NotArchivedError. */
export class GateBlockedError extends Error {
  readonly reason: GateBlockReason;
  readonly checks: GateCheck[];

  constructor(reason: GateBlockReason, message: string, checks: GateCheck[] = []) {
    super(message);
    this.name = "GateBlockedError";
    this.reason = reason;
    this.checks = checks;
  }
}

export function isGateError(e: unknown): e is GateBlockedError {
  return e instanceof GateBlockedError;
}

/**
 * THE GATE. Throws GateBlockedError when the page may not go live.
 *
 * Reads the body fresh and hashes it here rather than trusting anything the caller loaded, for
 * the same reason assertDay0Archived re-reads the client: this is the one place where being
 * convenient is worth less than being right.
 *
 * THREE WAYS TO FAIL, and they are different sentences on purpose. "Never checked", "checked,
 * then you edited it" and "checked and it failed" send a person to three different places, and
 * collapsing them into one message is how a gate becomes something nobody can act on.
 */
export async function assertGatePassed(clientId: string, pageId: string): Promise<GateRun> {
  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("answer_md")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (!data) throw new GateBlockedError("never_run", "That page does not exist.");

  const current = hashBody(((data.answer_md as string | null) ?? "").trim());
  const run = await latestGateRun(pageId);

  if (!run) {
    throw new GateBlockedError(
      "never_run",
      "This page has not been checked. Press Check, or type `check` in the page studio thread."
    );
  }

  if (run.bodyHash !== current) {
    throw new GateBlockedError(
      "stale",
      `The page changed after it was checked, so the ${run.verdict === "block" ? "verdict" : "pass"} ` +
        `describes text that is no longer on it. Check it again.`,
      run.checks
    );
  }

  if (run.verdict === "block") {
    const failed = run.checks.filter((c) => c.tier === "block" && c.status === "fail");
    throw new GateBlockedError(
      "blocked",
      `The quality gate refuses this page:\n` +
        failed.map((c) => `  - ${c.detail}`).join("\n"),
      run.checks
    );
  }

  return run;
}

/**
 * Publish anyway, on purpose, with a reason.
 *
 * !! A WAIVER IS RECORDED AS A VERDICT, NOT AS A FLAG, and reusing the table is the point.
 * It carries the body_hash of the text being waived, so a waiver goes stale the moment the page
 * is edited, exactly as a pass does. A boolean column on client_pages would survive a rewrite
 * and license publishing something nobody looked at.
 *
 * Loud by construction, the same way waiveDay0 is: a real reason is required, the actor is
 * recorded, and it is posted where somebody other than the person waiving will see it.
 */
export async function waiveGate(args: {
  clientId: string;
  pageId: string;
  reason: string;
  by: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    return {
      ok: false,
      error:
        "A waiver needs a real reason, in a sentence. It is read months later by somebody " +
        "working out why a page nobody could support went live.",
    };
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("answer_md, slug")
    .eq("id", args.pageId)
    .eq("client_id", args.clientId)
    .maybeSingle();

  if (!page) return { ok: false, error: "That page does not exist." };

  const previous = await latestGateRun(args.pageId);
  const failed = (previous?.checks ?? []).filter((c) => c.tier === "block" && c.status === "fail");

  const { error } = await supabaseAdmin.from("page_gate_runs").insert({
    page_id: args.pageId,
    client_id: args.clientId,
    verdict: "warn",
    checks: [
      ...(previous?.checks ?? []),
      {
        key: "waived",
        tier: "warn",
        status: "fail",
        detail: `Waived by ${args.by ?? "unknown"}: ${reason}`,
      },
    ],
    body_hash: hashBody(((page.answer_md as string | null) ?? "").trim()),
    model: previous?.id ? "waiver" : null,
    run_by: args.by,
  });

  if (error) return { ok: false, error: error.message };

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name")
    .eq("id", args.clientId)
    .maybeSingle();

  await postInfraAlert(
    `:no_entry: *Quality gate waived* on \`/${page.slug as string}\` for ` +
      `*${(client?.legal_name as string | null) ?? "a client"}* by ${args.by ?? "unknown"}.\n` +
      `> ${reason}\n` +
      (failed.length
        ? `It was refused for:\n${failed.map((c) => `  - ${c.detail.split("\n")[0]}`).join("\n")}\n`
        : "") +
      `This page can now publish to their live hub host.`
  ).catch(() => {});

  return { ok: true };
}

/** Loud failures go here. Same channel and same doctrine as day-zero.ts. */
async function postInfraAlert(text: string): Promise<void> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[hub/page-gate] SLACK_ALERTS_INFRA_CHANNEL unset. Alert dropped:", text);
    return;
  }
  await slack.postMessage(channel, text);
}

// ---------------------------------------------------------------------------
// Rendering a verdict
// ---------------------------------------------------------------------------

const MARK: Record<CheckStatus, string> = {
  pass: ":white_check_mark:",
  fail: ":x:",
  skip: ":heavy_minus_sign:",
};

/** The verdict as a Slack card. Failures first, because that is what gets acted on. */
export function renderVerdict(run: GateRun, pageSlug: string): string {
  const head =
    run.verdict === "block"
      ? `:no_entry: *Blocked* on \`/${pageSlug}\`. It cannot publish until these are fixed.`
      : run.verdict === "warn"
        ? `:warning: *Passed with warnings* on \`/${pageSlug}\`. It can publish.`
        : `:white_check_mark: *Passed* on \`/${pageSlug}\`.`;

  const ordered = [...run.checks].sort((a, b) => {
    const rank = (c: GateCheck) => (c.status === "fail" ? 0 : c.status === "skip" ? 1 : 2);
    return rank(a) - rank(b);
  });

  return [
    head,
    "",
    ...ordered.map((c) => `${MARK[c.status]} *${c.key}*${c.tier === "warn" ? " _(warning)_" : ""}\n    ${c.detail.replace(/\n/g, "\n    ")}`),
  ].join("\n");
}
