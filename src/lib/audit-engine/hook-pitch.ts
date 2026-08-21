// The EMAIL HOOK lane: a measured door knock sent BEFORE any audit is spent.
//
// Why it exists. A full audit is 20 engine calls, a PDF, a scorecard and a Slack thread, and
// until 2026-08-21 it was the only way to reach a prospect who has a website: every follow-on
// button is disabled until a report is `done`. So the first email to a stranger cost a whole
// audit, and most of those emails are never opened. This lane inverts that. It runs FOUR buyer
// questions instead of twenty, drafts one email off what they returned, and the audit is spent
// only on the people who reply.
//
// ‼️ IT IS A REAL SCAN, JUST A SMALL ONE, AND THAT IS THE WHOLE DESIGN. Every number and every
// name in the email comes from an engine call made moments earlier. The cheap version of this
// feature — ask a model to write a plausible cold email about a business — was never on the
// table: see project_audit_engine_single_engine, where an outage published a fabricated 0/100
// scorecard because `no_data` was scored as a confirmed absence. The rules that came out of
// that incident are load-bearing here:
//
//   - `appeared: null` means WE DO NOT KNOW. It is never counted as a miss. The fraction in the
//     email is over `measuredCount`, not over HOOK_PROMPT_COUNT.
//   - A rival may be named only when extractRecommendedBatch pulled it out of an answer we
//     actually received. classification.likely_competitors is a HYPOTHESIS (classify.ts) and is
//     never quoted at a prospect.
//   - The "something on your own site" tease requires a real site scan. draft-linter.ts rejects
//     it as `robots-tease`/`neverScanned` otherwise, and that gate is left to do its job rather
//     than worked around.
//
// This is the No-website lane pointed at a business that HAS a site. It is a separate file
// rather than a flag on no-website-pitch.ts because that file's angles, its context builder and
// NO_WEBSITE_LINE are all premised on there being nothing of theirs to read — the opposite
// premise. Only the premise differs: every guard, linter, formatter and rule block below is
// IMPORTED from the shared library, never restated. A second prompt assembly here would bypass
// the linter silently and the failure would look like slightly worse copy rather than a bug.

import { runOpenAI } from "./run-prompts";
import { researchWebsite, isThinResearch, SiteFetchError, type SiteResearch } from "./site-research";
import { detectSiteSignals, type SiteSignal } from "./site-signals";
import { checkRobots, robotsVerdict, searchBotFindings, type RobotsCheck } from "./robots-check";
import { classifyBusiness, type AuditPrompt } from "./classify";
import { extractRecommendedBatch } from "./extract-recommended";
import { buildAliases, isMentioned, isClientName } from "./mention-match";
import { callClaudeText } from "@/lib/claude-calls";
import {
  PERMISSION_PERSONA,
  PARAGRAPH_RULES,
  VOICE_RULES,
  STYLE_RULES,
  COMPLIANCE_RULES,
  prePitchRules,
  permissionExample,
  noDashes,
  enforceLinkPolicy,
  ensurePermissionClose,
  ensureSignoff,
  type GuardedDraft,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import { draftWithLint, retryInstruction } from "./draft-linter";
import {
  ensureGreeting,
  parseSubjectAndBody,
  pitchSubject,
  stripEchoedClose,
} from "./no-website-pitch";
import {
  HOOK_PRETEXT_LINE,
  NAME_COMPETITORS_IN_COLD_EMAIL,
  hookFractionLine,
} from "@/config/pitch";

/**
 * How many buyer questions the hook runs.
 *
 * Four, not twenty. Exported so the button's hint, the Slack card and the copy cannot disagree
 * about the number — the denominator appears in the email itself, so a literal anywhere else
 * would be a claim that drifts.
 */
export const HOOK_PROMPT_COUNT = 4;

function model(): "claude-opus-4-7" | "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

// ─────────────────────────────────────────────────────────────────────────────
// The scan
// ─────────────────────────────────────────────────────────────────────────────

export interface HookPromptResult {
  prompt: string;
  /** Did the engine name this business? NULL when the call returned no data at all. */
  appeared: boolean | null;
  /** Businesses the engine named instead, in the order it gave them. */
  named: string[];
}

export interface HookCheck {
  businessName: string;
  /** What they sell, in buyer words. Drives nothing on its own; quoted to the drafter. */
  trade: string;
  city: string | null;
  website: string;
  results: HookPromptResult[];
  /** Questions that came back with a usable answer. THE DENOMINATOR of the email's fraction. */
  measuredCount: number;
  /** Measured questions in which they were named. THE NUMERATOR. */
  appearedCount: number;
  /** The rival named in the most answers, or null. Only ever a name an engine actually returned. */
  topRival: { name: string; count: number } | null;
  /**
   * ‼️ TRI-STATE, and it must not be collapsed. `[]` means we scanned and the site was clean,
   * which forbids the tease; `null` would mean nobody looked. This lane always scans, so null
   * only appears if the crawl itself failed.
   */
  siteSignals: SiteSignal[] | null;
  robots: RobotsCheck;
  /** True when the pages were read directly, false when only search could describe them. */
  readTheirPages: boolean;
}

export type HookCheckOutcome =
  | { ok: true; check: HookCheck }
  | { ok: false; detail: string };

/**
 * Which four of the twenty questions to actually ask.
 *
 * SERVICIO first, then COMPARATIVO. Those are the two blocks with a buyer behind them: someone
 * asking who does this locally, or who is better at it, has already decided to spend money. INFO
 * is research, and MARCA is somebody who already knows the brand's name and therefore proves
 * nothing about being discovered. An email built on a MARCA miss would be reporting that a
 * stranger's business did not come up when we typed the stranger's business into a search box.
 */
function pickHookPrompts(prompts: AuditPrompt[]): string[] {
  const rank = (b: AuditPrompt["block"]) => (b === "SERVICIO" ? 0 : b === "COMPARATIVO" ? 1 : 2);
  return [...prompts]
    .filter((p) => p.block === "SERVICIO" || p.block === "COMPARATIVO")
    .sort((a, b) => rank(a.block) - rank(b.block))
    .map((p) => p.prompt.trim())
    .filter(Boolean)
    .slice(0, HOOK_PROMPT_COUNT);
}

/**
 * Crawl the site, scan it, classify it, then ask four real buyer questions.
 *
 * ‼️ ONLY OUR OWN FAILURES RETURN ok:false. A prospect who does not show up anywhere is the
 * strongest finding this lane has, not an error. But a crawl that could not run, a classifier
 * that threw, or four engine calls that all came back empty say something about OUR
 * infrastructure and nothing whatsoever about the prospect, and dressing those up as a finding
 * is how a dead API key becomes a sentence in a stranger's inbox. Same doctrine as
 * MiniCheckOutcome in no-website-pitch.ts.
 */
export async function runHookCheck(
  website: string,
  businessNameHint: string,
  city?: string | null
): Promise<HookCheckOutcome> {
  // 1. Read their site. researchWebsite already falls back to search-built research when the
  //    fetch is blocked, so a Cloudflare interstitial does not end the run.
  let research: SiteResearch;
  try {
    research = await researchWebsite(website);
  } catch (e) {
    const detail =
      e instanceof SiteFetchError
        ? `Could not read ${website}: ${e.message}`
        : `Could not read ${website}: ${(e as Error).message}`;
    return { ok: false, detail };
  }

  if (isThinResearch(research)) {
    return {
      ok: false,
      detail:
        `${website} loaded but there was too little on it to work out what they sell, so the ` +
        "questions would have been generic. Nothing was drafted.",
    };
  }

  // 2. Scan the site. ‼️ THIS IS WHAT LICENSES THE "one thing on your own site" LINE. Without a
  //    real result here the draft linter rejects that tease as neverScanned, and it should.
  //    detectSiteSignals is pure over markup we already have, so it costs no extra request.
  const readTheirPages = research.source === "site" || research.source === "site+search";
  const siteSignals: SiteSignal[] | null =
    readTheirPages && research.homepageHtml
      ? detectSiteSignals({
          html: research.homepageHtml,
          website: research.website ?? website,
          schemaHints: research.schemaHints,
          currentYear: new Date().getFullYear(),
        })
      : null;
  const robots = await checkRobots(website).catch(() => null);

  // 3. Work out who they are and what a buyer would ask. The questions are model-written HERE,
  //    where no-website-pitch.ts deliberately uses templates, and the difference is the site:
  //    that lane cannot see one, so a written question could invent a service they do not offer.
  //    We crawled these pages, so their services are read facts. It is also the only way to get
  //    a question as specific as "licensed electrician for a panel upgrade or EV charger install".
  let classification;
  try {
    classification = await classifyBusiness(research, {
      city: city?.trim() || undefined,
      businessName: businessNameHint.trim() || undefined,
    });
  } catch (e) {
    return { ok: false, detail: `Could not work out what this business sells: ${(e as Error).message}` };
  }

  const resolvedCity = city?.trim() || classification.city_detected || null;
  const businessName = classification.business_name?.trim() || businessNameHint.trim();
  const aliases = buildAliases(businessName, research.website ?? website);
  const prompts = pickHookPrompts(classification.prompts);

  if (prompts.length === 0) {
    return { ok: false, detail: "The classifier returned no buying questions to ask." };
  }

  // 4. Ask them. In parallel: four calls in front of somebody watching a button.
  const raw = await Promise.all(
    prompts.map(async (prompt) => {
      const r = await runOpenAI(prompt, resolvedCity);
      // status:"no_data" is "we do not know", NEVER "they were absent". Conflating the two is
      // exactly the defect that published a fabricated zero. See run-prompts.ts.
      if (r.status !== "ok" || !r.raw) return { prompt, appeared: null as boolean | null, text: "" };
      return { prompt, appeared: isMentioned(r.raw, aliases), text: r.raw };
    })
  );

  const measuredCount = raw.filter((r) => r.appeared !== null).length;
  if (measuredCount === 0) {
    return {
      ok: false,
      detail:
        "None of the engine calls came back, so there is nothing measured to write from. That is " +
        "about our side, not about this prospect. Press Email hook again.",
    };
  }

  // 5. Who came back instead. ONE Haiku call over the whole batch, and it is the same extractor
  //    the real audit uses to fill audit_runs.recommended — so "who came back" means the same
  //    thing in a hook as it does in a report. namesFrom() in no-website-pitch.ts is deliberately
  //    NOT used: its own comment says it is crude because it only ever feeds a prompt, and this
  //    email attaches a claim to the name it prints.
  const extracted = await extractRecommendedBatch(
    raw.filter((r) => r.text).map((r, i) => ({ id: String(i), text: r.text }))
  );

  const results: HookPromptResult[] = [];
  const rivalCounts = new Map<string, { display: string; count: number }>();
  let cursor = 0;
  for (const r of raw) {
    let named: string[] = [];
    if (r.text) {
      named = (extracted[String(cursor)] ?? [])
        .map((n) => n.trim())
        .filter((n) => n && !isClientName(n, aliases));
      cursor += 1;
      // Count each rival ONCE PER ANSWER, the way report-view.ts ranks mostRecommended, so
      // "came back in most of them" counts answers and not mentions.
      for (const name of new Set(named.map((n) => n.toLowerCase()))) {
        const display = named.find((n) => n.toLowerCase() === name) ?? name;
        const existing = rivalCounts.get(name);
        if (existing) existing.count += 1;
        else rivalCounts.set(name, { display, count: 1 });
      }
    }
    results.push({ prompt: r.prompt, appeared: r.appeared, named });
  }

  const ranked = [...rivalCounts.values()].sort((a, b) => b.count - a.count);
  const topRival = ranked.length > 0 ? { name: ranked[0].display, count: ranked[0].count } : null;

  return {
    ok: true,
    check: {
      businessName,
      trade: classification.business_type,
      city: resolvedCity,
      website: research.website ?? website,
      results,
      measuredCount,
      appearedCount: results.filter((r) => r.appeared === true).length,
      topRival,
      siteSignals,
      robots,
      readTheirPages,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The angles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ PICKED BY WHAT THE SCAN FOUND, never by the model's preference, and gated in BOTH
 * directions. An absence angle handed to a business that showed up everywhere is a lie the
 * prospect disproves from his phone in thirty seconds, and it costs the lead permanently. Same
 * structure and same reasoning as pickAngle() in no-website-pitch.ts.
 */
interface HookAngle {
  id: string;
  /** Requires at least one measured question they did NOT appear in. */
  needsMiss: boolean;
  /** Requires a rival an engine actually named. */
  needsRival: boolean;
  /** Requires that they appeared in every measured question. The mirror gate. */
  needsCleanSweep: boolean;
  finding: string;
}

const HOOK_ANGLES: HookAngle[] = [
  {
    // The reference email. Absence, proven by the name that took the slot.
    id: "rival-substitute",
    needsMiss: true,
    needsRival: true,
    needsCleanSweep: false,
    finding:
      "The finding is that you put a real buying question to the engine, it answered with a list " +
      "of businesses, and this prospect was not on it. Quote the question you asked, in quotes, " +
      "on its own line. State the fraction you were given and nothing else numeric. Then name the " +
      "ONE rival that kept coming back, and say how often it came back in the same terms you were " +
      "given. Do not editorialise about that rival, do not say it is better, and do not suggest " +
      "it let anyone down: you are reporting what an engine returned, which they can reproduce.",
  },
  {
    id: "buying-question",
    needsMiss: true,
    needsRival: false,
    needsCleanSweep: false,
    finding:
      "The finding is that somebody asking who to hire has already decided to buy, and the engine " +
      "answered that question without this business in it. Quote the question you asked, in " +
      "quotes, on its own line, then state the fraction. Do NOT list the names that did come back.",
  },
  {
    id: "site-signal",
    needsMiss: false,
    needsRival: false,
    needsCleanSweep: false,
    finding:
      "The finding is the thing on their own site that works against them in those answers. Say " +
      "that you found it and what KIND of thing it is, never the fix and never the detail. It is " +
      "withheld on purpose: it is what the video is for.",
  },
  {
    id: "present-but-thin",
    needsMiss: false,
    needsRival: false,
    needsCleanSweep: true,
    finding:
      "The finding is that they DID come back in the questions you asked, and this email must say " +
      "so plainly and without hedging. You must NOT tell them they are invisible, missing, or " +
      "losing anything. What you may say is that every word the engine used to describe them was " +
      "written by somebody else, so the description is not theirs and it is not under their " +
      "control. Nothing in this email may read as bad news about their visibility.",
  },
];

export function pickHookAngle(check: HookCheck): HookAngle {
  const misses = check.results.filter((r) => r.appeared === false).length;
  const hasRival = Boolean(check.topRival) && NAME_COMPETITORS_IN_COLD_EMAIL;
  const cleanSweep = misses === 0;
  const teaseAllowed = teaseIsLicensed(check);

  for (const a of HOOK_ANGLES) {
    if (a.needsMiss && misses === 0) continue;
    if (a.needsRival && !hasRival) continue;
    if (a.needsCleanSweep && !cleanSweep) continue;
    if (a.id === "site-signal" && !teaseAllowed) continue;
    return a;
  }
  // They appeared everywhere and there is no site finding: the only true thing left is that
  // their description belongs to other people.
  return HOOK_ANGLES[HOOK_ANGLES.length - 1];
}

/**
 * May this email carry the "something on your own site" tease?
 *
 * Mirrors draft-linter.ts's robots-tease rule exactly, and it has to: the linter is the one that
 * enforces it, so a mismatch here would build an email designed to be rejected. Empty signals
 * plus a clean robots.txt is a REAL answer meaning the site is fine, and it forbids the tease.
 */
function teaseIsLicensed(check: HookCheck): boolean {
  if (robotsVerdict(check.robots) === "devastating") return true;
  return (check.siteSignals ?? []).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts block
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the drafter may treat as fact. Sibling of reportContext() and miniCheckContext().
 *
 * ‼️ THE FRACTION IS COMPUTED HERE AND HANDED OVER AS A FINISHED PHRASE. Left to derive it, a
 * model counts the questions it can see (four) rather than the ones that were answered, and a
 * single failed call silently becomes a bigger denominator than we measured. Handing over the
 * arithmetic is the same discipline as appending PERMISSION_CLOSE in code.
 */
export function hookCheckContext(check: HookCheck): string {
  const lines: string[] = [
    `Business: ${check.businessName}`,
    `What they do: ${check.trade}`,
    `City: ${check.city ?? "unknown"}`,
    `Their website: ${check.website}`,
    "",
    `Questions actually put to ChatGPT (${check.results.length}):`,
  ];

  for (const r of check.results) {
    const verdict =
      r.appeared === null
        ? "NO ANSWER came back, so this question proves nothing and must not be counted or quoted"
        : r.appeared
          ? "they WERE named"
          : "they were NOT named";
    const named = r.named.length ? ` Named instead: ${r.named.join(", ")}.` : "";
    lines.push(`- "${r.prompt}" -> ${verdict}.${named}`);
  }

  lines.push(
    "",
    "‼️ THIS SENTENCE IS FIXED. Reproduce it VERBATIM, word for word, as its own paragraph. Do " +
      "not reword it, do not customise it to this business, do not convert it to a percentage, " +
      "do not round it, do not add an adjective, and do not add a second number anywhere in the " +
      "email. You may add a full stop at the end and nothing else:",
    fractionPhrase(check)
  );

  if (check.topRival && NAME_COMPETITORS_IN_COLD_EMAIL) {
    lines.push(
      "",
      `The one rival you may name: ${check.topRival.name}. It came back in ${rivalPhrase(check)}. ` +
        "You may name ONLY this business, and only in those terms. Every other name above is " +
        "context for you and must not appear in the email."
    );
  } else {
    lines.push("", "You may NOT name any competitor in this email.");
  }

  if (teaseIsLicensed(check)) {
    const detail =
      robotsVerdict(check.robots) === "devastating"
        ? searchBotFindings(check.robots)[0]?.detail ??
          "their robots.txt turns away a search crawler"
        : check.siteSignals?.[0]?.detail ?? "";
    lines.push(
      "",
      "You looked at their site and found something working against them there. FOR YOUR " +
        `UNDERSTANDING ONLY, do NOT state it: ${detail}`,
      "You may tease that you found one thing on their own site and that most businesses in " +
        "their trade never catch it. You may NOT say what it is, name the page, or hint at the " +
        "fix. It is what the video is for."
    );
  } else {
    lines.push(
      "",
      "‼️ You scanned their site and found NOTHING wrong with it. You must NOT write that there " +
        "is something on their site working against them, or tease any site finding at all. " +
        "There isn't one, and this is a real answer rather than a gap to fill."
    );
  }

  if (!check.readTheirPages) {
    lines.push(
      "",
      "‼️ Their site could not be read directly; everything above about them came from other " +
        "sources. Do not claim to have read their pages."
    );
  }

  return lines.join("\n");
}

/**
 * The one number this email prints, in the one wording it is allowed to print it in.
 *
 * Delegates to config/pitch.ts: the wording is a constant so it does not drift take to take, and
 * so changing it is one edit rather than a hunt through prompt text. See hookFractionLine.
 */
export function fractionPhrase(check: HookCheck): string {
  return hookFractionLine(check.appearedCount, check.measuredCount);
}

/**
 * Did the draft actually keep the fixed line?
 *
 * ‼️ CHECKED IN CODE, because asking is not a guarantee. The prompt says reproduce it verbatim,
 * and a model under a word limit still paraphrases — "you showed up in just one of four" is the
 * failure, and it is invisible unless something looks for it. This does NOT rewrite the body:
 * there is no safe way to find and replace a sentence that was reworded, and a bad splice would
 * be worse than a flagged one. It raises a warning that rides the Slack card and the timeline
 * note, exactly like removedLinks and formatNote do.
 *
 * Punctuation-tolerant: the drafter ends the sentence with a period the constant does not carry.
 */
function fractionWarningFor(body: string, check: HookCheck): string | null {
  const want = fractionPhrase(check);
  const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/[.,]/g, "").toLowerCase();
  if (normalize(body).includes(normalize(want))) return null;
  return `The fixed line was reworded. It must read exactly: "${want}". Check the draft before sending.`;
}

function rivalPhrase(check: HookCheck): string {
  const n = check.topRival?.count ?? 0;
  if (n >= check.measuredCount) return "every one of them";
  if (n === 1) return "one of them";
  return `${n} of them`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The draft
// ─────────────────────────────────────────────────────────────────────────────

export interface HookDraft extends GuardedDraft {
  angle: string;
  /** Set when the linter refused every attempt. The body is then the last REJECTED attempt and
   *  the caller must label it as such, never post it as approved. */
  rejectedFindings: string[];
  /** Set when the model paraphrased the fixed fraction line instead of reproducing it. */
  fractionWarning: string | null;
}

/**
 * Write the hook email.
 *
 * The rule stack is imported wholesale — prePitchRules (no links, no price, no close, one
 * finding, under 120 words), the paragraph and voice rules, the compliance rules and the
 * reference email — and then gated by draftWithLint. Nothing here restates a rule that already
 * exists somewhere else, which is what keeps this lane honest by construction rather than by
 * review.
 */
export async function draftHookPitch(
  check: HookCheck,
  recipientFirstName?: string | null,
  instructions?: string | null
): Promise<HookDraft> {
  const angle = pickHookAngle(check);
  const subject = pitchSubject(check.businessName);

  const gated = await draftWithLint(
    async (_attempt, previous) => {
      const { text } = await callClaudeText({
        model: model(),
        system: [
          PERMISSION_PERSONA,
          // ‼️ CORRECTS THE PERSONA'S OPENING LINE, which says an audit was run. Four questions
          // is not an audit, and letting the model believe otherwise is how "I ran your report"
          // ends up in an email about a scan that produced no report.
          "SCOPE, and it is narrower than the line above implies: what was actually run is " +
            `${check.results.length} buyer questions put to ChatGPT with web search on, plus a ` +
            "read of their website. You may say you ran their business through the AI engines " +
            "and that you looked at what came back. You may NOT call it an audit, a report, a " +
            "full analysis, or a score, because none of those were produced.",
          "This is the very first touch. Its only job is to earn a yes to sending the video.",
          `THE ONE FINDING: ${angle.finding}`,
          HOOK_PRETEXT_LINE,
          prePitchRules(null),
          permissionExample(null),
          PARAGRAPH_RULES,
          VOICE_RULES,
          STYLE_RULES,
          "Do NOT write a subject line. One is added for you; start with the first sentence.",
          "GREETING: do NOT write one. A greeting is added for you. Start on your first finding " +
            "sentence. Never greet the business by its name.",
          COMPLIANCE_RULES,
        ].join("\n"),
        user: [
          `What is actually known about this prospect. Use only this, invent nothing:\n${hookCheckContext(check)}`,
          instructions
            ? `\nMatthew's instructions, verbatim. These OUTRANK the generic guidance above, follow them literally:\n"""\n${instructions}\n"""`
            : "",
          retryInstruction(previous),
          "\nWrite the email now.",
        ]
          .filter(Boolean)
          .join("\n"),
        maxTokens: 700,
        temperature: 0.6,
      });
      const parsed = parseSubjectAndBody(text);
      return { subject: parsed.subject, body: parsed.body };
    },
    (d) => ({
      body: d.body,
      subject: d.subject,
      stage: "draft-1" as const,
      // ‼️ REAL VALUES, and this is the difference from the no-website lane, which passes null
      // for both and is therefore refused the site tease. We scanned, so the linter can check
      // the tease against a finding instead of rejecting it as unbacked.
      siteSignals: check.siteSignals,
      robots: check.robots,
    })
  );

  const chosen = gated.draft ?? gated.lastRejected;
  if (!chosen) {
    return {
      angle: angle.id,
      subject,
      body: "",
      removedLinks: [],
      formatNote: null,
      rejectedFindings: gated.findings.map((f) => `${f.rule}: ${f.detail}`),
      fractionWarning: null,
    };
  }

  const body = enforceLinkPolicy(noDashes(chosen.body), { mode: "none" });
  // allowEmphasis:true is the one deviation from every other pre-pitch lane, and it is required:
  // stripEmphasis would otherwise delete the bold HOOK_PRETEXT_LINE asks for. Not new machinery,
  // the reveal stage already uses this flag for its price line.
  const polished = await polishBody(stripEchoedClose(body.text), { allowEmphasis: true });
  const finalBody = ensureSignoff(ensurePermissionClose(ensureGreeting(polished.body, recipientFirstName)));

  return {
    angle: angle.id,
    subject,
    body: finalBody,
    removedLinks: body.removed,
    formatNote: polished.note,
    rejectedFindings: gated.draft ? [] : gated.findings.map((f) => `${f.rule}: ${f.detail}`),
    fractionWarning: fractionWarningFor(finalBody, check),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** `**bold**` -> Slack's `*bold*`. Slack mrkdwn uses single asterisks; doubles render literally. */
export function toSlackBold(s: string): string {
  return s.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "*$1*");
}

/**
 * The Slack card.
 *
 * ‼️ IT PRINTS THE QUESTIONS AND THE VERDICTS ABOVE THE DRAFT, not just the draft. The email
 * states one finding as fact, and the only way to know whether that fact is right is to see what
 * it came from. Same reasoning as formatNoWebsitePitchNote and the 20-prompt drop.
 */
export function formatHookCard(
  check: HookCheck,
  draft: HookDraft,
  drafts: Array<{ mailbox: string | null; url: string }>,
  mailboxNote: string
): string {
  const lines: string[] = [];

  lines.push(
    draft.rejectedFindings.length
      ? `:warning: *Email hook REJECTED by the linter* — *${check.businessName}*`
      : `:fishing_pole_and_fish: *Email hook drafted* — *${check.businessName}*`
  );
  lines.push(
    `Appeared in ${check.appearedCount} of ${check.measuredCount} measured${
      check.results.length !== check.measuredCount
        ? ` (${check.results.length - check.measuredCount} question(s) got no answer)`
        : ""
    } · angle \`${draft.angle}\``
  );

  if (mailboxNote) lines.push(mailboxNote);
  for (const d of drafts) lines.push(`<${d.url}|✉️ Open draft in ${d.mailbox ?? "your inbox"}>`);

  lines.push("", "*Questions asked:*");
  for (const r of check.results) {
    const verdict = r.appeared === null ? "no answer" : r.appeared ? "named" : "NOT named";
    const named = r.named.length ? ` · instead: ${r.named.join(", ")}` : "";
    lines.push(`• "${r.prompt}" → ${verdict}${named}`);
  }

  if (check.topRival) lines.push("", `*Top rival:* ${check.topRival.name} (${check.topRival.count}x)`);

  if (check.siteSignals === null) {
    lines.push("", "*Site scan:* could not read their pages directly");
  } else if (check.siteSignals.length === 0) {
    lines.push("", "*Site scan:* clean, no tease permitted");
  } else {
    lines.push("", `*Site signals:* ${check.siteSignals.map((s) => s.kind).join(", ")}`);
  }
  if (robotsVerdict(check.robots) === "devastating") {
    lines.push(`*robots.txt:* blocks a search crawler`);
  }

  if (draft.rejectedFindings.length) {
    lines.push("", "*The linter refused this draft. Shown below as rejected, do not send it:*");
    for (const f of draft.rejectedFindings) lines.push(`• ${f}`);
  }
  if (draft.fractionWarning) lines.push("", `:warning: ${draft.fractionWarning}`);
  if (draft.removedLinks.length) lines.push("", `Links stripped: ${draft.removedLinks.join(", ")}`);
  if (draft.formatNote) lines.push(draft.formatNote);

  lines.push("", `*Subject:* ${draft.subject}`, "", toSlackBold(draft.body));

  return lines.join("\n");
}

/** The lead-timeline note. Plain text: the timeline renders no mrkdwn and no <url|label> links. */
export function formatHookNote(
  check: HookCheck,
  draft: HookDraft,
  drafts: Array<{ mailbox: string | null; url: string }>,
  mailboxNote: string,
  slackUrl: string | null
): string {
  const lines: string[] = [];

  if (mailboxNote) lines.push(mailboxNote);
  for (const d of drafts) lines.push(`Open in ${d.mailbox ?? "your inbox"}: ${d.url}`);
  if (slackUrl) lines.push(`Card in Slack: ${slackUrl}`);

  lines.push(
    "",
    `Appeared in ${check.appearedCount} of ${check.measuredCount} measured questions. Angle: ${draft.angle}.`
  );

  for (const r of check.results) {
    const verdict = r.appeared === null ? "no answer" : r.appeared ? "named" : "NOT named";
    const named = r.named.length ? ` Instead: ${r.named.join(", ")}.` : "";
    lines.push(`- "${r.prompt}" -> ${verdict}.${named}`);
  }

  if (check.topRival) lines.push("", `Top rival: ${check.topRival.name} (${check.topRival.count}x)`);

  if (draft.rejectedFindings.length) {
    lines.push("", "THE LINTER REFUSED THIS DRAFT. Do not send it as written:");
    for (const f of draft.rejectedFindings) lines.push(`- ${f}`);
  }
  if (draft.fractionWarning) lines.push("", draft.fractionWarning);
  if (draft.removedLinks.length) lines.push("", `Links stripped: ${draft.removedLinks.join(", ")}`);
  if (draft.formatNote) lines.push(draft.formatNote);

  lines.push("", `Subject: ${draft.subject}`, "", draft.body);

  return lines.join("\n");
}
