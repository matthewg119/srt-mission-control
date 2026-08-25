// The hard gate every prospect-facing draft passes before it reaches Slack.
//
// This is the difference between a rule and a hope. `linkWarning()` and `bannedPhraseWarnings()`
// already existed and they REPORT — the draft still posts, and a tired reader pastes it anyway.
// The rules here REJECT: the draft is re-generated up to LINTER_MAX_RETRIES times, and if it
// still fails, the failure reason is posted instead of the draft. Nothing that trips a rule here
// can reach a prospect by accident.
//
// What belongs here vs. as a warning: a rule is only a reject when it is deterministic and its
// violation is unambiguous. "Says 'schema' to a prospect" is checkable, so it rejects. "Reads a
// bit stiff" is not, so it is not a rule at all. When a check is real but its threshold is a
// judgement call (draft-1 length), it still rejects, but the constant lives in config/pitch.ts
// where it can be tuned without touching this logic.

import {
  BANNED_ABSOLUTES,
  BANNED_JARGON,
  DM_MAX_SENTENCES,
  LINTER_MAX_RETRIES,
  SEED_SENTENCE_ALLOWANCE,
  SKELETON_BODY_SENTENCES,
} from "@/config/pitch";
import { robotsVerdict, type RobotsCheck } from "./robots-check";
import { PERMISSION_CLOSE, type BeliefId } from "./email-assistant";

export type LintRule =
  | "seed-log"
  | "missing-close"
  | "double-ask"
  | "draft-1-length"
  | "dm-length"
  | "dm-cityless"
  | "robots-tease"
  | "banned-jargon"
  | "absolutes"
  | "unfilled-variable"
  | "reseeded-belief";

export interface LintFinding {
  rule: LintRule;
  /** One line, written to be posted to Slack as-is. */
  detail: string;
}

export interface LintResult {
  ok: boolean;
  findings: LintFinding[];
}

export interface LintInput {
  /** Prospect-facing text ONLY. Never pass the SEED LOG or the Slack footer through here. */
  body: string;
  subject?: string;
  /**
   * Which stage this is. Only `draft-1` is length-checked against the control skeleton.
   *
   * `dm` is the Instagram lane (dm-pitch.ts) and it is the one stage with NO sign-off and no
   * appended PERMISSION_CLOSE, because it is a chat message rather than an email. It is a stage
   * here rather than its own linter so that rules 3 to 6 below (the tease needing a real finding,
   * the jargon list, the banned absolutes, unfilled placeholders) keep applying to it unchanged.
   * A second linter would have started as a copy of those four rules and drifted from them.
   */
  stage: "draft-1" | "dm" | "nudge" | "reveal" | "belief" | "objection" | "delivery" | "package";
  /** Beliefs this draft claims to install. Exactly one is required once seeding is in play. */
  installs?: BeliefId[];
  /** Beliefs already installed in this thread. */
  alreadyInstalled?: BeliefId[];
  /** Tri-state, straight off the report row. */
  robots?: RobotsCheck;
  /** Straight off the report row. Same tri-state: null = never scanned, [] = scanned clean. */
  siteSignals?: Array<{ kind: string; detail: string }> | null;
  /** Leave undefined to auto-detect from the body, which is what every caller should do. */
  hasWebsiteTease?: boolean;
  /**
   * `dm` stage only: the scan ran with NO location in the questions.
   *
   * ‼️ IT GUARDS AGAINST A CLAIM ABOUT A SEARCH NOBODY MADE. When Matthew answers "I don't know" to
   * the city prompt, the questions go out as plain national ones. A draft that then says "when
   * someone asks ChatGPT for laser skin treatments in your area" describes a local result that was
   * never measured, on a message whose entire basis is that the reader can reproduce it. The
   * drafter is told not to; this is what makes it structural, because a prose guard is not a guard.
   */
  cityless?: boolean;
  /**
   * An objection reply is allowed, and required, to re-seed the belief that broke. Suppresses
   * rule 7 only — every other rule still applies.
   */
  isObjectionBranch?: boolean;
}

/** Sentence count over prose. Matches format-guard's counter so the two never disagree. */
function countSentences(s: string): number {
  const m = s.trim().match(/[.!?]+(?=\s|$)/g);
  return m ? m.length : s.trim() ? 1 : 0;
}

/**
 * Body minus the greeting and the sign-off block.
 *
 * Those are single lines by convention and counting them would make every well-formed email look
 * two sentences longer than it is — the same exclusion `paragraphSmell` makes for the same reason.
 */
function bodyOnly(body: string): string {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hasTerminator = (p: string) => /[.!?]/.test(p);
  if (paras.length && !hasTerminator(paras[0]) && paras[0].length < 60) paras.shift();
  while (paras.length && !hasTerminator(paras[paras.length - 1]) && paras[paras.length - 1].length < 60) paras.pop();
  return paras.join("\n\n");
}

/**
 * The "{placeholder}" scan.
 *
 * Deliberately narrow: `{lowercase_words}` only. A prospect email should never contain braces at
 * all, but a Stage 3 image prompt legitimately contains JSON-ish punctuation, and a scan broad
 * enough to catch `{ "type": ... }` would fail every package. An unfilled template slot always
 * looks like {BUSINESS_NAME} or {city}, so that is exactly what this matches.
 */
const PLACEHOLDER_RE = /\{[A-Za-z][A-Za-z0-9_]*\}/g;

/**
 * The "there's also something on your own site working against you" line, EN and ES.
 *
 * Auto-detected rather than passed in, because the line is written by the model and a caller
 * that had to remember to declare it would eventually forget.
 */
/**
 * The location phrases a model reaches for when it has no city and wants the sentence to feel local.
 *
 * Deliberately a PHRASE list rather than an attempt to detect "in <SomePlace>". A place-name
 * detector over free text is a guess, and a guess here either rejects good drafts on a capitalised
 * word or misses the one that matters. These are the constructions that actually appeared, plus
 * their nearest neighbours, and every one of them is unambiguously a claim about a local search.
 */
const CITYLESS_LOCATION_RE =
  /\b(?:in|near|around)\s+(?:your|the)\s+(?:area|city|town|region|neighbou?rhood)\b|\bnear\s+you\b|\blocally\b|\bin\s+town\b|\byour\s+local\s+(?:area|market)\b/i;

const WEBSITE_TEASE_RE =
  /\b(?:something|one thing|algo)\b[^.!?]{0,60}?\b(?:on|in|en)\b[^.!?]{0,25}?\b(?:your|their|su)\b[^.!?]{0,25}?\b(?:site|website|sitio|markup)\b/i;

export function mentionsOwnSiteIssue(body: string): boolean {
  return WEBSITE_TEASE_RE.test(body);
}

export function lintDraft(input: LintInput): LintResult {
  const findings: LintFinding[] = [];
  const text = `${input.subject ?? ""}\n${input.body}`;

  // 1 — exactly one belief, when seeding is in play at all.
  if (input.installs !== undefined && input.installs.length !== 1) {
    findings.push({
      rule: "seed-log",
      detail:
        input.installs.length === 0
          ? "No belief installed. Every prospect-facing draft seeds exactly one."
          : `Installs ${input.installs.length} beliefs (${input.installs.join(", ")}). One per email, never two.`,
    });
  }

  const hasTease = input.hasWebsiteTease ?? mentionsOwnSiteIssue(input.body);

  // 1b — a permission-stage email ends with the standard close, and with exactly one question.
  // ensurePermissionClose() appends it in code, so a failure here means something downstream
  // edited it back out, and a revision that quietly drops the ask is the worst way to lose a
  // reply: the email still reads fine and simply never asks for anything.
  if (input.stage === "draft-1" || input.stage === "nudge") {
    for (const line of PERMISSION_CLOSE) {
      if (!input.body.includes(line)) {
        findings.push({ rule: "missing-close", detail: `The close is missing or altered. It must contain, on its own line: "${line}"` });
      }
    }
    // Its own rule code, not missing-close (2026-08-10). Both findings used to post as
    // `missing-close`, so a draft that HAD the close and merely asked twice was reported to the
    // operator as having lost it. The message and the code said different things, which is how a
    // real six-day outage read as noise in Slack.
    const questions = (input.body.match(/\?/g) ?? []).length;
    if (questions > 1) {
      findings.push({
        rule: "double-ask",
        detail: `${questions} question marks aimed at the reader. A permission email asks exactly once, and the ask is the close.`,
      });
    }
  }

  // 2 — draft 1 must stay within the control skeleton plus the seed's allowance.
  if (input.stage === "draft-1") {
    const ceiling = SKELETON_BODY_SENTENCES + SEED_SENTENCE_ALLOWANCE + (hasTease ? 1 : 0);
    const actual = countSentences(bodyOnly(input.body));
    if (actual > ceiling) {
      findings.push({
        rule: "draft-1-length",
        detail: `Draft 1 runs ${actual} sentences; the control skeleton plus a seed allows ${ceiling}. Cut ${actual - ceiling}.`,
      });
    }
  }

  // 2b — the DM lane. Same intent as rule 2 and rule 1b, in the units a chat message is written
  // in: it is read in a narrow bubble on a phone, so length is the whole difference between a
  // note and a wall someone scrolls past. It gets NO missing-close check, since there is no close
  // to append, but it keeps the one-question rule for the same reason draft-1 has it: a message
  // that asks twice splits the reply.
  if (input.stage === "dm") {
    const actual = countSentences(bodyOnly(input.body));
    if (actual > DM_MAX_SENTENCES) {
      findings.push({
        rule: "dm-length",
        detail: `The DM runs ${actual} sentences; a DM allows ${DM_MAX_SENTENCES}. Cut ${actual - DM_MAX_SENTENCES}.`,
      });
    }
    const questions = (input.body.match(/\?/g) ?? []).length;
    if (questions > 1) {
      findings.push({
        rule: "double-ask",
        detail: `${questions} question marks aimed at the reader. A DM asks exactly once, and the ask is the close.`,
      });
    }

    // 2c — a cityless run may not emit a city-shaped sentence. See LintInput.cityless.
    if (input.cityless) {
      const m = CITYLESS_LOCATION_RE.exec(input.body);
      if (m) {
        findings.push({
          rule: "dm-cityless",
          detail:
            `Says "${m[0].trim()}", but no city was known and the questions were asked with no ` +
            "location in them. That is a claim about a local search nobody ran. Cut the location.",
        });
      }
    }
  }

  // 3 — the "something on your own site" tease needs a real finding under it, and there are TWO
  // different findings that qualify:
  //
  //   site_signals    stale copyright, no viewport, http, no markup, no phone. This is what the
  //                   shipped email-1 hook has always meant, and it is the common case.
  //   robots_check    a blocked SEARCH crawler. Only "devastating" counts: a blocked GPTBot is a
  //                   training opt-out and does not keep them out of today's answers.
  //
  // Rejecting on robots alone would kill every legitimate site-signals tease, so the rule is
  // "neither supports it". Both undefined means the caller is not claiming anything either way.
  if (hasTease && (input.robots !== undefined || input.siteSignals !== undefined)) {
    const robotsSupports = robotsVerdict(input.robots ?? null) === "devastating";
    const signalsSupport = (input.siteSignals ?? []).length > 0;
    if (!robotsSupports && !signalsSupport) {
      const neverScanned = (input.robots ?? null) === null && (input.siteSignals ?? null) === null;
      findings.push({
        rule: "robots-tease",
        detail: neverScanned
          ? "Carries the 'something on your own site' tease, but neither the site scan nor the robots check ran. There is no finding to stand behind it."
          : "Carries the 'something on your own site' tease with nothing to back it: the site scan is clean and no search crawler is blocked. Cut the line rather than manufacture a problem.",
      });
    }
  }

  // 4 — jargon the owner does not speak.
  for (const { pattern, term, sayInstead } of BANNED_JARGON) {
    if (pattern.test(text)) {
      findings.push({ rule: "banned-jargon", detail: `Says "${term}" to the prospect. Say "${sayInstead}" instead.` });
    }
  }

  // 5 — absolutes. One of these discredits every other sentence in the email.
  for (const { pattern, detail } of BANNED_ABSOLUTES) {
    if (pattern.test(text)) {
      findings.push({ rule: "absolutes", detail: `Absolute claim: "${detail}". Hedge it ("more and more") or cut it.` });
    }
  }

  // 6 — unfilled template slots.
  const placeholders = [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
  if (placeholders.length > 0) {
    findings.push({ rule: "unfilled-variable", detail: `Unfilled placeholder(s): ${placeholders.join(", ")}.` });
  }

  // 7 — never re-install a belief. An objection reply is the deliberate exception.
  if (!input.isObjectionBranch && input.installs?.length && input.alreadyInstalled?.length) {
    const repeats = input.installs.filter((b) => input.alreadyInstalled!.includes(b));
    if (repeats.length > 0) {
      findings.push({
        rule: "reseeded-belief",
        detail: `${repeats.join(", ")} already installed in this thread. Repeating a seed reads as not listening.`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

/** Slack-ready block, posted ABOVE a draft that passed with notes, or INSTEAD of one that failed. */
export function formatLintFindings(findings: LintFinding[]): string {
  return findings.map((f) => `:no_entry: *${f.rule}* — ${f.detail}`).join("\n");
}

export interface GatedDraft<T> {
  draft: T | null;
  findings: LintFinding[];
  attempts: number;
  /**
   * The last attempt that failed, kept so a refusal can SHOW its work.
   *
   * Null only when `draft` is set. It is never approved and must always be posted under the
   * findings, labelled as rejected — see the caller in thread-assistant.ts.
   */
  lastRejected: T | null;
}

/**
 * Generate, lint, and retry.
 *
 * `produce` gets the previous attempt's findings so the retry prompt can name what to fix rather
 * than rolling the dice again. After LINTER_MAX_RETRIES the draft is refused: `draft` comes back
 * null and the caller posts the findings, never a silent pass.
 *
 * The rejected draft is RETAINED (2026-08-10). It used to go out of scope each iteration, so a
 * refusal left the operator with three reasons, no text, and nothing logged — and when the cause
 * was a contradiction between the prompt and the code, rephrasing the request could not fix it
 * and there was no way to see that from Slack. Same precedent as buildFollowupScript(), which
 * keeps its last shape-valid payload rather than handing back nothing.
 */
export async function draftWithLint<T>(
  produce: (attempt: number, previous: LintFinding[]) => Promise<T>,
  toLintInput: (draft: T) => LintInput,
  maxRetries: number = LINTER_MAX_RETRIES
): Promise<GatedDraft<T>> {
  let findings: LintFinding[] = [];
  let lastRejected: T | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const draft = await produce(attempt, findings);
    const result = lintDraft(toLintInput(draft));
    if (result.ok) return { draft, findings: [], attempts: attempt + 1, lastRejected: null };
    findings = result.findings;
    lastRejected = draft;
  }
  return { draft: null, findings, attempts: maxRetries + 1, lastRejected };
}

/** The instruction appended to a retry prompt, so attempt 2 knows what attempt 1 got wrong. */
export function retryInstruction(findings: LintFinding[]): string {
  if (findings.length === 0) return "";
  return [
    "The previous attempt was REJECTED. Fix every point below and change nothing else:",
    ...findings.map((f) => `- ${f.detail}`),
  ].join("\n");
}
